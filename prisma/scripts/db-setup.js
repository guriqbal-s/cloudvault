// Apply the checked-in MySQL migrations without a shadow database.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function run(cmd) {
  try {
    execSync(cmd, { stdio: 'inherit', cwd: repoRoot });
  } catch {
    console.error(`\nStep failed: ${cmd}\nFor connection help see docs/aws-rds-setup.md.`);
    process.exit(1);
  }
}

console.log('\n> Generating the Prisma client...');
run('npm run db:generate -w backend');

console.log('\n> Checking the database connection...');
run('node prisma/scripts/db-check.js --create');

console.log('\n> Applying migrations...');
run('npm run db:deploy -w backend');

if (!process.argv.includes('--no-seed')) {
  console.log('\n> Seeding...');
  run(`node prisma/seed.js${process.argv.includes('--core') ? ' --core' : ''}`);
}

console.log('\nDatabase ready.');
