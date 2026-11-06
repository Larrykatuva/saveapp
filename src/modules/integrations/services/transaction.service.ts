import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Card, CardState } from '../../cards/entities/card.entity';
import { CardTransaction } from '../../cards/entities/cardTransaction.entity';
import { Business } from '../../onboarding/entities/business.entity';
import { pageCount, pageWindow } from '../../shared/utils/portal-view.util';
import { CardService } from './card.service';

// The Transactions page pulls from UnionPay again when this old
export const TRANSACTIONS_STALE_MS = 10 * 60_000;
// Cards asked at once (Terraka answers in ~4 s per card)
const SYNC_CONCURRENCY = 3;
// Latest transactions asked per card on each pull
const SYNC_COUNT = 100;

export const APPROVED = 'Approved';

type Row = Pick<
  CardTransaction,
  | 'reference'
  | 'occurredAt'
  | 'description'
  | 'merchantName'
  | 'merchantCountry'
  | 'amount'
  | 'currency'
  | 'fees'
  | 'availableBalance'
  | 'status'
  | 'responseReason'
> & { card: Card; business: Business };

/**
 * Card transactions of a business in one place. UnionPay (Terraka /cardtx)
 * is the source: transactions are pulled per card and stored by UnionPay
 * reference, so pulling again never duplicates them. Pulled when the
 * Transactions page is opened (if stale), on "Refresh", and for one card
 * whenever Terraka's transaction webhook reports activity on it.
 */
@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    @InjectRepository(CardTransaction)
    private transactionRepository: Repository<CardTransaction>,
    @InjectRepository(Card) private cardRepository: Repository<Card>,
    private readonly cardService: CardService,
  ) {}

  /* ----------------------------- Listing ---------------------------- */

  private scoped(businessId: number) {
    return this.transactionRepository
      .createQueryBuilder('tx')
      .innerJoinAndSelect('tx.card', 'card')
      .where('tx."businessId" = :businessId', { businessId });
  }

  async search(
    businessId: number,
    filters: { q?: string; status?: string },
    page = 1,
  ) {
    const builder = this.scoped(businessId)
      .orderBy('tx.occurredAt', 'DESC')
      .addOrderBy('tx.id', 'DESC');
    const term = (filters.q ?? '').trim();
    if (term)
      builder.andWhere(
        new Brackets((where) =>
          where
            .where('card.name ILIKE :term', { term: `%${term}%` })
            .orWhere('card.reference ILIKE :term', { term: `%${term}%` })
            .orWhere('card.accountNumber ILIKE :term', { term: `%${term}%` })
            .orWhere('tx.description ILIKE :term', { term: `%${term}%` })
            .orWhere('tx.merchantName ILIKE :term', { term: `%${term}%` })
            .orWhere('tx.reference ILIKE :term', { term: `%${term}%` }),
        ),
      );
    if (filters.status === APPROVED)
      builder.andWhere('tx.status = :approved', { approved: APPROVED });
    else if (filters.status === 'Declined')
      builder.andWhere('tx.status <> :approved', { approved: APPROVED });
    const window = pageWindow(page);
    const [items, total] = await builder
      .skip(window.skip)
      .take(window.take)
      .getManyAndCount();
    return { items, total, page: window.page, pages: pageCount(total) };
  }

  async counts(businessId: number): Promise<Record<string, number>> {
    const row = await this.transactionRepository
      .createQueryBuilder('tx')
      .select('COUNT(*)', 'all')
      .addSelect(
        `COUNT(*) FILTER (WHERE tx.status = '${APPROVED}')`,
        'approved',
      )
      .where('tx."businessId" = :businessId', { businessId })
      .getRawOne<{ all: string; approved: string }>();
    const all = Number(row?.all ?? 0);
    const approved = Number(row?.approved ?? 0);
    return { all, [APPROVED]: approved, Declined: all - approved };
  }

  /** When this business's cards were last pulled from UnionPay. */
  async lastSyncedAt(businessId: number): Promise<Date | null> {
    const row = await this.cardRepository
      .createQueryBuilder('card')
      .innerJoin('card.holder', 'holder')
      .select('MAX(card."transactionsSyncedAt")', 'at')
      .where('holder."businessId" = :businessId', { businessId })
      .getRawOne<{ at: Date | null }>();
    return row?.at ? new Date(row.at) : null;
  }

  async isStale(businessId: number): Promise<boolean> {
    const at = await this.lastSyncedAt(businessId);
    return !at || Date.now() - at.getTime() > TRANSACTIONS_STALE_MS;
  }

  /* ----------------------------- Pulling ---------------------------- */

  /**
   * Pulls every live card of the business (and any card never pulled, so
   * the history of terminated or replaced cards is kept once).
   */
  async syncBusiness(businessId: number) {
    const cards = await this.cardRepository
      .createQueryBuilder('card')
      .innerJoin('card.holder', 'holder')
      .where('holder."businessId" = :businessId', { businessId })
      .andWhere(
        new Brackets((where) =>
          where
            .where('card.status IN (:...live)', {
              live: [CardState.Active, CardState.Blocked],
            })
            .orWhere('card."transactionsSyncedAt" IS NULL'),
        ),
      )
      .getMany();

    let added = 0;
    let failed = 0;
    for (let i = 0; i < cards.length; i += SYNC_CONCURRENCY) {
      const results = await Promise.allSettled(
        cards
          .slice(i, i + SYNC_CONCURRENCY)
          .map((card) => this.syncCard(card, businessId)),
      );
      for (const result of results) {
        if (result.status === 'fulfilled') added += result.value;
        else failed += 1;
      }
    }
    return { cards: cards.length, added, failed };
  }

  /** Pulls one card's latest transactions; answers how many were new. */
  async syncCard(card: Card, businessId: number): Promise<number> {
    let added = 0;
    try {
      const { transactions } = await this.cardService.transactions(card, {
        count: SYNC_COUNT,
      });
      const rows = transactions
        .map((item) => this.toRow(item, card, businessId))
        .filter((row): row is Row => row !== null);
      if (rows.length) {
        const known = await this.transactionRepository.find({
          select: { reference: true },
          where: { reference: In(rows.map((row) => row.reference)) },
        });
        const seen = new Set(known.map((row) => row.reference));
        added = rows.filter((row) => !seen.has(row.reference)).length;
        // Status and amounts can change (e.g. a reversal), so refresh them
        await this.transactionRepository.upsert(rows, ['reference']);
      }
    } catch (error) {
      this.logger.warn(
        `Transactions for card ${card.reference} could not be pulled: ${(error as Error).message}`,
      );
      throw error;
    } finally {
      await this.cardRepository.update(
        { id: card.id },
        { transactionsSyncedAt: new Date() },
      );
    }
    return added;
  }

  /** One UnionPay transaction as a row; null when it has no reference. */
  private toRow(
    item: Record<string, unknown>,
    card: Card,
    businessId: number,
  ): Row | null {
    const text = (key: string) => {
      const value = item[key];
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number') return String(value);
      return '';
    };
    const number = (key: string) => {
      const value = Number(item[key]);
      return Number.isFinite(value) ? value : 0;
    };
    const reference = text('referenceNumber') || text('rrn');
    const occurredAt = new Date(text('timestamp') || text('transactionDate'));
    if (!reference || Number.isNaN(occurredAt.getTime())) return null;

    // Loads come with amountBilling 0 and the value in amount; unloads and
    // purchases fill both (negative for money leaving the card)
    const billed = number('amountBilling');
    return {
      card: { id: card.id } as Card,
      business: { id: businessId } as Business,
      reference,
      occurredAt,
      description: text('description') || 'Transaction',
      merchantName: text('merchantName'),
      merchantCountry: text('merchantCountryCode'),
      amount: (billed || number('amount')).toFixed(2),
      currency:
        text('currencyBilling') || text('currencyTransaction') || card.currency,
      fees: (number('fee1') + number('fee2') + number('fee3')).toFixed(2),
      availableBalance:
        item.availableBalance === undefined || item.availableBalance === null
          ? null
          : number('availableBalance').toFixed(2),
      status:
        text('status') ||
        (text('responseCode') === '00' ? APPROVED : 'Declined'),
      responseReason: text('responseReason'),
    };
  }
}
