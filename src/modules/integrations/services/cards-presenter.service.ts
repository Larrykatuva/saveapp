import { Injectable } from '@nestjs/common';
import { Card, CardState } from '../../cards/entities/card.entity';
import {
  formatDate,
  imageUrl,
  initials,
  pager,
} from '../../shared/utils/portal-view.util';
import { CardService } from './card.service';

export const CARD_TONES: Record<CardState, string> = {
  [CardState.Active]: 'success',
  [CardState.Blocked]: 'warning',
  [CardState.Terminated]: 'danger',
  [CardState.Replaced]: 'neutral',
};

const TABS = [
  { value: '', label: 'All', key: 'all' },
  ...Object.values(CardState).map((state) => ({
    value: state,
    label: state,
    key: state,
  })),
];

export const formatDateTime = (value?: Date | string | null) =>
  value
    ? new Date(value).toLocaleString('en-KE', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

/**
 * The Cards list, card drawer and live panel, for the merchant portal
 * (base /merchant/cards) and the admin's merchant workspace
 * (base /admin/merchants/:id/cards). Every url is built from the base.
 */
@Injectable()
export class CardsPresenter {
  constructor(private readonly cardService: CardService) {}

  async tabs(businessId: number, status: string) {
    const counts = await this.cardService.counts(businessId);
    return TABS.map((tab) => ({
      ...tab,
      count: counts[tab.key] ?? 0,
      active: tab.value === status,
    }));
  }

  view(card: Card, base: string) {
    return {
      id: card.id,
      drawerUrl: `${base}/${card.id}`,
      name: card.name,
      reference: card.reference,
      maskedNumber: card.accountNumber || '••••',
      last4: (card.accountNumber ?? '').slice(-4),
      status: card.status,
      tone: CARD_TONES[card.status],
      inactive: card.status !== CardState.Active,
      mobile: card.holder?.mobile,
      expiry: card.expiryDate
        ? new Date(card.expiryDate).toLocaleDateString('en-KE', {
            month: '2-digit',
            year: '2-digit',
          })
        : '--/--',
      issued: formatDate(card.issuedAt),
    };
  }

  async table(
    businessId: number,
    q: string,
    status: string,
    page: number,
    base: string,
  ) {
    const result = await this.cardService.search(
      businessId,
      { q, status },
      page,
    );
    return {
      cards: result.items.map((card) => this.view(card, base)),
      filtered: Boolean(q || status),
      ...pager(result, `${base}/table`, { q, status }),
    };
  }

  /** Drawer: the card face, what SaveApp stores and its activity. */
  async drawer(card: Card, base: string, revealUrl: string | null) {
    const logs = await this.cardService.logs(card.id);
    return {
      card: this.view(card, base),
      liveUrl: `${base}/${card.id}/live`,
      revealUrl,
      details: [
        { label: 'Reference', value: card.reference },
        { label: 'Cardholder mobile', value: card.holder?.mobile ?? 'Not set' },
        { label: 'Cardholder reference', value: card.holder?.alias },
        { label: 'Type', value: `${card.type} · ${card.currency}` },
        { label: 'Issued', value: formatDate(card.issuedAt) },
        {
          label: 'Expires',
          value: formatDate(card.expiryDate) ?? 'Not known yet',
        },
        ...(card.description
          ? [{ label: 'Description', value: card.description }]
          : []),
      ],
      logs: logs.map((log) => ({
        action: log.action,
        description: log.description,
        initials: initials(log.account?.user?.fullName ?? log.action),
        photo: imageUrl(log.account?.user?.profile),
        when: formatDateTime(log.createdAt),
      })),
    };
  }

  /** Live from UnionPay; each part fails on its own without breaking the rest. */
  async live(card: Card, transactionsBase: string) {
    const attempt = async <T>(work: () => Promise<T>) => {
      try {
        return { value: await work(), error: null };
      } catch (error) {
        return { value: null, error: (error as Error).message };
      }
    };
    const [details, balance] = await Promise.all([
      attempt(() => this.cardService.liveDetails(card)),
      attempt(() => this.cardService.balance(card)),
    ]);
    return {
      details: details.value
        ? { ...details.value, tone: CARD_TONES[details.value.status] }
        : null,
      detailsError: details.error,
      balance: balance.value,
      balanceError: balance.error,
      transactionsUrl: `${transactionsBase}?q=${encodeURIComponent(card.reference)}`,
      checkedAt: formatDateTime(new Date()),
    };
  }
}
