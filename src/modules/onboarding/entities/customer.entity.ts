import { CommonEntity } from '../../shared/entites/common.entity';
import { Column, Entity } from 'typeorm';
import { OnboardingStatus } from './business.entity';
import { fileUrlListTransformer } from '../../shared/transformers/file-url.transformer';
import { KycItem } from './kyc.entity';

@Entity()
export class Customer extends CommonEntity {
  @Column({ enum: OnboardingStatus, default: OnboardingStatus.Pending })
  status: OnboardingStatus;

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
    transformer: fileUrlListTransformer<KycItem>('value'),
  })
  kyc: KycItem[];
}
