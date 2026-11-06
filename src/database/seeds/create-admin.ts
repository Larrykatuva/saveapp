/**
 * Creates the first SaveApp staff member (Super Admin), or updates an
 * existing user's password and gives them an active Staff account with the
 * Super Admin role. The email is treated as verified.
 *
 *   npm run create:admin -- <email> <password> <phone> ["Full name"]
 *
 * Start the app once first so the Super Admin role exists; if it doesn't yet,
 * the role is given on the next start (accounts without a role get their
 * level's default role, and Super Admin is the Staff default).
 */
import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import {
  PASSWORD_HINT,
  PASSWORD_RULE,
  PHONE_RULE,
} from '../../modules/authentication/dtos/auth-form.dtos';
import {
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

config();

async function run() {
  const [rawEmail, password, rawPhone, fullName = 'SaveApp Admin'] =
    process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  const phoneNumber = rawPhone?.replace(/[^\d+]/g, '');
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !password ||
    !phoneNumber
  ) {
    console.error(
      'Usage: npm run create:admin -- <email> <password> <phone> ["Full name"]',
    );
    process.exit(1);
  }
  if (!PASSWORD_RULE.test(password)) {
    console.error(`Password rejected: ${PASSWORD_HINT}.`);
    process.exit(1);
  }
  if (!PHONE_RULE.test(phoneNumber)) {
    console.error('Phone rejected: use 9 to 15 digits, e.g. +254712345678.');
    process.exit(1);
  }

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: [User, Account, Business, Customer, Country, Role, AccountRole],
  });
  await dataSource.initialize();
  const users = dataSource.getRepository(User);
  const accounts = dataSource.getRepository(Account);

  const hash = await bcrypt.hash(password, 10);
  let user = await users.findOneBy({ email });
  if (user) {
    await users.update(
      { id: user.id },
      { password: hash, emailVerified: true, verified: true, active: true },
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
    });
    console.log(`Created user ${email}.`);
  }

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

  await dataSource.destroy();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
