import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  CardOtpWebhook,
  CardTransactionWebhook,
} from '../../../unionpay/dtos/unionpay.dto';
import { WebhookEvent } from '../../entities/webhook.entity';
import { CardService } from '../../services/card.service';
import { normalizeIp } from '../../services/credential.service';
import { WebhookService } from '../../services/webhook.service';
import { TransactionService } from '../../services/transaction.service';
import {
  describeOtp,
  describeTransaction,
  otpEvent,
  transactionEvent,
} from '../../utils/terraka-events';

const TERRAKA: { label: string } = { label: 'UnionPay (Terraka)' };

/**
 * Card events Terraka posts to SaveApp (no auth on their side; set
 * TERRAKA_WEBHOOK_IPS to only accept their addresses):
 * - feed: a cardholder transacted ("Notification Feed Webhook")
 * - otp: the one-time pin that authorises a card payment ("One-time pin
 *   webhook"), which the merchant passes to its customer
 * Each event is logged on the card and forwarded, signed, to the card's
 * business webhooks in one documented shape (utils/terraka-events). Terraka
 * wants a 2xx within 30 seconds, so forwarding never holds up the answer;
 * it always answers 200 so events we can't place aren't retried.
 */
@ApiExcludeController()
@Controller('api/webhooks/terraka/cards')
export class TerrakaWebhookController {
  private readonly logger = new Logger(TerrakaWebhookController.name);

  constructor(
    private readonly cardService: CardService,
    private readonly webhookService: WebhookService,
    private readonly transactionService: TransactionService,
    private readonly configService: ConfigService,
  ) {}

  private assertSource(req: Request) {
    const allowed = (
      this.configService.get<string>('TERRAKA_WEBHOOK_IPS') ?? ''
    )
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);
    const ip = normalizeIp(req.ip);
    if (allowed.length && !allowed.includes(ip)) {
      this.logger.warn(`Rejected Terraka webhook from ${ip}`);
      throw new ForbiddenException('Unknown sender');
    }
  }

  @Post('feed')
  @HttpCode(HttpStatus.OK)
  async feed(@Req() req: Request, @Body() body: CardTransactionWebhook) {
    this.assertSource(req);
    const card = body?.cardAlias
      ? await this.cardService.findForWebhook(body.cardAlias)
      : null;
    if (!card?.holder?.business) {
      this.logger.warn(`Transaction for unknown card ${body?.cardAlias}`);
      return { received: true };
    }
    const event = transactionEvent(body, card.reference);
    this.webhookService.dispatch(
      card.holder.business.id,
      WebhookEvent.CardTransaction,
      event,
    );
    await this.cardService.log(
      card,
      TERRAKA,
      'Transaction',
      describeTransaction(event),
    );
    // Store it for the Transactions page (UnionPay's list is the record)
    this.transactionService
      .syncCard(card, card.holder.business.id)
      .catch(() => undefined);
    return { received: true };
  }

  @Post('otp')
  @HttpCode(HttpStatus.OK)
  async otp(@Req() req: Request, @Body() body: CardOtpWebhook) {
    this.assertSource(req);
    const card = body?.cardAlias
      ? await this.cardService.findForWebhook(body.cardAlias)
      : null;
    if (!card?.holder?.business) {
      this.logger.warn(`OTP for unknown card ${body?.cardAlias}`);
      return { received: true };
    }
    // Forward first: the customer is waiting at the till for this code
    const event = otpEvent(body, card);
    this.webhookService.dispatch(
      card.holder.business.id,
      WebhookEvent.CardOtp,
      event,
    );
    await this.cardService.log(card, TERRAKA, 'OTP', describeOtp(event));
    return { received: true };
  }
}
