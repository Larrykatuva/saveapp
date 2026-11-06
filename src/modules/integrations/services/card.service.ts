import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Card, CardState } from '../../cards/entities/card.entity';
import { CardLog } from '../../cards/entities/cardLog.entity';
import { Holder } from '../../cards/entities/holder.entity';
import { Account } from '../../onboarding/entities/account.entity';
import { Business } from '../../onboarding/entities/business.entity';
import { EntityService } from '../../shared/services/entity.service';
import { pageWindow } from '../../shared/utils/portal-view.util';
import {
  CardStatus,
  CardTransactionsQuery,
  TerrakaCardDetails,
  TerrakaRes,
} from '../../unionpay/dtos/unionpay.dto';
import { UnionpayService } from '../../unionpay/integrations/unionpay.service';

export const CARD_CURRENCY = 'KES';
export const CARD_TYPE = 'UnionPay';

/** Who changed a card: a portal account or an API credential. */
export interface CardActor {
  account?: Account | null;
  label: string;
}

export type CardAction = 'block' | 'unblock' | 'terminate';

const ACTIONS: Record<CardAction, { status: CardStatus; label: string }> = {
  block: { status: CardStatus.TemporarilyBlocked, label: 'Blocked' },
  unblock: { status: CardStatus.Enabled, label: 'Unblocked' },
  terminate: { status: CardStatus.PermanentlyBlocked, label: 'Terminated' },
};

/** Terraka's cardStatusID as our cached state. */
export const stateOf = (status?: CardStatus | number | null): CardState =>
  Number(status) === Number(CardStatus.TemporarilyBlocked)
    ? CardState.Blocked
    : Number(status) === Number(CardStatus.PermanentlyBlocked)
      ? CardState.Terminated
      : CardState.Active;

/** First six and last four digits only; the full number is never stored. */
export const maskPan = (pan?: string | null) => {
  const digits = (pan ?? '').replace(/\D/g, '');
  if (digits.length < 10) return digits ? `•••• ${digits.slice(-4)}` : '';
  return `${digits.slice(0, 6)}${'•'.repeat(digits.length - 10)}${digits.slice(-4)}`;
};

/** Expiry as Terraka sends it (MM/YY, MM/YYYY or a date), or null. */
export const parseExpiry = (raw?: string | null): Date | null => {
  const value = (raw ?? '').trim();
  const short = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
  if (short) {
    const month = Number(short[1]);
    const year = Number(short[2].length === 2 ? `20${short[2]}` : short[2]);
    // Cards expire at the end of the month
    return month >= 1 && month <= 12 ? new Date(year, month, 0) : null;
  }
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

/** Kenyan numbers as Terraka expects them (2547XXXXXXXX). */
export const normalizeMobile = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return digits;
};

/**
 * Cards a business issues through Terraka (UnionPay): cardholders, cards,
 * their live details, status changes and replacement. Every card is reached
 * through its holder's business, so one merchant never sees another's cards.
 */
@Injectable()
export class CardService extends EntityService<Card> {
  constructor(
    @InjectRepository(Card) private cardRepository: Repository<Card>,
    @InjectRepository(Holder) private holderRepository: Repository<Holder>,
    @InjectRepository(CardLog) private logRepository: Repository<CardLog>,
    private readonly unionpay: UnionpayService,
  ) {
    super();
    super.setRepository(this.cardRepository);
  }

  /** Terraka's own error message when a call did not succeed. */
  private ensure<T extends TerrakaRes>(answer: T, fallback: string): T {
    if (!answer.replyDetails?.isSuccess)
      throw new BadRequestException(
        answer.replyDetails?.errorComment || fallback,
      );
    return answer;
  }

  /* ----------------------------- Reading ---------------------------- */

  private scoped(businessId: number) {
    return this.cardRepository
      .createQueryBuilder('card')
      .innerJoinAndSelect('card.holder', 'holder')
      .where('holder."businessId" = :businessId', { businessId });
  }

  async search(
    businessId: number,
    filters: { q?: string; status?: string; mobile?: string },
    page = 1,
    size = 10,
  ) {
    const builder = this.scoped(businessId).orderBy('card.createdAt', 'DESC');
    const term = (filters.q ?? '').trim();
    if (term)
      builder.andWhere(
        new Brackets((where) =>
          where
            .where('card.name ILIKE :term', { term: `%${term}%` })
            .orWhere('card.reference ILIKE :term', { term: `%${term}%` })
            .orWhere('card.accountNumber ILIKE :term', { term: `%${term}%` })
            .orWhere('holder.mobile ILIKE :term', { term: `%${term}%` }),
        ),
      );
    if (filters.status)
      builder.andWhere('card.status = :status', { status: filters.status });
    if (filters.mobile)
      builder.andWhere('holder.mobile = :mobile', {
        mobile: normalizeMobile(filters.mobile),
      });
    const window = pageWindow(page);
    const take = Math.min(50, Math.max(1, size));
    const [items, total] = await builder
      .skip((window.page - 1) * take)
      .take(take)
      .getManyAndCount();
    return {
      items,
      total,
      page: window.page,
      pages: Math.max(1, Math.ceil(total / take)),
    };
  }

  async counts(businessId: number): Promise<Record<string, number>> {
    const rows = await this.scoped(businessId)
      .select('card.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('card.status')
      .getRawMany<{ status: string; count: string }>();
    const counts: Record<string, number> = { all: 0 };
    for (const row of rows) {
      counts[row.status] = Number(row.count);
      counts.all += Number(row.count);
    }
    return counts;
  }

  async findByReference(
    businessId: number,
    reference: string,
  ): Promise<Card | null> {
    return this.scoped(businessId)
      .andWhere('card.reference = :reference', { reference })
      .getOne();
  }

  async findInBusiness(businessId: number, id: number): Promise<Card | null> {
    return this.scoped(businessId).andWhere('card.id = :id', { id }).getOne();
  }

  async logs(cardId: number, limit = 10) {
    return this.logRepository.find({
      where: { card: { id: cardId } },
      relations: { account: { user: true } },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /* ---------------------------- Issuing ----------------------------- */

  /**
   * The business's cardholder for a mobile number, registering them with
   * Terraka the first time.
   */
  async holderFor(business: Business, mobile: string): Promise<Holder> {
    const number = normalizeMobile(mobile);
    const existing = await this.holderRepository.findOneBy({
      business: { id: business.id },
      mobile: number,
      active: true,
    });
    if (existing) return existing;
    const answer = this.ensure(
      await this.unionpay.addCardHolder(number),
      'UnionPay could not register the cardholder',
    );
    const raw = answer.cardholderAlias;
    const alias =
      typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
    if (!alias)
      throw new BadRequestException(
        'UnionPay did not return a cardholder reference',
      );
    return this.holderRepository.save({
      business,
      mobile: number,
      alias,
      active: true,
    });
  }

  /** Issues a card to a mobile number's cardholder and stores it. */
  async issue(
    business: Business,
    input: { mobile: string; name: string; description?: string },
    actor: CardActor,
  ): Promise<Card> {
    const holder = await this.holderFor(business, input.mobile);
    const answer = this.ensure(
      await this.unionpay.createCard(holder.alias),
      'UnionPay could not create the card',
    );
    const details = (answer.cardDetails ?? {}) as TerrakaCardDetails & {
      cardAlias?: string;
    };
    if (!details.cardAlias)
      throw new BadRequestException('UnionPay did not return a card reference');
    const card = await this.save({
      holder,
      accountNumber: maskPan(details.cardNumber),
      type: CARD_TYPE,
      name: input.name,
      description: input.description ?? '',
      currency: CARD_CURRENCY,
      issuedAt: new Date(),
      expiryDate: parseExpiry(details.dateExpiry),
      reference: details.cardAlias,
      status: stateOf(details.cardStatusID ?? CardStatus.Enabled),
    });
    await this.log(card, actor, 'Created', `Card issued to ${holder.mobile}`);
    return card;
  }

  /* ----------------------- Live details (Terraka) -------------------- */

  /** Status and expiry from UnionPay; the cached status follows it. */
  async liveDetails(card: Card) {
    const answer = this.ensure(
      await this.unionpay.getCardDetails(card.reference),
      'UnionPay could not return the card details',
    );
    const details = answer.cardDetails ?? {};
    const status = stateOf(details.cardStatusID);
    if (card.status !== CardState.Replaced && status !== card.status)
      await this.update({ id: card.id }, { status });
    return {
      maskedNumber: maskPan(details.cardNumber) || card.accountNumber,
      expiry: details.dateExpiry ?? null,
      status: card.status === CardState.Replaced ? card.status : status,
    };
  }

  async balance(card: Card) {
    const answer = this.ensure(
      await this.unionpay.getCardBalance(card.reference),
      'UnionPay could not return the balance',
    );
    return { balance: Number(answer.balance ?? 0), currency: card.currency };
  }

  async transactions(card: Card, filters: CardTransactionsQuery = {}) {
    const answer = this.ensure(
      await this.unionpay.getCardTransactions(card.reference, filters),
      'UnionPay could not return the transactions',
    );
    const transactions = answer.transactions ?? [];
    return { transactions, count: answer.count ?? transactions.length };
  }

  /* ---------------------------- Changes ----------------------------- */

  async setStatus(
    card: Card,
    action: CardAction,
    reason: string,
    actor: CardActor,
  ): Promise<Card> {
    if (
      card.status === CardState.Terminated ||
      card.status === CardState.Replaced
    )
      throw new BadRequestException(
        `This card is ${card.status.toLowerCase()} and can't be changed`,
      );
    const change = ACTIONS[action];
    this.ensure(
      await this.unionpay.setCardStatus(card.reference, change.status, reason),
      'UnionPay could not change the card status',
    );
    const status = stateOf(change.status);
    await this.update({ id: card.id }, { status });
    await this.log(card, actor, change.label, reason);
    return { ...card, status };
  }

  /** Issues a replacement; the old card is marked Replaced and stops working. */
  async replace(card: Card, reason: string, actor: CardActor): Promise<Card> {
    if (card.status === CardState.Replaced)
      throw new BadRequestException('This card has already been replaced');
    const answer = this.ensure(
      await this.unionpay.replaceCard(card.reference, reason),
      'UnionPay could not replace the card',
    );
    if (!answer.cardAliasNew)
      throw new BadRequestException(
        'UnionPay did not return the replacement card reference',
      );
    const fresh = await this.unionpay.getCardDetails(answer.cardAliasNew);
    const details = fresh.cardDetails ?? {};
    const replacement = await this.save({
      holder: card.holder,
      accountNumber: maskPan(details.cardNumber),
      type: card.type,
      name: card.name,
      description: card.description,
      currency: card.currency,
      issuedAt: new Date(),
      expiryDate: parseExpiry(details.dateExpiry),
      reference: answer.cardAliasNew,
      status: stateOf(details.cardStatusID ?? CardStatus.Enabled),
    });
    await this.update({ id: card.id }, { status: CardState.Replaced });
    await this.log(
      card,
      actor,
      'Replaced',
      `${reason} · new card ${replacement.reference}`,
    );
    await this.log(
      replacement,
      actor,
      'Created',
      `Replaces card ${card.reference}`,
    );
    return replacement;
  }

  /** Records a card event (also used for Terraka webhooks). */
  async log(card: Card, actor: CardActor, action: string, description: string) {
    await this.logRepository.save({
      card: { id: card.id } as Card,
      account: actor.account
        ? ({ id: actor.account.id } as Account)
        : undefined,
      action,
      description: `${description} · by ${actor.label}`.slice(0, 1000),
    });
  }

  /** The card behind a Terraka alias, with its holder's business. */
  async findForWebhook(reference: string): Promise<Card | null> {
    return this.filter(
      { reference },
      { relations: { holder: { business: true } } },
    );
  }
}
