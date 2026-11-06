import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RoleForm {
  @Transform(trim)
  @Length(2, 60, { message: 'Use 2 to 60 characters' })
  name: string;

  @Transform(trim)
  @IsOptional()
  @MaxLength(200, { message: 'Keep the description under 200 characters' })
  description?: string;
}

export class InviteMemberForm {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @Transform(trim)
  @IsOptional()
  @MaxLength(120, { message: 'Name is too long' })
  fullName?: string;

  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt({ message: 'Choose a role' })
  @Min(1, { message: 'Choose a role' })
  roleId: number;
}
