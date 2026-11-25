// In-memory implementation of the drive repository plus fake storage, so the drive logic
// (folders, files, versions, trash, library) is tested without a database. It mirrors the
// database behaviour the logic relies on: unique live names, conditional quota updates,
// transactions that roll back, cascade deletes.

import crypto from 'node:crypto';

import { createAccessService, ancestorIds } from '../../src/services/access.logic.js';
import { createAccessTokenService } from '../../src/services/accessToken.js';
import { createNotificationService } from '../../src/services/notification.logic.js';
import { createFileService } from '../../src/services/drive/files.logic.js';
import { createFolderService } from '../../src/services/drive/folders.logic.js';
import { createLibraryService } from '../../src/services/drive/library.logic.js';
import { createDecorator, nameTaken } from '../../src/services/drive/shared.js';
import { createTrashService } from '../../src/services/drive/trash.logic.js';
import { createVersionService } from '../../src/services/drive/versions.logic.js';
import ApiError from '../../src/utils/ApiError.js';
import { StorageError } from '../../src/services/storage/StorageProvider.js';

export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const ALICE = uuid(1);
export const BOB = uuid(2);
export const CAROL = uuid(3);

export const STANDARD = [
  'file:read', 'file:upload', 'file:download', 'file:update', 'file:delete', 'file:share',
  'folder:read', 'folder:create', 'folder:update', 'folder:delete', 'folder:share',
  'version:read', 'version:create', 'version:restore', 'version:delete',
];
export const VIEWER = ['file:read', 'folder:read', 'file:download', 'version:read'];

export const actor = (id, perms = STANDARD, name = null) => ({
  id, permissions: new Set(perms), user: { id, name: name ?? `user-${id.slice(-1)}` },
});

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Memory storage: `staged` simulates Multer's temp files, `blobs` the stored objects. */
export class MemoryStorage {
  constructor() { this.blobs = new Map(); this.staged = new Map(); this.failPut = false; }
  stage(name, content) {
    const path = `/tmp/staged-${this.staged.size + 1}-${Math.random().toString(16).slice(2)}`;
    const buf = Buffer.from(content);
    this.staged.set(path, buf);
    return { path, originalName: name, size: buf.length };
  }
  async putFromFile(key, path) {
    if (this.failPut) throw new StorageError('IO', 'disk full');
    const buf = this.staged.get(path);
    if (!buf) throw new StorageError('NOT_FOUND', 'no staged file');
    this.staged.delete(path);
    this.blobs.set(key, buf);
    return { size: buf.length, checksum: sha(buf) };
  }
  async delete(key) { this.blobs.delete(key); }
  async deletePrefix(prefix) { for (const k of [...this.blobs.keys()]) if (k.startsWith(prefix)) this.blobs.delete(k); }
  async copy(src, dest) {
    if (!this.blobs.has(src)) throw new StorageError('NOT_FOUND', 'missing');
    this.blobs.set(dest, this.blobs.get(src));
  }
  async getDownloadTarget() { return { type: 'stream' }; }
}

export function createWorld({ quota = 1_000_000n, allowedExtensions = ['pdf', 'txt', 'png', 'docx', 'zip'], maxUploadBytes = 100_000, warnPercent = 80 } = {}) {
  const T = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)); // deterministic timestamps
  let tick = 0;
  const stamp = () => T(++tick);
  let idCounter = 1000;
  const ids = () => uuid(++idCounter);

  const s = {
    users: [ALICE, BOB, CAROL].map((id, i) => ({ id, name: ['Alice', 'Bob', 'Carol'][i], used: 0n, quota })),
    folders: [], files: [], versions: [], fileShares: [], folderShares: [], links: [], stars: [], usage: [], notes: [],
  };
  const TABLES = ['users', 'folders', 'files', 'versions', 'fileShares', 'folderShares', 'links', 'stars', 'usage'];
  const user = (id) => s.users.find((u) => u.id === id);
  const ownerRef = (id) => ({ id, name: user(id)?.name });

  const fileRow = (f) => {
    if (!f) return null;
    const vs = s.versions.filter((v) => v.fileId === f.id);
    const cur = vs.find((v) => v.id === f.currentVersionId);
    const folder = s.folders.find((x) => x.id === f.folderId);
    return { ...f, owner: ownerRef(f.ownerId), folder: folder ? { path: folder.path } : null, versionCount: vs.length, currentVersion: cur?.versionNumber ?? vs.length };
  };
  const folderRow = (f) => (f ? { ...f, owner: ownerRef(f.ownerId) } : null);
  const live = (x) => !x.deletedAt;
  const lowerEq = (a, b) => a.toLowerCase() === b.toLowerCase();
  const sameParent = (a, b) => (a ?? null) === (b ?? null);

  function assertFolderNameFree(owner, parent, name, exceptId) {
    if (s.folders.some((f) => live(f) && f.id !== exceptId && f.ownerId === owner && sameParent(f.parentId, parent) && lowerEq(f.name, name))) throw nameTaken(name);
  }
  function assertFileNameFree(owner, folder, name, exceptId) {
    if (s.files.some((f) => live(f) && f.id !== exceptId && f.ownerId === owner && sameParent(f.folderId, folder) && lowerEq(f.name, name))) throw nameTaken(name);
  }

  const repo = {
    async transaction(fn) {
      const snap = structuredClone(Object.fromEntries(TABLES.map((t) => [t, s[t]])));
      try { return await fn(repo); } catch (err) {
        for (const t of TABLES) s[t].splice(0, s[t].length, ...snap[t]);
        throw err;
      }
    },
    // folders
    async getFolder(id) { return folderRow(s.folders.find((f) => f.id === id)); },
    async getFoldersByIds(ids_) { return s.folders.filter((f) => ids_.includes(f.id)).map(folderRow); },
    async folderShareIds(userId, ids_) { return new Set(s.folderShares.filter((x) => x.sharedWithId === userId && ids_.includes(x.folderId)).map((x) => x.folderId)); },
    async listLiveSubfolders(owner, parent, { q } = {}) {
      return s.folders.filter((f) => live(f) && f.ownerId === owner && sameParent(f.parentId, parent) && (!q || f.name.toLowerCase().includes(q.toLowerCase())))
        .sort((a, b) => a.name.localeCompare(b.name)).map(folderRow);
    },
    async liveFolderNames(owner, parent) { return s.folders.filter((f) => live(f) && f.ownerId === owner && sameParent(f.parentId, parent)).map((f) => f.name); },
    async createFolder(data) {
      assertFolderNameFree(data.ownerId, data.parentId, data.name);
      const row = { ...data, createdAt: stamp(), updatedAt: stamp(), deletedAt: null, deletedById: null, trashBatchId: null };
      s.folders.push(row);
      return folderRow(row);
    },
    async updateFolder(id, data) {
      const f = s.folders.find((x) => x.id === id);
      if (data.name) assertFolderNameFree(f.ownerId, f.parentId, data.name, id);
      Object.assign(f, data, { updatedAt: stamp() });
      return folderRow(f);
    },
    async moveFolderSubtree({ id, ownerId, oldPath, newPath, newParentId, name }) {
      const f = s.folders.find((x) => x.id === id);
      assertFolderNameFree(ownerId, newParentId, name ?? f.name, id);
      for (const d of s.folders) if (d.ownerId === ownerId && d.path.startsWith(oldPath) && d.id !== id) d.path = newPath + d.path.slice(oldPath.length);
      Object.assign(f, { parentId: newParentId, path: newPath, ...(name ? { name } : {}), updatedAt: stamp() });
      return folderRow(f);
    },
    async markFolderTreeDeleted({ ownerId, path, batchId, deletedById, at }) {
      const ids_ = s.folders.filter((f) => f.ownerId === ownerId && live(f) && f.path.startsWith(path)).map((f) => f.id);
      for (const f of s.folders) if (ids_.includes(f.id)) Object.assign(f, { deletedAt: at, deletedById, trashBatchId: batchId });
      for (const f of s.files) if (f.ownerId === ownerId && live(f) && ids_.includes(f.folderId)) Object.assign(f, { deletedAt: at, deletedById, trashBatchId: batchId });
    },
    // files
    async getFile(id) { return fileRow(s.files.find((f) => f.id === id)); },
    async liveFileNames(owner, folder) { return s.files.filter((f) => live(f) && f.ownerId === owner && sameParent(f.folderId, folder)).map((f) => f.name); },
    async listLiveFiles(owner, folder, { q, extensions, sort, skip, take }) {
      let rows = s.files.filter((f) => live(f) && f.ownerId === owner && sameParent(f.folderId, folder)
        && (!q || f.name.toLowerCase().includes(q.toLowerCase())) && (!extensions || extensions.includes(f.extension)));
      const col = { type: 'extension' }[sort.field] ?? sort.field;
      rows = rows.sort((a, b) => {
        const av = a[col], bv = b[col];
        const c = typeof av === 'string' ? av.localeCompare(bv) : av < bv ? -1 : av > bv ? 1 : 0;
        return (sort.dir === 'desc' ? -c : c) || a.name.localeCompare(b.name);
      });
      return { rows: rows.slice(skip, skip + take).map(fileRow), total: rows.length };
    },
    async createFileWithVersion({ file, version }) {
      assertFileNameFree(file.ownerId, file.folderId, file.name);
      const f = { ...file, createdAt: stamp(), updatedAt: stamp(), lastAccessedAt: null, deletedAt: null, deletedById: null, trashBatchId: null, currentVersionId: version.id };
      s.files.push(f);
      s.versions.push({ ...version, fileId: file.id, createdAt: stamp() });
      return fileRow(f);
    },
    async updateFile(id, data) {
      const f = s.files.find((x) => x.id === id);
      assertFileNameFree(f.ownerId, data.folderId !== undefined ? data.folderId : f.folderId, data.name ?? f.name, id);
      Object.assign(f, data, { updatedAt: stamp() });
      return fileRow(f);
    },
    async markFileDeleted(id, { batchId, deletedById, at }) { Object.assign(s.files.find((f) => f.id === id), { deletedAt: at, deletedById, trashBatchId: batchId }); },
    async touchFileAccessed(id, at) { s.files.find((f) => f.id === id).lastAccessedAt = at; },
    // versions
    async getVersion(fileId, n) { return s.versions.find((v) => v.fileId === fileId && v.versionNumber === n) ?? null; },
    async getCurrentVersion(fileId) { const f = s.files.find((x) => x.id === fileId); return s.versions.find((v) => v.id === f?.currentVersionId) ?? null; },
    async listVersions(fileId) {
      return s.versions.filter((v) => v.fileId === fileId).sort((a, b) => b.versionNumber - a.versionNumber)
        .map((v) => ({ ...v, uploadedBy: ownerRef(v.uploadedById) }));
    },
    async maxVersionNumber(fileId) { return Math.max(0, ...s.versions.filter((v) => v.fileId === fileId).map((v) => v.versionNumber)); },
    async addVersion({ fileId, version }) {
      if (s.versions.some((v) => v.fileId === fileId && v.versionNumber === version.versionNumber)) throw new ApiError(409, 'VERSION_CONFLICT', 'taken');
      const row = { ...version, fileId, createdAt: stamp() };
      s.versions.push(row);
      Object.assign(s.files.find((f) => f.id === fileId), { size: version.size, mimeType: version.mimeType, currentVersionId: row.id, updatedAt: stamp() });
      return row;
    },
    async deleteVersion(id) { s.versions.splice(s.versions.findIndex((v) => v.id === id), 1); },
    // quota
    async reserveQuota(userId, bytes) {
      const u = user(userId);
      if (u.used + bytes > u.quota) return { ok: false };
      u.used += bytes;
      return { ok: true, used: u.used, quota: u.quota };
    },
    async releaseQuota(userId, bytes) { const u = user(userId); u.used = u.used > bytes ? u.used - bytes : 0n; },
    async getUserQuota(userId) { const u = user(userId); return { used: u.used, quota: u.quota }; },
    async recordUploadUsage(row) { s.usage.push(row); },
    // decorations
    async countChildren(ids_) {
      const m = new Map();
      for (const id of ids_) m.set(id, s.files.filter((f) => live(f) && f.folderId === id).length + s.folders.filter((f) => live(f) && f.parentId === id).length);
      return m;
    },
    async starredIds(userId, { fileIds, folderIds }) {
      const mine = s.stars.filter((x) => x.userId === userId);
      return { files: new Set(mine.filter((x) => x.type === 'FILE' && fileIds.includes(x.id)).map((x) => x.id)), folders: new Set(mine.filter((x) => x.type === 'FOLDER' && folderIds.includes(x.id)).map((x) => x.id)) };
    },
    async sharedFlags(_owner, { fileIds, folderIds }) {
      return {
        files: new Set(fileIds.filter((id) => s.fileShares.some((x) => x.fileId === id))),
        folders: new Set(folderIds.filter((id) => s.folderShares.some((x) => x.folderId === id))),
      };
    },
    async listFileSharees(file) {
      const folderIds = file.folder ? ancestorIds(file.folder.path) : [];
      return [...new Set([...s.fileShares.filter((x) => x.fileId === file.id), ...s.folderShares.filter((x) => folderIds.includes(x.folderId))].map((x) => x.sharedWithId))];
    },
    // trash
    async listTrashRoots(owner) {
      return {
        folders: s.folders.filter((f) => f.ownerId === owner && f.deletedAt && f.trashBatchId === f.id).map(folderRow),
        files: s.files.filter((f) => f.ownerId === owner && f.deletedAt && f.trashBatchId === f.id).map(fileRow),
      };
    },
    async listExpiredTrashRoots(cutoff) {
      return [
        ...s.folders.filter((f) => f.deletedAt && f.deletedAt < cutoff && f.trashBatchId === f.id).map((f) => ({ type: 'folder', id: f.id, ownerId: f.ownerId, path: f.path })),
        ...s.files.filter((f) => f.deletedAt && f.deletedAt < cutoff && f.trashBatchId === f.id).map((f) => ({ type: 'file', id: f.id, ownerId: f.ownerId })),
      ];
    },
    async restoreBatch({ ownerId, batchId }) {
      for (const x of [...s.folders, ...s.files]) if (x.ownerId === ownerId && x.trashBatchId === batchId) Object.assign(x, { deletedAt: null, deletedById: null, trashBatchId: null });
    },
    async collectPurge({ ownerId, folderPath, fileId }) {
      let folderIds = [];
      let fileIds = [];
      if (folderPath) {
        folderIds = s.folders.filter((f) => f.ownerId === ownerId && f.path.startsWith(folderPath)).map((f) => f.id);
        fileIds = s.files.filter((f) => f.ownerId === ownerId && folderIds.includes(f.folderId)).map((f) => f.id);
      } else fileIds = [fileId];
      const bytes = s.versions.filter((v) => fileIds.includes(v.fileId)).reduce((n, v) => n + v.size, 0n);
      return { folderIds, fileIds, bytes };
    },
    async deleteRows({ fileIds, folderIds }) {
      // folder deletion cascades to anything beneath it (as the foreign keys do)
      const doomed = new Set(folderIds);
      const doomedFiles = new Set([...fileIds, ...s.files.filter((f) => doomed.has(f.folderId)).map((f) => f.id)]);
      for (const t of ['files']) s[t] = s[t]; // (arrays are mutated in place below)
      s.files.splice(0, s.files.length, ...s.files.filter((f) => !doomedFiles.has(f.id)));
      s.versions.splice(0, s.versions.length, ...s.versions.filter((v) => !doomedFiles.has(v.fileId)));
      s.folders.splice(0, s.folders.length, ...s.folders.filter((f) => !doomed.has(f.id)));
      s.stars.splice(0, s.stars.length, ...s.stars.filter((x) => !doomedFiles.has(x.id) && !doomed.has(x.id)));
    },
    // starred
    async setStar(userId, type, id) {
      if (s.stars.some((x) => x.userId === userId && x.id === id)) return false;
      s.stars.push({ userId, type, id });
      return true;
    },
    async unsetStar(userId, _type, id) {
      const i = s.stars.findIndex((x) => x.userId === userId && x.id === id);
      if (i >= 0) s.stars.splice(i, 1);
      return i >= 0;
    },
    async listStarred(userId) {
      const mine = s.stars.filter((x) => x.userId === userId);
      return {
        files: mine.filter((x) => x.type === 'FILE').map((x) => s.files.find((f) => f.id === x.id)).filter((f) => f && live(f)).map(fileRow),
        folders: mine.filter((x) => x.type === 'FOLDER').map((x) => s.folders.find((f) => f.id === x.id)).filter((f) => f && live(f)).map(folderRow),
      };
    },
    // recent
    async recentByAccess(owner, n) { return s.files.filter((f) => f.ownerId === owner && live(f) && f.lastAccessedAt).sort((a, b) => b.lastAccessedAt - a.lastAccessedAt).slice(0, n).map(fileRow); },
    async recentByUpdate(owner, n) { return s.files.filter((f) => f.ownerId === owner && live(f)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, n).map(fileRow); },
    // search
    async search({ actorId, q, extensions, ownerId, from, to, minSize, maxSize, includeFolders, skip, take }) {
      const paths = s.folderShares.filter((x) => x.sharedWithId === actorId).map((x) => s.folders.find((f) => f.id === x.folderId)).filter((f) => f && live(f)).map((f) => f.path);
      const visibleFile = (f) => f.ownerId === actorId || s.fileShares.some((x) => x.fileId === f.id && x.sharedWithId === actorId)
        || (f.folderId && paths.some((p) => s.folders.find((x) => x.id === f.folderId).path.startsWith(p)));
      const visibleFolder = (f) => f.ownerId === actorId || s.folderShares.some((x) => x.folderId === f.id && x.sharedWithId === actorId) || paths.some((p) => f.path.startsWith(p));
      const nameOk = (f) => !q || f.name.toLowerCase().includes(q.toLowerCase());
      const dateOk = (f) => (!from || f.createdAt >= from) && (!to || f.createdAt <= to);
      const files = s.files.filter((f) => live(f) && visibleFile(f) && nameOk(f) && dateOk(f) && (!ownerId || f.ownerId === ownerId)
        && (!extensions || extensions.includes(f.extension)) && (minSize == null || f.size >= minSize) && (maxSize == null || f.size <= maxSize))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const folders = includeFolders && q ? s.folders.filter((f) => live(f) && visibleFolder(f) && nameOk(f) && dateOk(f) && (!ownerId || f.ownerId === ownerId)).slice(0, 20).map(folderRow) : [];
      return { files: { rows: files.slice(skip, skip + take).map(fileRow), total: files.length }, folders };
    },
    // storage
    async storageBreakdown(owner) {
      const by = new Map();
      for (const f of s.files.filter((x) => x.ownerId === owner && live(x))) {
        const cur = by.get(f.extension) ?? { extension: f.extension, bytes: 0n, count: 0 };
        by.set(f.extension, { ...cur, bytes: cur.bytes + f.size, count: cur.count + 1 });
      }
      const sum = (pred) => s.versions.filter((v) => { const f = s.files.find((x) => x.id === v.fileId); return f.ownerId === owner && pred(f); }).reduce((n, v) => n + v.size, 0n);
      return { byExtension: [...by.values()], liveVersionBytes: sum(live), trashVersionBytes: sum((f) => !live(f)) };
    },
  };

  // Real access service over the same tables (a minimal Prisma-shaped fake).
  const accessDb = {
    file: { findUnique: async ({ where: { id } }) => { const f = s.files.find((x) => x.id === id); if (!f) return null; const fo = s.folders.find((x) => x.id === f.folderId); return { ...f, folder: fo ? { path: fo.path } : null }; } },
    folder: { findUnique: async ({ where: { id } }) => s.folders.find((x) => x.id === id) ?? null },
    fileShare: { findUnique: async ({ where: { fileId_sharedWithId: k } }) => s.fileShares.find((x) => x.fileId === k.fileId && x.sharedWithId === k.sharedWithId) ?? null },
    folderShare: { findMany: async ({ where }) => s.folderShares.filter((x) => x.sharedWithId === where.sharedWithId && where.folderId.in.includes(x.folderId)) },
  };
  const access = createAccessService({ db: accessDb });

  const logs = [];
  const activity = { log: async (e) => { logs.push(e); } };
  const emitted = [];
  const notifDb = {
    user: { findUnique: async () => ({ notificationPrefs: {} }) },
    notification: { create: async ({ data }) => { const row = { id: `n${s.notes.length + 1}`, readAt: null, createdAt: new Date(0), ...data }; s.notes.push(row); return row; }, count: async () => s.notes.length },
  };
  const errors = [];
  const logger = { error: (...a) => errors.push(a), warn() {}, info() {} };
  const notifications = createNotificationService({ db: notifDb, emit: (...a) => emitted.push(a), logger });
  const storage = new MemoryStorage();
  const removed = [];
  const removeFile = async (p) => { removed.push(p); storage.staged.delete(p); };
  const decorator = createDecorator({ repo });
  const accessTokens = createAccessTokenService({ secret: 'test-secret-test-secret', now: () => new Date('2026-06-01T00:00:00Z') });
  const config = { allowedExtensions, maxUploadBytes, quotaWarningPercent: warnPercent, trashRetentionDays: 30 };
  const base = { repo, access, storage, activity, notifications, decorator, logger, ids };

  const folders = createFolderService(base);
  const files = createFileService({ ...base, config, removeFile, accessTokens });
  const versions = createVersionService({ ...base, config, removeFile });
  const trash = createTrashService({ ...base, config });
  const library = createLibraryService(base);

  // fixture helpers -----------------------------------------------------------
  const settle = () => new Promise((r) => setImmediate(r)); // let fire-and-forget notifications finish
  const alice = actor(ALICE, STANDARD, 'Alice');
  const bob = actor(BOB, STANDARD, 'Bob');
  const carol = actor(CAROL, STANDARD, 'Carol');

  async function mkFolder(who, name, parentId = null) { return (await folders.create(who, { name, parentId })).id; }
  async function upload(who, name, content = 'hello', folderId = null) {
    const { results } = await files.upload(who, { folderId, files: [storage.stage(name, content)] });
    if (!results[0].ok) throw Object.assign(new Error(results[0].error.message), results[0].error);
    return results[0].file;
  }
  const shareFolder = (folderId, withId, role = 'VIEWER', canDownload = true) => s.folderShares.push({ folderId, sharedWithId: withId, sharedById: ALICE, role, canDownload });
  const shareFile = (fileId, withId, role = 'VIEWER', canDownload = true) => s.fileShares.push({ fileId, sharedWithId: withId, sharedById: ALICE, role, canDownload });

  return {
    s, repo, access, storage, logs, emitted, errors, removed, notifications, accessTokens, config, settle,
    folders, files, versions, trash, library, alice, bob, carol, mkFolder, upload, shareFolder, shareFile, user, ids,
    T, stamp,
  };
}
