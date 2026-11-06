import { Injectable } from '@nestjs/common';
import { CardTransaction } from '../../cards/entities/cardTransaction.entity';
import { pager } from '../../shared/utils/portal-view.util';
import { APPROVED, TransactionService } from './transaction.service';

const TABS = [
  { value: '', label: 'All', key: 'all' },
  { value: APPROVED, label: 'Approved', key: APPROVED },
  { value: 'Declined', label: 'Declined', key: 'Declined' },
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

const formatAmount = (value: string | number, currency: string) =>
  `${currency} ${Math.abs(Number(value)).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Money in shows as +, money out as − (UnionPay sends debits negative). */
const signedAmount = (value: string, currency: string) => {
  const amount = Number(value);
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return {
    amount: `${sign}${formatAmount(amount, currency)}`,
    direction: amount > 0 ? 'credit' : amount < 0 ? 'debit' : '',
  };
};

/**
 * The Transactions page for the merchant portal (base /merchant/transactions)
 * and the admin's merchant workspace; rows open the card under cardsBase.
 */
@Injectable()
export class TransactionsPresenter {
  constructor(private readonly transactionService: TransactionService) {}

  /** Header figures and tabs; stale means it's time to pull from UnionPay. */
  async summary(businessId: number, status: string) {
    const [counts, syncedAt, stale] = await Promise.all([
      this.transactionService.counts(businessId),
      this.transactionService.lastSyncedAt(businessId),
      this.transactionService.isStale(businessId),
    ]);
    return {
      stale,
      syncedAt: formatDateTime(syncedAt),
      tabs: TABS.map((tab) => ({
        ...tab,
        count: counts[tab.key] ?? 0,
        active: tab.value === status,
      })),
    };
  }

  /** "Refresh from UnionPay": pulls the cards and answers for the toast. */
  async sync(businessId: number) {
    const result = await this.transactionService.syncBusiness(businessId);
    const parts = [
      result.cards
        ? `Checked ${result.cards} card${result.cards === 1 ? '' : 's'} with UnionPay: ${result.added} new transaction${result.added === 1 ? '' : 's'}`
        : 'No cards to check yet',
    ];
    if (result.failed)
      parts.push(
        `${result.failed} card${result.failed === 1 ? '' : 's'} could not be reached, try again shortly`,
      );
    // New rows change the tab counts, so reload the page rather than the table
    return { ok: true, message: parts.join('. '), reload: result.added > 0 };
  }

  view(tx: CardTransaction, cardsBase: string) {
    const approved = tx.status === APPROVED;
    return {
      cardId: tx.card.id,
      cardUrl: `${cardsBase}/${tx.card.id}`,
      cardName: tx.card.name,
      maskedNumber: tx.card.accountNumber || tx.card.reference,
      when: formatDateTime(tx.occurredAt),
      description: tx.description,
      merchant: [tx.merchantName, tx.merchantCountry]
        .filter(Boolean)
        .join(' · '),
      ...signedAmount(tx.amount, tx.currency),
      fees: Number(tx.fees) ? formatAmount(tx.fees, tx.currency) : null,
      status: tx.status || 'Unknown',
      tone: approved ? 'success' : 'danger',
      reason: approved ? '' : tx.responseReason,
      reference: tx.reference,
    };
  }

  async table(
    businessId: number,
    q: string,
    status: string,
    page: number,
    base: string,
    cardsBase: string,
  ) {
    const result = await this.transactionService.search(
      businessId,
      { q, status },
      page,
    );
    return {
      transactions: result.items.map((tx) => this.view(tx, cardsBase)),
      filtered: Boolean(q || status),
      ...pager(result, `${base}/table`, { q, status }),
    };
  }
}
