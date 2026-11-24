// Local PostgreSQL without installing PostgreSQL.
//
// Runs a real PostgreSQL 17 server from the `embedded-postgres` npm package (binaries are
// downloaded by `npm install`). Data is kept in <repo>/.local-db/ between runs.
//
//   node scripts/local-db.js        start it and keep running until Ctrl+C   (npm run db:local)
//   import { startLocalDb } ...     start it from another script (setup-local.js)
//
// Connection: postgresql://postgres:postgres@localhost:5433/cloudvault
// (port 5433 so it never clashes with a "real" PostgreSQL on 5432; override with LOCAL_DB_PORT)

import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const LOCAL_DB = Object.freeze({
  dir: path.join(REPO_ROOT, '.local-db', 'data'),
  port: Number(process.env.LOCAL_DB_PORT) || 5433,
  user: 'postgres',
  password: 'postgres',
  database: 'cloudvault',
});
export const LOCAL_DATABASE_URL =
  `postgresql://${LOCAL_DB.user}:${LOCAL_DB.password}@localhost:${LOCAL_DB.port}/${LOCAL_DB.database}?schema=public`;

const portInUse = (port) => new Promise((resolve) => {
  const socket = net.connect({ port, host: '127.0.0.1' });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});

const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

/** A crash or a closed terminal can leave postmaster.pid behind, which blocks the next start. */
function clearStaleLock() {
  const lock = path.join(LOCAL_DB.dir, 'postmaster.pid');
  if (!fs.existsSync(lock)) return;
  const pid = Number(fs.readFileSync(lock, 'utf8').split(/\r?\n/)[0]);
  if (!pid || !pidAlive(pid)) {
    fs.rmSync(lock, { force: true });
    console.log('[db] removed a stale lock file from a previous run');
  }
}

/**
 * Start the local server. Resolves to { stop(), alreadyRunning }.
 * If something is already listening on the port (e.g. `npm run db:local` in another terminal)
 * it is reused and stop() is a no-op.
 */
export async function startLocalDb({ quiet = false } = {}) {
  if (await portInUse(LOCAL_DB.port)) {
    if (!quiet) console.log(`[db] something is already listening on port ${LOCAL_DB.port}; using it`);
    return { alreadyRunning: true, stop: async () => {} };
  }

  const pg = new EmbeddedPostgres({
    databaseDir: LOCAL_DB.dir,
    port: LOCAL_DB.port,
    user: LOCAL_DB.user,
    password: LOCAL_DB.password,
    persistent: true, // keep data on stop (the library default deletes it!)
    onLog: () => {},
    onError: (m) => { const s = String(m instanceof Error ? m.message : m).trim(); if (s && !quiet) console.error(`[db] ${s}`); },
  });

  if (!fs.existsSync(path.join(LOCAL_DB.dir, 'PG_VERSION'))) {
    console.log('[db] first run: creating the local database cluster in .local-db/ ...');
    fs.mkdirSync(path.dirname(LOCAL_DB.dir), { recursive: true });
    await pg.initialise();
  }
  clearStaleLock();
  await pg.start();

  let stopped = false;
  return {
    alreadyRunning: false,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await pg.stop().catch(() => {});
    },
  };
}

// ---- CLI: keep the server in the foreground until Ctrl+C ------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const db = await startLocalDb();
    if (db.alreadyRunning) {
      // Another copy owns the server; stay alive quietly so `npm run dev:local` keeps running.
      setInterval(() => {}, 1 << 30);
    } else {
      console.log(`[db] PostgreSQL ready on localhost:${LOCAL_DB.port} (data: .local-db/). Ctrl+C to stop.`);
      const shutdown = async () => {
        console.log('[db] stopping...');
        await db.stop();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      process.on('SIGHUP', shutdown);
      setInterval(() => {}, 1 << 30);
    }
  } catch (err) {
    console.error(`[db] could not start the local database: ${err?.message ?? err}`);
    console.error('[db] If it keeps failing, delete the .local-db folder (this erases local data) and run "npm run setup:local" again.');
    process.exit(1);
  }
}
