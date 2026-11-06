import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { fileUrlListTransformer } from '../../shared/transformers/file-url.transformer';
import { RequirementInput } from './requirement.entity';
import { Business, OnboardingStatus } from './business.entity';
import { Country } from '../../settings/entities/country.entity';

/**
 * Review state shared by a membership application and each KYC detail in it.
 */
export enum ReviewStatus {
  Pending = 'Pending',
  Accepted = 'Accepted',
  Rejected = 'Rejected',
}

/**
 * One answer to an organization requirement, kept as a snapshot so it stays
 * meaningful even if the requirement is later edited or removed.
 */
export interface KycItem {
  requirementId: number;
  name: string;
  input: RequirementInput;
  // Text/number answer, or the storage key of an uploaded file
  value: string | null;
  fileName?: string;
  mimeType?: string;
  size?: number;
  status: ReviewStatus;
  // Reviewer's reason, shown to the member when an item is rejected
  comment?: string | null;
  submittedAt: string;
  reviewedAt?: string | null;
}

@Entity()
export class Kyc extends CommonEntity {
  @ManyToOne(() => Country, (country: Country) => country.id, {
    onDelete: 'CASCADE',
  })
  country: Country;

  @ManyToOne(() => Business, (business: Business) => business.id, {
    onDelete: 'CASCADE',
  })
  @Index()
  business: Business;

  @Column({ enum: OnboardingStatus, default: OnboardingStatus.Pending })
  status: OnboardingStatus;

  // Set when the merchant sends the documents for review; null while they
  // are still filling them in
  @Column({ type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  // Reviewer's note when the business is rejected, shown to the merchant
  @Column({ type: 'text', nullable: true })
  reviewNote: string | null;

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
    transformer: fileUrlListTransformer<KycItem>('value'),
  })
  kyc: KycItem[];
}
