import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { Business } from '../../onboarding/entities/business.entity';
import { DeliveryStatus, Webhook, WebhookEvent } from './webhook.entity';

/**
 * One attempt to deliver an event to a merchant endpoint. Kept for a month
 * (WebhookLogService deletes older rows) so merchants can see what was sent.
 */
@Entity()
@Index(['business', 'createdAt'])
@Index(['createdAt'])
export class WebhookDelivery extends CommonEntity {
  @ManyToOne(() => Business, (business: Business) => business.id, {
    onDelete: 'CASCADE',
  })
  business: Business;

  @ManyToOne(() => Webhook, (webhook: Webhook) => webhook.id, {
    onDelete: 'CASCADE',
  })
  @Index()
  webhook: Webhook;

  // Shared by every endpoint the same event went to (X-SaveApp-Delivery)
  @Column({ type: String })
  @Index()
  eventId: string;

  @Column({ type: 'varchar', enum: WebhookEvent })
  event: WebhookEvent;

  // Endpoint URL at the time of delivery
  @Column({ type: String })
  url: string;

  @Column({ type: 'varchar', enum: DeliveryStatus })
  status: DeliveryStatus;

  // JSON body as sent (one-time codes are masked)
  @Column({ type: 'text' })
  payload: string;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'int', default: 0 })
  durationMs: number;
}
