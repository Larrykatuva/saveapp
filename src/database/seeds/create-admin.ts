/**
 * Creates a SaveApp staff member (Super Admin), or updates an existing
 * user's password and gives them an active Staff account with the Super
 * Admin role. The email is treated as verified.
 *
 *   npm run create:admin -- <email> <password> <phone> ["Full name"]
 *
 * Start the app once first so the Super Admin role exists; if it doesn't yet,
 * the role is given on the next start (accounts without a role get their
 * level's default role, and Super Admin is the Staff default).
 */
import { config } from 'dotenv';
import { adminProblems, seedDataSource, seedSuperAdmin } from './admin.seed';

config();

async function run() {
  const [rawEmail, password, rawPhone, fullName = 'SaveApp Admin'] =
    process.argv.slice(2);
  const input = {
    email: rawEmail?.trim().toLowerCase() ?? '',
    password: password ?? '',
    phone: rawPhone?.replace(/[^\d+]/g, '') ?? '',
    fullName,
  };
  const problems = adminProblems(input);
  if (problems.length) {
    console.error(`Needs ${problems.join(', ')}.`);
    console.error(
      'Usage: npm run create:admin -- <email> <password> <phone> ["Full name"]',
    );
    process.exit(1);
  }
  const dataSource = seedDataSource();
  await dataSource.initialize();
  await seedSuperAdmin(dataSource, input);
  await dataSource.destroy();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
