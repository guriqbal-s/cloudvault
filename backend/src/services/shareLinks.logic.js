// Share links: owner-side management (create / update / revoke) and the public, unauthenticated
// side (metadata, password unlock, folder browsing, streaming descriptors).
//
// Storage note: the link token is kept in plain form (ShareLink.token, looked up by
// access.resolveShareLink and the seed) so owners can copy the URL again from the share dialog.
// It is a 192-bit random value, never logged, and only ever returned to the link's creator.
// Password protection: bcrypt hash in ShareLink.passwordHash; a correct password yields a
// 15-minute unlock token bound to the link AND to the current password hash (changing the
// password invalidates every old unlock token).

import crypto from 'node:crypto';
import ApiError from '../utils/ApiError.js';
import { ancestorIds, isUuid, linkCoversFile, linkCoversFolder } from './access.logic.js';
import { linkDTO } from './shares.logic.js';
import { fileCategory, previewKind } from '../utils/fileTypes.js';

const UNLOCK_TTL_SECONDS = 15 * 60;
const pwTag = (hash) => (hash ? crypto.createHash('sha256').update(hash).digest('hex').slice(0, 16) : '');

/**
 * @param {{ db, access, hasher: {hash, compare}, randomToken: (bytes?: number) => string,
 *           unlockTokens: ReturnType<import('../utils/hmacToken.js').createHmacTokens>,
 *           activity, clientUrl?: string, now?: () => Date }} deps
 */
export function createShareLinkService({ db, access, hasher, randomToken, unlockTokens, activity, clientUrl, now = () => new Date() }) {
  const dto = (link) => linkDTO(link, { clientUrl, now: now() });

  // ------------------------------------------------------------------ owner side
  async function create(actor, type, id, { expiresAt, password, canDownload }, meta) {
    const resource = type === 'FILE'
      ? (await access.requireFileAccess(actor, id, 'share')).file
      : (await access.requireFolderAccess(actor, id, 'share')).folder;
    if (expiresAt && new Date(expiresAt) <= now()) throw ApiError.validation('Expiry must be in the future', [{ in: 'body', path: 'expiresAt', message: 'Expiry must be in the future' }]);

    const link = await db.shareLink.create({
      data: {
        token: randomToken(24),
        resourceType: type,
        ...(type === 'FILE' ? { fileId: resource.id } : { folderId: resource.id }),
        createdById: actor.id,
        allowDownload: canDownload ?? true,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        passwordHash: password ? await hasher.hash(password) : null,
      },
    });
    await activity.log({
      userId: actor.id, action: 'LINK_CREATE', description: `Created a share link for “${resource.name}”`,
      resourceType: type, resourceId: resource.id, resourceName: resource.name,
      metadata: { linkId: link.id, expiresAt: link.expiresAt, passwordProtected: Boolean(link.passwordHash) }, meta,
    });
    return dto(link);
  }

  /** The link must have been created by the actor (and still point at something they own). */
  async function ownLink(actor, linkId) {
    const link = isUuid(linkId) ? await db.shareLink.findUnique({ where: { id: linkId } }) : null;
    if (!link || link.createdById !== actor.id) throw ApiError.notFound('Link not found');
    return link;
  }

  async function update(actor, linkId, patch, meta) {
    const link = await ownLink(actor, linkId);
    const data = {};
    if (patch.expiresAt !== undefined) {
      if (patch.expiresAt !== null && new Date(patch.expiresAt) <= now()) throw ApiError.validation('Expiry must be in the future', [{ in: 'body', path: 'expiresAt', message: 'Expiry must be in the future' }]);
      data.expiresAt = patch.expiresAt === null ? null : new Date(patch.expiresAt);
    }
    if (patch.password !== undefined) data.passwordHash = patch.password === null ? null : await hasher.hash(patch.password);
    if (patch.canDownload !== undefined) data.allowDownload = patch.canDownload;
    if (patch.active !== undefined) data.revokedAt = patch.active ? null : (link.revokedAt ?? now());
    if (!Object.keys(data).length) return dto(link);

    const row = await db.shareLink.update({ where: { id: link.id }, data });
    await activity.log({
      userId: actor.id, action: patch.active === false ? 'LINK_REVOKE' : 'SHARE_UPDATE',
      description: patch.active === false ? 'Revoked a share link' : 'Updated a share link',
      resourceType: link.resourceType, resourceId: link.fileId ?? link.folderId, metadata: { linkId: link.id, fields: Object.keys(data) }, meta,
    });
    return dto(row);
  }

  async function revoke(actor, linkId, meta) {
    const link = await ownLink(actor, linkId);
    if (!link.revokedAt) {
      await db.shareLink.update({ where: { id: link.id }, data: { revokedAt: now() } });
      await activity.log({
        userId: actor.id, action: 'LINK_REVOKE', description: 'Revoked a share link',
        resourceType: link.resourceType, resourceId: link.fileId ?? link.folderId, metadata: { linkId: link.id }, meta,
      });
    }
    return { revoked: true };
  }

  // ------------------------------------------------------------------ public side
  function isUnlocked(link, at) {
    if (!link.passwordHash) return true;
    const claims = unlockTokens.verify(at);
    return Boolean(claims && claims.lid === link.id && claims.ph === pwTag(link.passwordHash));
  }

  /** Resolve + enforce the password gate. */
  async function open(token, at) {
    const resolved = await access.resolveShareLink(token);
    if (!isUnlocked(resolved.link, at)) {
      throw new ApiError(403, 'LINK_LOCKED', 'This link is password protected');
    }
    return resolved;
  }

  async function touch(link) {
    await db.shareLink.update({ where: { id: link.id }, data: { accessCount: { increment: 1 }, lastAccessedAt: now() } });
  }

  async function metadata(token, at) {
    const resolved = await access.resolveShareLink(token);
    const { link, target } = resolved;
    const requiresPassword = Boolean(link.passwordHash);
    const unlocked = isUnlocked(link, at);
    const out = {
      kind: link.resourceType === 'FILE' ? 'file' : 'folder',
      requiresPassword,
      unlocked,
      canDownload: link.allowDownload,
      expiresAt: link.expiresAt ?? null,
    };
    if (!unlocked) return out; // name and size stay hidden until the password is entered
    await touch(link);
    out.name = target.name;
    if (link.resourceType === 'FILE') {
      const ext = String(target.name).includes('.') ? String(target.name).split('.').pop().toLowerCase() : '';
      Object.assign(out, { size: target.size, mimeType: target.mimeType, extension: ext, category: fileCategory(ext), previewKind: previewKind(ext) });
    }
    const sharer = await db.user.findUnique({ where: { id: link.createdById }, select: { name: true } });
    out.sharedBy = sharer?.name ?? null;
    return out;
  }

  async function unlock(token, password) {
    const { link } = await access.resolveShareLink(token);
    if (link.passwordHash && !(await hasher.compare(String(password), link.passwordHash))) {
      throw new ApiError(403, 'INVALID_LINK_PASSWORD', 'Incorrect password');
    }
    const { token: accessToken, expiresAt } = unlockTokens.sign({ lid: link.id, ph: pwTag(link.passwordHash) }, UNLOCK_TTL_SECONDS);
    return { accessToken, expiresAt };
  }

  /** Folder links only: contents of the linked folder or one of its descendants. */
  async function browse(token, at, folderId) {
    const resolved = await open(token, at);
    if (resolved.resourceType !== 'FOLDER') throw ApiError.badRequest('This link points to a single file');
    const folder = folderId ? await access.loadFolder(folderId) : resolved.target;
    if (!folder || !linkCoversFolder(resolved, folder)) throw ApiError.notFound('Folder not found');

    const [folders, files] = await Promise.all([
      db.folder.findMany({ where: { parentId: folder.id, deletedAt: null }, orderBy: [{ name: 'asc' }] }),
      db.file.findMany({ where: { folderId: folder.id, deletedAt: null }, orderBy: [{ name: 'asc' }] }),
    ]);
    const chain = ancestorIds(folder.path);
    const from = chain.indexOf(resolved.target.id);
    const crumbIds = chain.slice(from < 0 ? 0 : from);
    const crumbRows = crumbIds.length ? await db.folder.findMany({ where: { id: { in: crumbIds } }, select: { id: true, name: true } }) : [];
    const byId = new Map(crumbRows.map((r) => [r.id, r.name]));
    return {
      folder: { id: folder.id, name: folder.name },
      breadcrumbs: crumbIds.map((id) => ({ id, name: byId.get(id) ?? '' })),
      canDownload: resolved.canDownload,
      folders: folders.map((f) => ({ id: f.id, name: f.name, updatedAt: f.updatedAt })),
      files: files.map((f) => ({ id: f.id, name: f.name, extension: f.extension, category: fileCategory(f.extension), previewKind: previewKind(f.extension), size: f.size, updatedAt: f.updatedAt })),
    };
  }

  /**
   * Descriptor for the controller to stream.
   * @param {{ fileId?: string, preview?: boolean }} opts fileId is required for folder links
   */
  async function streamTarget(token, at, { fileId, preview = false } = {}) {
    const resolved = await open(token, at);
    let file;
    if (resolved.resourceType === 'FILE') {
      file = resolved.target;
      if (fileId && fileId !== file.id) throw ApiError.notFound('File not found');
    } else {
      if (!fileId) throw ApiError.badRequest('Choose a file inside the shared folder');
      file = await access.loadFile(fileId);
      if (!file || !linkCoversFile(resolved, file)) throw ApiError.notFound('File not found');
    }
    if (!preview && !resolved.canDownload) throw ApiError.forbidden('Downloading is disabled for this link');
    const ext = String(file.name).includes('.') ? String(file.name).split('.').pop().toLowerCase() : '';
    if (preview && !previewKind(ext)) throw new ApiError(415, 'NOT_PREVIEWABLE', 'This file type cannot be previewed');

    const head = await db.file.findUnique({ where: { id: file.id }, select: { currentVersionId: true } });
    const version = head?.currentVersionId
      ? await db.fileVersion.findUnique({ where: { id: head.currentVersionId }, select: { storageKey: true, size: true, mimeType: true } })
      : await db.fileVersion.findFirst({ where: { fileId: file.id }, orderBy: [{ versionNumber: 'desc' }], select: { storageKey: true, size: true, mimeType: true } });
    if (!version) throw ApiError.notFound('File not found');

    if (!preview) {
      await touch(resolved.link);
      await activity.log({
        userId: resolved.link.createdById, action: 'LINK_ACCESS', description: `Someone downloaded “${file.name}” through a share link`,
        resourceType: 'FILE', resourceId: file.id, resourceName: file.name, metadata: { linkId: resolved.link.id },
      });
    }
    return { key: version.storageKey, size: Number(version.size), filename: file.name, mimeType: version.mimeType ?? file.mimeType, disposition: preview ? 'inline' : 'attachment' };
  }

  return { create, update, revoke, metadata, unlock, browse, streamTarget };
}
