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
 * SEED_ADMIN_EMAIL, SEED_ADMIN_PHONE and SEED_ADMIN_NAME. Safe to run again:
 * it resets the password and makes sure the Staff account and Super Admin
 * role are in place. Start the app once first so the roles exist.
 */
import { config } from 'dotenv';
import { appEnv } from '../../configs/environment';
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
