import { Injectable } from '@nestjs/common';
import { SetPermission } from '../../authorization/entities/permission.entity';
import { formatDate } from '../../shared/utils/portal-view.util';
import { AnalyticsService, Totals } from './analytics.service';

const CURRENCY = 'KES';
export const OVERVIEW_DAYS = 30;

export const count = (value: number) => value.toLocaleString('en-KE');
export const money = (value: number) =>
  `${CURRENCY} ${Math.abs(value).toLocaleString('en-KE', {
    minimumFractionDigits: value % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
export const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : '–';

/** "+12% vs previous 30 days", toned by whether up is good. */
const change = (now: number, before: number, upIsGood = true) => {
  if (!before) return null;
  const diff = Math.round(((now - before) / before) * 100);
  return {
    text: `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff)}% vs previous ${OVERVIEW_DAYS} days`,
    tone: diff === 0 ? 'flat' : diff > 0 === upIsGood ? 'good' : 'bad',
  };
};

/** "5 min ago", "3 h ago", "2 days ago", or the date. */
export const ago = (moment: Date | null) => {
  if (!moment) return null;
  const minutes = Math.round((Date.now() - moment.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  if (minutes < 7 * 24 * 60)
    return `${Math.round(minutes / (24 * 60))} days ago`;
  return formatDate(moment);
};

const dateTime = (moment: Date) =>
  moment.toLocaleString('en-KE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** A transaction row for the overview tables. */
export const transactionRow = (
  tx: Awaited<ReturnType<AnalyticsService['recentTransactions']>>[number],
) => ({
  ...tx,
  when: dateTime(tx.occurredAt),
  amountText: `${tx.amount > 0 ? '+' : tx.amount < 0 ? '−' : ''}${money(tx.amount)}`,
  direction: tx.amount > 0 ? 'credit' : tx.amount < 0 ? 'debit' : '',
  tone: tx.status === 'Approved' ? 'success' : 'danger',
});

/** Card money tiles shared by both overviews (last 30 days). */
export const moneyTiles = (now: Totals, before: Totals, base: string) => [
  {
    label: 'Money in',
    icon: 'arrow-down-left',
    value: money(now.moneyIn),
    sub: `Last ${OVERVIEW_DAYS} days`,
    delta: change(now.moneyIn, before.moneyIn),
    href: `${base}/analytics`,
  },
  {
    label: 'Money out',
    icon: 'arrow-up-right',
    value: money(now.moneyOut),
    sub: `Last ${OVERVIEW_DAYS} days`,
    delta: change(now.moneyOut, before.moneyOut, false),
    href: `${base}/analytics`,
  },
  {
    label: 'Transactions',
    icon: 'arrow-left-right',
    value: count(now.transactions),
    sub: now.transactions
      ? `${percent(now.approved, now.transactions)} approved`
      : `None in ${OVERVIEW_DAYS} days`,
    delta: change(now.transactions, before.transactions),
    href: `${base}/transactions`,
  },
];

/** Figures for the overview pages (merchant portal and merchant workspace). */
@Injectable()
export class OverviewPresenter {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Cards, money and integration health of one business for its overview
   * (merchant portal, and the admin's merchant workspace). Parts follow the
   * viewer's permissions.
   */
  async merchant(
    businessId: number,
    permissions: string[],
    base = '/merchant',
  ) {
    const canCards = permissions.includes(SetPermission.MerchantCardsView);
    const canIntegrations = [
      SetPermission.MerchantCredentialsView,
      SetPermission.MerchantWebhooksManage,
    ].some((permission) => permissions.includes(permission));
    const result: Record<string, unknown> = { canCards, canIntegrations };
    const { current, previous } = this.analytics.window(OVERVIEW_DAYS);
    const scope = { businessId, days: OVERVIEW_DAYS } as const;
    const now = await this.analytics.totals(scope, current);
    if (canCards) {
      const [before, cards, recent] = await Promise.all([
        this.analytics.totals(scope, previous),
        this.analytics.cardCounts(businessId),
        this.analytics.recentTransactions(businessId, 6),
      ]);
      result.activityTiles = [
        {
          label: 'Active cards',
          icon: 'credit-card',
          value: count(cards.active),
          sub: `${count(cards.total)} issued, ${count(now.cardsIssued)} in ${OVERVIEW_DAYS} days`,
          href: `${base}/cards?status=Active`,
        },
        ...moneyTiles(now, before, base),
      ];
      result.recent = recent.map(transactionRow);
    }
    if (canIntegrations) {
      const health = await this.analytics.integrationHealth(businessId);
      result.health = {
        keys: health.keys.total
          ? `${count(health.keys.active)} active of ${count(health.keys.total)}`
          : 'None yet',
        keysUsed: health.keys.lastUsedAt
          ? `Last used ${ago(health.keys.lastUsedAt)}`
          : 'Never used',
        webhooks: health.webhooks.total
          ? `${count(health.webhooks.active)} active of ${count(health.webhooks.total)}`
          : 'None yet',
        lastEvent: health.lastDelivery
          ? {
              event: health.lastDelivery.event,
              delivered: health.lastDelivery.delivered,
              when: ago(health.lastDelivery.at),
            }
          : null,
        deliveryRate: now.deliveries
          ? `${percent(now.delivered, now.deliveries)} of ${count(now.deliveries)} events delivered`
          : `No events in ${OVERVIEW_DAYS} days`,
        ready: health.keys.active > 0 && health.webhooks.active > 0,
      };
    }
    return result;
  }
}
