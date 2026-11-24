// Connection doctor for the database in DATABASE_URL (local PostgreSQL or AWS RDS).
//
//   npm run db:check            -> parse the URL, connect, report server/SSL/extension status
//   npm run db:check -- --create -> also create the target database if it does not exist yet
//
// It explains the usual RDS problems (security group, public access, SSL, password encoding)
// instead of printing a bare Prisma error code.

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const CREATE = process.argv.includes('--create');
const ok = (m) => console.log(`  ✔ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const fail = (m) => { console.error(`  ✖ ${m}`); process.exit(1); };

const raw = process.env.DATABASE_URL;
if (!raw) fail('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');

let url;
try {
  url = new URL(raw);
} catch {
  fail('DATABASE_URL is not a valid URL. If your password contains @ : / ? # % or spaces, URL-encode it\n'
    + '    (run: node -e "console.log(encodeURIComponent(process.argv[1]))" "your-password").');
}
if (!/^postgres(ql)?:$/.test(url.protocol)) fail(`DATABASE_URL must start with postgresql:// (got ${url.protocol}//).`);

const dbName = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres';
const isRds = /\.rds\.amazonaws\.com$/i.test(url.hostname);
const sslmode = url.searchParams.get('sslmode');

console.log('\nCloudVault database check');
console.log(`  host:     ${url.hostname}:${url.port || 5432}${isRds ? '  (AWS RDS)' : ''}`);
console.log(`  database: ${dbName}`);
console.log(`  user:     ${decodeURIComponent(url.username)}`);
console.log(`  sslmode:  ${sslmode ?? '(not set)'}\n`);

if (isRds && !sslmode) {
  warn('RDS endpoints normally require SSL. Add  ?sslmode=require  (or &sslmode=require) to DATABASE_URL.');
}
if (isRds && !url.searchParams.get('connect_timeout')) {
  warn('Tip: add &connect_timeout=15 so an unreachable RDS host fails fast instead of hanging.');
}

const withDb = (name) => {
  const u = new URL(url.href);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.href;
};

function explain(err) {
  const msg = String(err?.message ?? err);
  const code = err?.errorCode ?? '';
  if (code === 'P1001' || /Can't reach database server|timed out|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
    return [
      'Cannot reach the database server.',
      isRds
        ? 'For RDS check: (1) the instance status is "Available"; (2) "Publicly accessible" is Yes if you connect from your own PC;\n'
          + '    (3) the instance\'s security group has an inbound rule: PostgreSQL, TCP 5432, source = My IP;\n'
          + '    (4) the endpoint and port in DATABASE_URL match the RDS console; (5) your network does not block outbound port 5432.'
        : 'Is PostgreSQL running, and are the host/port right?',
    ].join('\n    ');
  }
  if (code === 'P1000' || /authentication failed|password authentication/i.test(msg)) {
    return 'Authentication failed: wrong username or password. For RDS this is the master username/password you chose when creating the instance.\n'
      + '    Special characters in the password must be URL-encoded in DATABASE_URL.';
  }
  if (code === 'P1003' || /does not exist/i.test(msg)) {
    return `Database "${dbName}" does not exist on this server. Run:  npm run db:check -- --create`;
  }
  if (/no pg_hba.conf entry|SSL|TLS|certificate/i.test(msg)) {
    return 'SSL problem. For RDS use ?sslmode=require in DATABASE_URL.';
  }
  return msg;
}

async function connect(href) {
  const client = new PrismaClient({ datasources: { db: { url: href } }, log: [] });
  await client.$connect();
  return client;
}

let prisma;
try {
  prisma = await connect(url.href);
} catch (err) {
  const missingDb = err?.errorCode === 'P1003' || /does not exist/i.test(String(err?.message));
  if (!(missingDb && CREATE)) fail(explain(err));

  // Connect to the always-present "postgres" maintenance database and create ours.
  let admin;
  try {
    admin = await connect(withDb('postgres'));
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    ok(`Created database "${dbName}"`);
  } catch (e) {
    fail(`Could not create database "${dbName}": ${explain(e)}`);
  } finally {
    await admin?.$disconnect();
  }
  try { prisma = await connect(url.href); } catch (e) { fail(explain(e)); }
}

try {
  const [{ version }] = await prisma.$queryRawUnsafe('SELECT version() AS version');
  ok(`Connected: ${version.split(',')[0]}`);

  const major = Number((await prisma.$queryRawUnsafe('SHOW server_version_num'))[0].server_version_num) / 10000;
  if (major < 14) warn(`PostgreSQL ${Math.floor(major)} detected; CloudVault is tested on 14+.`);

  try {
    const [{ ssl }] = await prisma.$queryRawUnsafe('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
    if (ssl) ok('Connection is encrypted (SSL)');
    else if (isRds) warn('Connection is NOT encrypted. Add sslmode=require to DATABASE_URL.');
    else ok('Connection is not encrypted (fine for a local server)');
  } catch { /* pg_stat_ssl not visible: ignore */ }

  const ext = await prisma.$queryRawUnsafe("SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm'");
  if (ext.length) ok('pg_trgm extension is available (needed for fast search)');
  else warn('pg_trgm extension is not available on this server; the initial migration will fail.');

  const tables = await prisma.$queryRawUnsafe(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations'",
  );
  if (tables[0].n) {
    const [{ n }] = await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
    ok(`Schema present (${n} migration${n === 1 ? '' : 's'} applied)`);
  } else {
    warn('No tables yet. Next step:  npm run db:setup');
  }
  console.log('\nDatabase looks good.\n');
} catch (err) {
  fail(explain(err));
} finally {
  await prisma.$disconnect();
}
