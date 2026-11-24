// Resource-level authorisation ("layer 2"). Pure logic plus an injectable database handle,
// so it can be unit-tested without PostgreSQL. services/access.service.js wires in Prisma.
//
// Two layers must BOTH allow an action:
//   1. Global RBAC   - does the actor's role include the permission key (e.g. "file:update")?
//   2. Resource ACL  - is the actor the owner, or has the resource (or an ancestor folder)
//                      been shared with them, and with which role?
// The effective right is the more restrictive of the two: a global Viewer who is given
// Editor on a share still cannot edit.
//
// OWNERSHIP INVARIANT: everything created inside a folder is owned by that folder's owner
// (the uploader is recorded on FileVersion.uploadedById). So "owner of the resource" is
// enough to cover content that shared Editors add to a folder. Cross-owner moves are not
// allowed (enforced in the file/folder services); cross-owner copies create new content.
//
// Existence is not leaked: a resource the actor cannot see at all is reported as 404, and
// 403 is only used when the actor can see it but lacks the right for this action.

import ApiError from '../utils/ApiError.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

export const LEVEL_RANK = Object.freeze({ NONE: 0, VIEWER: 1, EDITOR: 2, OWNER: 3 });
const atLeast = (level, min) => LEVEL_RANK[level] >= LEVEL_RANK[min];

/**
 * action -> minimum resource level, plus the global permission required per resource type.
 * A resource type missing from `permission` means the action does not apply to it.
 * `null` means "no global permission check" (the route middleware already requires one).
 */
export const ACTIONS = Object.freeze({
  read: { min: 'VIEWER', permission: { FILE: 'file:read', FOLDER: 'folder:read' } },
  download: { min: 'VIEWER', needsDownload: true, permission: { FILE: 'file:download', FOLDER: 'file:download' } },
  update: { min: 'EDITOR', permission: { FILE: 'file:update', FOLDER: 'folder:update' } },
  version: { min: 'EDITOR', permission: { FILE: 'version:create' } },
  createChild: { min: 'EDITOR', permission: { FOLDER: null } },
  delete: { min: 'OWNER', permission: { FILE: 'file:delete', FOLDER: 'folder:delete' } },
  share: { min: 'OWNER', permission: { FILE: 'file:share', FOLDER: 'folder:share' } },
});

const OWNER_ACCESS = Object.freeze({ level: 'OWNER', canDownload: true, source: 'owner' });
const NO_ACCESS = Object.freeze({ level: 'NONE', canDownload: false, source: 'none' });

/** "/<rootId>/<childId>/" -> ['rootId', 'childId'] (includes the folder itself). */
export function ancestorIds(path) {
  return String(path ?? '').split('/').filter(Boolean);
}

/**
 * Merge several share grants into one: highest role wins, and downloading is allowed when
 * any grant allows it. Editors can always download.
 * @param {Array<{role: 'VIEWER'|'EDITOR', canDownload: boolean}>} grants
 */
export function combineGrants(grants) {
  let level = 'NONE';
  let canDownload = false;
  for (const g of grants) {
    const candidate = g.role === 'EDITOR' ? 'EDITOR' : 'VIEWER';
    if (LEVEL_RANK[candidate] > LEVEL_RANK[level]) level = candidate;
    if (g.canDownload) canDownload = true;
  }
  if (level === 'EDITOR') canDownload = true;
  return { level, canDownload };
}

function assertActor(actor) {
  if (!actor || typeof actor.id !== 'string' || !(actor.permissions instanceof Set)) {
    // Fail closed: forgetting to load permissions must never silently widen access.
    throw new TypeError('actor must be { id: string, permissions: Set<string> }');
  }
}

const LABEL = { FILE: 'file', FOLDER: 'folder' };

/**
 * Checks `action` against an already-resolved access result. Returns the access on success.
 * @throws ApiError 404 (not visible), 403 (visible but not allowed)
 */
export function authorize(actor, type, access, action) {
  assertActor(actor);
  const def = ACTIONS[action];
  if (!def) throw new TypeError(`Unknown access action: ${action}`);
  if (!(type in def.permission)) throw new TypeError(`Action "${action}" does not apply to ${type}`);

  const label = LABEL[type];
  if (access.level === 'NONE') throw ApiError.notFound(`${label[0].toUpperCase()}${label.slice(1)} not found`);

  if (!atLeast(access.level, def.min)) {
    const who = def.min === 'OWNER' ? 'the owner' : `${def.min.toLowerCase()} access`;
    throw ApiError.forbidden(`You need ${who} to ${action} this ${label}`);
  }
  if (def.needsDownload && !access.canDownload) {
    throw ApiError.forbidden('Downloading is disabled for this item');
  }
  const permission = def.permission[type];
  if (permission && !actor.permissions.has(permission)) {
    throw ApiError.forbidden('Your role does not allow this action');
  }
  return access;
}

/** Boolean flags for the UI (hide/disable buttons). The backend still enforces everything. */
export function capabilitiesFor(actor, type, access) {
  const out = {};
  for (const action of Object.keys(ACTIONS)) {
    if (!(type in ACTIONS[action].permission)) continue;
    try {
      authorize(actor, type, access, action);
      out[action] = true;
    } catch {
      out[action] = false;
    }
  }
  return out;
}

/** True when a resolved folder link grants access to `folder` (the linked folder or a descendant). */
export function linkCoversFolder(resolved, folder) {
  if (resolved.link.resourceType !== 'FOLDER' || folder.deletedAt) return false;
  return String(folder.path).startsWith(resolved.target.path);
}

/** True when a resolved link grants access to `file` (the linked file, or a file inside the linked folder). */
export function linkCoversFile(resolved, file) {
  if (file.deletedAt) return false;
  if (resolved.link.resourceType === 'FILE') return resolved.target.id === file.id;
  return Boolean(file.folder?.path) && String(file.folder.path).startsWith(resolved.target.path);
}

/**
 * @param {{ db: object, now?: () => Date }} deps  db is a Prisma client (or a test double)
 */
export function createAccessService({ db, now = () => new Date() }) {
  const fileSelect = {
    id: true, name: true, ownerId: true, folderId: true, deletedAt: true,
    mimeType: true, size: true, folder: { select: { path: true } },
  };
  const folderSelect = { id: true, name: true, ownerId: true, parentId: true, path: true, deletedAt: true };

  async function loadFile(id) {
    if (!isUuid(id)) return null; // a malformed id must be a 404, not a database error
    return db.file.findUnique({ where: { id }, select: fileSelect });
  }

  async function loadFolder(id) {
    if (!isUuid(id)) return null;
    return db.folder.findUnique({ where: { id }, select: folderSelect });
  }

  /** @returns {Promise<{level, canDownload, source}>} for an already-loaded file record */
  async function resolveFileAccess(actor, file) {
    assertActor(actor);
    if (file.ownerId === actor.id) return OWNER_ACCESS;
    if (file.deletedAt) return NO_ACCESS; // the trash is owner-only

    const folderIds = file.folder ? ancestorIds(file.folder.path) : [];
    const [direct, inherited] = await Promise.all([
      db.fileShare.findUnique({
        where: { fileId_sharedWithId: { fileId: file.id, sharedWithId: actor.id } },
        select: { role: true, canDownload: true },
      }),
      folderIds.length
        ? db.folderShare.findMany({
            where: { sharedWithId: actor.id, folderId: { in: folderIds } },
            select: { role: true, canDownload: true },
          })
        : Promise.resolve([]),
    ]);

    const grants = [...(direct ? [direct] : []), ...inherited];
    const combined = combineGrants(grants);
    if (combined.level === 'NONE') return NO_ACCESS;

    const directLevel = direct ? combineGrants([direct]).level : 'NONE';
    const folderLevel = combineGrants(inherited).level;
    const source = LEVEL_RANK[directLevel] >= LEVEL_RANK[folderLevel] ? 'file-share' : 'folder-share';
    return { ...combined, source };
  }

  /** @returns {Promise<{level, canDownload, source}>} for an already-loaded folder record */
  async function resolveFolderAccess(actor, folder) {
    assertActor(actor);
    if (folder.ownerId === actor.id) return OWNER_ACCESS;
    if (folder.deletedAt) return NO_ACCESS;

    // folder.path includes the folder's own id, so a share on the folder itself counts too.
    const inherited = await db.folderShare.findMany({
      where: { sharedWithId: actor.id, folderId: { in: ancestorIds(folder.path) } },
      select: { role: true, canDownload: true },
    });
    const combined = combineGrants(inherited);
    if (combined.level === 'NONE') return NO_ACCESS;
    return { ...combined, source: 'folder-share' };
  }

  /**
   * Load a file and enforce `action` in one call.
   * @param {{ allowTrashed?: boolean }} [opts] trash endpoints pass true (still owner-only)
   * @returns {Promise<{ file, access }>}
   */
  async function requireFileAccess(actor, fileId, action, { allowTrashed = false } = {}) {
    const file = await loadFile(fileId);
    if (!file || (file.deletedAt && !allowTrashed)) throw ApiError.notFound('File not found');
    const access = await resolveFileAccess(actor, file);
    authorize(actor, 'FILE', access, action);
    return { file, access };
  }

  async function requireFolderAccess(actor, folderId, action, { allowTrashed = false } = {}) {
    const folder = await loadFolder(folderId);
    if (!folder || (folder.deletedAt && !allowTrashed)) throw ApiError.notFound('Folder not found');
    const access = await resolveFolderAccess(actor, folder);
    authorize(actor, 'FOLDER', access, action);
    return { folder, access };
  }

  /**
   * Validate a public share-link token (no user involved). Links are view/download only.
   * 404 for unknown tokens; 410 for revoked, expired, deleted-target or disabled-creator links.
   */
  async function resolveShareLink(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
      throw ApiError.notFound('Link not found');
    }
    const link = await db.shareLink.findUnique({
      where: { token },
      include: {
        file: { select: fileSelect },
        folder: { select: folderSelect },
        createdBy: { select: { status: true } },
      },
    });
    if (!link) throw ApiError.notFound('Link not found');
    if (link.revokedAt) throw ApiError.gone('This link has been revoked');
    if (link.expiresAt && link.expiresAt <= now()) throw ApiError.gone('This link has expired');

    const target = link.resourceType === 'FILE' ? link.file : link.folder;
    if (!target || target.deletedAt) throw ApiError.gone('The shared item is no longer available');
    if (link.createdBy.status !== 'ACTIVE') throw ApiError.gone('This link is no longer available');

    return {
      link,
      target,
      resourceType: link.resourceType,
      level: 'VIEWER',
      canDownload: link.allowDownload,
    };
  }

  return {
    loadFile,
    loadFolder,
    resolveFileAccess,
    resolveFolderAccess,
    requireFileAccess,
    requireFolderAccess,
    resolveShareLink,
    authorize,
    capabilitiesFor,
    linkCoversFile,
    linkCoversFolder,
  };
}
