import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSocialDb, actor } from './helpers/socialDb.js';
import { createAccessService } from '../src/services/access.logic.js';
import { createShareService } from '../src/services/shares.logic.js';
import { createShareLinkService } from '../src/services/shareLinks.logic.js';
import { createHmacTokens } from '../src/utils/hmacToken.js';

const PERMS = ['file:read', 'file:download', 'file:share', 'folder:read', 'folder:share', 'file:update', 'folder:update'];
const status = (code) => (e) => e?.statusCode === code;
const SECRET = 'x'.repeat(32);

function world() {
  let clock = new Date('2026-06-01T00:00:00Z');
  const now = () => clock;
  const db = createSocialDb({ now });
  const mk = (name, extra = {}) => db.seed('user', { name, email: `${name}@x.dev`, ...extra });
  const alice = mk('alice'); const bob = mk('bob'); const carol = mk('carol'); const sam = mk('sam', { status: 'SUSPENDED' });
  const folder = db.seed('folder', { name: 'Docs', ownerId: alice.id, path: '/f1/' });
  folder.path = `/${folder.id}/`;
  const inner = db.seed('folder', { name: 'Inner', ownerId: alice.id, parentId: folder.id, path: `${folder.path}in/` });
  inner.path = `${folder.path}${inner.id}/`;
  const file = db.seed('file', { name: 'plan.pdf', extension: 'pdf', mimeType: 'application/pdf', size: 10n, ownerId: alice.id });
  const inFolder = db.seed('file', { name: 'deep.png', extension: 'png', mimeType: 'image/png', size: 4n, ownerId: alice.id, folderId: inner.id });
  const zip = db.seed('file', { name: 'a.zip', extension: 'zip', mimeType: 'application/zip', size: 4n, ownerId: alice.id, folderId: folder.id });
  const outside = db.seed('file', { name: 'secret.pdf', extension: 'pdf', mimeType: 'application/pdf', size: 4n, ownerId: alice.id });
  for (const f of [file, inFolder, zip, outside]) {
    const v = db.seed('fileVersion', { fileId: f.id, versionNumber: 1, storageKey: `k/${f.id}`, size: f.size, mimeType: f.mimeType });
    f.currentVersionId = v.id;
  }
  const A = actor(alice.id, PERMS, 40, 'Alice'); const B = actor(bob.id, PERMS, 40, 'Bob'); const C = actor(carol.id, PERMS, 40, 'Carol');
  A.user = { id: alice.id, name: 'Alice' };
  const notes = []; const logs = [];
  const notifications = { create: async (n) => { notes.push(n); return n; } };
  const activity = { log: async (e) => { logs.push(e); } };
  const access = createAccessService({ db, now });
  const shares = createShareService({ db, access, notifications, activity, clientUrl: 'http://app', now });
  const hasher = { hash: async (p) => `h(${p})`, compare: async (p, h) => h === `h(${p})` };
  let n = 0;
  const links = createShareLinkService({
    db, access, hasher, randomToken: () => `tok${String(++n).padStart(20, '0')}`,
    unlockTokens: createHmacTokens({ secret: SECRET, purpose: 'link-unlock', now }), activity, clientUrl: 'http://app', now,
  });
  return { db, alice, bob, carol, sam, folder, inner, file, inFolder, zip, outside, A, B, C, notes, logs, shares, links, advance: (ms) => { clock = new Date(clock.getTime() + ms); } };
}

// ----------------------------------------------------------------- sharing with users
test('grant creates a share, notifies the recipient and logs it; repeating it is a no-op', async () => {
  const w = world();
  const dto = await w.shares.grant(w.A, 'FILE', w.file.id, { email: ' BOB@x.dev ', level: 'VIEWER', canDownload: false }, { ip: '1.1.1.1' });
  assert.equal(dto.user.email, 'bob@x.dev');
  assert.equal(dto.level, 'VIEWER');
  assert.equal(dto.canDownload, false);
  assert.equal(w.db.tables.fileShare.length, 1);
  assert.equal(w.notes.length, 1);
  assert.equal(w.notes[0].type, 'FILE_SHARED');
  assert.equal(w.notes[0].userId, w.bob.id);
  assert.deepEqual(w.notes[0].data, { resourceType: 'FILE', resourceId: w.file.id, actorId: w.alice.id, level: 'VIEWER' });
  assert.equal(w.logs[0].action, 'SHARE_CREATE');
  assert.equal(w.logs[0].resourceName, 'plan.pdf');

  await w.shares.grant(w.A, 'FILE', w.file.id, { email: 'bob@x.dev', level: 'VIEWER', canDownload: false });
  assert.equal(w.notes.length, 1);
  assert.equal(w.logs.length, 1);
});

test('changing the level sends PERMISSION_CHANGED; editors can always download; folders notify as FOLDER_SHARED', async () => {
  const w = world();
  await w.shares.grant(w.A, 'FOLDER', w.folder.id, { email: 'bob@x.dev', level: 'VIEWER', canDownload: false });
  assert.equal(w.notes[0].type, 'FOLDER_SHARED');
  const up = await w.shares.grant(w.A, 'FOLDER', w.folder.id, { email: 'bob@x.dev', level: 'EDITOR', canDownload: false });
  assert.equal(up.level, 'EDITOR');
  assert.equal(up.canDownload, true);
  assert.equal(w.notes[1].type, 'PERMISSION_CHANGED');
  assert.equal(w.db.tables.folderShare.length, 1);
  assert.equal(w.logs[1].action, 'SHARE_UPDATE');
});

test('only the owner can share; strangers get 404, viewers 403, missing permission 403', async () => {
  const w = world();
  await assert.rejects(w.shares.grant(w.C, 'FILE', w.file.id, { email: 'bob@x.dev', level: 'VIEWER' }), status(404));
  await w.shares.grant(w.A, 'FILE', w.file.id, { email: 'bob@x.dev', level: 'EDITOR' });
  await assert.rejects(w.shares.grant(w.B, 'FILE', w.file.id, { email: 'carol@x.dev', level: 'VIEWER' }), status(403));
  const noPerm = actor(w.alice.id, ['file:read'], 40, 'Alice');
  await assert.rejects(w.shares.grant(noPerm, 'FILE', w.file.id, { email: 'carol@x.dev', level: 'VIEWER' }), status(403));
  await assert.rejects(w.shares.grant(w.A, 'FILE', 'not-a-uuid', { email: 'carol@x.dev', level: 'VIEWER' }), status(404));
});

test('recipient must be an active user other than the owner', async () => {
  const w = world();
  await assert.rejects(w.shares.grant(w.A, 'FILE', w.file.id, { email: 'nobody@x.dev', level: 'VIEWER' }), status(404));
  await assert.rejects(w.shares.grant(w.A, 'FILE', w.file.id, { email: 'sam@x.dev', level: 'VIEWER' }), status(404));
  await assert.rejects(w.shares.grant(w.A, 'FILE', w.file.id, { email: 'alice@x.dev', level: 'VIEWER' }), status(400));
  assert.equal(w.notes.length, 0);
});

test('update and revoke notify, log and 404 for unknown shares', async () => {
  const w = world();
  await w.shares.grant(w.A, 'FILE', w.file.id, { email: 'bob@x.dev', level: 'VIEWER' });
  const up = await w.shares.update(w.A, 'FILE', w.file.id, w.bob.id, { level: 'EDITOR' });
  assert.equal(up.level, 'EDITOR');
  assert.equal(w.notes.at(-1).type, 'PERMISSION_CHANGED');
  const same = await w.shares.update(w.A, 'FILE', w.file.id, w.bob.id, { level: 'EDITOR' });
  assert.equal(same.level, 'EDITOR');
  assert.equal(w.notes.length, 2);
  await assert.rejects(w.shares.update(w.A, 'FILE', w.file.id, w.carol.id, { level: 'EDITOR' }), status(404));

  await w.shares.revoke(w.A, 'FILE', w.file.id, w.bob.id);
  assert.equal(w.db.tables.fileShare.length, 0);
  assert.equal(w.notes.at(-1).type, 'ACCESS_REVOKED');
  assert.equal(w.logs.at(-1).action, 'SHARE_REVOKE');
  await assert.rejects(w.shares.revoke(w.A, 'FILE', w.file.id, w.bob.id), status(404));
});

test('listForResource shows people and live links, only to the owner', async () => {
  const w = world();
  await w.shares.grant(w.A, 'FILE', w.file.id, { email: 'bob@x.dev', level: 'VIEWER' });
  const link = await w.links.create(w.A, 'FILE', w.file.id, {}, {});
  const list = await w.shares.listForResource(w.A, 'FILE', w.file.id);
  assert.equal(list.people.length, 1);
  assert.deepEqual(Object.keys(list.people[0].user).sort(), ['email', 'id', 'name']);
  assert.equal(list.links[0].id, link.id);
  assert.equal(list.links[0].url, `http://app/s/${link.token}`);
  await assert.rejects(w.shares.listForResource(w.B, 'FILE', w.file.id), status(403));
  await assert.rejects(w.shares.listForResource(w.C, 'FILE', w.file.id), status(404));
});

test('withMe lists direct shares with sharedBy and capabilities, skipping trashed items', async () => {
  const w = world();
  await w.shares.grant(w.A, 'FILE', w.file.id, { email: 'bob@x.dev', level: 'EDITOR' });
  await w.shares.grant(w.A, 'FILE', w.outside.id, { email: 'bob@x.dev', level: 'VIEWER' });
  await w.shares.grant(w.A, 'FOLDER', w.folder.id, { email: 'bob@x.dev', level: 'VIEWER', canDownload: false });
  w.outside.deletedAt = new Date();
  const out = await w.shares.withMe(w.B);
  assert.deepEqual(out.files.map((f) => f.name), ['plan.pdf']);
  assert.equal(out.files[0].sharedBy.name, 'alice');
  assert.equal(out.files[0].access.level, 'EDITOR');
  assert.equal(out.files[0].access.capabilities.update, true);
  assert.equal(out.files[0].shared, true);
  assert.equal(out.folders[0].access.canDownload, false);
  assert.equal(out.folders[0].access.capabilities.createChild, false);
  assert.deepEqual((await w.shares.withMe(w.C)), { folders: [], files: [] });
});

test('byMe includes items shared with people or through a live link, not revoked or expired links', async () => {
  const w = world();
  await w.shares.grant(w.A, 'FILE', w.file.id, { email: 'bob@x.dev', level: 'VIEWER' });
  const l1 = await w.links.create(w.A, 'FOLDER', w.folder.id, {});
  const l2 = await w.links.create(w.A, 'FILE', w.zip.id, { expiresAt: new Date('2026-06-02T00:00:00Z') });
  let out = await w.shares.byMe(w.A);
  assert.deepEqual(out.files.map((f) => f.name).sort(), ['a.zip', 'plan.pdf']);
  assert.deepEqual(out.folders.map((f) => f.name), ['Docs']);
  assert.equal(out.files[0].access.level, 'OWNER');
  w.advance(2 * 86400_000);
  await w.links.revoke(w.A, l1.id);
  out = await w.shares.byMe(w.A);
  assert.deepEqual(out.files.map((f) => f.name), ['plan.pdf']);
  assert.deepEqual(out.folders, []);
  void l2;
});

// ----------------------------------------------------------------- link management
test('create stores a hashed password, honours canDownload and rejects past expiry', async () => {
  const w = world();
  const dto = await w.links.create(w.A, 'FILE', w.file.id, { password: 'pw-123456', canDownload: false, expiresAt: new Date('2026-07-01T00:00:00Z') }, {});
  assert.equal(dto.hasPassword, true);
  assert.equal(dto.canDownload, false);
  assert.equal(dto.expired, false);
  assert.ok(!('passwordHash' in dto));
  assert.equal(w.db.tables.shareLink[0].passwordHash, 'h(pw-123456)');
  assert.match(dto.token, /^[A-Za-z0-9_-]{16,128}$/);
  assert.equal(w.logs.at(-1).action, 'LINK_CREATE');
  await assert.rejects(w.links.create(w.A, 'FILE', w.file.id, { expiresAt: new Date('2026-05-01T00:00:00Z') }), status(422));
  await assert.rejects(w.links.create(w.B, 'FILE', w.file.id, {}), status(404));
});

test('only the creator can update or revoke a link; password and active flags work', async () => {
  const w = world();
  const l = await w.links.create(w.A, 'FILE', w.file.id, {});
  await assert.rejects(w.links.update(w.B, l.id, { canDownload: false }), status(404));
  await assert.rejects(w.links.revoke(w.B, l.id), status(404));
  await assert.rejects(w.links.update(w.A, 'nope', {}), status(404));
  let u = await w.links.update(w.A, l.id, { password: 'abc12345', canDownload: false });
  assert.equal(u.hasPassword, true);
  u = await w.links.update(w.A, l.id, { password: null, expiresAt: null });
  assert.equal(u.hasPassword, false);
  u = await w.links.update(w.A, l.id, { active: false });
  assert.equal(u.revoked, true);
  u = await w.links.update(w.A, l.id, { active: true });
  assert.equal(u.revoked, false);
  await w.links.revoke(w.A, l.id);
  assert.ok(w.db.tables.shareLink[0].revokedAt);
});

// ----------------------------------------------------------------- public side
test('metadata for an open link counts the visit; revoked and expired links are 410, unknown 404', async () => {
  const w = world();
  const l = await w.links.create(w.A, 'FILE', w.file.id, { expiresAt: new Date('2026-06-02T00:00:00Z') });
  const meta = await w.links.metadata(l.token);
  assert.equal(meta.name, 'plan.pdf');
  assert.equal(meta.kind, 'file');
  assert.equal(meta.sharedBy, 'alice');
  assert.equal(meta.previewKind, 'pdf');
  assert.equal(meta.requiresPassword, false);
  assert.equal(w.db.tables.shareLink[0].accessCount, 1);
  w.advance(3 * 86400_000);
  await assert.rejects(w.links.metadata(l.token), status(410));
  await assert.rejects(w.links.metadata('doesnotexist0000000000'), status(404));
  const l2 = await w.links.create(w.A, 'FILE', w.file.id, {}, {});
  await w.links.revoke(w.A, l2.id);
  await assert.rejects(w.links.metadata(l2.token), status(410));
});

test('password gate: name hidden, wrong password 403, unlock token required and bound to the password', async () => {
  const w = world();
  const l = await w.links.create(w.A, 'FILE', w.file.id, { password: 'pw-123456' });
  const locked = await w.links.metadata(l.token);
  assert.deepEqual(locked.name, undefined);
  assert.equal(locked.requiresPassword, true);
  assert.equal(locked.unlocked, false);
  assert.equal(w.db.tables.shareLink[0].accessCount, 0);

  await assert.rejects(w.links.streamTarget(l.token), (e) => e.code === 'LINK_LOCKED' && e.statusCode === 403);
  await assert.rejects(w.links.unlock(l.token, 'wrong'), (e) => e.code === 'INVALID_LINK_PASSWORD' && e.statusCode === 403);
  const { accessToken } = await w.links.unlock(l.token, 'pw-123456');
  assert.equal((await w.links.metadata(l.token, accessToken)).name, 'plan.pdf');
  assert.equal((await w.links.streamTarget(l.token, accessToken)).filename, 'plan.pdf');
  await assert.rejects(w.links.streamTarget(l.token, 'garbage'), status(403));

  // token for another link does not open this one
  const other = await w.links.create(w.A, 'FILE', w.zip.id, { password: 'pw-123456' });
  await assert.rejects(w.links.streamTarget(other.token, accessToken), status(403));
  // changing the password invalidates earlier unlock tokens
  await w.links.update(w.A, l.id, { password: 'new-pw-9999' });
  await assert.rejects(w.links.streamTarget(l.token, accessToken), status(403));
  // tokens expire
  const fresh = (await w.links.unlock(l.token, 'new-pw-9999')).accessToken;
  w.advance(16 * 60_000);
  await assert.rejects(w.links.streamTarget(l.token, fresh), status(403));
});

test('streamTarget: download needs allowDownload, preview needs a previewable type, downloads are counted and logged', async () => {
  const w = world();
  const l = await w.links.create(w.A, 'FILE', w.file.id, { canDownload: false });
  await assert.rejects(w.links.streamTarget(l.token), status(403));
  const prev = await w.links.streamTarget(l.token, undefined, { preview: true });
  assert.equal(prev.disposition, 'inline');
  assert.equal(w.db.tables.shareLink[0].accessCount, 0);

  const zipLink = await w.links.create(w.A, 'FILE', w.zip.id, {});
  await assert.rejects(w.links.streamTarget(zipLink.token, undefined, { preview: true }), status(415));
  const d = await w.links.streamTarget(zipLink.token);
  assert.deepEqual([d.key, d.size, d.disposition], [`k/${w.zip.id}`, 4, 'attachment']);
  assert.equal(w.db.tables.shareLink[1].accessCount, 1);
  assert.equal(w.logs.at(-1).action, 'LINK_ACCESS');
  assert.equal(w.logs.at(-1).userId, w.alice.id);
});

test('folder links: browse descendants, stream covered files only, never escape the folder', async () => {
  const w = world();
  const l = await w.links.create(w.A, 'FOLDER', w.folder.id, {});
  const top = await w.links.browse(l.token, undefined, undefined);
  assert.equal(top.folder.name, 'Docs');
  assert.deepEqual(top.folders.map((f) => f.name), ['Inner']);
  assert.deepEqual(top.files.map((f) => f.name), ['a.zip']);
  assert.ok(!('ownerId' in top.files[0]));
  assert.deepEqual(top.breadcrumbs.map((b) => b.name), ['Docs']);

  const inner = await w.links.browse(l.token, undefined, w.inner.id);
  assert.deepEqual(inner.breadcrumbs.map((b) => b.name), ['Docs', 'Inner']);
  assert.deepEqual(inner.files.map((f) => f.name), ['deep.png']);

  assert.equal((await w.links.streamTarget(l.token, undefined, { fileId: w.inFolder.id, preview: true })).filename, 'deep.png');
  await assert.rejects(w.links.streamTarget(l.token, undefined, { fileId: w.outside.id }), status(404));
  await assert.rejects(w.links.streamTarget(l.token), status(400));
  const rootFolder = w.db.seed('folder', { name: 'Elsewhere', ownerId: w.alice.id, path: '/zzz/' });
  await assert.rejects(w.links.browse(l.token, undefined, rootFolder.id), status(404));
  w.inFolder.deletedAt = new Date();
  await assert.rejects(w.links.streamTarget(l.token, undefined, { fileId: w.inFolder.id }), status(404));

  const fileLink = await w.links.create(w.A, 'FILE', w.file.id, {});
  await assert.rejects(w.links.browse(fileLink.token), status(400));
  await assert.rejects(w.links.streamTarget(fileLink.token, undefined, { fileId: w.zip.id }), status(404));
});

test('hmac tokens reject tampering, wrong purpose and expiry', () => {
  let t = new Date('2026-01-01T00:00:00Z');
  const a = createHmacTokens({ secret: SECRET, purpose: 'a', now: () => t });
  const b = createHmacTokens({ secret: SECRET, purpose: 'b', now: () => t });
  const { token } = a.sign({ x: 1 }, 60);
  assert.equal(a.verify(token).x, 1);
  assert.equal(b.verify(token), null);
  assert.equal(a.verify(`${token}A`), null);
  assert.equal(a.verify(token.replace(/^./, (c) => (c === 'e' ? 'f' : 'e'))), null);
  assert.equal(a.verify(undefined), null);
  assert.equal(a.verify('a.b.c'), null);
  t = new Date(t.getTime() + 61_000);
  assert.equal(a.verify(token), null);
  assert.throws(() => createHmacTokens({ secret: 'short', purpose: 'a' }), TypeError);
});
