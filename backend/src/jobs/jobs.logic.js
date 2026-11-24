// Background job bodies. Pure and injectable: index.js schedules them with node-cron; tests call
// them directly with fakes. Every job returns a small summary and never throws for one bad row.

import { filePrefix } from '../services/storage/keys.js';

const DAY = 86_400_000;
const BATCH = 200;

/**
 * @param {{ db, storage, notifications, activity, logger, now?: () => Date,
 *           config: { trashRetentionDays: number, warningPercent: number } }} deps
 */
export function createJobs({ db, storage, notifications, activity, logger, now = () => new Date(), config }) {
  /** Permanently remove files and folders that have been in the trash past the retention period. */
  async function purgeTrash() {
    const cutoff = new Date(now().getTime() - config.trashRetentionDays * DAY);
    const summary = { files: 0, folders: 0, bytes: 0, failed: 0 };
    const skipped = new Set();

    for (;;) {
      const batch = (await db.file.findMany({ where: { deletedAt: { lt: cutoff }, id: { notIn: [...skipped] } }, orderBy: [{ deletedAt: 'asc' }], take: BATCH }));
      if (!batch.length) break;
      const doomed = [];
      for (const file of batch) {
        try {
          await storage.deletePrefix(filePrefix(file.ownerId, file.id)); // blobs first: a failure keeps the row for the next run
          doomed.push(file);
        } catch (err) {
          skipped.add(file.id);
          summary.failed += 1;
          logger.error(`Trash purge: could not delete blobs of file ${file.id}:`, err);
        }
      }
      if (!doomed.length) continue;

      const versions = await db.fileVersion.findMany({ where: { fileId: { in: doomed.map((f) => f.id) } }, select: { fileId: true, size: true } });
      const freed = new Map();
      for (const f of doomed) freed.set(f.ownerId, 0n);
      const ownerOf = new Map(doomed.map((f) => [f.id, f.ownerId]));
      for (const v of versions) freed.set(ownerOf.get(v.fileId), freed.get(ownerOf.get(v.fileId)) + BigInt(v.size));

      await db.file.deleteMany({ where: { id: { in: doomed.map((f) => f.id) } } });
      for (const [ownerId, bytes] of freed) {
        if (bytes > 0n) await db.user.update({ where: { id: ownerId }, data: { storageUsedBytes: { decrement: bytes } } });
        summary.bytes += Number(bytes);
      }
      for (const f of doomed) {
        await activity.log({
          userId: f.ownerId, action: 'FILE_PERMANENT_DELETE', description: `“${f.name}” was removed from the trash after ${config.trashRetentionDays} days`,
          resourceType: 'FILE', resourceId: f.id, resourceName: f.name, metadata: { automatic: true },
        });
      }
      summary.files += doomed.length;
    }

    const folders = await db.folder.deleteMany({ where: { deletedAt: { lt: cutoff } } });
    summary.folders = folders.count;
    return summary;
  }

  /** Links are inactive the moment they expire (checked on every access); this removes old rows. */
  async function expireLinks() {
    const grace = new Date(now().getTime() - 30 * DAY);
    const { count } = await db.shareLink.deleteMany({ where: { expiresAt: { lt: grace } } });
    return { deleted: count };
  }

  /** Delete expired auth tokens and long-revoked sessions. Revoked-but-unexpired refresh tokens stay (reuse detection). */
  async function pruneTokens() {
    const t = now();
    const [refresh, reset, verify, sessions] = await Promise.all([
      db.refreshToken.deleteMany({ where: { expiresAt: { lt: t } } }),
      db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: t } } }),
      db.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: t } } }),
      db.userSession.deleteMany({ where: { revokedAt: { lt: new Date(t.getTime() - 90 * DAY) } } }),
    ]);
    return { refreshTokens: refresh.count, resetTokens: reset.count, verificationTokens: verify.count, sessions: sessions.count };
  }

  /** One STORAGE_WARNING per user per day once usage reaches the threshold. */
  async function storageWarnings() {
    const t = now();
    const since = new Date(t.getTime() - DAY);
    const summary = { checked: 0, warned: 0 };
    const threshold = BigInt(config.warningPercent);
    for (let skip = 0; ; skip += BATCH) {
      const users = await db.user.findMany({
        where: { status: 'ACTIVE', storageUsedBytes: { gt: 0n } }, orderBy: [{ id: 'asc' }], skip, take: BATCH,
        select: { id: true, storageUsedBytes: true, storageQuotaBytes: true },
      });
      if (!users.length) break;
      for (const u of users) {
        summary.checked += 1;
        const quota = BigInt(u.storageQuotaBytes);
        if (quota <= 0n || BigInt(u.storageUsedBytes) * 100n < quota * threshold) continue;
        if (await db.notification.findFirst({ where: { userId: u.id, type: 'STORAGE_WARNING', createdAt: { gte: since } } })) continue;
        const pct = Number((BigInt(u.storageUsedBytes) * 1000n) / quota) / 10;
        const sent = await notifications.create({
          userId: u.id, type: 'STORAGE_WARNING', title: 'Your storage is almost full',
          body: `You have used ${pct}% of your storage. Delete files or empty the trash to free space.`, data: { percent: pct },
        });
        if (sent) summary.warned += 1;
      }
    }
    return summary;
  }

  /** Daily StorageUsage row for the previous UTC day (history for analytics). */
  async function snapshotStorage() {
    const t = now();
    const end = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    const start = new Date(end.getTime() - DAY);
    const users = await db.user.findMany({ where: {}, select: { id: true, storageUsedBytes: true } });
    let written = 0;
    for (const u of users) {
      const [files, folders, versions] = await Promise.all([
        db.file.count({ where: { ownerId: u.id, deletedAt: null } }),
        db.folder.count({ where: { ownerId: u.id, deletedAt: null } }),
        db.fileVersion.findMany({ where: { file: { ownerId: u.id }, createdAt: { gte: start, lt: end } }, select: { size: true } }),
      ]);
      const row = {
        bytesUsed: u.storageUsedBytes, fileCount: files, folderCount: folders,
        bytesUploaded: versions.reduce((a, v) => a + BigInt(v.size), 0n), filesUploaded: versions.length,
      };
      const existing = await db.storageUsage.findFirst({ where: { userId: u.id, date: start } });
      if (existing) await db.storageUsage.update({ where: { id: existing.id }, data: row });
      else await db.storageUsage.create({ data: { userId: u.id, date: start, ...row } });
      written += 1;
    }
    return { users: written };
  }

  /** Wraps a job so overlapping runs are skipped and errors are logged instead of crashing the process. */
  function guarded(name, fn) {
    let running = false;
    return async () => {
      if (running) { logger.warn?.(`Job ${name} is still running; skipping this tick`); return null; }
      running = true;
      try {
        const out = await fn();
        logger.info?.(`Job ${name} finished`, out);
        return out;
      } catch (err) {
        logger.error(`Job ${name} failed:`, err);
        return null;
      } finally {
        running = false;
      }
    };
  }

  return { purgeTrash, expireLinks, pruneTokens, storageWarnings, snapshotStorage, guarded };
}
