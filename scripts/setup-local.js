// One-time local setup:  npm run setup:local
//
//  1. Creates .env from .env.example if it does not exist (with a random JWT secret).
//  2. Points DATABASE_URL at the bundled local PostgreSQL (the previous value is kept as a comment,
//     so switching back to AWS RDS is just un-commenting a line).
//  3. Starts the local PostgreSQL, creates tables and seeds demo data (npm run db:setup), stops it.
//
// Re-running it is safe: it only applies pending migrations and re-seeds the demo data.
// Flags: --no-seed (keep existing data, only migrate)

import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_DATABASE_URL, REPO_ROOT, startLocalDb } from './local-db.js';

const envPath = path.join(REPO_ROOT, '.env');
const examplePath = path.join(REPO_ROOT, '.env.example');

// ---- 1 + 2: .env -----------------------------------------------------------------------
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : null;
if (env === null) {
  env = fs.readFileSync(examplePath, 'utf8');
  console.log('> Created .env from .env.example');
}
if (/^JWT_ACCESS_SECRET=change-me/m.test(env)) {
  env = env.replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${crypto.randomBytes(64).toString('hex')}`);
  console.log('> Generated a random JWT_ACCESS_SECRET');
}
const lines = env.split(/\r?\n/);
const active = lines.findIndex((l) => /^DATABASE_URL=/.test(l));
const want = `DATABASE_URL="${LOCAL_DATABASE_URL}"`;
if (active === -1) {
  lines.push(want);
} else if (lines[active] !== want) {
  console.log('> Switched DATABASE_URL in .env to the local database (previous value kept as a comment)');
  lines.splice(active, 1, `# ${lines[active]}`, want);
}
fs.writeFileSync(envPath, lines.join('\n'));

// ---- 3: database -------------------------------------------------------------------------
console.log('\n> Starting the local PostgreSQL...');
const db = await startLocalDb();
let failed = false;
try {
  const args = process.argv.includes('--no-seed') ? ' --no-seed' : '';
  execSync(`node prisma/scripts/db-setup.js${args}`, {
    stdio: 'inherit',
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: LOCAL_DATABASE_URL },
  });
} catch {
  failed = true;
} finally {
  await db.stop();
}

if (failed) {
  console.error('\nLocal setup failed; see the messages above.');
  process.exit(1);
}
console.log(`
Local setup complete.

  Start everything:   npm run dev:local
  Open:               http://localhost:5173
  Sign in as:         alice@cloudvault.dev  /  CloudVault#2026
`);
