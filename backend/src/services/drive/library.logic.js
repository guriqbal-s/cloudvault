// Read-mostly views over the drive: starred, recent, search and the storage summary.

import ApiError from '../../utils/ApiError.js';
import { CATEGORIES, CATEGORY_LABELS, EXTENSIONS_BY_CATEGORY, fileCategory } from '../../utils/fileTypes.js';
import { buildMeta, parsePagination } from '../../utils/pagination.js';
import { OWNER_ACCESS, toNumber } from './shared.js';

export const RECENT_DEFAULT = 20;
export const RECENT_MAX = 100;

/** Normalise search input into the repository filter. Pure, so it is unit-tested directly. */
export function buildSearchFilter(query = {}) {
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  const extensions = query.type ? EXTENSIONS_BY_CATEGORY[query.type] : undefined;
  if (query.type && !extensions) throw ApiError.validation('Unknown file type filter');
  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw ApiError.validation('Invalid date filter');
  if (from && to && from > to) throw ApiError.validation('"from" must be before "to"');
  const minSize = query.minSize != null ? BigInt(query.minSize) : undefined;
  const maxSize = query.maxSize != null ? BigInt(query.maxSize) : undefined;
  if (minSize != null && maxSize != null && minSize > maxSize) throw ApiError.validation('"minSize" must not exceed "maxSize"');
  // Folders have no type or size, so those filters only make sense for files.
  const includeFolders = !extensions && minSize == null && maxSize == null;
  return { q: q || undefined, extensions, ownerId: query.ownerId, from, to, minSize, maxSize, includeFolders };
}

export function createLibraryService({ repo, access, activity, decorator }) {
  const meta = (m) => m ?? {};

  // ---------------------------------------------------------------- starred
  async function listStarred(actor) {
    const { files, folders } = await repo.listStarred(actor.id);
    const visibleFiles = [];
    const visibleFolders = [];
    const accessById = new Map();
    for (const f of files) {
      const a = await access.resolveFileAccess(actor, f);
      if (a.level !== 'NONE') { visibleFiles.push(f); accessById.set(f.id, a); }
    }
    for (const f of folders) {
      const a = await access.resolveFolderAccess(actor, f);
      if (a.level !== 'NONE') { visibleFolders.push(f); accessById.set(f.id, a); }
    }
    return decorator.decorate(actor, { files: visibleFiles, folders: visibleFolders }, (row) => accessById.get(row.id));
  }

  async function star(actor, type, id, reqMeta) {
    const isFile = type === 'files';
    const { file, folder } = isFile
      ? await access.requireFileAccess(actor, id, 'read')
      : await access.requireFolderAccess(actor, id, 'read');
    const target = file ?? folder;
    const added = await repo.setStar(actor.id, isFile ? 'FILE' : 'FOLDER', id);
    if (added) {
      await activity.log({
        userId: actor.id, action: 'STAR', resourceType: isFile ? 'FILE' : 'FOLDER', resourceId: id, resourceName: target.name,
        description: `Starred "${target.name}"`, meta: meta(reqMeta),
      });
    }
    return { starred: true };
  }

  async function unstar(actor, type, id, reqMeta) {
    const isFile = type === 'files';
    const removed = await repo.unsetStar(actor.id, isFile ? 'FILE' : 'FOLDER', id);
    if (removed) {
      await activity.log({
        userId: actor.id, action: 'UNSTAR', resourceType: isFile ? 'FILE' : 'FOLDER', resourceId: id,
        description: 'Removed a star', meta: meta(reqMeta),
      });
    }
    return { starred: false };
  }

  // ----------------------------------------------------------------- recent
  /** Own files, most recently opened OR modified first. */
  async function recent(actor, limit) {
    const n = Math.min(RECENT_MAX, Math.max(1, Number.parseInt(limit, 10) || RECENT_DEFAULT));
    const [opened, modified] = await Promise.all([repo.recentByAccess(actor.id, n), repo.recentByUpdate(actor.id, n)]);
    const key = (f) => Math.max(new Date(f.lastAccessedAt ?? 0).getTime(), new Date(f.updatedAt).getTime());
    const merged = new Map();
    for (const f of [...opened, ...modified]) merged.set(f.id, f);
    const rows = [...merged.values()].sort((a, b) => key(b) - key(a)).slice(0, n);
    return (await decorator.decorate(actor, { files: rows }, OWNER_ACCESS)).files;
  }

  // ----------------------------------------------------------------- search
  async function search(actor, query = {}) {
    const filter = buildSearchFilter(query);
    const { page, limit, skip, take } = parsePagination(query, { defaultLimit: 25, maxLimit: 50 });
    const result = await repo.search({ actorId: actor.id, ...filter, skip, take });
    const accessById = new Map();
    for (const f of result.files.rows) accessById.set(f.id, await access.resolveFileAccess(actor, f));
    for (const f of result.folders) accessById.set(f.id, await access.resolveFolderAccess(actor, f));
    const decorated = await decorator.decorate(actor, { files: result.files.rows, folders: result.folders }, (row) => accessById.get(row.id));
    return { ...decorated, meta: buildMeta({ page, limit, total: result.files.total }) };
  }

  // ---------------------------------------------------------------- storage
  async function storageSummary(actor) {
    const [{ used, quota }, b] = await Promise.all([repo.getUserQuota(actor.id), repo.storageBreakdown(actor.id)]);
    const byCategory = new Map();
    let liveCurrent = 0n;
    for (const row of b.byExtension) {
      const cat = fileCategory(row.extension);
      const cur = byCategory.get(cat) ?? { bytes: 0n, count: 0 };
      byCategory.set(cat, { bytes: cur.bytes + BigInt(row.bytes), count: cur.count + row.count });
      liveCurrent += BigInt(row.bytes);
    }
    const breakdown = CATEGORIES
      .filter((c) => byCategory.has(c))
      .map((c) => ({ category: c, label: CATEGORY_LABELS[c], bytes: toNumber(byCategory.get(c).bytes), count: byCategory.get(c).count }))
      .sort((a, z) => z.bytes - a.bytes);
    const versionsBytes = b.liveVersionBytes > liveCurrent ? b.liveVersionBytes - liveCurrent : 0n;
    const usedN = toNumber(used);
    const quotaN = toNumber(quota);
    return {
      used: usedN, quota: quotaN,
      percent: quotaN > 0 ? Math.min(100, Math.round((usedN * 1000) / quotaN) / 10) : 0,
      breakdown,
      versionsBytes: toNumber(versionsBytes),
      trashBytes: toNumber(b.trashVersionBytes),
    };
  }

  return { listStarred, star, unstar, recent, search, storageSummary };
}
