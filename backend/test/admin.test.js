import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSocialDb, actor } from './helpers/socialDb.js';
import { createAdminService, roleSlug } from '../src/services/admin.logic.js';
import { createActivityQueryService } from '../src/services/activityQuery.logic.js';
import { createDashboardService, breakdownByCategory, dailySeries, percentOf } from '../src/services/dashboard.logic.js';

const status = (code, errCode) => (e) => e?.statusCode === code && (!errCode || e.code === errCode);
const ADMIN_PERMS = ['admin:access', 'admin:analytics', 'user:read', 'user:manage', 'user:assign-role', 'user:suspend', 'user:quota'];

function world() {
  const now = () => new Date('2026-06-15T12:00:00Z');
  const db = createSocialDb({ now });
  const roles = {
    super: db.seed('role', { name: 'Super Admin', rank: 100 }),
    admin: db.seed('role', { name: 'Admin', rank: 80 }),
    manager: db.seed('role', { name: 'Manager', rank: 60 }),
    std: db.seed('role', { name: 'Standard User', rank: 40 }),
  };
  const user = (name, role, extra = {}) => {
    const u = db.seed('user', { name, email: `${name}@x.dev`, passwordHash: 'secret-hash', ...extra });
    if (role) db.seed('userRole', { userId: u.id, roleId: role.id });
    return u;
  };
  const root = user('root', roles.super); const root2 = user('root2', roles.super);
  const ann = user('ann', roles.admin); const mia = user('mia', roles.manager);
  const sue = user('sue', roles.std, { storageUsedBytes: 400n }); const tom = user('tom', roles.std);
  const perms = db.seed('permission', { key: 'file:read', group: 'Files' });
  db.seed('rolePermission', { roleId: roles.std.id, permissionId: perms.id });

  const logs = []; const notes = []; const deleted = [];
  const hasher = { hash: async (p) => `h(${p})` };
  const storage = { deletePrefix: async (p) => { deleted.push(p); }, delete: async (k) => { deleted.push(k); } };
  const admin = createAdminService({
    db, hasher, storage, activity: { log: async (e) => logs.push(e) }, notifications: { create: async (n) => notes.push(n) },
    defaultQuotaBytes: 777n, now, logger: { error() {} },
  });
  const SUPER = actor(root.id, [...ADMIN_PERMS, 'admin:manage-admins'], 100, 'root');
  const ADMIN = actor(ann.id, ADMIN_PERMS, 80, 'ann');
  return { db, roles, root, root2, ann, mia, sue, tom, admin, logs, notes, deleted, SUPER, ADMIN, now };
}

// ------------------------------------------------------------------ users listing
test('listUsers filters, sorts, paginates and never exposes password hashes', async () => {
  const w = world();
  const all = await w.admin.listUsers({ sort: 'name:asc', limit: 3, page: 1 });
  assert.equal(all.meta.total, 6);
  assert.deepEqual(all.items.map((u) => u.name), ['ann', 'mia', 'root']);
  assert.ok(!JSON.stringify(all, (_k, v) => (typeof v === 'bigint' ? 0 : v)).includes('secret-hash'));
  assert.deepEqual(all.items[0].roles, ['Admin']);
  assert.equal(all.items[0].rank, 80);

  assert.deepEqual((await w.admin.listUsers({ q: 'OO' })).items.map((u) => u.name).sort(), ['root', 'root2']);
  assert.deepEqual((await w.admin.listUsers({ role: 'standard-user' })).items.map((u) => u.name).sort(), ['sue', 'tom']);
  assert.deepEqual((await w.admin.listUsers({ role: 'no-such-role' })).items, []);
  w.sue.status = 'SUSPENDED';
  assert.deepEqual((await w.admin.listUsers({ status: 'SUSPENDED' })).items.map((u) => u.name), ['sue']);
  const bad = await w.admin.listUsers({ sort: 'passwordHash:asc' }); // not whitelisted: falls back to createdAt
  assert.equal(bad.items.length, 6);
});

test('getUser adds counts; unknown or malformed ids are 404', async () => {
  const w = world();
  w.db.seed('file', { ownerId: w.sue.id, name: 'a', extension: 'pdf' });
  w.db.seed('userSession', { userId: w.sue.id });
  const u = await w.admin.getUser(w.sue.id);
  assert.deepEqual([u.fileCount, u.folderCount, u.activeSessions, u.storagePercent], [1, 0, 1, 40]);
  await assert.rejects(w.admin.getUser('nope'), status(404));
  await assert.rejects(w.admin.getUser('11111111-1111-4111-8111-111111111111'), status(404));
});

// ------------------------------------------------------------------ create
test('createUser hashes the password, defaults the role and quota, and enforces rank and unique email', async () => {
  const w = world();
  const u = await w.admin.createUser(w.ADMIN, { name: 'New', email: ' New@X.dev ', password: 'pw12345678' }, {});
  assert.equal(u.email, 'new@x.dev');
  assert.deepEqual(u.roles, ['Standard User']);
  assert.equal(u.storageQuotaBytes, 777n);
  const row = w.db.tables.user.find((r) => r.email === 'new@x.dev');
  assert.equal(row.passwordHash, 'h(pw12345678)');
  assert.equal(row.status, 'ACTIVE');
  assert.ok(row.emailVerifiedAt);
  await assert.rejects(w.admin.createUser(w.ADMIN, { name: 'D', email: 'new@x.dev', password: 'pw12345678' }), status(409, 'EMAIL_TAKEN'));
  await assert.rejects(w.admin.createUser(w.ADMIN, { name: 'X', email: 'x@x.dev', password: 'pw12345678', roleKey: 'admin' }), status(403)); // peer
  await assert.rejects(w.admin.createUser(w.ADMIN, { name: 'X', email: 'x@x.dev', password: 'pw12345678', roleKey: 'super-admin' }), status(403));
  await assert.rejects(w.admin.createUser(w.ADMIN, { name: 'X', email: 'x@x.dev', password: 'pw12345678', roleKey: 'ghost' }), status(422));
  const peer = await w.admin.createUser(w.SUPER, { name: 'Pal', email: 'pal@x.dev', password: 'pw12345678', roleKey: 'Super Admin', quotaBytes: 5 }, {});
  assert.deepEqual([peer.roles, peer.storageQuotaBytes], [['Super Admin'], 5n]);
  assert.equal(w.logs.at(-1).action, 'REGISTER');
});

// ------------------------------------------------------------------ update
test('updateUser checks the specific permission for each field', async () => {
  const w = world();
  const onlyQuota = actor(w.ann.id, ['admin:access', 'user:quota'], 80);
  await assert.rejects(w.admin.updateUser(onlyQuota, w.sue.id, { name: 'Z' }), status(403));
  await assert.rejects(w.admin.updateUser(onlyQuota, w.sue.id, { status: 'SUSPENDED' }), status(403));
  const u = await w.admin.updateUser(onlyQuota, w.sue.id, { quotaBytes: 12345 }, {});
  assert.equal(u.storageQuotaBytes, 12345n);
  assert.equal(w.logs.at(-1).action, 'ADMIN_QUOTA_CHANGE');
  assert.equal(w.notes.at(-1).type, 'SYSTEM');
  assert.equal(w.notes.at(-1).userId, w.sue.id);
});

test('suspending revokes every session and token; reactivating verifies the account', async () => {
  const w = world();
  const s = w.db.seed('userSession', { userId: w.sue.id });
  w.db.seed('refreshToken', { userId: w.sue.id, sessionId: s.id, tokenHash: 'h', familyId: 'f', expiresAt: new Date('2027-01-01') });
  const other = w.db.seed('userSession', { userId: w.tom.id });
  const u = await w.admin.updateUser(w.ADMIN, w.sue.id, { status: 'SUSPENDED' }, {});
  assert.equal(u.status, 'SUSPENDED');
  assert.ok(w.db.tables.userSession.find((r) => r.id === s.id).revokedAt);
  assert.ok(w.db.tables.refreshToken[0].revokedAt);
  assert.equal(w.db.tables.userSession.find((r) => r.id === other.id).revokedAt, null);
  assert.equal(w.logs.at(-1).action, 'ADMIN_USER_STATUS_CHANGE');
  const back = await w.admin.updateUser(w.ADMIN, w.sue.id, { status: 'ACTIVE' });
  assert.equal(back.status, 'ACTIVE');
});

test('rank rules: cannot manage equal or higher ranks; Super Admin peers need manage-admins; no self status/quota changes', async () => {
  const w = world();
  await assert.rejects(w.admin.updateUser(w.ADMIN, w.root.id, { status: 'SUSPENDED' }), status(403));
  await assert.rejects(w.admin.updateUser(w.ADMIN, w.ann.id, { quotaBytes: 1 }), status(403)); // self
  await assert.rejects(w.admin.updateUser(w.ADMIN, w.ann.id, { status: 'SUSPENDED' }), status(403));
  const own = await w.admin.updateUser(w.ADMIN, w.ann.id, { name: 'Ann B' }, {}); // renaming yourself is fine
  assert.equal(own.name, 'Ann B');
  const peer = await w.admin.updateUser(w.SUPER, w.root2.id, { status: 'SUSPENDED' }, {});
  assert.equal(peer.status, 'SUSPENDED');
  const peerWithoutKey = actor(w.root.id, ADMIN_PERMS, 100);
  await assert.rejects(w.admin.updateUser(peerWithoutKey, w.root2.id, { status: 'ACTIVE' }), status(403));
});

// ------------------------------------------------------------------ roles
test('setRoles replaces roles, notifies and logs; enforces ranks and self rule', async () => {
  const w = world();
  const u = await w.admin.setRoles(w.ADMIN, w.sue.id, ['manager'], {});
  assert.deepEqual(u.roles, ['Manager']);
  assert.equal(w.db.tables.userRole.filter((r) => r.userId === w.sue.id).length, 1);
  assert.equal(w.logs.at(-1).action, 'ADMIN_ROLE_CHANGE');
  assert.equal(w.notes.at(-1).userId, w.sue.id);
  await assert.rejects(w.admin.setRoles(w.ADMIN, w.sue.id, ['admin']), status(403)); // not above own rank
  await assert.rejects(w.admin.setRoles(w.ADMIN, w.root.id, ['standard-user']), status(403)); // target outranks actor
  await assert.rejects(w.admin.setRoles(w.ADMIN, w.ann.id, ['manager']), status(403)); // self
  await assert.rejects(w.admin.setRoles(w.ADMIN, w.sue.id, ['ghost']), status(422));
  const multi = await w.admin.setRoles(w.ADMIN, w.tom.id, ['manager', 'Standard User', 'manager'], {});
  assert.deepEqual(multi.roles.sort(), ['Manager', 'Standard User']);
});

test('the last active Super Admin cannot be demoted, suspended or deleted', async () => {
  const w = world();
  w.root2.status = 'SUSPENDED'; // only root remains active
  const actorB = actor(w.root2.id, [...ADMIN_PERMS, 'admin:manage-admins'], 100);
  await assert.rejects(w.admin.setRoles(actorB, w.root.id, ['admin']), status(409, 'LAST_SUPER_ADMIN'));
  await assert.rejects(w.admin.updateUser(actorB, w.root.id, { status: 'SUSPENDED' }), status(409, 'LAST_SUPER_ADMIN'));
  await assert.rejects(w.admin.removeUser(actorB, w.root.id, { purge: true }), status(409, 'LAST_SUPER_ADMIN'));
  w.root2.status = 'ACTIVE'; // now there are two
  const out = await w.admin.setRoles(w.SUPER, w.root2.id, ['admin'], {});
  assert.deepEqual(out.roles, ['Admin']);
});

// ------------------------------------------------------------------ delete
test('removeUser refuses users with content unless purge; purge deletes blobs, rows and reassigns foreign versions', async () => {
  const w = world();
  assert.deepEqual(await w.admin.removeUser(w.ADMIN, w.tom.id, {}, {}), { deleted: true }); // no content
  assert.equal(w.db.tables.user.some((u) => u.id === w.tom.id), false);
  assert.equal(w.db.tables.userRole.some((r) => r.userId === w.tom.id), false);

  const f1 = w.db.seed('file', { ownerId: w.sue.id, name: 'a.pdf', extension: 'pdf' });
  const f2 = w.db.seed('file', { ownerId: w.sue.id, name: 'b.pdf', extension: 'pdf' });
  w.db.seed('fileVersion', { fileId: f1.id, uploadedById: w.sue.id, versionNumber: 1 });
  w.db.seed('folder', { ownerId: w.sue.id, name: 'F', path: '/x/' });
  const mine = w.db.seed('file', { ownerId: w.mia.id, name: 'm.pdf', extension: 'pdf' });
  const foreign = w.db.seed('fileVersion', { fileId: mine.id, uploadedById: w.sue.id, versionNumber: 1 });
  w.sue.avatarKey = `uploads/avatars/${w.sue.id}`;

  await assert.rejects(w.admin.removeUser(w.ADMIN, w.sue.id, { purge: false }), (e) => e.code === 'USER_HAS_CONTENT' && e.details.files === 2 && e.details.folders === 1);
  assert.equal(w.db.tables.user.some((u) => u.id === w.sue.id), true);

  await w.admin.removeUser(w.ADMIN, w.sue.id, { purge: true }, {});
  assert.deepEqual(w.deleted.sort(), [`uploads/avatars/${w.sue.id}`, `versions/users/${w.sue.id}/${f1.id}/`, `versions/users/${w.sue.id}/${f2.id}/`].sort());
  assert.equal(w.db.tables.file.filter((f) => f.ownerId === w.sue.id).length, 0);
  assert.equal(w.db.tables.folder.length, 0);
  assert.equal(w.db.tables.fileVersion.find((v) => v.id === foreign.id).uploadedById, w.mia.id);
  assert.equal(w.db.tables.user.some((u) => u.id === w.sue.id), false);
  assert.equal(w.logs.at(-1).metadata.purge, true);
  await assert.rejects(w.admin.removeUser(w.ADMIN, w.ann.id, {}), status(403)); // self
  await assert.rejects(w.admin.removeUser(w.ADMIN, w.root.id, {}), status(403)); // higher rank
});

test('a storage failure during purge stops before deleting the user', async () => {
  const w = world();
  w.db.seed('file', { ownerId: w.sue.id, name: 'a.pdf', extension: 'pdf' });
  const failing = createAdminService({
    db: w.db, hasher: {}, storage: { deletePrefix: async () => { throw new Error('disk'); }, delete: async () => {} },
    activity: { log: async () => {} }, notifications: { create: async () => {} }, now: w.now, logger: { error() {} },
  });
  await assert.rejects(failing.removeUser(w.ADMIN, w.sue.id, { purge: true }), /disk/);
  assert.equal(w.db.tables.user.some((u) => u.id === w.sue.id), true);
});

test('revokeSessions signs a user out everywhere', async () => {
  const w = world();
  w.db.seed('userSession', { userId: w.sue.id }); w.db.seed('userSession', { userId: w.sue.id });
  assert.deepEqual(await w.admin.revokeSessions(w.ADMIN, w.sue.id, {}), { revoked: 2 });
  assert.deepEqual(await w.admin.revokeSessions(w.ADMIN, w.sue.id, {}), { revoked: 0 });
  await assert.rejects(w.admin.revokeSessions(w.ADMIN, w.root.id, {}), status(403));
});

// ------------------------------------------------------------------ roles / stats / sharing / storage
test('listRoles returns permissions and member counts, highest rank first', async () => {
  const w = world();
  const roles = await w.admin.listRoles();
  assert.deepEqual(roles.map((r) => r.key), ['super-admin', 'admin', 'manager', 'standard-user']);
  assert.deepEqual(roles.find((r) => r.key === 'standard-user').permissions, ['file:read']);
  assert.deepEqual(roles.map((r) => r.userCount), [2, 1, 1, 2]);
  assert.equal(roleSlug(' Standard   User '), 'standard-user');
});

test('stats aggregates users, files, storage, shares and a 30-day signup series', async () => {
  const w = world();
  w.sue.status = 'SUSPENDED'; w.tom.status = 'PENDING_VERIFICATION';
  w.db.seed('file', { ownerId: w.mia.id, name: 'a.png', extension: 'png', size: 10n });
  w.db.seed('file', { ownerId: w.mia.id, name: 'b.png', extension: 'png', size: 5n });
  w.db.seed('file', { ownerId: w.mia.id, name: 'c.zip', extension: 'zip', size: 1n, deletedAt: new Date() });
  w.db.seed('shareLink', { createdById: w.mia.id, resourceType: 'FILE', token: 't1' });
  w.db.seed('shareLink', { createdById: w.mia.id, resourceType: 'FILE', token: 't2', revokedAt: new Date() });
  w.db.seed('userSession', { userId: w.mia.id, lastActiveAt: new Date('2026-06-10') });
  w.db.seed('userSession', { userId: w.mia.id, lastActiveAt: new Date('2026-01-01') });
  const s = await w.admin.stats();
  assert.deepEqual(s.users, { total: 6, active: 4, suspended: 1, pending: 1 });
  assert.equal(s.files, 2);
  assert.equal(s.storage.used, 400);
  assert.equal(s.storage.quota, 6000);
  assert.equal(s.activeSessions, 1);
  assert.deepEqual(s.shares, { links: 1, people: 0 });
  assert.equal(s.signups.length, 30);
  assert.equal(s.signups.at(-1).date, '2026-06-15');
  assert.equal(s.signups.at(-1).count, 6);
  assert.deepEqual(s.byCategory, [{ category: 'image', label: 'Images', bytes: 15, count: 2 }]);
});

test('listLinks and revokeLink (admin monitor)', async () => {
  const w = world();
  const file = w.db.seed('file', { ownerId: w.mia.id, name: 'plan.pdf', extension: 'pdf' });
  const link = w.db.seed('shareLink', { createdById: w.mia.id, resourceType: 'FILE', fileId: file.id, token: 'tt', passwordHash: 'x' });
  const out = await w.admin.listLinks({});
  assert.equal(out.items[0].resourceName, 'plan.pdf');
  assert.equal(out.items[0].createdBy.name, 'mia');
  assert.equal(out.items[0].hasPassword, true);
  assert.ok(!('passwordHash' in out.items[0]) && !('token' in out.items[0]));
  await w.admin.revokeLink(w.ADMIN, link.id, {});
  assert.equal((await w.admin.listLinks({})).items.length, 0);
  await assert.rejects(w.admin.revokeLink(w.ADMIN, 'bad'), status(404));
});

test('storageRanking orders by usage with percentages', async () => {
  const w = world();
  w.mia.storageUsedBytes = 900n;
  const r = await w.admin.storageRanking({ limit: 2 });
  assert.deepEqual(r.users.map((u) => [u.name, u.percent]), [['mia', 90], ['sue', 40]]);
  assert.deepEqual(r.totals, { used: 1300, quota: 6000 });
});

// ------------------------------------------------------------------ activity query
test('activity: own history is scoped to the user, admin sees all; filters and pagination work', async () => {
  const w = world();
  const t = (s) => new Date(s);
  w.db.seed('activityLog', { userId: w.sue.id, action: 'LOGIN', description: 'Signed in', createdAt: t('2026-06-01') });
  w.db.seed('activityLog', { userId: w.sue.id, action: 'FILE_UPLOAD', description: 'Uploaded “Budget.xlsx”', resourceName: 'Budget.xlsx', createdAt: t('2026-06-02') });
  w.db.seed('activityLog', { userId: w.tom.id, action: 'LOGIN', description: 'Signed in', ip: '9.9.9.9', createdAt: t('2026-06-03') });
  const q = createActivityQueryService({ db: w.db });

  const own = await q.listOwn(w.sue.id, { userId: w.tom.id }); // spoofed userId is ignored
  assert.deepEqual(own.items.map((i) => i.action), ['FILE_UPLOAD', 'LOGIN']);
  assert.equal(own.items[0].user.name, 'sue');
  assert.ok(!('userAgent' in own.items[0]));
  assert.deepEqual((await q.listOwn(w.sue.id, { action: 'LOGIN' })).items.length, 1);
  assert.deepEqual((await q.listOwn(w.sue.id, { from: '2026-06-02', to: '2026-06-30' })).items.map((i) => i.action), ['FILE_UPLOAD']);

  const all = await q.listAll({}, { page: 1, limit: 2 });
  assert.equal(all.meta.total, 3);
  assert.equal(all.items.length, 2);
  assert.equal(all.meta.hasNext, true);
  assert.deepEqual((await q.listAll({ q: 'budget' })).items.map((i) => i.action), ['FILE_UPLOAD']);
  assert.deepEqual((await q.listAll({ userId: w.tom.id })).items.map((i) => i.user.name), ['tom']);
});

// ------------------------------------------------------------------ dashboard
test('dashboard helpers: percent, category merge, zero-filled daily series', () => {
  assert.equal(percentOf(1n, 3n), 33.33);
  assert.equal(percentOf(5n, 0n), 0);
  assert.equal(percentOf(10n, 5n), 100);
  const merged = breakdownByCategory([
    { extension: 'jpg', _sum: { size: 5n }, _count: { _all: 1 } }, { extension: 'png', _sum: { size: 7n }, _count: { _all: 2 } },
    { extension: 'pdf', _sum: { size: 100n }, _count: { _all: 1 } }, { extension: 'exe', _sum: { size: null }, _count: { _all: 1 } },
  ]);
  assert.deepEqual(merged.map((m) => [m.category, m.bytes, m.count]), [['pdf', 100, 1], ['image', 12, 3], ['other', 0, 1]]);
  const series = dailySeries([{ createdAt: new Date('2026-06-15T01:00:00Z'), size: 4 }, { createdAt: new Date('2026-06-15T23:00:00Z'), size: 6 }, { createdAt: new Date('2026-05-01') }],
    (r) => r.size, { days: 3, now: new Date('2026-06-15T12:00:00Z') });
  assert.deepEqual(series, [{ date: '2026-06-13', count: 0, bytes: 0 }, { date: '2026-06-14', count: 0, bytes: 0 }, { date: '2026-06-15', count: 2, bytes: 10 }]);
});

test('dashboard.forUser composes counts, storage, categories, uploads, recents', async () => {
  const w = world();
  const me = w.sue.id;
  const A = actor(me, [], 40, 'sue'); A.user = { id: me, name: 'sue', storageUsedBytes: 400n, storageQuotaBytes: 1000n };
  const f1 = w.db.seed('file', { ownerId: me, name: 'a.pdf', extension: 'pdf', size: 100n, mimeType: 'application/pdf' });
  w.db.seed('file', { ownerId: me, name: 'b.png', extension: 'png', size: 50n, mimeType: 'image/png' });
  w.db.seed('file', { ownerId: me, name: 'gone.png', extension: 'png', size: 50n, deletedAt: new Date() });
  w.db.seed('folder', { ownerId: me, name: 'F', path: '/x/' });
  w.db.seed('folder', { ownerId: me, name: 'T', path: '/y/', deletedAt: new Date() });
  w.db.seed('fileVersion', { fileId: f1.id, versionNumber: 1, size: 100n, createdAt: new Date('2026-06-15T08:00:00Z') });
  w.db.seed('fileVersion', { fileId: f1.id, versionNumber: 2, size: 20n, createdAt: new Date('2026-04-01T08:00:00Z') });
  w.db.seed('fileVersion', { fileId: w.db.seed('file', { ownerId: w.mia.id, name: 'x', extension: 'pdf' }).id, versionNumber: 1, size: 999n });
  w.db.seed('fileShare', { fileId: f1.id, sharedWithId: me, sharedById: w.mia.id });
  w.db.seed('starredResource', { userId: me, fileId: f1.id });
  w.db.seed('activityLog', { userId: me, action: 'LOGIN', description: 'Signed in' });
  const dash = await createDashboardService({ db: w.db, now: w.now }).forUser(A);
  assert.deepEqual(dash.storage, { used: 400, quota: 1000, percent: 40 });
  assert.deepEqual(dash.counts, { files: 2, folders: 1, shared: 1, starred: 1, trash: 2 });
  assert.deepEqual(dash.byCategory.map((c) => c.category), ['pdf', 'image']);
  assert.equal(dash.uploadsOverTime.length, 30);
  assert.deepEqual(dash.uploadsOverTime.at(-1), { date: '2026-06-15', count: 1, bytes: 100 });
  assert.equal(dash.uploadsOverTime.reduce((a, d) => a + d.count, 0), 1);
  assert.equal(dash.recentFiles.length, 2);
  assert.equal(dash.recentFiles[0].access.level, 'OWNER');
  assert.equal(dash.recentActivity[0].user.name, 'sue');
});
