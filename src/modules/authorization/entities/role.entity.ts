import { CommonEntity } from '../../shared/entites/common.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { AuthorizationLevel } from './permission.entity';
import { Business } from '../../onboarding/entities/business.entity';

@Entity()
export class Role extends CommonEntity {
  // This will be null for internal roles where type is Staff
  @ManyToOne(() => Business, (business: Business) => business.id, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  business: Business;

  @Column({
    enum: AuthorizationLevel,
    default: AuthorizationLevel.B2B,
  })
  type: AuthorizationLevel;

  @Column({ type: String })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // Seeded default role; read-only in the UI
  @Column({ type: Boolean, default: false })
  system: boolean;

  @Column({ type: Boolean, default: true })
  active: boolean;
}
