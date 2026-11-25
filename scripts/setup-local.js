// Configure and migrate the Docker-based local MySQL database.
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const LOCAL_DATABASE_URL = 'mysql://root:cloudvault-local-root@127.0.0.1:3307/cloudvault';

console.log('> Starting local MySQL...');
execSync('docker compose up -d --wait mysql', { stdio: 'inherit', cwd: REPO_ROOT });

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

const args = process.argv.includes('--no-seed') ? ' --no-seed' : '';
execSync(`node prisma/scripts/db-setup.js${args}`, {
  stdio: 'inherit',
  cwd: REPO_ROOT,
  env: { ...process.env, DATABASE_URL: LOCAL_DATABASE_URL },
});

console.log(`
Local setup complete.

  Start everything:   npm run dev:local
  Open:               http://localhost:5173
  Sign in as:         alice@cloudvault.dev  /  CloudVault#2026
`);
