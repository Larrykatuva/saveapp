import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PHONE_RULE } from '../../authentication/dtos/auth-form.dtos';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Business details, as entered when it is created or edited. */
export class BusinessForm {
  @Transform(trim)
  @IsNotEmpty({ message: 'Enter the business name' })
  @MaxLength(120, { message: 'Keep the name under 120 characters' })
  name: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[^\d+]/g, '') : value,
  )
  @Matches(PHONE_RULE, { message: 'Enter a valid phone number' })
  phone: string;

  @Transform(trim)
  @IsNotEmpty({ message: 'Enter the business address' })
  @MaxLength(200, { message: 'Keep the address under 200 characters' })
  address: string;

  // Checked to remove the current logo
  @IsOptional()
  removeLogo?: string;
}

export class CreateBusinessForm extends BusinessForm {
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt({ message: 'Choose a country' })
  @Min(1, { message: 'Choose a country' })
  country: number;
}
