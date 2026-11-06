/**
 * Shared seed pieces: a database connection from .env, and an idempotent
 * Super Admin: creates the user (or resets an existing user's password),
 * gives them an active Staff account and the Super Admin role. The email is
 * treated as verified. Used by `npm run seed` and `npm run create:admin`.
 */
import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import {
  PASSWORD_HINT,
  PASSWORD_RULE,
  PHONE_RULE,
} from '../../modules/authentication/dtos/auth-form.dtos';
import {
  OtpChannel,
  SignInMethod,
  User,
} from '../../modules/authentication/entities/user.entity';
import { SystemRoles } from '../../modules/authorization/constants/roles.catalog';
import { AccountRole } from '../../modules/authorization/entities/accountRole.entity';
import { AuthorizationLevel } from '../../modules/authorization/entities/permission.entity';
import { Role } from '../../modules/authorization/entities/role.entity';
import { Account } from '../../modules/onboarding/entities/account.entity';
import { Business } from '../../modules/onboarding/entities/business.entity';
import { Customer } from '../../modules/onboarding/entities/customer.entity';
import { Country } from '../../modules/settings/entities/country.entity';

export interface AdminInput {
  email: string;
  password: string;
  phone: string;
  fullName: string;
  // Where sign-in codes go (email by default). SMS marks the seeded phone
  // as verified (it is the admin's own).
  codes?: OtpChannel;
}

/** Checks the input against the app's own rules; answers the problems. */
export function adminProblems(input: Partial<AdminInput>): string[] {
  const problems: string[] = [];
  if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
    problems.push('a valid email');
  if (!input.password || !PASSWORD_RULE.test(input.password))
    problems.push(`a password (${PASSWORD_HINT.toLowerCase()})`);
  if (!input.phone || !PHONE_RULE.test(input.phone))
    problems.push('a phone of 9 to 15 digits, e.g. +254712345678');
  return problems;
}

export function seedDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: [User, Account, Business, Customer, Country, Role, AccountRole],
  });
}

export async function seedSuperAdmin(
  dataSource: DataSource,
  {
    email,
    password,
    phone: phoneNumber,
    fullName,
    codes = OtpChannel.Email,
  }: AdminInput,
): Promise<void> {
  const channel: Partial<User> =
    codes === OtpChannel.Sms
      ? { phoneVerified: true, otpChannel: OtpChannel.Sms }
      : { otpChannel: OtpChannel.Email };
  const users = dataSource.getRepository(User);
  const accounts = dataSource.getRepository(Account);

  const hash = await bcrypt.hash(password, 10);
  let user = await users.findOneBy({ email });
  if (user) {
    await users.update(
      { id: user.id },
      {
        password: hash,
        emailVerified: true,
        verified: true,
        active: true,
        // Running the seed again also moves codes to the chosen channel
        ...(codes === OtpChannel.Sms ? { phoneNumber } : {}),
        ...channel,
      },
    );
    console.log(`Updated password for existing user ${email}.`);
  } else {
    user = await users.save({
      email,
      phoneNumber,
      fullName,
      password: hash,
      emailVerified: true,
      verified: true,
      active: true,
      signInMethod: SignInMethod.SignUp,
      ...channel,
    });
    console.log(`Created user ${email}.`);
  }
  console.log(
    codes === OtpChannel.Sms
      ? `Sign-in codes go by SMS to ${phoneNumber}.`
      : `Sign-in codes go by email to ${email}.`,
  );

  let account = await accounts.findOneBy({
    user: { id: user.id },
    type: AuthorizationLevel.Staff,
  });
  if (account) {
    if (!account.active)
      await accounts.update({ id: account.id }, { active: true });
    console.log('Staff account already present (ensured active).');
  } else {
    account = await accounts.save({
      user,
      type: AuthorizationLevel.Staff,
      active: true,
    });
    console.log('Staff account created.');
  }

  // Super Admin holds every staff permission (created by the app on boot)
  const superAdmin = await dataSource.getRepository(Role).findOneBy({
    name: SystemRoles.SuperAdmin,
    type: AuthorizationLevel.Staff,
    system: true,
  });
  if (superAdmin) {
    const links = dataSource.getRepository(AccountRole);
    const link = await links.findOneBy({
      account: { id: account.id },
      role: { id: superAdmin.id },
    });
    if (!link) await links.save({ account, role: superAdmin, active: true });
    else if (!link.active)
      await links.update({ id: link.id }, { active: true });
    console.log('Super Admin role assigned.');
  } else {
    console.log(
      'Super Admin role not seeded yet: it is assigned automatically on the next app start.',
    );
  }
}
