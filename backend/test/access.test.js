import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccessService, combineGrants, capabilitiesFor, authorize, ancestorIds, isUuid,
} from '../src/services/access.logic.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = id(1), B = id(2), C = id(3), D = id(4);
const ROOT = id(10), CHILD = id(11), OTHER = id(12);
const F_DEEP = id(20), F_TOP = id(21), F_OTHER = id(22), F_TRASH = id(23);

const ALL_PERMS = [
  'file:read', 'file:download', 'file:update', 'file:delete', 'file:share',
  'folder:read', 'folder:update', 'folder:delete', 'folder:share', 'version:create',
];
const actor = (userId, perms = ALL_PERMS) => ({ id: userId, permissions: new Set(perms) });

function world(extra = {}) {
  const folders = [
    { id: ROOT, name: 'Root', ownerId: OWNER, parentId: null, path: `/${ROOT}/`, deletedAt: null },
    { id: CHILD, name: 'Child', ownerId: OWNER, parentId: ROOT, path: `/${ROOT}/${CHILD}/`, deletedAt: null },
    { id: OTHER, name: 'Other', ownerId: OWNER, parentId: null, path: `/${OTHER}/`, deletedAt: null },
  ];
  const files = [
    { id: F_DEEP, name: 'deep.pdf', ownerId: OWNER, folderId: CHILD, deletedAt: null },
    { id: F_TOP, name: 'top.pdf', ownerId: OWNER, folderId: null, deletedAt: null },
    { id: F_OTHER, name: 'other.pdf', ownerId: OWNER, folderId: OTHER, deletedAt: null },
    { id: F_TRASH, name: 'trash.pdf', ownerId: OWNER, folderId: null, deletedAt: new Date('2026-01-01') },
  ];
  const state = {
    folders, files,
    fileShares: [{ fileId: F_TOP, sharedWithId: C, role: 'EDITOR', canDownload: true }],
    folderShares: [{ folderId: ROOT, sharedWithId: B, role: 'VIEWER', canDownload: false }],
    links: [],
    ...extra,
  };
  let calls = 0;
  const db = {
    file: {
      findUnique: async ({ where: { id: i } }) => {
        calls++;
        const f = state.files.find((x) => x.id === i);
        if (!f) return null;
        const folder = state.folders.find((x) => x.id === f.folderId);
        return { ...f, folder: folder ? { path: folder.path } : null };
      },
    },
    folder: { findUnique: async ({ where: { id: i } }) => { calls++; return state.folders.find((x) => x.id === i) ?? null; } },
    fileShare: {
      findUnique: async ({ where: { fileId_sharedWithId: k } }) =>
        state.fileShares.find((s) => s.fileId === k.fileId && s.sharedWithId === k.sharedWithId) ?? null,
    },
    folderShare: {
      findMany: async ({ where }) =>
        state.folderShares.filter((s) => s.sharedWithId === where.sharedWithId && where.folderId.in.includes(s.folderId)),
    },
    shareLink: {
      findUnique: async ({ where: { token } }) => {
        const l = state.links.find((x) => x.token === token);
        if (!l) return null;
        return {
          ...l,
          file: state.files.find((f) => f.id === l.fileId) ? { ...state.files.find((f) => f.id === l.fileId), folder: null } : null,
          folder: state.folders.find((f) => f.id === l.folderId) ?? null,
          createdBy: { status: l.creatorStatus ?? 'ACTIVE' },
        };
      },
    },
  };
  return { db, state, svc: createAccessService({ db, now: () => new Date('2026-06-01T00:00:00Z') }), calls: () => calls };
}

const status = (code) => (e) => e.statusCode === code;

test('helpers: ancestorIds, isUuid, combineGrants', () => {
  assert.deepEqual(ancestorIds('/a/b/c/'), ['a', 'b', 'c']);
  assert.deepEqual(ancestorIds(null), []);
  assert.equal(isUuid(id(1)), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid("' OR 1=1 --"), false);
  assert.deepEqual(combineGrants([]), { level: 'NONE', canDownload: false });
  assert.deepEqual(combineGrants([{ role: 'VIEWER', canDownload: false }]), { level: 'VIEWER', canDownload: false });
  assert.deepEqual(
    combineGrants([{ role: 'VIEWER', canDownload: false }, { role: 'VIEWER', canDownload: true }]),
    { level: 'VIEWER', canDownload: true }
  );
  // editors can always download, even if the flag says otherwise
  assert.deepEqual(combineGrants([{ role: 'EDITOR', canDownload: false }]), { level: 'EDITOR', canDownload: true });
  assert.equal(combineGrants([{ role: 'VIEWER', canDownload: true }, { role: 'EDITOR', canDownload: false }]).level, 'EDITOR');
});

test('owner has every right on their own file and folder', async () => {
  const { svc } = world();
  for (const action of ['read', 'download', 'update', 'version', 'delete', 'share']) {
    const { access } = await svc.requireFileAccess(actor(OWNER), F_DEEP, action);
    assert.equal(access.level, 'OWNER');
  }
  for (const action of ['read', 'update', 'createChild', 'delete', 'share']) {
    await svc.requireFolderAccess(actor(OWNER), CHILD, action);
  }
});

test('a folder share is inherited by files in nested sub-folders', async () => {
  const { svc } = world();
  const { access } = await svc.requireFileAccess(actor(B), F_DEEP, 'read');
  assert.deepEqual({ level: access.level, dl: access.canDownload, src: access.source }, { level: 'VIEWER', dl: false, src: 'folder-share' });
  await svc.requireFolderAccess(actor(B), CHILD, 'read'); // sub-folder
  await svc.requireFolderAccess(actor(B), ROOT, 'read'); // the shared folder itself
});

test('viewer cannot edit, version, delete or share, and download follows canDownload', async () => {
  const { svc } = world();
  for (const action of ['update', 'version', 'delete', 'share']) {
    await assert.rejects(svc.requireFileAccess(actor(B), F_DEEP, action), status(403), action);
  }
  await assert.rejects(svc.requireFileAccess(actor(B), F_DEEP, 'download'), (e) => e.statusCode === 403 && /Downloading is disabled/.test(e.message));
  await assert.rejects(svc.requireFolderAccess(actor(B), CHILD, 'createChild'), status(403));
});

test('a share does not leak sideways: sibling folders and top-level files are invisible (404, not 403)', async () => {
  const { svc } = world();
  await assert.rejects(svc.requireFileAccess(actor(B), F_OTHER, 'read'), status(404));
  await assert.rejects(svc.requireFileAccess(actor(B), F_TOP, 'read'), status(404));
  await assert.rejects(svc.requireFolderAccess(actor(B), OTHER, 'read'), status(404));
});

test('a stranger gets 404 for existing and missing resources alike', async () => {
  const { svc } = world();
  await assert.rejects(svc.requireFileAccess(actor(D), F_DEEP, 'read'), (e) => e.statusCode === 404 && e.message === 'File not found');
  await assert.rejects(svc.requireFileAccess(actor(D), id(999), 'read'), (e) => e.statusCode === 404 && e.message === 'File not found');
});

test('direct editor share: may update and add versions, may not delete or re-share', async () => {
  const { svc } = world();
  for (const action of ['read', 'download', 'update', 'version']) await svc.requireFileAccess(actor(C), F_TOP, action);
  for (const action of ['delete', 'share']) await assert.rejects(svc.requireFileAccess(actor(C), F_TOP, action), status(403), action);
});

test('global RBAC caps the share: an Editor share does not help a role without the permission', async () => {
  const { svc } = world();
  const limited = actor(C, ['file:read', 'file:download']); // e.g. the Viewer role
  await svc.requireFileAccess(limited, F_TOP, 'read');
  await assert.rejects(svc.requireFileAccess(limited, F_TOP, 'update'), (e) => e.statusCode === 403 && /role/.test(e.message));
  await assert.rejects(svc.requireFileAccess(limited, F_TOP, 'version'), status(403));
});

test('RBAC also applies to owners (a Viewer-role user cannot modify even their own files)', async () => {
  const { svc } = world();
  const viewerRole = actor(OWNER, ['file:read', 'file:download', 'folder:read']);
  await svc.requireFileAccess(viewerRole, F_DEEP, 'read');
  await assert.rejects(svc.requireFileAccess(viewerRole, F_DEEP, 'delete'), status(403));
  await assert.rejects(svc.requireFileAccess(viewerRole, F_DEEP, 'update'), status(403));
});

test('multiple grants: the highest role wins, and downloading is the union', async () => {
  const { svc } = world({
    fileShares: [{ fileId: F_DEEP, sharedWithId: B, role: 'EDITOR', canDownload: false }],
  });
  const { access } = await svc.requireFileAccess(actor(B), F_DEEP, 'update');
  assert.equal(access.level, 'EDITOR');
  assert.equal(access.canDownload, true);
  assert.equal(access.source, 'file-share');
});

test('a more permissive folder share applies when the file share is weaker', async () => {
  const { svc } = world({
    fileShares: [{ fileId: F_DEEP, sharedWithId: B, role: 'VIEWER', canDownload: false }],
    folderShares: [{ folderId: ROOT, sharedWithId: B, role: 'EDITOR', canDownload: true }],
  });
  const { access } = await svc.requireFileAccess(actor(B), F_DEEP, 'update');
  assert.equal(access.level, 'EDITOR');
  assert.equal(access.source, 'folder-share');
});

test('trash is owner-only', async () => {
  const { svc } = world({
    fileShares: [{ fileId: F_TRASH, sharedWithId: C, role: 'EDITOR', canDownload: true }],
  });
  await assert.rejects(svc.requireFileAccess(actor(OWNER), F_TRASH, 'read'), status(404)); // normal endpoints hide it
  const { access } = await svc.requireFileAccess(actor(OWNER), F_TRASH, 'delete', { allowTrashed: true });
  assert.equal(access.level, 'OWNER');
  await assert.rejects(svc.requireFileAccess(actor(C), F_TRASH, 'read', { allowTrashed: true }), status(404));
});

test('a trashed folder removes a recipient\'s access', async () => {
  const { svc, state } = world();
  state.folders.find((f) => f.id === ROOT).deletedAt = new Date();
  await assert.rejects(svc.requireFolderAccess(actor(B), ROOT, 'read'), status(404));
  await svc.requireFolderAccess(actor(OWNER), ROOT, 'delete', { allowTrashed: true });
});

test('malformed ids are 404 and never reach the database', async () => {
  const { svc, calls } = world();
  for (const bad of ['abc', "' OR 1=1 --", '', undefined, null, 42, id(1) + 'x']) {
    await assert.rejects(svc.requireFileAccess(actor(OWNER), bad, 'read'), status(404));
    await assert.rejects(svc.requireFolderAccess(actor(OWNER), bad, 'read'), status(404));
  }
  assert.equal(calls(), 0);
});

test('fails closed when the actor has no permission Set', async () => {
  const { svc } = world();
  await assert.rejects(svc.requireFileAccess({ id: OWNER }, F_DEEP, 'read'), TypeError);
  await assert.rejects(svc.requireFileAccess({ id: OWNER, permissions: ['file:read'] }, F_DEEP, 'read'), TypeError);
  await assert.rejects(svc.requireFileAccess(null, F_DEEP, 'read'), TypeError);
});

test('programmer errors: unknown action, action that does not apply to the type', async () => {
  const { svc } = world();
  await assert.rejects(svc.requireFileAccess(actor(OWNER), F_DEEP, 'explode'), TypeError);
  await assert.rejects(svc.requireFileAccess(actor(OWNER), F_DEEP, 'createChild'), TypeError);
  await assert.rejects(svc.requireFolderAccess(actor(OWNER), ROOT, 'version'), TypeError);
});

test('capabilitiesFor reports what the UI may show', () => {
  const viewer = { level: 'VIEWER', canDownload: true, source: 'folder-share' };
  assert.deepEqual(capabilitiesFor(actor(B), 'FILE', viewer), {
    read: true, download: true, update: false, version: false, delete: false, share: false,
  });
  const owner = { level: 'OWNER', canDownload: true, source: 'owner' };
  assert.deepEqual(capabilitiesFor(actor(OWNER), 'FOLDER', owner), {
    read: true, download: true, update: true, createChild: true, delete: true, share: true,
  });
  assert.throws(() => authorize(actor(B), 'FILE', { level: 'NONE', canDownload: false }, 'read'), (e) => e.statusCode === 404);
});

// ---------------------------------------------------------------- share links

const TOKEN = 'T'.repeat(43);
const link = (over = {}) => ({
  token: TOKEN, resourceType: 'FILE', fileId: F_TOP, folderId: null,
  allowDownload: true, expiresAt: null, revokedAt: null, ...over,
});

test('a valid file link resolves as view-only', async () => {
  const { svc } = world({ links: [link()] });
  const r = await svc.resolveShareLink(TOKEN);
  assert.equal(r.level, 'VIEWER');
  assert.equal(r.canDownload, true);
  assert.equal(r.target.id, F_TOP);
});

test('links honour allowDownload=false', async () => {
  const { svc } = world({ links: [link({ allowDownload: false })] });
  assert.equal((await svc.resolveShareLink(TOKEN)).canDownload, false);
});

test('unknown or malformed tokens are 404', async () => {
  const { svc } = world({ links: [link()] });
  for (const bad of ['nope'.repeat(10), 'short', '', null, undefined, 'a'.repeat(200), `${TOKEN}'`, 'has space '.repeat(4)]) {
    await assert.rejects(svc.resolveShareLink(bad), status(404), String(bad));
  }
});

test('revoked, expired, trashed-target and disabled-creator links are 410', async () => {
  const cases = [
    link({ revokedAt: new Date('2026-05-01') }),
    link({ expiresAt: new Date('2026-05-31T23:59:59Z') }),
    link({ expiresAt: new Date('2026-06-01T00:00:00Z') }), // expires exactly now: already invalid
    link({ fileId: F_TRASH }),
    link({ creatorStatus: 'SUSPENDED' }),
  ];
  for (const l of cases) {
    const { svc } = world({ links: [l] });
    await assert.rejects(svc.resolveShareLink(TOKEN), status(410));
  }
  const { svc } = world({ links: [link({ expiresAt: new Date('2026-06-01T00:00:01Z') })] });
  await svc.resolveShareLink(TOKEN); // not yet expired
});

test('a folder link covers its descendants only (including a prefix look-alike trap)', async () => {
  const { svc, state } = world({ links: [link({ resourceType: 'FOLDER', fileId: null, folderId: ROOT })] });
  const resolved = await svc.resolveShareLink(TOKEN);
  assert.equal(resolved.target.id, ROOT);

  const deep = await svc.loadFile(F_DEEP);
  const other = await svc.loadFile(F_OTHER);
  const top = await svc.loadFile(F_TOP);
  assert.equal(svc.linkCoversFile(resolved, deep), true);
  assert.equal(svc.linkCoversFile(resolved, other), false);
  assert.equal(svc.linkCoversFile(resolved, top), false);
  assert.equal(svc.linkCoversFile(resolved, { ...deep, deletedAt: new Date() }), false);

  assert.equal(svc.linkCoversFolder(resolved, await svc.loadFolder(CHILD)), true);
  assert.equal(svc.linkCoversFolder(resolved, await svc.loadFolder(ROOT)), true);
  assert.equal(svc.linkCoversFolder(resolved, await svc.loadFolder(OTHER)), false);

  // "/aaa/" must not cover "/aaab/..." (trailing slash in materialised paths protects this)
  const fake = { link: { resourceType: 'FOLDER' }, target: { path: '/aaa/' } };
  assert.equal(svc.linkCoversFolder(fake, { path: '/aaab/', deletedAt: null }), false);
  assert.equal(svc.linkCoversFolder(fake, { path: '/aaa/bbb/', deletedAt: null }), true);
  void state;
});

test('a file link covers only that file', async () => {
  const { svc } = world({ links: [link()] });
  const resolved = await svc.resolveShareLink(TOKEN);
  assert.equal(svc.linkCoversFile(resolved, await svc.loadFile(F_TOP)), true);
  assert.equal(svc.linkCoversFile(resolved, await svc.loadFile(F_DEEP)), false);
  assert.equal(svc.linkCoversFolder(resolved, await svc.loadFolder(ROOT)), false);
});
