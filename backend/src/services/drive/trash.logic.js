// Trash: list, restore, permanent delete, empty, and the retention purge used by the cron job.
//
// A "trash root" is the item the user actually deleted: a folder (whose whole subtree shares
// its id as trashBatchId) or a single file (trashBatchId = its own id). Only roots are listed
// and restored; permanent deletion removes the whole subtree and frees the owner's quota.

import ApiError from '../../utils/ApiError.js';
import { nextAvailableName } from '../../utils/names.js';
import * as keys from '../storage/keys.js';
import { OWNER_ACCESS } from './shared.js';

const notInTrash = () => ApiError.badRequest('This item is not in the trash');

export function createTrashService({ repo, access, storage, activity, decorator, config, logger }) {
  const meta = (m) => m ?? {};

  async function list(actor) {
    const { folders, files } = await repo.listTrashRoots(actor.id);
    return decorator.decorate(actor, { files, folders }, OWNER_ACCESS);
  }

  async function restore(actor, type, id, reqMeta) {
    return type === 'files' ? restoreFile(actor, id, reqMeta) : restoreFolder(actor, id, reqMeta);
  }

  async function restoreFile(actor, id, reqMeta) {
    await access.requireFileAccess(actor, id, 'delete', { allowTrashed: true });
    const row = await repo.getFile(id);
    if (!row.deletedAt) throw notInTrash();
    if (row.trashBatchId !== row.id) throw rootFirst();

    await repo.transaction(async (r) => {
      const parent = row.folderId ? await r.getFolder(row.folderId) : null;
      const folderId = parent && !parent.deletedAt ? parent.id : null; // parent gone -> top level
      const name = nextAvailableName(row.name, await r.liveFileNames(row.ownerId, folderId));
      await r.restoreBatch({ ownerId: row.ownerId, batchId: row.id });
      await r.updateFile(id, { name, folderId });
    });
    await activity.log({
      userId: actor.id, action: 'FILE_RESTORE', resourceType: 'FILE', resourceId: id, resourceName: row.name,
      description: `Restored "${row.name}" from the trash`, meta: meta(reqMeta),
    });
    return decorator.file(actor, await repo.getFile(id), OWNER_ACCESS);
  }

  async function restoreFolder(actor, id, reqMeta) {
    await access.requireFolderAccess(actor, id, 'delete', { allowTrashed: true });
    const folder = await repo.getFolder(id);
    if (!folder.deletedAt) throw notInTrash();
    if (folder.trashBatchId !== folder.id) throw rootFirst();

    await repo.transaction(async (r) => {
      const parent = folder.parentId ? await r.getFolder(folder.parentId) : null;
      const parentId = parent && !parent.deletedAt ? parent.id : null;
      const name = nextAvailableName(folder.name, await r.liveFolderNames(folder.ownerId, parentId));
      await r.restoreBatch({ ownerId: folder.ownerId, batchId: folder.id });
      if (parentId !== folder.parentId) {
        await r.moveFolderSubtree({
          id: folder.id, ownerId: folder.ownerId, oldPath: folder.path,
          newPath: `${parent && !parent.deletedAt ? parent.path : '/'}${folder.id}/`, newParentId: parentId, name,
        });
      } else if (name !== folder.name) {
        await r.updateFolder(folder.id, { name });
      }
    });
    await activity.log({
      userId: actor.id, action: 'FOLDER_RESTORE', resourceType: 'FOLDER', resourceId: id, resourceName: folder.name,
      description: `Restored folder "${folder.name}" from the trash`, meta: meta(reqMeta),
    });
    return decorator.folder(actor, await repo.getFolder(id), OWNER_ACCESS);
  }

  /**
   * Permanently delete one trashed item and everything under it.
   * Database rows go first (atomically, with the quota refund); blobs are removed afterwards, so
   * a failure leaves harmless orphans rather than rows that point at nothing.
   */
  async function purgeRoot({ type, id, ownerId, path }) {
    const plan = await repo.collectPurge({ ownerId, folderPath: type === 'folder' ? path : null, fileId: type === 'file' ? id : null });
    await repo.transaction(async (r) => {
      await r.deleteRows({ fileIds: plan.fileIds, folderIds: plan.folderIds });
      if (plan.bytes > 0n) await r.releaseQuota(ownerId, plan.bytes);
    });
    for (const fileId of plan.fileIds) {
      await storage.deletePrefix(keys.filePrefix(ownerId, fileId))
        .catch((err) => logger.error(`Blob cleanup failed for file ${fileId}:`, err));
    }
    return { files: plan.fileIds.length, folders: plan.folderIds.length, bytes: Number(plan.bytes) };
  }

  async function purge(actor, type, id, reqMeta) {
    if (type === 'files') {
      const { file } = await access.requireFileAccess(actor, id, 'delete', { allowTrashed: true });
      const row = await repo.getFile(id);
      if (!row.deletedAt) throw notInTrash();
      const result = await purgeRoot({ type: 'file', id, ownerId: file.ownerId });
      await activity.log({
        userId: actor.id, action: 'FILE_PERMANENT_DELETE', resourceType: 'FILE', resourceId: id, resourceName: row.name,
        description: `Permanently deleted "${row.name}"`, meta: meta(reqMeta),
      });
      return result;
    }
    const { folder } = await access.requireFolderAccess(actor, id, 'delete', { allowTrashed: true });
    if (!folder.deletedAt) throw notInTrash();
    const result = await purgeRoot({ type: 'folder', id, ownerId: folder.ownerId, path: folder.path });
    await activity.log({
      userId: actor.id, action: 'FOLDER_PERMANENT_DELETE', resourceType: 'FOLDER', resourceId: id, resourceName: folder.name,
      description: `Permanently deleted folder "${folder.name}"`, meta: meta(reqMeta),
    });
    return result;
  }

  async function empty(actor, reqMeta) {
    const { folders, files } = await repo.listTrashRoots(actor.id);
    const total = { files: 0, folders: 0, bytes: 0 };
    const add = (r) => { total.files += r.files; total.folders += r.folders; total.bytes += r.bytes; };
    for (const f of folders) add(await purgeRoot({ type: 'folder', id: f.id, ownerId: actor.id, path: f.path }));
    for (const f of files) add(await purgeRoot({ type: 'file', id: f.id, ownerId: actor.id }));
    if (folders.length + files.length) {
      await activity.log({
        userId: actor.id, action: 'FILE_PERMANENT_DELETE', description: `Emptied the trash (${folders.length + files.length} items)`,
        meta: meta(reqMeta), metadata: total,
      });
    }
    return total;
  }

  /** Cron entry point: purge items that have been in the trash longer than the retention period. */
  async function purgeExpired(now = new Date()) {
    const cutoff = new Date(now.getTime() - config.trashRetentionDays * 86_400_000);
    const roots = await repo.listExpiredTrashRoots(cutoff);
    const total = { items: 0, failed: 0, bytes: 0 };
    for (const root of roots) {
      try {
        const r = await purgeRoot(root);
        total.items += 1;
        total.bytes += r.bytes;
      } catch (err) {
        total.failed += 1;
        logger.error(`Trash purge failed for ${root.type} ${root.id}:`, err);
      }
    }
    return total;
  }

  return { list, restore, purge, purgeRoot, empty, purgeExpired };
}

function rootFirst() {
  return new ApiError(409, 'RESTORE_PARENT_FIRST', 'This item was deleted together with a folder. Restore that folder instead.');
}
