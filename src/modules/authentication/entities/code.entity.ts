import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { User } from './user.entity';

export enum Purpose {
  Registration = 'Registration',
  PhoneVerification = 'PhoneVerification',
  EmailVerification = 'EmailVerification',
  ResetPassword = 'ResetPassword',
  AccountInvite = 'AccountInvite',
  AccountLogin = 'AccountLogin',
  ViewCredentials = 'ViewCredentials',
  CardDetails = 'CardDetails',
}

@Entity()
export class Code extends CommonEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ enum: Purpose })
  purpose: Purpose;

  @Column({ type: String })
  @Index()
  code: string;

  @Column({ type: Boolean, default: false })
  used: boolean;

  @Column({ type: Date })
  expiry: Date;
}
