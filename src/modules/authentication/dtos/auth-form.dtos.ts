import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const email = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
// Kenyan numbers are stored as +2547XXXXXXXX; anything else keeps its digits
const phone = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/[^\d+]/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
  return digits;
};

export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
export const PASSWORD_HINT =
  'Use at least 8 characters with a mix of letters and numbers';
export const PHONE_RULE = /^\+?\d{9,15}$/;

export class LoginForm {
  @Transform(email)
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @IsNotEmpty({ message: 'Enter your password' })
  password: string;

  @IsOptional()
  remember?: string;
}

export class RegisterForm {
  @Transform(trim)
  @IsNotEmpty({ message: 'Enter your full name' })
  @MaxLength(120, { message: 'Name is too long' })
  fullName: string;

  @Transform(email)
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @Transform(phone)
  @Matches(PHONE_RULE, { message: 'Enter a valid phone number' })
  phoneNumber: string;

  @Matches(PASSWORD_RULE, { message: PASSWORD_HINT })
  password: string;

  @IsNotEmpty({ message: 'Confirm your password' })
  confirmPassword: string;

  @Equals('on', { message: 'Accept the terms to continue' })
  terms: string;
}

/** Sign up from an invitation: the email comes from the invitation. */
export class InviteRegisterForm {
  @Transform(trim)
  @IsNotEmpty({ message: 'Enter your full name' })
  @MaxLength(120, { message: 'Name is too long' })
  fullName: string;

  @Transform(phone)
  @Matches(PHONE_RULE, { message: 'Enter a valid phone number' })
  phoneNumber: string;

  @Matches(PASSWORD_RULE, { message: PASSWORD_HINT })
  password: string;

  @IsNotEmpty({ message: 'Confirm your password' })
  confirmPassword: string;

  @Equals('on', { message: 'Accept the terms to continue' })
  terms: string;
}

export class InviteLoginForm {
  @IsNotEmpty({ message: 'Enter your password' })
  password: string;
}

export class VerifyCodeForm {
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.join('') : trim({ value }),
  )
  @Length(6, 6, { message: 'Enter the 6-digit code' })
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;
}

export class ForgotPasswordForm {
  @Transform(email)
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;
}

export class ResetPasswordForm extends VerifyCodeForm {
  @Matches(PASSWORD_RULE, { message: PASSWORD_HINT })
  password: string;

  @MinLength(1, { message: 'Confirm your new password' })
  confirmPassword: string;
}

/** My account: name and phone (the email is the sign in and stays fixed). */
export class ProfileForm {
  @Transform(trim)
  @IsNotEmpty({ message: 'Enter your full name' })
  @MaxLength(120, { message: 'Name is too long' })
  fullName: string;

  @Transform(phone)
  @Matches(PHONE_RULE, { message: 'Enter a valid phone number' })
  phoneNumber: string;

  // Checked to remove the current profile photo
  @IsOptional()
  removePhoto?: string;
}

export class ChangePasswordForm {
  @IsNotEmpty({ message: 'Enter your current password' })
  currentPassword: string;

  @Matches(PASSWORD_RULE, { message: PASSWORD_HINT })
  password: string;

  @MinLength(1, { message: 'Confirm your new password' })
  confirmPassword: string;
}
