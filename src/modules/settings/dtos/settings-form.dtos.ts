import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AuthorizationLevel,
  MERCHANT_LEVELS,
} from '../../authorization/entities/permission.entity';
import { RequirementInput } from '../../onboarding/entities/requirement.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CountryForm {
  @Transform(trim)
  @IsNotEmpty({ message: 'Enter the country name' })
  @MaxLength(80, { message: 'Keep the name under 80 characters' })
  name: string;

  @Transform(upper)
  @Matches(/^[A-Z]{2}$/, { message: 'Use the 2-letter ISO code, e.g. KE' })
  code: string;

  @IsOptional()
  active?: string;

  // Checked to remove an uploaded image
  @IsOptional()
  removeLogo?: string;
}

export class RequirementForm {
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt({ message: 'Choose a country' })
  @Min(1, { message: 'Choose a country' })
  country: number;

  @IsIn(MERCHANT_LEVELS, { message: 'Choose who this applies to' })
  level: AuthorizationLevel;

  @Transform(trim)
  @IsNotEmpty({ message: 'Enter the requirement name' })
  @MaxLength(120, { message: 'Keep the name under 120 characters' })
  name: string;

  @IsEnum(RequirementInput, { message: 'Choose what the merchant provides' })
  input: RequirementInput;

  @Transform(trim)
  @IsOptional()
  @MaxLength(300, { message: 'Keep the guidance under 300 characters' })
  comment?: string;

  @IsOptional()
  required?: string;
}
