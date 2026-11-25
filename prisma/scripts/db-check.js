// Check the MySQL connection in DATABASE_URL and optionally create the target database.
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const raw = process.env.DATABASE_URL;
const create = process.argv.includes('--create');

function fail(message) {
  throw new Error(message);
}

async function usingDatabase(url, callback) {
  const prisma = new PrismaClient({ datasourceUrl: url.href });
  try {
    await prisma.$connect();
    return await callback(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

function errorCode(error) {
  return error.errorCode ?? error.code;
}

async function main() {
  if (!raw) fail('Set DATABASE_URL in the root .env file or in the process environment.');
  if (/YOUR_RDS_ENDPOINT|YOUR_DB_USER|YOUR_DB_PASSWORD/.test(raw)) {
    fail('Fill in the RDS endpoint, username and password in the root .env file.');
  }

  let url;
  let dbName;
  try {
    url = new URL(raw);
    dbName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    fail('DATABASE_URL is invalid. Percent-encode special characters in the username and password.');
  }
  if (url.protocol !== 'mysql:' || !url.hostname || !url.username || !dbName || dbName.includes('/')) {
    fail('DATABASE_URL must use mysql://USER:PASSWORD@HOST:PORT/DATABASE.');
  }

  const isRds = /\.rds\.amazonaws\.com(?:\.cn)?$/i.test(url.hostname);
  if (isRds && (!url.searchParams.has('sslcert') || url.searchParams.get('sslaccept') !== 'strict')) {
    fail('For RDS, set sslcert and sslaccept=strict in DATABASE_URL. See docs/aws-rds-setup.md.');
  }
  console.log(`\nChecking ${url.hostname}:${url.port || 3306}/${dbName}${isRds ? ' (AWS RDS)' : ''}`);

  try {
    await checkDatabase(url, isRds);
  } catch (error) {
    if (errorCode(error) !== 'P1003' || !create) throw error;
    const maintenance = new URL(url);
    maintenance.pathname = '/information_schema';
    const identifier = '\x60' + dbName.replaceAll('\x60', '\x60\x60') + '\x60';
    await usingDatabase(maintenance, (prisma) => prisma.$executeRawUnsafe(
      `CREATE DATABASE IF NOT EXISTS ${identifier} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci`,
    ));
    console.log(`  Created database ${dbName}.`);
    await checkDatabase(url, isRds);
  }
}

async function checkDatabase(url, isRds) {
  await usingDatabase(url, async (prisma) => {
    const [{ version }] = await prisma.$queryRaw`SELECT VERSION() AS version`;
    console.log(`  Connected to MySQL ${version}.`);

    if (isRds) {
      const [tls] = await prisma.$queryRaw`SHOW SESSION STATUS LIKE 'Ssl_cipher'`;
      if (!tls?.Value) fail('The RDS connection is missing TLS encryption.');
      console.log(`  TLS cipher ${tls.Value}.`);
    }

    const [table] = await prisma.$queryRaw`
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = '_prisma_migrations'`;
    if (table) {
      const [{ n }] = await prisma.$queryRaw`
        SELECT COUNT(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      console.log(`  Applied migrations: ${n}.`);
    } else {
      console.log('  No migrations applied. Run npm run db:setup:prod to initialize this database.');
    }
  });
}

const hints = {
  P1000: 'Authentication failed. Check the RDS username and percent-encoded password.',
  P1001: 'MySQL is unreachable. Check the host, port, network access, and RDS security group.',
  P1002: 'MySQL timed out. Check the host, port, network access, and RDS security group.',
  P1003: 'The database does not exist. Run npm run db:check -- --create to create it.',
  P1010: 'The MySQL user does not have access to the requested database.',
  P1011: 'TLS connection failed. Check the AWS RDS CA certificate and endpoint.',
};

main().catch((error) => {
  const code = errorCode(error);
  console.error(hints[code] ?? (code ? `Database check failed (${code}).` : error.message));
  process.exitCode = 1;
});
