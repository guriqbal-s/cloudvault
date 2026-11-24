import prisma from '../config/db.js';
import { storage } from './storage/index.js';

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

/** Reports whether the API's dependencies are reachable. Never throws. */
export async function checkHealth() {
  const [db, store] = await Promise.all([
    withTimeout(prisma.$queryRaw`SELECT 1`, 2000).then(() => true, () => false),
    withTimeout(storage.healthCheck(), 2000).catch(() => false),
  ]);
  return {
    ok: db && store,
    status: db && store ? 'ok' : 'degraded',
    checks: { database: db ? 'up' : 'down', storage: store ? 'up' : 'down' },
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
