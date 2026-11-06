import { createHmac, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { AxiosRequestHeaders } from 'axios';
import { Repository } from 'typeorm';
import { Business } from '../../onboarding/entities/business.entity';
import { EntityService } from '../../shared/services/entity.service';
import {
  RequestContentType,
  RequestService,
} from '../../shared/services/request.service';
import { FormError } from '../../shared/utils/form.util';
import {
  DeliveryStatus,
  Webhook,
  WebhookEvent,
} from '../entities/webhook.entity';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';

const MAX_ENDPOINTS = 5;

export interface WebhookPayload {
  id: string;
  event: WebhookEvent;
  createdAt: string;
  data: unknown;
}

/**
 * Merchant webhook endpoints and delivery. Each event is posted as JSON with
 * X-SaveApp-Event, X-SaveApp-Delivery, X-SaveApp-Timestamp and
 * X-SaveApp-Signature = "sha256=" + HMAC-SHA256(secret, "<timestamp>.<body>").
 * Deliveries are fire-and-forget (no retries yet); the latest outcome is
 * cached on the endpoint.
 */
@Injectable()
export class WebhookService extends EntityService<Webhook> {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(Webhook) private webhookRepository: Repository<Webhook>,
    @InjectRepository(WebhookDelivery)
    private deliveryRepository: Repository<WebhookDelivery>,
    private readonly requestService: RequestService,
    private readonly configService: ConfigService,
  ) {
    super();
    super.setRepository(this.webhookRepository);
  }

  private get production() {
    return this.configService.get<string>('ENV') === 'PROD';
  }

  /** HTTPS in production, and never an address on SaveApp's own network. */
  checkUrl(raw: string): string {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new FormError('Please fix the highlighted fields', {
        url: 'Enter a full URL, e.g. https://example.com/webhooks/saveapp',
      });
    }
    const local =
      /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/i.test(
        url.hostname,
      );
    if (!['http:', 'https:'].includes(url.protocol))
      throw new FormError('Please fix the highlighted fields', {
        url: 'Use an http or https URL',
      });
    if (this.production && (url.protocol !== 'https:' || local))
      throw new FormError('Please fix the highlighted fields', {
        url: 'Use a public https URL',
      });
    return url.toString();
  }

  async list(businessId: number): Promise<Webhook[]> {
    return this.filterMany(
      { business: { id: businessId } },
      { order: { createdAt: 'DESC' } },
    );
  }

  async findInBusiness(businessId: number, id: number) {
    return this.filter({ id, business: { id: businessId } });
  }

  async secretOf(webhook: Webhook): Promise<string> {
    const row = await this.webhookRepository
      .createQueryBuilder('webhook')
      .addSelect('webhook.secret')
      .where('webhook.id = :id', { id: webhook.id })
      .getOne();
    return row?.secret ?? '';
  }

  async create(business: Business, rawUrl: string, active: boolean) {
    const url = this.checkUrl(rawUrl);
    const count = await this.webhookRepository.count({
      where: { business: { id: business.id } },
    });
    if (count >= MAX_ENDPOINTS)
      throw new FormError(
        `A business can have up to ${MAX_ENDPOINTS} endpoints`,
      );
    return this.save({
      business,
      url,
      active,
      secret: `whsec_${randomBytes(24).toString('base64url')}`,
    });
  }

  async edit(webhook: Webhook, rawUrl: string, active: boolean) {
    await this.update(
      { id: webhook.id },
      { url: this.checkUrl(rawUrl), active },
    );
  }

  async rotateSecret(webhook: Webhook): Promise<void> {
    await this.update(
      { id: webhook.id },
      { secret: `whsec_${randomBytes(24).toString('base64url')}` },
    );
  }

  /** Sends an event to every active endpoint of the business, in the background. */
  dispatch(businessId: number, event: WebhookEvent, data: unknown): void {
    // One event id for every endpoint, so logs and receivers can match them
    const eventId = `evt_${randomBytes(12).toString('hex')}`;
    void this.filterMany({ business: { id: businessId }, active: true })
      .then((webhooks) =>
        Promise.all(
          webhooks.map((webhook) =>
            this.deliver(webhook, businessId, event, data, eventId),
          ),
        ),
      )
      .catch((error) =>
        this.logger.error(
          `Webhook dispatch failed: ${(error as Error).message}`,
        ),
      );
  }

  /**
   * Posts one signed event, records the attempt in the event log and the
   * outcome on the endpoint.
   */
  async deliver(
    webhook: Webhook,
    businessId: number,
    event: WebhookEvent,
    data: unknown,
    eventId = `evt_${randomBytes(12).toString('hex')}`,
  ): Promise<{ ok: boolean; error?: string }> {
    const payload: WebhookPayload = {
      id: eventId,
      event,
      createdAt: new Date().toISOString(),
      data,
    };
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', await this.secretOf(webhook))
      .update(`${timestamp}.${body}`)
      .digest('hex');
    const started = Date.now();
    let error: string | undefined;
    try {
      await this.requestService.postRequest<string, unknown>(
        webhook.url,
        body,
        RequestContentType.JSON,
        undefined,
        {
          'User-Agent': 'SaveApp-Webhooks/1.0',
          'X-SaveApp-Event': event,
          'X-SaveApp-Delivery': payload.id,
          'X-SaveApp-Timestamp': timestamp,
          'X-SaveApp-Signature': `sha256=${signature}`,
        } as unknown as AxiosRequestHeaders,
      );
    } catch (failure) {
      const response = (
        failure as { getResponse?: () => unknown }
      ).getResponse?.();
      error = (
        typeof response === 'string'
          ? response
          : JSON.stringify(response ?? (failure as Error).message)
      ).slice(0, 1000);
      this.logger.warn(`Webhook ${webhook.id} (${event}) failed: ${error}`);
    }
    const status = error ? DeliveryStatus.Failed : DeliveryStatus.Delivered;
    await this.update(
      { id: webhook.id },
      {
        lastDeliveryAt: new Date(),
        lastStatus: status,
        lastError: error ?? null,
      },
    );
    await this.deliveryRepository.save({
      business: { id: businessId } as Business,
      webhook: { id: webhook.id } as Webhook,
      eventId,
      event,
      url: webhook.url,
      status,
      // One-time codes are not kept in the log
      payload:
        event === WebhookEvent.CardOtp || event === WebhookEvent.CardDetailsOtp
          ? JSON.stringify({
              ...payload,
              data: { ...(data as object), otp: '••••••' },
            })
          : body,
      error: error ?? null,
      durationMs: Date.now() - started,
    });
    return { ok: !error, error };
  }
}
