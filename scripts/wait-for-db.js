// Wait until the host:port in DATABASE_URL accepts TCP connections, then exit 0.
// Used by `npm run dev:local` so the API starts only after the local database is up.

import dotenv from 'dotenv';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const TIMEOUT_MS = 120_000;
let url;
try {
  url = new URL(process.env.DATABASE_URL);
} catch {
  console.error('[wait] DATABASE_URL in .env is missing or invalid. Run "npm run setup:local" first.');
  process.exit(1);
}
const host = url.hostname;
const port = Number(url.port) || 5432;

const tryConnect = () => new Promise((resolve) => {
  const s = net.connect({ host, port });
  s.setTimeout(2000);
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('timeout', () => { s.destroy(); resolve(false); });
  s.once('error', () => resolve(false));
});

const started = Date.now();
while (!(await tryConnect())) {
  if (Date.now() - started > TIMEOUT_MS) {
    console.error(`[wait] database at ${host}:${port} did not come up within ${TIMEOUT_MS / 1000}s`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}
// The port opens a moment before PostgreSQL accepts logins; give it a beat.
await new Promise((r) => setTimeout(r, 750));
console.log(`[wait] database is reachable at ${host}:${port}`);
