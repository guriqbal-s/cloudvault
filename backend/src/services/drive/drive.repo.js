// Prisma implementation of the drive repository.
//
// The logic modules (folders/files/versions/trash/library) only talk to this interface, which
// keeps their business rules unit-testable against an in-memory implementation
// (test/helpers/driveFakes.js). THIS file is the thin, query-only layer: keep it free of rules.
//
// Row shapes returned (BigInt sizes are kept as BigInt; dto.js / JSON serialisation handle them):
//   FileRow   { id, name, extension, mimeType, size, ownerId, folderId, createdAt, updatedAt, lastAccessedAt,
//               deletedAt, trashBatchId, currentVersionId, owner:{id,name}, folder:{path}|null,
//               versionCount, currentVersion }
//   FolderRow { id, name, ownerId, parentId, path, createdAt, updatedAt, deletedAt, trashBatchId, owner:{id,name} }
//
// Concurrency notes: name uniqueness is enforced by the partial unique indexes in extras.sql
// (P2002 -> NAME_TAKEN); quota is claimed with one conditional UPDATE (no read-modify-write).

import ApiError from '../../utils/ApiError.js';
import { ancestorIds } from '../access.logic.js';
import { nameTaken } from './shared.js';

const ownerSelect = { select: { id: true, name: true } };
const fileInclude = {
  owner: ownerSelect,
  folder: { select: { path: true } },
  currentVersion: { select: { versionNumber: true } },
  _count: { select: { versions: true } },
};
const folderInclude = { owner: ownerSelect };

const SORT_COLUMN = { name: 'name', size: 'size', createdAt: 'createdAt', updatedAt: 'updatedAt', type: 'extension' };

function mapFile(row) {
  if (!row) return null;
  const { _count, currentVersion, ...rest } = row;
  return { ...rest, versionCount: _count.versions, currentVersion: currentVersion?.versionNumber ?? _count.versions };
}
const mapFolder = (row) => row ?? null;

/** Run `fn` and convert a unique-constraint violation into the API's NAME_TAKEN error. */
async function uniqueAsNameTaken(name, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.code === 'P2002') throw nameTaken(name ?? 'item');
    throw err;
  }
}

const startOfUtcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} client */
export function createDriveRepo(client) {
  const inTransaction = typeof client.$transaction !== 'function'; // transaction clients lack $transaction
  const atomically = (fn) => (inTransaction ? fn(client) : client.$transaction(fn, { timeout: 20_000 }));

  const repo = {
    /** Run `fn` with a repo bound to one database transaction (commit on return, rollback on throw). */
    transaction(fn) {
      if (inTransaction) return fn(repo);
      return client.$transaction((tx) => fn(createDriveRepo(tx)), { timeout: 20_000 });
    },

    // ----------------------------------------------------------- folders
    async getFolder(id) {
      return mapFolder(await client.folder.findUnique({ where: { id }, include: folderInclude }));
    },
    async getFoldersByIds(ids) {
      if (!ids.length) return [];
      return client.folder.findMany({ where: { id: { in: ids } }, include: folderInclude });
    },
    async folderShareIds(userId, folderIds) {
      if (!folderIds.length) return new Set();
      const rows = await client.folderShare.findMany({
        where: { sharedWithId: userId, folderId: { in: folderIds } }, select: { folderId: true },
      });
      return new Set(rows.map((r) => r.folderId));
    },
    async listLiveSubfolders(ownerId, parentId, { q } = {}) {
      return client.folder.findMany({
        where: { ownerId, parentId, deletedAt: null, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
        include: folderInclude,
        orderBy: { name: 'asc' },
      });
    },
    async liveFolderNames(ownerId, parentId) {
      const rows = await client.folder.findMany({ where: { ownerId, parentId, deletedAt: null }, select: { name: true } });
      return rows.map((r) => r.name);
    },
    async createFolder(data) {
      return uniqueAsNameTaken(data.name, () => client.folder.create({ data, include: folderInclude }));
    },
    async updateFolder(id, data) {
      return uniqueAsNameTaken(data.name, () => client.folder.update({ where: { id }, data, include: folderInclude }));
    },
    /** Re-parent a folder and rewrite the materialised path of everything beneath it. */
    async moveFolderSubtree({ id, ownerId, oldPath, newPath, newParentId, name }) {
      return uniqueAsNameTaken(name, () => atomically(async (tx) => {
        await tx.$executeRaw`
          UPDATE "folders"
             SET "path" = ${newPath} || substr("path", ${oldPath.length + 1}::int), "updatedAt" = (now() AT TIME ZONE 'UTC')
           WHERE "ownerId" = ${ownerId}::uuid
             AND "path" LIKE ${`${oldPath}%`}
             AND "id" <> ${id}::uuid`;
        return tx.folder.update({
          where: { id }, data: { parentId: newParentId, path: newPath, ...(name ? { name } : {}) }, include: folderInclude,
        });
      }));
    },
    async markFolderTreeDeleted({ ownerId, path, batchId, deletedById, at }) {
      return atomically(async (tx) => {
        const live = await tx.folder.findMany({
          where: { ownerId, deletedAt: null, path: { startsWith: path } }, select: { id: true },
        });
        const folderIds = live.map((f) => f.id);
        const data = { deletedAt: at, deletedById, trashBatchId: batchId };
        await tx.file.updateMany({ where: { ownerId, deletedAt: null, folderId: { in: folderIds } }, data });
        await tx.folder.updateMany({ where: { id: { in: folderIds } }, data });
        return { folders: folderIds.length };
      });
    },

    // ------------------------------------------------------------- files
    async getFile(id) {
      return mapFile(await client.file.findUnique({ where: { id }, include: fileInclude }));
    },
    async liveFileNames(ownerId, folderId) {
      const rows = await client.file.findMany({ where: { ownerId, folderId, deletedAt: null }, select: { name: true } });
      return rows.map((r) => r.name);
    },
    async listLiveFiles(ownerId, folderId, { q, extensions, sort, skip, take }) {
      const where = {
        ownerId, folderId, deletedAt: null,
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
        ...(extensions ? { extension: { in: extensions } } : {}),
      };
      const [rows, total] = await Promise.all([
        client.file.findMany({
          where, include: fileInclude, skip, take,
          orderBy: [{ [SORT_COLUMN[sort.field] ?? 'name']: sort.dir }, { name: 'asc' }],
        }),
        client.file.count({ where }),
      ]);
      return { rows: rows.map(mapFile), total };
    },
    async createFileWithVersion({ file, version }) {
      return uniqueAsNameTaken(file.name, () => atomically(async (tx) => {
        await tx.file.create({ data: file });
        const v = await tx.fileVersion.create({ data: { ...version, fileId: file.id } });
        await tx.file.update({ where: { id: file.id }, data: { currentVersionId: v.id } });
        return mapFile(await tx.file.findUnique({ where: { id: file.id }, include: fileInclude }));
      }));
    },
    async updateFile(id, data) {
      return uniqueAsNameTaken(data.name, async () => mapFile(await client.file.update({ where: { id }, data, include: fileInclude })));
    },
    async markFileDeleted(id, { batchId, deletedById, at }) {
      await client.file.update({ where: { id }, data: { deletedAt: at, deletedById, trashBatchId: batchId } });
    },
    /** Raw on purpose: a Prisma update would also bump the @updatedAt ("last modified") column. */
    async touchFileAccessed(id, at) {
      await client.$executeRaw`UPDATE "files" SET "lastAccessedAt" = (${new Date(at).toISOString()}::timestamptz AT TIME ZONE 'UTC') WHERE "id" = ${id}::uuid`;
    },

    // ---------------------------------------------------------- versions
    async getVersion(fileId, versionNumber) {
      return client.fileVersion.findUnique({ where: { fileId_versionNumber: { fileId, versionNumber } } });
    },
    async getCurrentVersion(fileId) {
      const f = await client.file.findUnique({ where: { id: fileId }, select: { currentVersion: true } });
      return f?.currentVersion ?? null;
    },
    async listVersions(fileId) {
      return client.fileVersion.findMany({
        where: { fileId }, orderBy: { versionNumber: 'desc' }, include: { uploadedBy: ownerSelect },
      });
    },
    async maxVersionNumber(fileId) {
      const r = await client.fileVersion.aggregate({ where: { fileId }, _max: { versionNumber: true } });
      return r._max.versionNumber ?? 0;
    },
    /** Insert a version and make it current, atomically. */
    async addVersion({ fileId, version }) {
      return atomically(async (tx) => {
        let created;
        try {
          created = await tx.fileVersion.create({ data: { ...version, fileId } });
        } catch (err) {
          if (err?.code === 'P2002') throw new ApiError(409, 'VERSION_CONFLICT', 'Version number already taken');
          throw err;
        }
        await tx.file.update({
          where: { id: fileId },
          data: { size: version.size, mimeType: version.mimeType, currentVersionId: created.id },
        });
        return created;
      });
    },
    async deleteVersion(id) {
      await client.fileVersion.delete({ where: { id } });
    },

    // ------------------------------------------------------------- quota
    /** One conditional UPDATE: succeeds only if the new total still fits. */
    async reserveQuota(userId, bytes) {
      const rows = await client.$queryRaw`
        UPDATE "users" SET "storageUsedBytes" = "storageUsedBytes" + ${bytes}::bigint
         WHERE "id" = ${userId}::uuid AND "storageUsedBytes" + ${bytes}::bigint <= "storageQuotaBytes"
        RETURNING "storageUsedBytes" AS used, "storageQuotaBytes" AS quota`;
      if (!rows.length) return { ok: false };
      return { ok: true, used: BigInt(rows[0].used), quota: BigInt(rows[0].quota) };
    },
    async releaseQuota(userId, bytes) {
      await client.$executeRaw`
        UPDATE "users" SET "storageUsedBytes" = GREATEST(0, "storageUsedBytes" - ${bytes}::bigint)
         WHERE "id" = ${userId}::uuid`;
    },
    async getUserQuota(userId) {
      const u = await client.user.findUnique({ where: { id: userId }, select: { storageUsedBytes: true, storageQuotaBytes: true } });
      return { used: u?.storageUsedBytes ?? 0n, quota: u?.storageQuotaBytes ?? 0n };
    },
    /** Best-effort daily counters for the upload charts (the nightly job fills in the rest). */
    async recordUploadUsage({ userId, bytes, files, at }) {
      const date = startOfUtcDay(at);
      const [user, fileCount, folderCount] = await Promise.all([
        client.user.findUnique({ where: { id: userId }, select: { storageUsedBytes: true } }),
        client.file.count({ where: { ownerId: userId, deletedAt: null } }),
        client.folder.count({ where: { ownerId: userId, deletedAt: null } }),
      ]);
      const used = user?.storageUsedBytes ?? 0n;
      await client.storageUsage.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, bytesUsed: used, fileCount, folderCount, bytesUploaded: BigInt(bytes), filesUploaded: files },
        update: { bytesUsed: used, fileCount, folderCount, bytesUploaded: { increment: BigInt(bytes) }, filesUploaded: { increment: files } },
      });
    },

    // ------------------------------------------------ listing decorations
    async countChildren(folderIds) {
      const [files, folders] = await Promise.all([
        client.file.groupBy({ by: ['folderId'], where: { folderId: { in: folderIds }, deletedAt: null }, _count: { _all: true } }),
        client.folder.groupBy({ by: ['parentId'], where: { parentId: { in: folderIds }, deletedAt: null }, _count: { _all: true } }),
      ]);
      const out = new Map();
      for (const r of files) out.set(r.folderId, (out.get(r.folderId) ?? 0) + r._count._all);
      for (const r of folders) out.set(r.parentId, (out.get(r.parentId) ?? 0) + r._count._all);
      return out;
    },
    async starredIds(userId, { fileIds, folderIds }) {
      const out = { files: new Set(), folders: new Set() };
      if (!fileIds.length && !folderIds.length) return out;
      const rows = await client.starredResource.findMany({
        where: { userId, OR: [{ fileId: { in: fileIds } }, { folderId: { in: folderIds } }] },
        select: { fileId: true, folderId: true },
      });
      for (const r of rows) (r.fileId ? out.files : out.folders).add(r.fileId ?? r.folderId);
      return out;
    },
    /** Which of the owner's items have a share or an active public link. */
    async sharedFlags(ownerId, { fileIds, folderIds }) {
      const out = { files: new Set(), folders: new Set() };
      if (!fileIds.length && !folderIds.length) return out;
      const now = new Date();
      const live = { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
      const [fs, ds, fl, dl] = await Promise.all([
        fileIds.length ? client.fileShare.findMany({ where: { fileId: { in: fileIds } }, select: { fileId: true } }) : [],
        folderIds.length ? client.folderShare.findMany({ where: { folderId: { in: folderIds } }, select: { folderId: true } }) : [],
        fileIds.length ? client.shareLink.findMany({ where: { fileId: { in: fileIds }, ...live }, select: { fileId: true } }) : [],
        folderIds.length ? client.shareLink.findMany({ where: { folderId: { in: folderIds }, ...live }, select: { folderId: true } }) : [],
      ]);
      for (const r of [...fs, ...fl]) out.files.add(r.fileId);
      for (const r of [...ds, ...dl]) out.folders.add(r.folderId);
      return out;
    },
    /** Users with a share on the file or on any folder above it. */
    async listFileSharees(file) {
      const folderIds = file.folder ? ancestorIds(file.folder.path) : [];
      const [direct, inherited] = await Promise.all([
        client.fileShare.findMany({ where: { fileId: file.id }, select: { sharedWithId: true } }),
        folderIds.length ? client.folderShare.findMany({ where: { folderId: { in: folderIds } }, select: { sharedWithId: true } }) : [],
      ]);
      return [...new Set([...direct, ...inherited].map((r) => r.sharedWithId))];
    },

    // ------------------------------------------------------------- trash
    /** Items the user deleted themselves (their trashBatchId equals their own id). */
    async listTrashRoots(ownerId) {
      const [folders, files] = await Promise.all([
        client.folder.findMany({ where: { ownerId, deletedAt: { not: null } }, include: folderInclude, orderBy: { deletedAt: 'desc' } }),
        client.file.findMany({ where: { ownerId, deletedAt: { not: null } }, include: fileInclude, orderBy: { deletedAt: 'desc' } }),
      ]);
      return {
        folders: folders.filter((f) => f.trashBatchId === f.id),
        files: files.map(mapFile).filter((f) => f.trashBatchId === f.id),
      };
    },
    async listExpiredTrashRoots(cutoff) {
      const [folders, files] = await Promise.all([
        client.folder.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true, ownerId: true, path: true, trashBatchId: true } }),
        client.file.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true, ownerId: true, trashBatchId: true } }),
      ]);
      return [
        ...folders.filter((f) => f.trashBatchId === f.id).map((f) => ({ type: 'folder', id: f.id, ownerId: f.ownerId, path: f.path })),
        ...files.filter((f) => f.trashBatchId === f.id).map((f) => ({ type: 'file', id: f.id, ownerId: f.ownerId })),
      ];
    },
    async restoreBatch({ ownerId, batchId }) {
      const data = { deletedAt: null, deletedById: null, trashBatchId: null };
      await atomically(async (tx) => {
        await tx.folder.updateMany({ where: { ownerId, trashBatchId: batchId }, data });
        await tx.file.updateMany({ where: { ownerId, trashBatchId: batchId }, data });
      });
    },
    /** Everything a permanent delete must remove, and the bytes (ALL versions) to refund. */
    async collectPurge({ ownerId, folderPath, fileId }) {
      let folderIds = [];
      let fileIds = [];
      if (folderPath) {
        folderIds = (await client.folder.findMany({ where: { ownerId, path: { startsWith: folderPath } }, select: { id: true } })).map((f) => f.id);
        fileIds = (await client.file.findMany({ where: { ownerId, folderId: { in: folderIds } }, select: { id: true } })).map((f) => f.id);
      } else {
        fileIds = [fileId];
      }
      const sum = await client.fileVersion.aggregate({ where: { fileId: { in: fileIds } }, _sum: { size: true } });
      return { folderIds, fileIds, bytes: sum._sum.size ?? 0n };
    },
    async deleteRows({ fileIds, folderIds }) {
      await atomically(async (tx) => {
        if (fileIds.length) await tx.file.deleteMany({ where: { id: { in: fileIds } } });
        if (folderIds.length) await tx.folder.deleteMany({ where: { id: { in: folderIds } } });
      });
    },

    // ----------------------------------------------------------- starred
    /** @returns {Promise<boolean>} true when a new star was created */
    async setStar(userId, type, id) {
      try {
        await client.starredResource.create({
          data: { userId, resourceType: type, ...(type === 'FILE' ? { fileId: id } : { folderId: id }) },
        });
        return true;
      } catch (err) {
        if (err?.code === 'P2002') return false; // already starred
        throw err;
      }
    },
    async unsetStar(userId, type, id) {
      const r = await client.starredResource.deleteMany({
        where: { userId, ...(type === 'FILE' ? { fileId: id } : { folderId: id }) },
      });
      return r.count > 0;
    },
    async listStarred(userId) {
      const rows = await client.starredResource.findMany({
        where: { userId }, orderBy: { createdAt: 'desc' },
        include: { file: { include: fileInclude }, folder: { include: folderInclude } },
      });
      return {
        files: rows.map((r) => r.file).filter((f) => f && !f.deletedAt).map(mapFile),
        folders: rows.map((r) => r.folder).filter((f) => f && !f.deletedAt),
      };
    },

    // ------------------------------------------------------------ recent
    async recentByAccess(ownerId, take) {
      const rows = await client.file.findMany({
        where: { ownerId, deletedAt: null, lastAccessedAt: { not: null } },
        orderBy: { lastAccessedAt: 'desc' }, take, include: fileInclude,
      });
      return rows.map(mapFile);
    },
    async recentByUpdate(ownerId, take) {
      const rows = await client.file.findMany({
        where: { ownerId, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take, include: fileInclude,
      });
      return rows.map(mapFile);
    },

    // ------------------------------------------------------------ search
    /** Search the actor's own items plus everything shared with them (directly or via a folder). */
    async search({ actorId, q, extensions, ownerId, from, to, minSize, maxSize, includeFolders, skip, take }) {
      const shares = await client.folderShare.findMany({
        where: { sharedWithId: actorId, folder: { deletedAt: null } }, select: { folder: { select: { path: true } } },
      });
      const paths = shares.map((s) => s.folder.path);
      const created = from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};
      const byName = q ? { name: { contains: q, mode: 'insensitive' } } : {};
      const byOwner = ownerId ? { ownerId } : {};

      const fileWhere = {
        deletedAt: null, ...byName, ...byOwner, ...created,
        ...(extensions ? { extension: { in: extensions } } : {}),
        ...(minSize != null || maxSize != null ? { size: { ...(minSize != null ? { gte: minSize } : {}), ...(maxSize != null ? { lte: maxSize } : {}) } } : {}),
        OR: [
          { ownerId: actorId },
          { shares: { some: { sharedWithId: actorId } } },
          ...paths.map((p) => ({ folder: { path: { startsWith: p } } })),
        ],
      };
      const folderWhere = {
        deletedAt: null, ...byName, ...byOwner, ...created,
        OR: [
          { ownerId: actorId },
          { shares: { some: { sharedWithId: actorId } } },
          ...paths.map((p) => ({ path: { startsWith: p } })),
        ],
      };

      const [rows, total, folders] = await Promise.all([
        client.file.findMany({ where: fileWhere, include: fileInclude, orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }], skip, take }),
        client.file.count({ where: fileWhere }),
        includeFolders && q
          ? client.folder.findMany({ where: folderWhere, include: folderInclude, orderBy: { name: 'asc' }, take: 20 })
          : [],
      ]);
      return { files: { rows: rows.map(mapFile), total }, folders };
    },

    // ----------------------------------------------------------- storage
    async storageBreakdown(ownerId) {
      const [groups, live, trash] = await Promise.all([
        client.file.groupBy({ by: ['extension'], where: { ownerId, deletedAt: null }, _sum: { size: true }, _count: { _all: true } }),
        client.fileVersion.aggregate({ where: { file: { ownerId, deletedAt: null } }, _sum: { size: true } }),
        client.fileVersion.aggregate({ where: { file: { ownerId, deletedAt: { not: null } } }, _sum: { size: true } }),
      ]);
      return {
        byExtension: groups.map((g) => ({ extension: g.extension, bytes: g._sum.size ?? 0n, count: g._count._all })),
        liveVersionBytes: live._sum.size ?? 0n,
        trashVersionBytes: trash._sum.size ?? 0n,
      };
    },
  };
  return repo;
}
