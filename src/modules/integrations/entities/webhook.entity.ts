import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { Business } from '../../onboarding/entities/business.entity';

/** Events a merchant endpoint receives. Card events originate from Terraka. */
export enum WebhookEvent {
  CardTransaction = 'card.transaction',
  CardOtp = 'card.otp',
  // Code a merchant sends back to see a card's full details
  CardDetailsOtp = 'card.details_otp',
  Test = 'webhook.test',
}

export enum DeliveryStatus {
  Delivered = 'Delivered',
  Failed = 'Failed',
}

/** A merchant endpoint that receives card events, signed with its secret. */
@Entity()
export class Webhook extends CommonEntity {
  @ManyToOne(() => Business, (business: Business) => business.id, {
    onDelete: 'CASCADE',
  })
  @Index()
  business: Business;

  @Column({ type: String })
  url: string;

  // HMAC-SHA256 key for the X-SaveApp-Signature header; needed in clear to sign
  @Column({ type: String, select: false })
  secret: string;

  @Column({ type: Boolean, default: true })
  active: boolean;

  // Outcome of the latest delivery, cached so the list needs no log table
  @Column({ type: 'timestamptz', nullable: true })
  lastDeliveryAt: Date | null;

  @Column({ type: 'varchar', enum: DeliveryStatus, nullable: true })
  lastStatus: DeliveryStatus | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;
}
