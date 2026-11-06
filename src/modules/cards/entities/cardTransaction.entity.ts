import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { Business } from '../../onboarding/entities/business.entity';
import { CommonEntity } from '../../shared/entites/common.entity';
import { Card } from './card.entity';

/**
 * A card transaction as UnionPay reports it (Terraka's /cardtx), kept so the
 * merchant portal can list every card's activity in one table. One row per
 * UnionPay reference number. Never holds the card number.
 */
@Entity()
@Index(['business', 'occurredAt'])
export class CardTransaction extends CommonEntity {
  @ManyToOne(() => Card, (card: Card) => card.id, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @Index()
  card: Card;

  @ManyToOne(() => Business, (business: Business) => business.id, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  business: Business;

  // UnionPay's reference number for the transaction
  @Column({ type: String })
  @Index({ unique: true })
  reference: string;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @Column({ type: String, default: '' })
  description: string;

  @Column({ type: String, default: '' })
  merchantName: string;

  @Column({ type: String, default: '' })
  merchantCountry: string;

  // In the card's (billing) currency; numeric columns come back as strings
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  amount: string;

  @Column({ type: String, default: 'KES' })
  currency: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  fees: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  availableBalance: string | null;

  // UnionPay's status, e.g. Approved
  @Column({ type: String, default: '' })
  status: string;

  @Column({ type: String, default: '' })
  responseReason: string;
}
