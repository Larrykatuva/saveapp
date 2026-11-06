import { CommonEntity } from '../../shared/entites/common.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { Business } from '../../onboarding/entities/business.entity';
import { Account } from '../../onboarding/entities/account.entity';

@Entity()
export class Holder extends CommonEntity {
  @ManyToOne(() => Business, (business: Business) => business.id, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  business: Business;

  @ManyToOne(() => Account, (account: Account) => account.id, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  account: Account;

  // Mobile number the cardholder was registered with at Terraka
  @Column({ type: String, nullable: true })
  @Index()
  mobile: string | null;

  @Column({ type: Boolean, default: true })
  active: boolean;

  @Column({ type: String, default: 1 })
  @Index({ unique: true })
  alias: string;
}
