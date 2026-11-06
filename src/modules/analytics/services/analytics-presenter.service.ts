import { Injectable } from '@nestjs/common';
import {
  AnalyticsScope,
  AnalyticsService,
  RANGES,
  RangeDays,
  Totals,
} from './analytics.service';

const CURRENCY = 'KES';

// Chart colours (validated with the dataviz palette checks on white):
// one hue for single series; brand blue vs red for money in and out;
// categorical slots for parts of a whole; status hues for delivered/failed
const COLORS = {
  single: '#0a6cb0',
  moneyIn: '#0a6cb0',
  moneyOut: '#e34948',
  parts: ['#0a6cb0', '#eb6834', '#1baf7a', '#eda100'],
  good: '#0ca30c',
  critical: '#d03b3b',
};

const count = (value: number) => value.toLocaleString('en-KE');
const money = (value: number) =>
  `${CURRENCY} ${value.toLocaleString('en-KE', {
    minimumFractionDigits: value % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : '–';
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00+03:00`).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Africa/Nairobi',
  });

/** "+12% vs previous 30 days", toned by whether up is good. */
const delta = (
  current: number,
  previous: number,
  days: number,
  upIsGood = true,
) => {
  if (!previous) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  const up = change > 0;
  return {
    text: `${up ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}% vs previous ${days} days`,
    tone: change === 0 ? 'flat' : up === upIsGood ? 'good' : 'bad',
  };
};

interface Chart {
  id: string;
  title: string;
  subtitle: string;
  kind: 'columns' | 'hbars' | 'segmented';
  data: unknown;
  empty: string | null;
  table: { head: string[]; rows: string[][] };
  wide?: boolean;
}

export interface AnalyticsPageOptions {
  // SaveApp team: merchant filter and merchant charts (when not scoped)
  admin: boolean;
  // Selected merchant id (admin filter), as text
  business?: string;
  // Show the merchant filter (off inside a merchant's workspace)
  showFilter?: boolean;
  // Where the page lives, for the filter form
  base: string;
}

/**
 * Builds the Analytics page for both portals and the admin's merchant
 * workspace: the same figures, scoped to one business or to all of them.
 * Charts are drawn in the browser by public/js/charts.js from the JSON each
 * card carries; every chart also has a table view.
 */
@Injectable()
export class AnalyticsPresenter {
  constructor(private readonly analytics: AnalyticsService) {}

  range(raw: string): RangeDays {
    const days = Number(raw) as RangeDays;
    return RANGES.includes(days) ? days : 30;
  }

  async page(scope: AnalyticsScope, extra: AnalyticsPageOptions) {
    const { current, previous } = this.analytics.window(scope.days);
    const [now, before, daily, types, merchants, issued, statuses] =
      await Promise.all([
        this.analytics.totals(scope, current),
        this.analytics.totals(scope, previous),
        this.analytics.transactionsDaily(scope, current),
        this.analytics.transactionTypes(scope, current),
        this.analytics.topMerchants(scope, current),
        this.analytics.cardsIssuedDaily(scope, current),
        this.analytics.cardsByStatus(scope),
      ]);
    const [deliveries, events] = await Promise.all([
      this.analytics.deliveriesDaily(scope, current),
      this.analytics.deliveriesByEvent(scope, current),
    ]);
    const labels = current.days.map(dayLabel);

    const charts: Chart[] = [
      {
        id: 'money-flow',
        title: 'Money in and out',
        subtitle: `Card loads and refunds above the line, spending and unloads below, ${CURRENCY} per day`,
        kind: 'columns',
        wide: true,
        data: {
          labels,
          diverging: true,
          format: 'money',
          currency: CURRENCY,
          series: [
            {
              name: 'Money in',
              color: COLORS.moneyIn,
              values: daily.map((d) => d.moneyIn),
            },
            {
              name: 'Money out',
              color: COLORS.moneyOut,
              values: daily.map((d) => d.moneyOut),
            },
          ],
        },
        empty:
          now.moneyIn || now.moneyOut
            ? null
            : 'No money moved on cards in this period.',
        table: {
          head: ['Day', 'Money in', 'Money out', 'Net'],
          rows: daily
            .filter((d) => d.moneyIn || d.moneyOut)
            .map((d, i) => [
              labels[current.days.indexOf(d.day)] ?? String(i),
              money(d.moneyIn),
              money(d.moneyOut),
              money(d.moneyIn - d.moneyOut),
            ]),
        },
      },
      {
        id: 'transactions-daily',
        title: 'Transactions per day',
        subtitle: 'Every transaction UnionPay reported, approved or not',
        kind: 'columns',
        data: {
          labels,
          format: 'count',
          series: [
            {
              name: 'Transactions',
              color: COLORS.single,
              values: daily.map((d) => d.count),
            },
          ],
        },
        empty: now.transactions ? null : 'No transactions in this period.',
        table: {
          head: ['Day', 'Transactions'],
          rows: daily
            .filter((d) => d.count)
            .map((d) => [dayLabel(d.day), count(d.count)]),
        },
      },
      {
        id: 'transaction-types',
        title: 'Transaction types',
        subtitle: 'What the transactions were, most common first',
        kind: 'hbars',
        data: {
          format: 'count',
          color: COLORS.single,
          items: types.map((t) => ({
            label: t.label,
            value: t.count,
            note: money(t.amount),
          })),
        },
        empty: types.length ? null : 'No transactions in this period.',
        table: {
          head: ['Type', 'Transactions', 'Amount'],
          rows: types.map((t) => [t.label, count(t.count), money(t.amount)]),
        },
      },
      {
        id: 'top-merchants',
        title: 'Where cards were used',
        subtitle: `Merchants by amount spent, ${CURRENCY}`,
        kind: 'hbars',
        data: {
          format: 'money',
          currency: CURRENCY,
          color: COLORS.single,
          items: merchants.map((m) => ({
            label: m.label,
            value: m.amount,
            note: `${count(m.count)} payments`,
          })),
        },
        empty: merchants.length
          ? null
          : 'No card payments at merchants in this period yet.',
        table: {
          head: ['Merchant', 'Amount', 'Payments'],
          rows: merchants.map((m) => [
            m.label,
            money(m.amount),
            count(m.count),
          ]),
        },
      },
      {
        id: 'cards-issued',
        title: 'Cards issued',
        subtitle: 'New cards per day, including replacements',
        kind: 'columns',
        data: {
          labels,
          format: 'count',
          series: [
            {
              name: 'Cards issued',
              color: COLORS.single,
              values: issued.map((d) => d.count),
            },
          ],
        },
        empty: now.cardsIssued ? null : 'No cards issued in this period.',
        table: {
          head: ['Day', 'Cards issued'],
          rows: issued
            .filter((d) => d.count)
            .map((d) => [dayLabel(d.day), count(d.count)]),
        },
      },
      {
        id: 'cards-status',
        title: 'Cards by status',
        subtitle: 'Every card issued so far, as it stands today',
        kind: 'segmented',
        data: {
          format: 'count',
          parts: statuses.map((s, i) => ({
            label: s.label,
            value: s.count,
            color: COLORS.parts[i],
          })),
        },
        empty: statuses.some((s) => s.count) ? null : 'No cards issued yet.',
        table: {
          head: ['Status', 'Cards', 'Share'],
          rows: statuses.map((s) => [
            s.label,
            count(s.count),
            percent(
              s.count,
              statuses.reduce((sum, item) => sum + item.count, 0),
            ),
          ]),
        },
      },
      {
        id: 'webhook-deliveries',
        title: 'Webhook deliveries',
        subtitle: 'Events sent to webhook endpoints per day',
        kind: 'columns',
        data: {
          labels,
          stacked: true,
          format: 'count',
          series: [
            {
              name: 'Delivered',
              color: COLORS.good,
              values: deliveries.map((d) => d.delivered),
            },
            {
              name: 'Failed',
              color: COLORS.critical,
              values: deliveries.map((d) => d.failed),
            },
          ],
        },
        empty: now.deliveries ? null : 'No webhook events sent in this period.',
        table: {
          head: ['Day', 'Delivered', 'Failed'],
          rows: deliveries
            .filter((d) => d.delivered || d.failed)
            .map((d) => [dayLabel(d.day), count(d.delivered), count(d.failed)]),
        },
      },
      {
        id: 'webhook-events',
        title: 'Events by type',
        subtitle: 'How many of each event went out',
        kind: 'hbars',
        data: {
          format: 'count',
          color: COLORS.single,
          items: events.map((e) => ({
            label: e.label,
            value: e.count,
            note: e.failed ? `${count(e.failed)} failed` : `${e.avgMs} ms avg`,
          })),
        },
        empty: events.length ? null : 'No webhook events sent in this period.',
        table: {
          head: ['Event', 'Sent', 'Failed', 'Average response'],
          rows: events.map((e) => [
            e.label,
            count(e.count),
            count(e.failed),
            `${e.avgMs} ms`,
          ]),
        },
      },
    ];

    let merchantTiles: ReturnType<typeof this.tile>[] = [];
    if (extra.admin && scope.businessId === null) {
      const [byStatus, joined, top] = await Promise.all([
        this.analytics.merchantsByStatus(),
        this.analytics.merchantsJoinedDaily(current),
        this.analytics.topBusinesses(current),
      ]);
      const total = byStatus.reduce((sum, s) => sum + s.count, 0);
      const joinedTotal = joined.reduce((sum, d) => sum + d.count, 0);
      merchantTiles = [
        this.tile(
          'Merchants',
          count(total),
          `${count(byStatus[0].count)} approved, ${count(byStatus[1].count)} pending`,
          null,
          'store',
        ),
      ];
      charts.unshift(
        {
          id: 'merchants-status',
          title: 'Merchants by onboarding status',
          subtitle: 'Every business on SaveApp today',
          kind: 'segmented',
          data: {
            format: 'count',
            parts: byStatus.map((s, i) => ({
              label: s.label,
              value: s.count,
              color: COLORS.parts[i],
            })),
          },
          empty: total ? null : 'No merchants yet.',
          table: {
            head: ['Status', 'Merchants', 'Share'],
            rows: byStatus.map((s) => [
              s.label,
              count(s.count),
              percent(s.count, total),
            ]),
          },
        },
        {
          id: 'merchants-joined',
          title: 'New merchants',
          subtitle: 'Businesses created per day',
          kind: 'columns',
          data: {
            labels,
            format: 'count',
            series: [
              {
                name: 'New merchants',
                color: COLORS.single,
                values: joined.map((d) => d.count),
              },
            ],
          },
          empty: joinedTotal ? null : 'No new merchants in this period.',
          table: {
            head: ['Day', 'New merchants'],
            rows: joined
              .filter((d) => d.count)
              .map((d) => [dayLabel(d.day), count(d.count)]),
          },
        },
        {
          id: 'merchants-top',
          title: 'Top merchants by card money',
          subtitle: `Money moved on each merchant's cards, ${CURRENCY}`,
          kind: 'hbars',
          wide: true,
          data: {
            format: 'money',
            currency: CURRENCY,
            color: COLORS.single,
            items: top.map((b) => ({
              label: b.label,
              value: b.amount,
              note: `${count(b.cards)} cards`,
            })),
          },
          empty: top.some((b) => b.amount)
            ? null
            : 'No card money moved in this period.',
          table: {
            head: ['Merchant', 'Amount', 'Transactions', 'Cards'],
            rows: top.map((b) => [
              b.label,
              money(b.amount),
              count(b.count),
              count(b.cards),
            ]),
          },
        },
      );
    }

    return {
      admin: extra.admin,
      showFilter: extra.showFilter ?? extra.admin,
      base: extra.base,
      days: scope.days,
      business: extra.business ?? '',
      businessName: extra.business
        ? (await this.analytics.businesses()).find(
            (b) => String(b.id) === extra.business,
          )?.name
        : null,
      businesses: extra.admin
        ? (await this.analytics.businesses()).map((b) => ({
            ...b,
            selected: String(b.id) === extra.business,
          }))
        : [],
      ranges: RANGES.map((days) => ({
        days,
        label: `${days} days`,
        active: days === scope.days,
        href: `?days=${days}${extra.business ? `&business=${extra.business}` : ''}`,
      })),
      tiles: [...merchantTiles, ...this.kpis(now, before, scope.days)],
      charts,
    };
  }

  private tile(
    label: string,
    value: string,
    sub: string | null,
    change: ReturnType<typeof delta>,
    icon: string,
  ) {
    return { label, value, sub, delta: change, iconName: icon };
  }

  private kpis(now: Totals, before: Totals, days: number) {
    return [
      this.tile(
        'Money in',
        money(now.moneyIn),
        'Loads and refunds onto cards',
        delta(now.moneyIn, before.moneyIn, days),
        'arrow-down-left',
      ),
      this.tile(
        'Money out',
        money(now.moneyOut),
        'Spending and unloads',
        delta(now.moneyOut, before.moneyOut, days, false),
        'arrow-up-right',
      ),
      this.tile(
        'Transactions',
        count(now.transactions),
        now.transactions
          ? `${percent(now.approved, now.transactions)} approved, ${count(now.cardsUsed)} cards used`
          : 'None yet',
        delta(now.transactions, before.transactions, days),
        'arrow-left-right',
      ),
      this.tile(
        'Cards issued',
        count(now.cardsIssued),
        'New cards in this period',
        delta(now.cardsIssued, before.cardsIssued, days),
        'credit-card',
      ),
      this.tile(
        'Webhook delivery',
        percent(now.delivered, now.deliveries),
        now.deliveries
          ? `${count(now.deliveries)} events, ${now.avgDeliveryMs ?? 0} ms average`
          : 'No events sent',
        null,
        'webhook',
      ),
    ];
  }
}
