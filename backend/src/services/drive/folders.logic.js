// Folder operations: browse, create, rename/move, soft delete.
// Pure business rules; data access goes through `repo`, authorisation through `access`.

import ApiError from '../../utils/ApiError.js';
import { ancestorIds } from '../access.logic.js';
import { EXTENSIONS_BY_CATEGORY } from '../../utils/fileTypes.js';
import { cleanName } from '../../utils/names.js';
import { buildMeta, parsePagination } from '../../utils/pagination.js';
import {
  MAX_FOLDER_DEPTH, OWNER_ACCESS, crossOwner, hasName, invalidMove, nameTaken, withoutName,
} from './shared.js';

export const FILE_SORT_FIELDS = Object.freeze(['name', 'size', 'createdAt', 'updatedAt', 'type']);

/** { sort, order } from the query, whitelisted. */
export function parseFileSort({ sort, order } = {}) {
  const field = FILE_SORT_FIELDS.includes(sort) ? sort : 'name';
  const dir = order === 'desc' ? 'desc' : order === 'asc' ? 'asc' : field === 'name' || field === 'type' ? 'asc' : 'desc';
  return { field, dir };
}

/** @param {{ repo, access, activity, decorator, ids?: () => string }} deps */
export function createFolderService({ repo, access, activity, decorator, ids }) {
  const meta = (m) => m ?? {};

  /** Breadcrumb trail; a sharee only sees the path from the folder shared with them downward. */
  async function breadcrumbs(actor, folder) {
    const idsInPath = ancestorIds(folder.path);
    const rows = await repo.getFoldersByIds(idsInPath);
    const byId = new Map(rows.map((r) => [r.id, r]));
    let trail = idsInPath.map((id) => byId.get(id)).filter(Boolean);
    if (folder.ownerId !== actor.id) {
      const shared = await repo.folderShareIds(actor.id, idsInPath);
      const start = trail.findIndex((r) => shared.has(r.id));
      trail = start < 0 ? [folder] : trail.slice(start);
    }
    return trail.map((r) => ({ id: r.id, name: r.name }));
  }

  /** Contents of one folder (or the caller's root when folderId is null). */
  async function contents(actor, folderId, query = {}) {
    let folder = null;
    let folderAccess = OWNER_ACCESS;
    let ownerId = actor.id;
    let crumbs = [];

    if (folderId) {
      const resolved = await access.requireFolderAccess(actor, folderId, 'read');
      folderAccess = resolved.access;
      ownerId = resolved.folder.ownerId;
      folder = await repo.getFolder(folderId);
      crumbs = await breadcrumbs(actor, folder);
    }

    const { page, limit, skip, take } = parsePagination(query, { defaultLimit: 50, maxLimit: 200 });
    const q = typeof query.q === 'string' && query.q.trim() ? query.q.trim().slice(0, 100) : undefined;
    const extensions = query.type ? EXTENSIONS_BY_CATEGORY[query.type] ?? [] : undefined;
    const { field, dir } = parseFileSort(query);

    const [subfolders, fileRows] = await Promise.all([
      query.type ? Promise.resolve([]) : repo.listLiveSubfolders(ownerId, folderId ?? null, { q }),
      repo.listLiveFiles(ownerId, folderId ?? null, { q, extensions, sort: { field, dir }, skip, take }),
    ]);

    // Children inherit the folder's access (the conservative choice: a direct share on a single
    // file inside is never needed to read it, and never widens the folder's rights).
    const { files, folders } = await decorator.decorate(actor, { files: fileRows.rows, folders: subfolders }, folderAccess);
    const folderDto = folder ? await decorator.folder(actor, folder, folderAccess) : null;
    return { folder: folderDto, breadcrumbs: crumbs, folders, files, meta: buildMeta({ page, limit, total: fileRows.total }) };
  }

  async function create(actor, { name, parentId }, reqMeta) {
    const clean = cleanName(name, 'Folder name');
    let parent = null;
    let parentAccess = OWNER_ACCESS;
    let ownerId = actor.id;
    if (parentId) {
      const resolved = await access.requireFolderAccess(actor, parentId, 'createChild');
      parent = resolved.folder;
      parentAccess = resolved.access;
      ownerId = parent.ownerId;
      if (ancestorIds(parent.path).length >= MAX_FOLDER_DEPTH) {
        throw ApiError.validation(`Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep`);
      }
    }
    if (hasName(await repo.liveFolderNames(ownerId, parentId ?? null), clean)) throw nameTaken(clean);

    const id = ids();
    const row = await repo.createFolder({
      id, name: clean, ownerId, parentId: parentId ?? null, path: `${parent ? parent.path : '/'}${id}/`,
    });
    await activity.log({
      userId: actor.id, action: 'FOLDER_CREATE', resourceType: 'FOLDER', resourceId: id, resourceName: clean,
      description: `Created folder "${clean}"`, meta: meta(reqMeta),
    });
    return decorator.folder(actor, row, parentAccess);
  }

  async function update(actor, folderId, { name, parentId }, reqMeta) {
    const { folder, access: folderAccess } = await access.requireFolderAccess(actor, folderId, 'update');
    const newName = name === undefined ? folder.name : cleanName(name, 'Folder name');
    const moving = parentId !== undefined && (parentId ?? null) !== (folder.parentId ?? null);
    const renaming = newName !== folder.name;
    if (!moving && !renaming) return decorator.folder(actor, await repo.getFolder(folderId), folderAccess);

    let destPath = '/';
    const destParent = moving ? parentId ?? null : folder.parentId ?? null;
    if (moving) {
      if (parentId === null) {
        if (folder.ownerId !== actor.id) throw crossOwner(); // the root of a drive belongs to its owner
      } else {
        const dest = (await access.requireFolderAccess(actor, parentId, 'createChild')).folder;
        if (dest.ownerId !== folder.ownerId) throw crossOwner();
        if (dest.path.startsWith(folder.path)) throw invalidMove();
        if (ancestorIds(dest.path).length >= MAX_FOLDER_DEPTH) {
          throw ApiError.validation(`Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep`);
        }
        destPath = dest.path;
      }
    }

    let siblings = await repo.liveFolderNames(folder.ownerId, destParent);
    if (!moving) siblings = withoutName(siblings, folder.name);
    if (hasName(siblings, newName)) throw nameTaken(newName);

    if (moving) {
      await repo.moveFolderSubtree({
        id: folder.id, ownerId: folder.ownerId, oldPath: folder.path, newPath: `${destPath}${folder.id}/`,
        newParentId: destParent, name: newName,
      });
    } else {
      await repo.updateFolder(folder.id, { name: newName });
    }

    if (renaming) {
      await activity.log({
        userId: actor.id, action: 'FOLDER_RENAME', resourceType: 'FOLDER', resourceId: folder.id, resourceName: newName,
        description: `Renamed folder "${folder.name}" to "${newName}"`, meta: meta(reqMeta),
      });
    }
    if (moving) {
      await activity.log({
        userId: actor.id, action: 'FOLDER_MOVE', resourceType: 'FOLDER', resourceId: folder.id, resourceName: newName,
        description: `Moved folder "${newName}"`, meta: meta(reqMeta),
      });
    }
    return decorator.folder(actor, await repo.getFolder(folder.id), folderAccess);
  }

  /** Move the folder and everything in it to the trash (owner only). */
  async function remove(actor, folderId, reqMeta) {
    const { folder } = await access.requireFolderAccess(actor, folderId, 'delete');
    await repo.markFolderTreeDeleted({
      ownerId: folder.ownerId, rootId: folder.id, path: folder.path, batchId: folder.id, deletedById: actor.id, at: new Date(),
    });
    await activity.log({
      userId: actor.id, action: 'FOLDER_DELETE', resourceType: 'FOLDER', resourceId: folder.id, resourceName: folder.name,
      description: `Moved folder "${folder.name}" to the trash`, meta: meta(reqMeta),
    });
    return { id: folder.id };
  }

  return { contents, create, update, remove, breadcrumbs };
}
