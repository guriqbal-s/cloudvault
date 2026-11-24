// Version history: list, upload a new version, restore an old one, download, delete.
// Every version counts toward the OWNER's quota (the uploader is only recorded on the version).

import ApiError from '../../utils/ApiError.js';
import { MIME_BY_EXT, extensionOf } from '../../utils/fileTypes.js';
import * as keys from '../storage/keys.js';
import { userRef } from '../dto.js';

const COMMENT_MAX = 500;

export function toVersionDTO(v, currentVersionId) {
  return {
    id: v.id,
    number: v.versionNumber,
    size: v.size,
    mimeType: v.mimeType,
    comment: v.comment ?? null,
    uploadedBy: userRef(v.uploadedBy),
    createdAt: v.createdAt,
    isCurrent: v.id === currentVersionId,
  };
}

export function createVersionService({
  repo, access, storage, activity, notifications, config, removeFile, ids, logger,
}) {
  const meta = (m) => m ?? {};

  async function requireVersion(fileId, number) {
    const v = await repo.getVersion(fileId, number);
    if (!v) throw ApiError.notFound('Version not found');
    return v;
  }

  async function list(actor, fileId) {
    await access.requireFileAccess(actor, fileId, 'read');
    const [file, versions] = await Promise.all([repo.getFile(fileId), repo.listVersions(fileId)]);
    return versions.map((v) => toVersionDTO(v, file.currentVersionId));
  }

  /** Tell everyone with access (and the owner) that the file changed, except the person who did it. */
  async function notifyChange(actor, file, type, body) {
    const people = await repo.listFileSharees(file);
    const recipients = [...new Set([file.ownerId, ...people])].filter((id) => id !== actor.id);
    if (recipients.length) {
      notifications.createForMany(recipients, {
        type, title: 'Shared file updated', body, data: { resourceType: 'FILE', resourceId: file.id, actorId: actor.id },
      });
    }
  }

  /** Shared tail of "upload version" and "restore version": reserve quota, store, record. */
  async function commit({ actor, file, number, storeBlob, mimeType, comment, checksumFallback, size }) {
    const reservation = await repo.reserveQuota(file.ownerId, BigInt(size));
    if (!reservation.ok) {
      throw ApiError.quotaExceeded(file.ownerId === actor.id ? 'Not enough storage space left' : 'The owner of this file has no storage space left');
    }
    const key = keys.versionKey(file.ownerId, file.id, number);
    let blob = null;
    try {
      blob = await storeBlob(key);
      const row = await repo.transaction((r) => r.addVersion({
        fileId: file.id,
        version: {
          id: ids(), versionNumber: number, storageKey: key, size: BigInt(blob.size), mimeType,
          checksum: blob.checksum ?? checksumFallback, uploadedById: actor.id, comment,
        },
      }));
      return row;
    } catch (err) {
      await repo.releaseQuota(file.ownerId, BigInt(size)).catch((e) => logger.error('Quota release failed:', e));
      if (blob) await storage.delete(key).catch((e) => logger.error('Orphan cleanup failed:', e));
      if (err.code === 'VERSION_CONFLICT') throw new ApiError(409, 'VERSION_CONFLICT', 'The file was changed at the same time. Try again.');
      throw err;
    }
  }

  async function upload(actor, fileId, { file: staged, comment }, reqMeta) {
    try {
      if (!staged) throw ApiError.validation('Choose a file to upload');
      const { file } = await access.requireFileAccess(actor, fileId, 'version');
      const row = await repo.getFile(fileId);
      const ext = extensionOf(fileNameOf(staged));
      if (ext !== row.extension) {
        throw new ApiError(422, 'EXTENSION_MISMATCH', `A new version must be a ".${row.extension}" file`);
      }
      if (staged.size > config.maxUploadBytes) {
        throw new ApiError(413, 'FILE_TOO_LARGE', `The file is larger than the ${Math.floor(config.maxUploadBytes / 1048576)} MB limit`);
      }
      const cleanComment = typeof comment === 'string' && comment.trim() ? comment.trim().slice(0, COMMENT_MAX) : null;
      const number = (await repo.maxVersionNumber(fileId)) + 1;

      const created = await commit({
        actor, file, number, size: staged.size, mimeType: MIME_BY_EXT[row.extension], comment: cleanComment,
        storeBlob: (key) => storage.putFromFile(key, staged.path),
      });
      await activity.log({
        userId: actor.id, action: 'VERSION_CREATE', resourceType: 'FILE', resourceId: fileId, resourceName: row.name,
        description: `Uploaded version ${number} of "${row.name}"`, meta: meta(reqMeta), metadata: { version: number },
      });
      await notifyChange(actor, file, 'SHARED_FILE_UPDATED', `${actor.user?.name ?? 'Someone'} uploaded version ${number} of "${row.name}".`);
      return toVersionDTO({ ...created, uploadedBy: { id: actor.id, name: actor.user?.name } }, created.id);
    } finally {
      if (staged?.path) await removeFile(staged.path).catch(() => {});
    }
  }

  /** Restoring never rewrites history: it copies the old content into a NEW latest version. */
  async function restore(actor, fileId, number, reqMeta) {
    const { file } = await access.requireFileAccess(actor, fileId, 'version');
    const [row, source] = await Promise.all([repo.getFile(fileId), requireVersion(fileId, number)]);
    if (source.id === row.currentVersionId) throw ApiError.badRequest('That version is already the current one');
    const newNumber = (await repo.maxVersionNumber(fileId)) + 1;

    const created = await commit({
      actor, file, number: newNumber, size: Number(source.size), mimeType: source.mimeType,
      comment: `Restored from version ${number}`, checksumFallback: source.checksum,
      storeBlob: async (key) => {
        await storage.copy(source.storageKey, key);
        return { size: Number(source.size), checksum: source.checksum };
      },
    });
    await activity.log({
      userId: actor.id, action: 'VERSION_RESTORE', resourceType: 'FILE', resourceId: fileId, resourceName: row.name,
      description: `Restored version ${number} of "${row.name}"`, meta: meta(reqMeta), metadata: { from: number, to: newNumber },
    });
    await notifyChange(actor, file, 'SHARED_FILE_UPDATED', `${actor.user?.name ?? 'Someone'} restored an earlier version of "${row.name}".`);
    return toVersionDTO({ ...created, uploadedBy: { id: actor.id, name: actor.user?.name } }, created.id);
  }

  async function prepareDownload(actor, fileId, number, reqMeta) {
    const { file } = await access.requireFileAccess(actor, fileId, 'download');
    const v = await requireVersion(fileId, number);
    await activity.log({
      userId: actor.id, action: 'FILE_DOWNLOAD', resourceType: 'FILE', resourceId: fileId, resourceName: file.name,
      description: `Downloaded version ${number} of "${file.name}"`, meta: meta(reqMeta),
    });
    const target = await storage.getDownloadTarget(v.storageKey, { filename: file.name, mimeType: v.mimeType, expiresInSeconds: 60 });
    return { target, key: v.storageKey, size: Number(v.size), filename: file.name, mimeType: v.mimeType, disposition: 'attachment' };
  }

  async function remove(actor, fileId, number, reqMeta) {
    const { file } = await access.requireFileAccess(actor, fileId, 'delete');
    const [row, v] = await Promise.all([repo.getFile(fileId), requireVersion(fileId, number)]);
    if (v.id === row.currentVersionId) throw new ApiError(409, 'CURRENT_VERSION', 'The current version cannot be deleted');
    await repo.transaction(async (r) => {
      await r.deleteVersion(v.id);
      await r.releaseQuota(file.ownerId, BigInt(v.size));
    });
    await storage.delete(v.storageKey).catch((e) => logger.error('Version blob delete failed:', e));
    await activity.log({
      userId: actor.id, action: 'VERSION_DELETE', resourceType: 'FILE', resourceId: fileId, resourceName: row.name,
      description: `Deleted version ${number} of "${row.name}"`, meta: meta(reqMeta),
    });
    return { number };
  }

  return { list, upload, restore, prepareDownload, remove };
}

/** The staged upload's original name (multer sets originalname; tests pass originalName). */
function fileNameOf(staged) {
  return staged.originalName ?? staged.originalname ?? '';
}
