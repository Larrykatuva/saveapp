import { CommonEntity } from '../../shared/entites/common.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { FileUrlTransformer } from '../../shared/transformers/file-url.transformer';
import { Country } from '../../settings/entities/country.entity';
import { AuthorizationLevel } from '../../authorization/entities/permission.entity';

export enum OnboardingStatus {
  Pending = 'Pending',
  Approved = 'Approved',
  Rejected = 'Rejected',
  Suspended = 'Suspended',
}

@Entity()
export class Business extends CommonEntity {
  @Column({ type: String })
  name: string;

  @Column({ type: String })
  email: string;

  @Column({ type: String })
  phone: string;

  @Column({ type: String })
  address: string;

  // Country the business operates in; picks its KYC requirements
  @ManyToOne(() => Country, (country: Country) => country.id, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @Index()
  country: Country;

  // B2B or WhiteLabel; the level of every account in the business
  @Column({ enum: AuthorizationLevel, default: AuthorizationLevel.B2B })
  type: AuthorizationLevel;

  @Column({ enum: OnboardingStatus, default: OnboardingStatus.Pending })
  status: OnboardingStatus;

  // Optional at sign up; added later from the business profile
  @Column({ type: String, nullable: true, transformer: FileUrlTransformer })
  logo: string | null;
}
