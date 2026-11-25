// Optional Redis connection, used to run several API instances side by side.
// With REDIS_URL set, rate-limit counters, Socket.IO events and background-job locks are
// shared across instances. Without it, everything stays in process (single-instance mode).

import Redis from 'ioredis';

import { env } from './env.js';
import logger from '../utils/logger.js';

const clients = new Set();

/** A new Redis connection, or null when REDIS_URL is not configured. */
export function createRedisClient(name = 'main') {
  if (!env.redisUrl) return null;
  const client = new Redis(env.redisUrl, {
    connectionName: `cloudvault-${name}`,
    // Commands wait for (re)connection instead of failing immediately on a brief blip.
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
  });
  client.on('error', (err) => logger.error(`Redis (${name}) error: ${err.message}`));
  clients.add(client);
  return client;
}

/** Shared connection for commands (rate limits, locks). null in single-instance mode. */
export const redis = createRedisClient('main');

/** Resolves when Redis answers, so startup fails fast on a wrong REDIS_URL. */
export async function assertRedisReachable() {
  if (!redis) return;
  try {
    await redis.ping();
  } catch (err) {
    throw new Error(`Cannot connect to Redis at REDIS_URL (${err.message})`);
  }
}

export async function closeRedis() {
  await Promise.all([...clients].map((c) => c.quit().catch(() => c.disconnect())));
  clients.clear();
}
