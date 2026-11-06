import { CommonEntity } from '../../shared/entites/common.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { Holder } from './holder.entity';

/** Card state, cached from Terraka's cardStatusID (1 blocked, 2 enabled, 3 terminated). */
export enum CardState {
  Active = 'Active',
  Blocked = 'Blocked',
  Terminated = 'Terminated',
  Replaced = 'Replaced',
}

@Entity()
export class Card extends CommonEntity {
  @ManyToOne(() => Holder, (holder: Holder) => holder.id, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @Index()
  holder: Holder;

  @Column({ type: String })
  accountNumber: string;

  @Column({ type: String })
  type: string;

  @Column({ type: String })
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: String })
  currency: string;

  @Column({ type: Date })
  issuedAt: Date;

  // Terraka's expiry format is not confirmed yet, so it may be missing
  @Column({ type: Date, nullable: true })
  expiryDate: Date | null;

  @Column({ enum: CardState, default: CardState.Active })
  status: CardState;

  @Column({ type: String })
  reference: string;

  // Last time its transactions were pulled from UnionPay (Transactions page)
  @Column({ type: 'timestamptz', nullable: true })
  transactionsSyncedAt: Date | null;
}
