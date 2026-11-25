// Process entry point: verify dependencies, prepare storage, listen, attach Socket.IO, start cron jobs, shut down cleanly.

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

import { env } from './config/env.js';
import prisma from './config/db.js';
import app from './app.js';
import logger from './utils/logger.js';
import { attachSocketServer } from './sockets/index.js';
import { startJobs } from './jobs/index.js';
import { assertRedisReachable, closeRedis } from './config/redis.js';
import { storage } from './services/storage/index.js';

export const httpServer = http.createServer(app);
const io = attachSocketServer(httpServer);
let stopJobs = () => {};

async function prepareLocalStorage() {
  if (env.storage.driver !== 'local') return;
  for (const dir of ['uploads', 'versions', 'tmp']) {
    await fs.mkdir(path.join(env.storage.root, dir), { recursive: true });
  }
}

async function start() {
  await prisma.$connect().catch((err) => {
    throw new Error(
      `Cannot connect to the database (${err.message}). Check DATABASE_URL in .env, then run ` +
        '"npm run db:check" to check MySQL connectivity and TLS. ' +
        'See docs/aws-rds-setup.md for RDS setup.'
    );
  });
  await prepareLocalStorage();
  await assertRedisReachable();
  // Warm the storage health cache so the first load-balancer probe answers quickly.
  if (!(await storage.healthCheck())) logger.warn(`Storage (${env.storage.driver}) is not reachable yet`);

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(env.port, () => resolve());
  });
  stopJobs = startJobs();
  logger.info(
    `CloudVault API listening on http://localhost:${env.port} (${env.nodeEnv}, storage: ${env.storage.driver}, ` +
      `${env.redisUrl ? 'multi-instance via Redis' : 'single instance'})`
  );
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down...`);
  const force = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  force.unref();
  try {
    stopJobs();
    io?.close?.();
    await new Promise((resolve) => httpServer.close(() => resolve()));
    httpServer.closeIdleConnections?.();
    await prisma.$disconnect();
    await closeRedis();
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection:', reason));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  shutdown('uncaughtException');
});

start().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
