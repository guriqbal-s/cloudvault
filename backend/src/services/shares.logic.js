// Sharing with other users: per-resource people lists, grant / change / revoke, and the
// "shared with me" / "shared by me" listings. Only the OWNER of a resource can share it
// (access layer action "share"), which also enforces the global file:share / folder:share keys.

import ApiError from '../utils/ApiError.js';
import { combineGrants } from './access.logic.js';
import { toFileDTO, toFolderDTO, userRef } from './dto.js';

const OWNER_ACCESS = Object.freeze({ level: 'OWNER', canDownload: true, source: 'owner' });
const LISTING_LIMIT = 200;

/** URL segment -> resource type. */
export const TYPE_BY_SEGMENT = Object.freeze({ files: 'FILE', folders: 'FOLDER' });

export function linkDTO(link, { clientUrl, now = new Date() } = {}) {
  return {
    id: link.id,
    resourceType: link.resourceType,
    token: link.token,
    url: clientUrl ? `${clientUrl}/s/${link.token}` : undefined,
    canDownload: link.allowDownload,
    hasPassword: Boolean(link.passwordHash),
    expiresAt: link.expiresAt ?? null,
    expired: Boolean(link.expiresAt && link.expiresAt <= now),
    revoked: Boolean(link.revokedAt),
    accessCount: link.accessCount ?? 0,
    lastAccessedAt: link.lastAccessedAt ?? null,
    createdAt: link.createdAt,
  };
}

const shareDTO = (share, user) => ({
  id: share.id,
  user: user ? { id: user.id, name: user.name, email: user.email } : null,
  level: share.role,
  canDownload: share.canDownload,
  createdAt: share.createdAt,
});

/** @param {{ db, access, notifications, activity, clientUrl?: string, now?: () => Date }} deps */
export function createShareService({ db, access, notifications, activity, clientUrl, now = () => new Date() }) {
  const model = (type) => (type === 'FILE' ? db.fileShare : db.folderShare);
  const fk = (type) => (type === 'FILE' ? 'fileId' : 'folderId');

  /** Loads the resource and enforces that the actor may share it. */
  async function requireShareable(actor, type, id) {
    if (type === 'FILE') {
      const { file } = await access.requireFileAccess(actor, id, 'share');
      return { resource: file, label: 'file' };
    }
    const { folder } = await access.requireFolderAccess(actor, id, 'share');
    return { resource: folder, label: 'folder' };
  }

  async function usersById(ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
    return new Map(rows.map((u) => [u.id, u]));
  }

  async function listForResource(actor, type, id) {
    const { resource } = await requireShareable(actor, type, id);
    const [shares, links] = await Promise.all([
      model(type).findMany({ where: { [fk(type)]: resource.id }, orderBy: [{ createdAt: 'asc' }] }),
      db.shareLink.findMany({ where: { [fk(type)]: resource.id, revokedAt: null }, orderBy: [{ createdAt: 'desc' }] }),
    ]);
    const users = await usersById(shares.map((s) => s.sharedWithId));
    const t = now();
    return {
      people: shares.map((s) => shareDTO(s, users.get(s.sharedWithId))),
      links: links.map((l) => linkDTO(l, { clientUrl, now: t })),
    };
  }

  async function grant(actor, type, id, { email, level, canDownload }, meta) {
    const { resource, label } = await requireShareable(actor, type, id);
    const recipient = await db.user.findUnique({ where: { email: String(email).trim().toLowerCase() }, select: { id: true, name: true, email: true, status: true } });
    if (!recipient || recipient.status !== 'ACTIVE') throw ApiError.notFound('No active user with that email address');
    if (recipient.id === resource.ownerId) throw ApiError.badRequest('The owner already has full access');

    const wantsDownload = level === 'EDITOR' ? true : canDownload ?? true;
    const existing = await model(type).findFirst({ where: { [fk(type)]: resource.id, sharedWithId: recipient.id } });
    let row;
    let created = false;
    if (!existing) {
      row = await model(type).create({ data: { [fk(type)]: resource.id, sharedWithId: recipient.id, sharedById: actor.id, role: level, canDownload: wantsDownload } });
      created = true;
    } else if (existing.role !== level || existing.canDownload !== wantsDownload) {
      row = await model(type).update({ where: { id: existing.id }, data: { role: level, canDownload: wantsDownload } });
    } else {
      return shareDTO(existing, recipient); // nothing changed: no notification, no log noise
    }

    const actorName = actor.user?.name ?? 'Someone';
    const roleText = level === 'EDITOR' ? 'edit' : 'view';
    await notifications.create({
      userId: recipient.id,
      type: created ? (type === 'FILE' ? 'FILE_SHARED' : 'FOLDER_SHARED') : 'PERMISSION_CHANGED',
      title: created ? `${actorName} shared a ${label} with you` : `Your access to “${resource.name}” changed`,
      body: created ? `“${resource.name}” — you can ${roleText}.` : `You can now ${roleText} “${resource.name}”.`,
      data: { resourceType: type, resourceId: resource.id, actorId: actor.id, level },
    });
    await activity.log({
      userId: actor.id,
      action: created ? 'SHARE_CREATE' : 'SHARE_UPDATE',
      description: `${created ? 'Shared' : 'Updated access to'} “${resource.name}” ${created ? 'with' : 'for'} ${recipient.email} (${level.toLowerCase()})`,
      resourceType: type, resourceId: resource.id, resourceName: resource.name,
      metadata: { sharedWithId: recipient.id, level, canDownload: wantsDownload }, meta,
    });
    return shareDTO(row, recipient);
  }

  async function update(actor, type, id, userId, { level, canDownload }, meta) {
    const { resource } = await requireShareable(actor, type, id);
    const existing = await model(type).findFirst({ where: { [fk(type)]: resource.id, sharedWithId: userId } });
    if (!existing) throw ApiError.notFound('Share not found');
    const nextLevel = level ?? existing.role;
    const nextDownload = nextLevel === 'EDITOR' ? true : canDownload ?? existing.canDownload;
    const user = (await usersById([userId])).get(userId);
    if (nextLevel === existing.role && nextDownload === existing.canDownload) return shareDTO(existing, user);

    const row = await model(type).update({ where: { id: existing.id }, data: { role: nextLevel, canDownload: nextDownload } });
    await notifications.create({
      userId,
      type: 'PERMISSION_CHANGED',
      title: `Your access to “${resource.name}” changed`,
      body: `You can now ${nextLevel === 'EDITOR' ? 'edit' : 'view'} “${resource.name}”.`,
      data: { resourceType: type, resourceId: resource.id, actorId: actor.id, level: nextLevel },
    });
    await activity.log({
      userId: actor.id, action: 'SHARE_UPDATE',
      description: `Changed ${user?.email ?? 'a user'}'s access to “${resource.name}” to ${nextLevel.toLowerCase()}`,
      resourceType: type, resourceId: resource.id, resourceName: resource.name, metadata: { sharedWithId: userId, level: nextLevel }, meta,
    });
    return shareDTO(row, user);
  }

  async function revoke(actor, type, id, userId, meta) {
    const { resource } = await requireShareable(actor, type, id);
    const existing = await model(type).findFirst({ where: { [fk(type)]: resource.id, sharedWithId: userId } });
    if (!existing) throw ApiError.notFound('Share not found');
    await model(type).delete({ where: { id: existing.id } });
    const user = (await usersById([userId])).get(userId);
    await notifications.create({
      userId, type: 'ACCESS_REVOKED',
      title: 'Access removed',
      body: `You no longer have access to “${resource.name}”.`,
      data: { resourceType: type, resourceId: resource.id, actorId: actor.id },
    });
    await activity.log({
      userId: actor.id, action: 'SHARE_REVOKE', description: `Stopped sharing “${resource.name}” with ${user?.email ?? 'a user'}`,
      resourceType: type, resourceId: resource.id, resourceName: resource.name, metadata: { sharedWithId: userId }, meta,
    });
    return { revoked: true };
  }

  async function starredSets(userId, fileIds, folderIds) {
    const [f, d] = await Promise.all([
      fileIds.length ? db.starredResource.findMany({ where: { userId, fileId: { in: fileIds } }, select: { fileId: true } }) : [],
      folderIds.length ? db.starredResource.findMany({ where: { userId, folderId: { in: folderIds } }, select: { folderId: true } }) : [],
    ]);
    return { files: new Set(f.map((r) => r.fileId)), folders: new Set(d.map((r) => r.folderId)) };
  }

  /** Items other people shared directly with the actor (items inside a shared folder are reached by opening it). */
  async function withMe(actor) {
    const opts = { where: { sharedWithId: actor.id }, orderBy: [{ createdAt: 'desc' }], take: LISTING_LIMIT };
    const [fileShares, folderShares] = await Promise.all([db.fileShare.findMany(opts), db.folderShare.findMany(opts)]);
    const [files, folders] = await Promise.all([
      fileShares.length ? db.file.findMany({ where: { id: { in: fileShares.map((s) => s.fileId) }, deletedAt: null } }) : [],
      folderShares.length ? db.folder.findMany({ where: { id: { in: folderShares.map((s) => s.folderId) }, deletedAt: null } }) : [],
    ]);
    const fileMap = new Map(files.map((f) => [f.id, f]));
    const folderMap = new Map(folders.map((f) => [f.id, f]));
    const users = await usersById([...files, ...folders].map((r) => r.ownerId).concat([...fileShares, ...folderShares].map((s) => s.sharedById)));
    const stars = await starredSets(actor.id, files.map((f) => f.id), folders.map((f) => f.id));

    const accessOf = (share, source) => ({ ...combineGrants([share]), source });
    return {
      folders: folderShares.filter((s) => folderMap.has(s.folderId)).map((s) => {
        const f = folderMap.get(s.folderId);
        return toFolderDTO(f, { actor, access: accessOf(s, 'folder-share'), owner: userRef(users.get(f.ownerId)), sharedBy: users.get(s.sharedById), starred: stars.folders.has(f.id), shared: true });
      }),
      files: fileShares.filter((s) => fileMap.has(s.fileId)).map((s) => {
        const f = fileMap.get(s.fileId);
        return toFileDTO(f, { actor, access: accessOf(s, 'file-share'), owner: userRef(users.get(f.ownerId)), sharedBy: users.get(s.sharedById), starred: stars.files.has(f.id), shared: true });
      }),
    };
  }

  /** Items the actor owns and has shared with people or via a live link. */
  async function byMe(actor) {
    const t = now();
    const liveLink = { createdById: actor.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: t } }] };
    const [fileShares, folderShares, links] = await Promise.all([
      db.fileShare.findMany({ where: { sharedById: actor.id }, select: { fileId: true } }),
      db.folderShare.findMany({ where: { sharedById: actor.id }, select: { folderId: true } }),
      db.shareLink.findMany({ where: liveLink, select: { fileId: true, folderId: true } }),
    ]);
    const fileIds = [...new Set([...fileShares.map((s) => s.fileId), ...links.map((l) => l.fileId)].filter(Boolean))];
    const folderIds = [...new Set([...folderShares.map((s) => s.folderId), ...links.map((l) => l.folderId)].filter(Boolean))];
    const [files, folders] = await Promise.all([
      fileIds.length ? db.file.findMany({ where: { id: { in: fileIds }, ownerId: actor.id, deletedAt: null }, orderBy: [{ updatedAt: 'desc' }], take: LISTING_LIMIT }) : [],
      folderIds.length ? db.folder.findMany({ where: { id: { in: folderIds }, ownerId: actor.id, deletedAt: null }, orderBy: [{ updatedAt: 'desc' }], take: LISTING_LIMIT }) : [],
    ]);
    const stars = await starredSets(actor.id, files.map((f) => f.id), folders.map((f) => f.id));
    return {
      folders: folders.map((f) => toFolderDTO(f, { actor, access: OWNER_ACCESS, owner: actor.user, starred: stars.folders.has(f.id), shared: true })),
      files: files.map((f) => toFileDTO(f, { actor, access: OWNER_ACCESS, owner: actor.user, starred: stars.files.has(f.id), shared: true })),
    };
  }

  return { listForResource, grant, update, revoke, withMe, byMe };
}
