import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { Card } from '../../cards/entities/card.entity';
import { Credential } from '../../credentials/entities/credential.entity';

/**
 * A request to see a card's full details (number, expiry, CVV). The code is
 * sent to the merchant's webhook endpoints and must come back with the
 * challenge id; only a hash of it is kept.
 */
@Entity()
export class CardChallenge extends CommonEntity {
  @ManyToOne(() => Card, (card: Card) => card.id, { onDelete: 'CASCADE' })
  @Index()
  card: Card;

  @ManyToOne(() => Credential, (credential: Credential) => credential.id, {
    onDelete: 'CASCADE',
  })
  @Index()
  credential: Credential;

  @Column({ type: String })
  @Index({ unique: true })
  challengeId: string;

  // HMAC-SHA256 of "<challengeId>:<otp>" with PRIVATE_KEY
  @Column({ type: String })
  otpHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  // Set when the code is used, or when a newer challenge replaces this one
  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}
