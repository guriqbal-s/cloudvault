// File operations: upload (many at once), details, rename/move, soft delete, download/preview
// preparation and signed access URLs. Versions live in versions.logic.js.

import ApiError from '../../utils/ApiError.js';
import { API_PREFIX } from '../../config/constants.js';
import { MIME_BY_EXT, extensionOf, previewKind } from '../../utils/fileTypes.js';
import { cleanName, fixFilenameEncoding, nextAvailableName, withExtension } from '../../utils/names.js';
import * as keys from '../storage/keys.js';
import { OWNER_ACCESS, crossOwner, hasName, nameTaken, withoutName } from './shared.js';

const MAX_NAME_RETRIES = 3;

/** One file result for a multi-file upload response. */
const failure = (name, err) => ({
  name, ok: false,
  error: { code: err.code ?? 'UPLOAD_FAILED', message: err.isOperational ? err.message : 'Upload failed' },
});

/**
 * @param {object} deps
 * @param {object} deps.repo, deps.access, deps.storage, deps.activity, deps.notifications, deps.decorator
 * @param {{ allowedExtensions: string[], maxUploadBytes: number, quotaWarningPercent: number }} deps.config
 * @param {(path: string) => Promise<void>} deps.removeFile  deletes a staged upload
 * @param {() => string} deps.ids
 * @param {object} deps.accessTokens  services/accessToken.js
 */
export function createFileService({
  repo, access, storage, activity, notifications, decorator, config, removeFile, ids, accessTokens, logger,
}) {
  const meta = (m) => m ?? {};
  const allowed = new Set(config.allowedExtensions);

  function actionFor(purpose) {
    return purpose === 'preview' ? 'read' : 'download';
  }

  // ------------------------------------------------------------------ upload
  /**
   * @param {object} actor
   * @param {{ folderId?: string|null, files: Array<{ path: string, originalName: string, size: number }> }} input
   * @returns {Promise<{ results: Array<{name: string, ok: boolean, file?: object, error?: object}> }>}
   */
  async function upload(actor, { folderId = null, files }, reqMeta) {
    try {
      if (!files?.length) throw ApiError.validation('Choose at least one file to upload');

      let ownerId = actor.id;
      let folderAccess = OWNER_ACCESS;
      let folderName = null;
      if (folderId) {
        const resolved = await access.requireFolderAccess(actor, folderId, 'createChild');
        ownerId = resolved.folder.ownerId;
        folderAccess = resolved.access;
        folderName = resolved.folder.name;
      }

      const taken = new Set(await repo.liveFileNames(ownerId, folderId));
      const results = [];
      const stored = []; // { name, size } for notifications
      let warned = false;

      for (const staged of files) {
        const displayName = fixFilenameEncoding(staged.originalName);
        try {
          const outcome = await uploadOne({ actor, ownerId, folderId, folderAccess, staged, displayName, taken, reqMeta });
          results.push({ name: displayName, ok: true, file: outcome.dto });
          stored.push({ name: outcome.name, size: staged.size });
          if (outcome.crossedWarning && !warned) {
            warned = true;
            notifications.create({
              userId: ownerId, type: 'STORAGE_WARNING', title: 'Storage almost full',
              body: `You have used over ${config.quotaWarningPercent}% of your storage.`, data: { percent: outcome.percent },
            });
          }
        } catch (err) {
          if (!err.isOperational) logger.error('Upload failed:', err);
          results.push(failure(displayName, err));
        } finally {
          await removeFile(staged.path).catch(() => {});
        }
      }

      if (stored.length) {
        const totalBytes = stored.reduce((n, f) => n + f.size, 0);
        repo.recordUploadUsage({ userId: ownerId, bytes: totalBytes, files: stored.length, at: new Date() })
          .catch((err) => logger.error('Failed to record upload usage:', err));
        const summary = stored.length === 1 ? `"${stored[0].name}"` : `${stored.length} files`;
        notifications.create({
          userId: actor.id, type: 'UPLOAD_COMPLETED', title: 'Upload complete',
          body: `${summary} uploaded${folderName ? ` to "${folderName}"` : ''}.`, data: { folderId },
        });
        if (ownerId !== actor.id) {
          notifications.create({
            userId: ownerId, type: 'SHARED_FILE_UPDATED', title: 'New files in a shared folder',
            body: `${actor.user?.name ?? 'Someone'} added ${summary} to "${folderName}".`, data: { folderId },
          });
        }
      }
      return { results };
    } catch (err) {
      // Request-level failure: still delete every staged file.
      await Promise.all((files ?? []).map((f) => removeFile(f.path).catch(() => {})));
      throw err;
    }
  }

  async function uploadOne({ actor, ownerId, folderId, folderAccess, staged, displayName, taken, reqMeta }) {
    const name = cleanName(displayName, 'File name');
    const extension = extensionOf(name);
    if (!extension || !allowed.has(extension)) {
      throw new ApiError(415, 'FILE_TYPE_NOT_ALLOWED', extension ? `".${extension}" files are not allowed` : 'Files without an extension are not allowed');
    }
    if (staged.size > config.maxUploadBytes) {
      throw new ApiError(413, 'FILE_TOO_LARGE', `"${name}" is larger than the ${Math.floor(config.maxUploadBytes / 1048576)} MB limit`);
    }

    const reservation = await repo.reserveQuota(ownerId, BigInt(staged.size));
    if (!reservation.ok) {
      throw ApiError.quotaExceeded(ownerId === actor.id ? 'Not enough storage space left' : 'The owner of this folder has no storage space left');
    }

    const fileId = ids();
    const key = keys.versionKey(ownerId, fileId, 1);
    let blob = null;
    try {
      blob = await storage.putFromFile(key, staged.path);
      let finalName = nextAvailableName(name, taken);
      let row;
      for (let attempt = 1; ; attempt += 1) {
        try {
          row = await repo.transaction((r) => r.createFileWithVersion({
            file: { id: fileId, name: finalName, ownerId, folderId, mimeType: MIME_BY_EXT[extension], extension, size: BigInt(blob.size) },
            version: {
              id: ids(), versionNumber: 1, storageKey: key, size: BigInt(blob.size), mimeType: MIME_BY_EXT[extension],
              checksum: blob.checksum, uploadedById: actor.id, comment: null,
            },
          }));
          break;
        } catch (err) {
          if (err.code !== 'NAME_TAKEN' || attempt >= MAX_NAME_RETRIES) throw err;
          finalName = nextAvailableName(name, [...taken, ...(await repo.liveFileNames(ownerId, folderId))]);
        }
      }
      taken.add(finalName);
      await activity.log({
        userId: actor.id, action: 'FILE_UPLOAD', resourceType: 'FILE', resourceId: fileId, resourceName: finalName,
        description: `Uploaded "${finalName}"`, meta: meta(reqMeta), metadata: { size: blob.size },
      });
      const dto = await decorator.file(actor, row, folderAccess);
      const thr = config.quotaWarningPercent;
      const pct = (used) => (reservation.quota > 0n ? Number((used * 100n) / reservation.quota) : 0);
      const before = pct(reservation.used - BigInt(staged.size));
      const after = pct(reservation.used);
      return { dto, name: finalName, crossedWarning: before < thr && after >= thr, percent: after };
    } catch (err) {
      await repo.releaseQuota(ownerId, BigInt(staged.size)).catch((e) => logger.error('Quota release failed:', e));
      if (blob) await storage.delete(key).catch((e) => logger.error('Orphan cleanup failed:', e));
      throw err;
    }
  }

  // ------------------------------------------------------------------ read / update / delete
  async function get(actor, fileId) {
    const { access: fileAccess } = await access.requireFileAccess(actor, fileId, 'read');
    return decorator.file(actor, await repo.getFile(fileId), fileAccess);
  }

  async function update(actor, fileId, { name, folderId }, reqMeta) {
    const { file, access: fileAccess } = await access.requireFileAccess(actor, fileId, 'update');
    const row = await repo.getFile(fileId);
    const newName = name === undefined ? row.name : withExtension(cleanName(name, 'File name'), row.extension);
    const moving = folderId !== undefined && (folderId ?? null) !== (row.folderId ?? null);
    const renaming = newName !== row.name;
    if (!moving && !renaming) return decorator.file(actor, row, fileAccess);

    const destFolder = moving ? folderId ?? null : row.folderId ?? null;
    if (moving) {
      if (folderId === null) {
        if (file.ownerId !== actor.id) throw crossOwner();
      } else {
        const dest = (await access.requireFolderAccess(actor, folderId, 'createChild')).folder;
        if (dest.ownerId !== file.ownerId) throw crossOwner();
      }
    }

    let siblings = await repo.liveFileNames(file.ownerId, destFolder);
    if (!moving) siblings = withoutName(siblings, row.name);
    if (hasName(siblings, newName)) throw nameTaken(newName);

    await repo.updateFile(fileId, { name: newName, ...(moving ? { folderId: destFolder } : {}) });
    if (renaming) {
      await activity.log({
        userId: actor.id, action: 'FILE_RENAME', resourceType: 'FILE', resourceId: fileId, resourceName: newName,
        description: `Renamed "${row.name}" to "${newName}"`, meta: meta(reqMeta),
      });
    }
    if (moving) {
      await activity.log({
        userId: actor.id, action: 'FILE_MOVE', resourceType: 'FILE', resourceId: fileId, resourceName: newName,
        description: `Moved "${newName}"`, meta: meta(reqMeta),
      });
    }
    return decorator.file(actor, await repo.getFile(fileId), fileAccess);
  }

  async function remove(actor, fileId, reqMeta) {
    const { file } = await access.requireFileAccess(actor, fileId, 'delete');
    await repo.markFileDeleted(fileId, { batchId: fileId, deletedById: actor.id, at: new Date() });
    await activity.log({
      userId: actor.id, action: 'FILE_DELETE', resourceType: 'FILE', resourceId: fileId, resourceName: file.name,
      description: `Moved "${file.name}" to the trash`, meta: meta(reqMeta),
    });
    return { id: fileId };
  }

  // ------------------------------------------------------------------ download / preview
  /**
   * Authorises and describes how to send the current version.
   * @returns {Promise<{ target: object, key: string, size: number, filename: string, mimeType: string, disposition: string }>}
   */
  async function prepareDelivery(actor, fileId, purpose, reqMeta) {
    const { file } = await access.requireFileAccess(actor, fileId, actionFor(purpose));
    const row = await repo.getFile(fileId);
    if (purpose === 'preview' && !previewKind(row.extension)) {
      throw new ApiError(415, 'PREVIEW_NOT_SUPPORTED', 'This file type cannot be previewed');
    }
    const version = await repo.getCurrentVersion(fileId);
    if (!version) throw ApiError.notFound('File content not found');

    repo.touchFileAccessed(fileId, new Date()).catch((err) => logger.error('touchFileAccessed failed:', err));
    if (purpose === 'download') {
      await activity.log({
        userId: actor.id, action: 'FILE_DOWNLOAD', resourceType: 'FILE', resourceId: fileId, resourceName: file.name,
        description: `Downloaded "${file.name}"`, meta: meta(reqMeta),
      });
    }
    return deliveryFor({ name: row.name, version, purpose });
  }

  async function deliveryFor({ name, version, purpose }) {
    const target = await storage.getDownloadTarget(version.storageKey, {
      filename: name, mimeType: version.mimeType, expiresInSeconds: 60,
    });
    return {
      target, key: version.storageKey, size: Number(version.size), filename: name, mimeType: version.mimeType,
      disposition: purpose === 'preview' ? 'inline' : 'attachment',
    };
  }

  /** Short-lived URL for <img>/<video>/<iframe>/links. The server re-checks access on use. */
  async function createAccessUrl(actor, fileId, purpose) {
    const { file } = await access.requireFileAccess(actor, fileId, actionFor(purpose));
    if (purpose === 'preview' && !previewKind(extensionOf(file.name))) {
      throw new ApiError(415, 'PREVIEW_NOT_SUPPORTED', 'This file type cannot be previewed');
    }
    const { token, expiresAt } = accessTokens.sign({ userId: actor.id, fileId, purpose });
    return { url: `${API_PREFIX}/files/${fileId}/${purpose}?st=${encodeURIComponent(token)}`, expiresAt };
  }

  return { upload, get, update, remove, prepareDelivery, deliveryFor, createAccessUrl };
}
