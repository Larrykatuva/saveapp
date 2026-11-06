/**
 * Seeds a SaveApp server with exactly one account: the Super Admin. Nothing
 * else is created; merchants sign up and onboard themselves.
 *
 * The password is never stored in the repo. Give it in the environment:
 *
 *   SEED_ADMIN_PASSWORD='…' npm run seed          # from source (ts-node)
 *   SEED_ADMIN_PASSWORD='…' npm run seed:prod     # on a server (sandbox or
 *                                                 # production), after npm run build
 *
 * Email, phone and name default to Lawrence's; override them with
 * SEED_ADMIN_EMAIL, SEED_ADMIN_PHONE and SEED_ADMIN_NAME. Sign-in codes go
 * by SMS to that phone (SEED_ADMIN_CODES=email to use email). Safe to run again:
 * it resets the password and makes sure the Staff account and Super Admin
 * role are in place. Start the app once first so the roles exist.
 */
import { config } from 'dotenv';
import { appEnv } from '../../configs/environment';
import { OtpChannel } from '../../modules/authentication/entities/user.entity';
import { adminProblems, seedDataSource, seedSuperAdmin } from './admin.seed';

config();

async function run() {
  const input = {
    email: (process.env.SEED_ADMIN_EMAIL ?? 'larry.katuva@gmail.com')
      .trim()
      .toLowerCase(),
    phone: (process.env.SEED_ADMIN_PHONE ?? '+254794310952').replace(
      /[^\d+]/g,
      '',
    ),
    fullName: process.env.SEED_ADMIN_NAME ?? 'Lawrence Katuva',
    password: process.env.SEED_ADMIN_PASSWORD ?? '',
    // SMS unless told otherwise: works with Africa's Talking alone, even
    // while the mail settings are a test inbox
    codes:
      (process.env.SEED_ADMIN_CODES ?? 'sms').trim().toLowerCase() === 'email'
        ? OtpChannel.Email
        : OtpChannel.Sms,
  };
  const problems = adminProblems(input);
  if (problems.length) {
    console.error(
      `Seed needs ${problems.join(', ')}. Set SEED_ADMIN_PASSWORD (and optionally SEED_ADMIN_EMAIL, SEED_ADMIN_PHONE, SEED_ADMIN_NAME).`,
    );
    process.exit(1);
  }
  const dataSource = seedDataSource();
  await dataSource.initialize();
  // Say where this goes, so a sandbox seed never lands on the wrong database
  console.log(
    `Seeding Super Admin ${input.email} into ${appEnv()} (${process.env.DB_NAME} on ${process.env.DB_HOST})…`,
  );
  await seedSuperAdmin(dataSource, input);
  await dataSource.destroy();
  console.log('Done.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
