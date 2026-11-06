import { Column, Entity, ManyToOne } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { Card } from './card.entity';
import { Account } from '../../onboarding/entities/account.entity';

@Entity()
export class CardLog extends CommonEntity {
  @ManyToOne(() => Card, (card: Card) => card.id, { onDelete: 'CASCADE' })
  card: Card;

  @ManyToOne(() => Account, (account: Account) => account.id, {
    onDelete: 'CASCADE',
  })
  account: Account;

  @Column({ type: String })
  action: string;

  @Column({ type: 'text' })
  description: string;
}
