// Prisma client singleton for MySQL.
import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

const globalForPrisma = globalThis;
const prisma = globalForPrisma.__cloudvaultPrisma ??
  new PrismaClient({ log: env.isProd ? ['error'] : ['warn', 'error'] });

// Reuse one client across `node --watch` module reloads in development.
if (!env.isProd) globalForPrisma.__cloudvaultPrisma = prisma;

export default prisma;
