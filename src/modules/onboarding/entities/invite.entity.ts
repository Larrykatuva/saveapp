import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { Account } from './account.entity';
import { Business } from './business.entity';
import { Role } from '../../authorization/entities/role.entity';

export enum InviteStatus {
  Pending = 'Pending',
  Accepted = 'Accepted',
  Rejected = 'Rejected',
  Expired = 'Expired',
  Revoked = 'Revoked',
}

@Entity()
export class Invite extends CommonEntity {
  // This will be null if the invite is staff related
  @ManyToOne(() => Business, (business: Business) => business.id, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @Index()
  business: Business;

  @Column()
  email: string;

  // Name the inviter typed, used to prefill the sign up form
  @Column({ type: String, nullable: true })
  fullName: string | null;

  // Role the new account receives on acceptance (falls back to Viewer if the
  // role was deleted in the meantime)
  @ManyToOne(() => Role, (role: Role) => role.id, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  role: Role | null;

  // SHA-256 of the token in the invitation link; the token itself is never stored
  @Column({ type: String })
  @Index({ unique: true })
  token: string;

  @Column({ type: Date })
  expiry: Date;

  // Will be populated on acceptance, at that point we will have details of the account user
  @ManyToOne(() => Account, (account: Account) => account.id, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  actionBy: Account;

  @Column({ enum: InviteStatus, default: InviteStatus.Pending })
  status: InviteStatus;
}
