import { Column, Entity, ManyToOne } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { Credential } from './credential.entity';

export enum CredentialScopes {
  Card = 'Card',
  WalletAsService = 'WalletAsService',
}

@Entity()
export class Scope extends CommonEntity {
  @ManyToOne(() => Credential, (credential: Credential) => credential.id, {
    onDelete: 'CASCADE',
  })
  credential: Credential;

  @Column({ enum: CredentialScopes })
  scope: CredentialScopes;

  @Column({ type: Boolean, default: true })
  active: boolean;
}
