// Schedules the background jobs with node-cron. Call startJobs() after the server is listening;
// the returned function stops them (used on shutdown). Cron expressions come from .env.

import cron from 'node-cron';

import prisma from '../config/db.js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import activityService from '../services/activity.service.js';
import notificationService from '../services/notification.service.js';
import { storage } from '../services/storage/index.js';
import { redis } from '../config/redis.js';
import { createJobs } from './jobs.logic.js';
import { withClusterLock } from './clusterLock.js';

export function startJobs() {
  const jobs = createJobs({
    db: prisma, storage, notifications: notificationService, activity: activityService, logger,
    config: { trashRetentionDays: env.jobs.trashRetentionDays, warningPercent: env.storage.quotaWarningPercent },
  });

  const schedule = [
    ['trash-purge', env.jobs.trashPurgeCron, jobs.purgeTrash],
    ['link-cleanup', env.jobs.linkExpiryCron, jobs.expireLinks],
    ['token-prune', '15 4 * * *', jobs.pruneTokens],
    ['storage-warnings', '0 9 * * *', jobs.storageWarnings],
    ['storage-snapshot', env.jobs.storageSnapshotCron, jobs.snapshotStorage],
  ];

  const tasks = schedule.map(([name, expression, fn]) => {
    if (!cron.validate(expression)) throw new Error(`Invalid cron expression for ${name}: "${expression}"`);
    // guarded: no overlap within this instance; cluster lock: only one instance runs each tick
    return cron.schedule(expression, jobs.guarded(name, withClusterLock(redis, name, fn, { logger })));
  });
  logger.info(`Scheduled ${tasks.length} background jobs`);
  return () => tasks.forEach((t) => t.stop());
}

export default startJobs;
