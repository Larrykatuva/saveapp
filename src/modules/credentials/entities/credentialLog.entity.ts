import { CommonEntity } from '../../shared/entites/common.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { Credential } from './credential.entity';
import { Account } from '../../onboarding/entities/account.entity';

@Entity()
export class CredentialLog extends CommonEntity {
  @ManyToOne(() => Credential, (credential: Credential) => credential.id, {
    onDelete: 'CASCADE',
  })
  credential: Credential;

  @ManyToOne(() => Account, (account: Account) => account.id, {
    onDelete: 'CASCADE',
  })
  account: Account;

  @Column({ type: String })
  action: string;

  @Column({ type: 'text' })
  description: string;
}
