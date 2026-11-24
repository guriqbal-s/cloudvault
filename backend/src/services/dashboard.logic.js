// Aggregates for the dashboard: counts, storage breakdown, 30-day upload series, recent items.

import { CATEGORIES, CATEGORY_LABELS, fileCategory } from '../utils/fileTypes.js';
import { toActivityDTO, toFileDTO } from './dto.js';

const DAY = 86_400_000;
const OWNER_ACCESS = Object.freeze({ level: 'OWNER', canDownload: true, source: 'owner' });
export const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

export function percentOf(used, quota) {
  const u = BigInt(used ?? 0);
  const q = BigInt(quota ?? 0);
  if (q <= 0n) return 0;
  return Math.min(100, Number((u * 10000n) / q) / 100);
}

/** Merge per-extension groups into per-category rows (all values as plain numbers). */
export function breakdownByCategory(groups) {
  const acc = new Map();
  for (const g of groups) {
    const cat = fileCategory(g.extension);
    const cur = acc.get(cat) ?? { category: cat, label: CATEGORY_LABELS[cat], bytes: 0, count: 0 };
    cur.bytes += Number(g._sum?.size ?? 0);
    cur.count += g._count?._all ?? 0;
    acc.set(cat, cur);
  }
  return CATEGORIES.filter((c) => acc.has(c)).map((c) => acc.get(c)).sort((a, b) => b.bytes - a.bytes);
}

/** Zero-filled series for the last `days` UTC days (oldest first). */
export function dailySeries(items, valueOf, { days = 30, now }) {
  const buckets = new Map();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i--) buckets.set(dayKey(today - i * DAY), { date: dayKey(today - i * DAY), count: 0, bytes: 0 });
  for (const it of items) {
    const b = buckets.get(dayKey(it.createdAt));
    if (!b) continue;
    b.count += 1;
    b.bytes += Number(valueOf(it) ?? 0);
  }
  return [...buckets.values()];
}

/** @param {{ db: object, now?: () => Date }} deps */
export function createDashboardService({ db, now = () => new Date() }) {
  async function forUser(actor) {
    const t = now();
    const me = actor.id;
    const since = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - 29 * DAY);
    const live = { ownerId: me, deletedAt: null };
    const trashed = { ownerId: me, deletedAt: { not: null } };

    const [files, folders, sharedFiles, sharedFolders, starred, trashFiles, trashFolders, groups, versions, recent, activity] = await Promise.all([
      db.file.count({ where: live }),
      db.folder.count({ where: live }),
      db.fileShare.count({ where: { sharedWithId: me } }),
      db.folderShare.count({ where: { sharedWithId: me } }),
      db.starredResource.count({ where: { userId: me } }),
      db.file.count({ where: trashed }),
      db.folder.count({ where: trashed }),
      db.file.groupBy({ by: ['extension'], where: live, _sum: { size: true }, _count: { _all: true } }),
      db.fileVersion.findMany({ where: { file: { ownerId: me }, createdAt: { gte: since } }, select: { createdAt: true, size: true } }),
      db.file.findMany({ where: live, orderBy: [{ updatedAt: 'desc' }], take: 6 }),
      db.activityLog.findMany({ where: { userId: me }, orderBy: [{ createdAt: 'desc' }], take: 8 }),
    ]);

    const used = actor.user?.storageUsedBytes ?? 0n;
    const quota = actor.user?.storageQuotaBytes ?? 0n;
    return {
      storage: { used: Number(used), quota: Number(quota), percent: percentOf(used, quota) },
      counts: { files, folders, shared: sharedFiles + sharedFolders, starred, trash: trashFiles + trashFolders },
      byCategory: breakdownByCategory(groups),
      uploadsOverTime: dailySeries(versions, (v) => v.size, { now: t }),
      recentFiles: recent.map((f) => toFileDTO(f, { actor, access: OWNER_ACCESS, owner: actor.user })),
      recentActivity: activity.map((a) => toActivityDTO({ ...a, user: actor.user })),
    };
  }

  return { forUser };
}
