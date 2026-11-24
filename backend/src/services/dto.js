// Response shapes for files and folders. Every endpoint that returns a file or folder goes
// through these builders, so the frontend can rely on one shape. See docs/api-contract.md.
//
// `file` / `folder` are Prisma rows. Anything not passed in (owner, starred, ...) defaults to a
// neutral value, so list endpoints only pay for the extras they actually loaded.

import { capabilitiesFor } from './access.logic.js';
import { fileCategory } from '../utils/fileTypes.js';

export const userRef = (user) => (user ? { id: user.id, name: user.name } : null);

/** { level, canDownload, source, capabilities } for the signed-in actor. */
export function accessDTO(actor, type, access) {
  if (!actor || !access) return undefined;
  return {
    level: access.level,
    canDownload: access.canDownload,
    source: access.source,
    capabilities: capabilitiesFor(actor, type, access),
  };
}

/**
 * @param {object} file   Prisma File row
 * @param {object} [ctx]
 * @param {object} [ctx.actor]   req.user, for the access block
 * @param {object} [ctx.access]  result of accessService.resolveFileAccess
 * @param {boolean} [ctx.starred]
 * @param {boolean} [ctx.shared]         true when the file has any share or active link
 * @param {{id:string,name:string}} [ctx.owner]
 * @param {number} [ctx.versionCount]
 * @param {number} [ctx.currentVersion]  version number of the current version
 * @param {{id:string,name:string}} [ctx.sharedBy]  set on "shared with me" listings
 */
export function toFileDTO(file, ctx = {}) {
  const owner = ctx.owner ?? file.owner;
  return {
    id: file.id,
    kind: 'file',
    name: file.name,
    extension: file.extension,
    mimeType: file.mimeType,
    category: fileCategory(file.extension),
    size: file.size,
    ownerId: file.ownerId,
    owner: userRef(owner),
    folderId: file.folderId ?? null,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    lastAccessedAt: file.lastAccessedAt ?? null,
    deletedAt: file.deletedAt ?? null,
    starred: Boolean(ctx.starred),
    shared: Boolean(ctx.shared),
    versionCount: ctx.versionCount ?? 1,
    currentVersion: ctx.currentVersion ?? ctx.versionCount ?? 1,
    ...(ctx.sharedBy ? { sharedBy: userRef(ctx.sharedBy) } : {}),
    access: accessDTO(ctx.actor, 'FILE', ctx.access),
  };
}

/**
 * @param {object} folder Prisma Folder row
 * @param {object} [ctx]  same keys as toFileDTO, plus itemCount (children: files + sub-folders)
 */
export function toFolderDTO(folder, ctx = {}) {
  const owner = ctx.owner ?? folder.owner;
  return {
    id: folder.id,
    kind: 'folder',
    name: folder.name,
    ownerId: folder.ownerId,
    owner: userRef(owner),
    parentId: folder.parentId ?? null,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    deletedAt: folder.deletedAt ?? null,
    starred: Boolean(ctx.starred),
    shared: Boolean(ctx.shared),
    itemCount: ctx.itemCount ?? null,
    ...(ctx.sharedBy ? { sharedBy: userRef(ctx.sharedBy) } : {}),
    access: accessDTO(ctx.actor, 'FOLDER', ctx.access),
  };
}

/** Activity log row -> API shape (the `user` relation must be selected as { id, name }). */
export function toActivityDTO(row) {
  return {
    id: row.id,
    action: row.action,
    description: row.description,
    resourceType: row.resourceType ?? null,
    resourceId: row.resourceId ?? null,
    resourceName: row.resourceName ?? null,
    user: userRef(row.user),
    ip: row.ip ?? null,
    createdAt: row.createdAt,
  };
}
