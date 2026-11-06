import { Column, Entity, ManyToOne, Unique } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { Account } from '../../onboarding/entities/account.entity';
import { Role } from './role.entity';

@Entity()
@Unique(['account', 'role'])
export class AccountRole extends CommonEntity {
  @ManyToOne(() => Account, (account: Account) => account.id, {
    onDelete: 'CASCADE',
  })
  account: Account;

  @ManyToOne(() => Role, (role: Role) => role.id, { onDelete: 'CASCADE' })
  role: Role;

  @Column({ type: Boolean, default: true })
  active: boolean;
}
