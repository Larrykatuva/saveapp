import { CommonEntity } from '../../shared/entites/common.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { Business } from '../../onboarding/entities/business.entity';

@Entity()
export class Credential extends CommonEntity {
  @ManyToOne(() => Business, (business: Business) => business.id, {
    onDelete: 'CASCADE',
  })
  @Index()
  business: Business;

  // Label the merchant gives the key, e.g. "Production server"
  @Column({ type: String, default: 'API key' })
  name: string;

  // Should be hashed with a secret key (HMAC-SHA256 with PRIVATE_KEY, so it
  // can still be looked up)
  @Column({ type: String })
  @Index({ unique: true })
  clientId: string;

  // Start of the client id, shown in the portal since the id is only hashed
  @Column({ type: String, default: '' })
  hint: string;

  // Should be hashed with a secret key
  @Column({ type: String })
  clientSecret: string;

  // IP addresses allowed to use the key; empty allows any (not in production)
  @Column({ type: 'jsonb', default: () => "'[]'" })
  ips: string[];

  // Last time the key got a token or made an API call
  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: Boolean, default: true })
  active: boolean;
}
