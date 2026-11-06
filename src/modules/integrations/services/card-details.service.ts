import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AttemptService } from '../../authentication/services/attempt.service';
import { Card, CardState } from '../../cards/entities/card.entity';
import { Credential } from '../../credentials/entities/credential.entity';
import { UnionpayService } from '../../unionpay/integrations/unionpay.service';
import { CardChallenge } from '../entities/card-challenge.entity';
import { WebhookEvent } from '../entities/webhook.entity';
import { CardActor, CardService, stateOf } from './card.service';
import { WebhookService } from './webhook.service';

export const CHALLENGE_MINUTES = 5;
const MAX_ATTEMPTS = 5;
// Requests per credential in a 15-minute window
const MAX_REQUESTS = 20;
const WINDOW_MS = 15 * 60_000;

export interface CardChallengeResult {
  challengeId: string;
  expiresAt: Date;
  expiresIn: number;
  sentTo: number;
}

export interface FullCardDetails {
  reference: string;
  name: string;
  cardNumber: string;
  expiry: string | null;
  cvv: string;
  status: CardState;
}

/**
 * Full card details (number, expiry, CVV) behind a second check: asking for
 * them sends a one-time code to the merchant's webhook endpoints, and the
 * details are only returned when that code comes back. Nothing sensitive is
 * stored or logged.
 */
@Injectable()
export class CardDetailsService {
  constructor(
    @InjectRepository(CardChallenge)
    private challengeRepository: Repository<CardChallenge>,
    private readonly webhookService: WebhookService,
    private readonly cardService: CardService,
    private readonly unionpay: UnionpayService,
    private readonly attemptService: AttemptService,
    private readonly configService: ConfigService,
  ) {}

  private hash(challengeId: string, otp: string) {
    return createHmac(
      'sha256',
      this.configService.getOrThrow<string>('PRIVATE_KEY'),
    )
      .update(`${challengeId}:${otp}`)
      .digest('hex');
  }

  /** Sends a code to the business's webhooks and opens a challenge. */
  async request(
    card: Card,
    credential: Credential,
    businessId: number,
    actor: CardActor,
  ): Promise<CardChallengeResult> {
    if (
      card.status === CardState.Terminated ||
      card.status === CardState.Replaced
    )
      throw new BadRequestException(
        `This card is ${card.status.toLowerCase()}, so its details can't be shown`,
      );
    const endpoints = (await this.webhookService.list(businessId)).filter(
      (webhook) => webhook.active,
    );
    if (!endpoints.length)
      throw new ConflictException(
        'Add an active webhook endpoint in the merchant portal first: the one-time code for full card details is sent there',
      );
    const key = `card-details:${credential.id}`;
    if (await this.attemptService.isBlocked(key, MAX_REQUESTS))
      throw new HttpException(
        'Too many requests for full card details. Try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    await this.attemptService.fail(key, WINDOW_MS);

    // Only the newest challenge for this card and key stays open
    await this.challengeRepository.update(
      {
        card: { id: card.id },
        credential: { id: credential.id },
        closedAt: IsNull(),
      },
      { closedAt: new Date() },
    );
    const challengeId = `chl_${randomBytes(16).toString('hex')}`;
    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + CHALLENGE_MINUTES * 60_000);
    await this.challengeRepository.save({
      card: { id: card.id } as Card,
      credential: { id: credential.id } as Credential,
      challengeId,
      otpHash: this.hash(challengeId, otp),
      expiresAt,
    });
    this.webhookService.dispatch(businessId, WebhookEvent.CardDetailsOtp, {
      cardReference: card.reference,
      challengeId,
      otp,
      expiresAt: expiresAt.toISOString(),
    });
    await this.cardService.log(
      card,
      actor,
      'Details requested',
      'One-time code sent to the webhook endpoints',
    );
    return {
      challengeId,
      expiresAt,
      expiresIn: CHALLENGE_MINUTES * 60,
      sentTo: endpoints.length,
    };
  }

  /** Checks the code and returns the full details from UnionPay. */
  async verify(
    card: Card,
    credential: Credential,
    challengeId: string,
    otp: string,
    actor: CardActor,
  ): Promise<FullCardDetails> {
    const challenge = await this.challengeRepository.findOne({
      where: {
        challengeId,
        card: { id: card.id },
        credential: { id: credential.id },
      },
    });
    if (!challenge)
      throw new BadRequestException('Unknown challenge for this card');
    if (challenge.closedAt)
      throw new BadRequestException(
        'This challenge was already used or replaced. Request a new code.',
      );
    if (challenge.expiresAt < new Date())
      throw new BadRequestException(
        'This code has expired. Request a new one.',
      );
    if (challenge.attempts >= MAX_ATTEMPTS)
      throw new BadRequestException('Too many wrong codes. Request a new one.');

    const expected = Buffer.from(challenge.otpHash);
    const received = Buffer.from(this.hash(challengeId, otp.trim()));
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      const attempts = challenge.attempts + 1;
      await this.challengeRepository.update(
        { id: challenge.id },
        attempts >= MAX_ATTEMPTS
          ? { attempts, closedAt: new Date() }
          : { attempts },
      );
      const left = MAX_ATTEMPTS - attempts;
      throw new BadRequestException(
        left > 0
          ? `Wrong code. ${left} attempt${left === 1 ? '' : 's'} left`
          : 'Too many wrong codes. Request a new one.',
      );
    }
    await this.challengeRepository.update(
      { id: challenge.id },
      { closedAt: new Date() },
    );
    return this.reveal(card, actor, 'one-time code check');
  }

  /**
   * Full number, expiry and CVV straight from UnionPay, once the caller has
   * passed a second check (API: webhook code, portal: code sent to the user).
   * Nothing is stored; only the fact that they were shown is logged.
   */
  async reveal(
    card: Card,
    actor: CardActor,
    check: string,
  ): Promise<FullCardDetails> {
    if (
      card.status === CardState.Terminated ||
      card.status === CardState.Replaced
    )
      throw new BadRequestException(
        `This card is ${card.status.toLowerCase()}, so its details can't be shown`,
      );
    const [details, cvvAnswer] = await Promise.all([
      this.unionpay.getCardDetails(card.reference),
      this.unionpay.getCardCvv(card.reference),
    ]);
    if (!details.replyDetails?.isSuccess || !details.cardDetails?.cardNumber)
      throw new BadRequestException(
        details.replyDetails?.errorComment ||
          'UnionPay could not return the card details',
      );
    const cvv =
      cvvAnswer.cvv ??
      cvvAnswer.CVV ??
      cvvAnswer.cardCvv ??
      cvvAnswer.cardDetails?.cvv ??
      cvvAnswer.cardDetails?.CVV;
    if (!cvvAnswer.replyDetails?.isSuccess || !cvv)
      throw new BadRequestException(
        cvvAnswer.replyDetails?.errorComment ||
          'UnionPay could not return the CVV',
      );
    await this.cardService.log(
      card,
      actor,
      'Details revealed',
      `Full number, expiry and CVV shown after the ${check}`,
    );
    return {
      reference: card.reference,
      name: card.name,
      cardNumber: details.cardDetails.cardNumber.replace(/\D/g, ''),
      expiry: details.cardDetails.dateExpiry ?? null,
      cvv: String(cvv),
      status: stateOf(details.cardDetails.cardStatusID),
    };
  }
}
