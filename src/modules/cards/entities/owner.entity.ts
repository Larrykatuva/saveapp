import { CommonEntity } from '../../shared/entites/common.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { Account } from '../../onboarding/entities/account.entity';
import { Business } from '../../onboarding/entities/business.entity';

enum HistoryAction {
  Assigned = 'Assigned',
  Activated = 'Activated',
  Deactivated = 'Deactivated',
}

interface HistoryData {
  action: HistoryAction;
  description: string;
  accountId: number; // Account if being affected
  actionBy: number; // Account id of the person performing the action
}

@Entity()
export class Owner extends CommonEntity {
  @ManyToOne(() => Account, (account: Account) => account.id, {
    onDelete: 'CASCADE',
  })
  account: Account;

  @ManyToOne(() => Business, (business: Business) => business.id, {
    onDelete: 'CASCADE',
  })
  business: Business;

  @Column({ type: Boolean, default: true })
  active: boolean;

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
  })
  history: HistoryData[];
}
