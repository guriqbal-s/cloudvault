// Prisma client singleton. Works with local PostgreSQL and AWS RDS; only DATABASE_URL changes.
// RDS refuses unencrypted connections by default, so for *.rds.amazonaws.com hosts we add
// sslmode=require when the URL does not say otherwise (see docs/aws-rds-setup.md).

import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import logger from '../utils/logger.js';

const globalForPrisma = globalThis;

export function withRdsDefaults(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return rawUrl; }
  if (!/\.rds\.amazonaws\.com$/i.test(url.hostname)) return rawUrl;
  if (!url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'require');
    logger.warn('DATABASE_URL points at AWS RDS without sslmode; using sslmode=require.');
  }
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '15');
  return url.href;
}

const prisma =
  globalForPrisma.__cloudvaultPrisma ??
  new PrismaClient({
    datasources: { db: { url: withRdsDefaults(env.databaseUrl) } },
    log: env.isProd ? ['error'] : ['warn', 'error'],
  });

// Reuse one client across `node --watch` module reloads in development.
if (!env.isProd) globalForPrisma.__cloudvaultPrisma = prisma;

export default prisma;
