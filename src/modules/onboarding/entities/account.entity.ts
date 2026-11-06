import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { User } from '../../authentication/entities/user.entity';
import { Business } from './business.entity';
import { Customer } from './customer.entity';
import { AuthorizationLevel } from '../../authorization/entities/permission.entity';

@Entity()
export class Account extends CommonEntity {
  @ManyToOne(() => User, (user: User) => user.id, { onDelete: 'CASCADE' })
  @Index()
  user: User;

  @Column({
    enum: AuthorizationLevel,
    default: AuthorizationLevel.B2C,
  })
  type: AuthorizationLevel;

  // This will not be null if the account is type is Whitelabel or B2B, this will be null if account is staff
  @ManyToOne(() => Business, (business: Business) => business.id, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  business: Business;

  // This will not be null if the account is B2C, this will be null if account is staff
  @ManyToOne(() => Customer, (customer: Customer) => customer.id, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  customer: Customer;

  @Column({ type: Boolean, default: false })
  active: boolean;

  @Column({ type: Boolean, default: true })
  allowEmailNotifications: boolean;

  @Column({ type: Boolean, default: true })
  allowPhoneNotifications: boolean;

  @Column({ type: Boolean, default: true })
  allowApplicantNotifications: boolean;
}
