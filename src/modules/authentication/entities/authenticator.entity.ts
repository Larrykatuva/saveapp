import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { User } from './user.entity';

/**
 * A user's authenticator app (TOTP, RFC 6238). The row exists from the
 * moment setup starts; it only protects sign in once `enabledAt` is set.
 */
@Entity()
export class Authenticator extends CommonEntity {
  @ManyToOne(() => User, (user: User) => user.id, { onDelete: 'CASCADE' })
  @Index({ unique: true })
  user: User;

  // Base32 secret encrypted with AES-256-GCM (key derived from PRIVATE_KEY)
  @Column({ type: 'text', select: false })
  secret: string;

  @Column({ type: 'timestamptz', nullable: true })
  enabledAt: Date | null;

  // SHA-256 hashes of unused recovery codes
  @Column({ type: 'jsonb', default: () => "'[]'", select: false })
  recoveryCodes: string[];

  // Last 30-second step accepted, so a code can't be replayed
  @Column({ type: 'bigint', default: 0 })
  lastStep: string;
}
