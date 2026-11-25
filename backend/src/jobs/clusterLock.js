// Makes a scheduled job run on only one API instance per tick. Every instance fires the same
// cron schedule; the first to claim that tick in Redis runs the job, the others skip it.
// Without Redis (single instance) the job always runs.
//
// The claim is keyed by job name + the minute the tick fired in and is never released early,
// so a job that finishes in milliseconds cannot run again on an instance whose clock is
// slightly behind. Each instance fires when its own clock reaches the scheduled minute, so
// all instances compute the same key.

/**
 * @param {import('ioredis').Redis | null} redis
 * @param {string} name
 * @param {() => Promise<unknown>} fn
 * @param {{ ttlMs?: number, now?: () => Date, logger?: { info?: Function } }} [opts]
 * @returns {() => Promise<unknown>} resolves to fn's result, or null when another instance ran it
 */
export function withClusterLock(redis, name, fn, { ttlMs = 10 * 60_000, now = () => new Date(), logger } = {}) {
  if (!redis) return fn;
  return async () => {
    const minute = now().toISOString().slice(0, 16); // e.g. 2026-11-25T03:00
    const claimed = await redis.set(`cv:job-tick:${name}:${minute}`, process.pid, 'PX', ttlMs, 'NX');
    if (claimed !== 'OK') {
      logger?.info?.(`Job ${name} ran on another instance for ${minute}; skipping`);
      return null;
    }
    return fn();
  };
}
