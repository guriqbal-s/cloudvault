import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';

import { createSocialDb, actor } from './helpers/socialDb.js';
import { createNotificationService } from '../src/services/notification.logic.js';
import { createProfileService, sniffImage, mergePrefs, MAX_AVATAR_BYTES } from '../src/services/profile.logic.js';
import { createJobs } from '../src/jobs/jobs.logic.js';
import { createSocketAuth, onConnection, userRoom } from '../src/sockets/auth.js';
import { ACTIVITY_ACTIONS } from '../src/constants/activityActions.js';

const status = (code, errCode) => (e) => e?.statusCode === code && (!errCode || e.code === errCode);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32, 3)]);

// ------------------------------------------------------------- enum sync
test('ACTIVITY_ACTIONS mirrors the Prisma enum exactly', () => {
  const schema = fs.readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
  const body = /enum ActivityAction \{([^}]*)\}/.exec(schema)[1];
  const fromSchema = body.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepEqual([...ACTIVITY_ACTIONS], fromSchema);
});

// ------------------------------------------------------------- notifications REST
function notifWorld() {
  const db = createSocialDb();
  const a = db.seed('user', { name: 'a', email: 'a@x.dev' }); const b = db.seed('user', { name: 'b', email: 'b@x.dev' });
  const emitted = [];
  const svc = createNotificationService({ db, emit: (...x) => emitted.push(x), logger: { error() {} } });
  return { db, a, b, svc, emitted };
}

test('notifications: list pages newest first, unread filter, meta.unreadCount', async () => {
  const { db, a, b, svc } = notifWorld();
  for (let i = 0; i < 5; i++) db.seed('notification', { userId: a.id, type: 'SYSTEM', title: `n${i}`, body: 'x', createdAt: new Date(2026, 0, i + 1), readAt: i < 2 ? new Date() : null });
  db.seed('notification', { userId: b.id, type: 'SYSTEM', title: 'other', body: 'x' });
  const p1 = await svc.list(a.id, { page: 1, limit: 2 });
  assert.deepEqual(p1.items.map((n) => n.title), ['n4', 'n3']);
  assert.deepEqual([p1.meta.total, p1.meta.totalPages, p1.meta.unreadCount, p1.meta.hasNext], [5, 3, 3, true]);
  const unread = await svc.list(a.id, { unread: true, page: 1, limit: 10 });
  assert.deepEqual(unread.items.map((n) => n.title), ['n4', 'n3', 'n2']);
  assert.ok(!('userId' in unread.items[0]));
});

test('notifications: mark read / read-all / delete only touch the caller\'s own rows', async () => {
  const { db, a, b, svc } = notifWorld();
  const mine = db.seed('notification', { userId: a.id, type: 'SYSTEM', title: 'm', body: 'x' });
  const theirs = db.seed('notification', { userId: b.id, type: 'SYSTEM', title: 't', body: 'x' });
  db.seed('notification', { userId: a.id, type: 'SYSTEM', title: 'm2', body: 'x' });
  const r = await svc.markRead(a.id, mine.id);
  assert.equal(r.changed, true);
  assert.ok(r.notification.readAt);
  assert.equal(r.unreadCount, 1);
  assert.equal((await svc.markRead(a.id, mine.id)).changed, false); // idempotent
  await assert.rejects(svc.markRead(a.id, theirs.id), status(404));
  await assert.rejects(svc.markRead(a.id, 'nope'), status(404));
  assert.deepEqual(await svc.markAllRead(a.id), { updated: 1, unreadCount: 0 });
  assert.equal(db.tables.notification.find((n) => n.id === theirs.id).readAt, null);
  await assert.rejects(svc.remove(a.id, theirs.id), status(404));
  assert.deepEqual(await svc.remove(a.id, mine.id), { unreadCount: 0 });
  assert.equal(db.tables.notification.length, 2);
});

// ------------------------------------------------------------- profile
function profileWorld() {
  const db = createSocialDb();
  const u = db.seed('user', { name: 'Una', email: 'una@x.dev' });
  const files = new Map(); const logs = [];
  const storage = {
    put: async (k, b) => { files.set(k, b); },
    getStream: async (k) => { if (!files.has(k)) throw Object.assign(new Error('nf'), { code: 'NOT_FOUND' }); return Readable.from([files.get(k)]); },
    delete: async (k) => { files.delete(k); },
  };
  const svc = createProfileService({ db, storage, activity: { log: async (e) => logs.push(e) }, logger: { error() {} } });
  return { db, u, files, logs, svc };
}

test('sniffImage trusts bytes, not names', () => {
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(JPG), 'image/jpeg');
  assert.equal(sniffImage(GIF), 'image/gif');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImage(Buffer.from('MZ' + 'x'.repeat(40))), null);
  assert.equal(sniffImage(Buffer.alloc(4)), null);
  assert.equal(sniffImage('nope'), null);
});

test('mergePrefs updates only the keys sent', () => {
  assert.deepEqual(mergePrefs({ inApp: { shared: false, uploads: true } }, { inApp: { uploads: false }, email: { quota: true } }), { inApp: { shared: false, uploads: false }, email: { quota: true } });
  assert.deepEqual(mergePrefs(undefined, { inApp: { shared: true } }), { inApp: { shared: true } });
});

test('profile: name, preferences merge, activity logged, empty preference update is a no-op', async () => {
  const w = profileWorld();
  await w.svc.updateProfile(w.u.id, { name: 'Una B' }, { ip: '1.1.1.1' });
  assert.equal(w.db.tables.user[0].name, 'Una B');
  assert.equal(w.logs.at(-1).action, 'PROFILE_UPDATE');
  await w.svc.updatePreferences(w.u.id, { theme: 'dark', notificationPrefs: { inApp: { shared: false } } });
  await w.svc.updatePreferences(w.u.id, { notificationPrefs: { inApp: { uploads: false }, email: { quota: true } } });
  assert.equal(w.db.tables.user[0].themePref, 'dark');
  assert.deepEqual(w.db.tables.user[0].notificationPrefs, { inApp: { shared: false, uploads: false }, email: { quota: true } });
  const n = w.logs.length;
  await w.svc.updatePreferences(w.u.id, {});
  assert.equal(w.logs.length, n);
});

test('avatar: validates size and bytes, stores under the avatar key, serves back with sniffed type, removes', async () => {
  const w = profileWorld();
  await assert.rejects(w.svc.setAvatar(w.u.id, undefined), status(400));
  await assert.rejects(w.svc.setAvatar(w.u.id, Buffer.alloc(MAX_AVATAR_BYTES + 1, 1)), status(413));
  await assert.rejects(w.svc.setAvatar(w.u.id, Buffer.from('<svg onload=alert(1)></svg>'.padEnd(40))), status(415, 'UNSUPPORTED_IMAGE'));
  await assert.rejects(w.svc.getAvatar(w.u.id), status(404));

  await w.svc.setAvatar(w.u.id, PNG, {});
  assert.equal(w.db.tables.user[0].avatarKey, `uploads/avatars/${w.u.id}`);
  assert.ok(w.files.has(`uploads/avatars/${w.u.id}`));
  const got = await w.svc.getAvatar(w.u.id);
  assert.equal(got.mimeType, 'image/png');
  assert.deepEqual(got.buffer, PNG);

  await w.svc.setAvatar(w.u.id, JPG, {}); // replace
  assert.equal((await w.svc.getAvatar(w.u.id)).mimeType, 'image/jpeg');
  w.db.tables.user[0].status = 'SUSPENDED';
  await assert.rejects(w.svc.getAvatar(w.u.id), status(404));
  w.db.tables.user[0].status = 'ACTIVE';
  await assert.rejects(w.svc.getAvatar('bad-id'), status(404));

  await w.svc.removeAvatar(w.u.id, {});
  assert.equal(w.db.tables.user[0].avatarKey, null);
  assert.equal(w.files.size, 0);
  await w.svc.removeAvatar(w.u.id, {}); // idempotent
  w.db.tables.user[0].avatarKey = 'uploads/avatars/missing';
  await assert.rejects(w.svc.getAvatar(w.u.id), status(404)); // row points at a missing blob
});

test('lookup: min 2 chars, active users only, excludes self, max 8, only id/name/email', async () => {
  const w = profileWorld();
  for (let i = 0; i < 10; i++) w.db.seed('user', { name: `Pat ${String(i).padStart(2, '0')}`, email: `pat${i}@x.dev`, passwordHash: 'h' });
  w.db.seed('user', { name: 'Pat Gone', email: 'gone@x.dev', status: 'SUSPENDED' });
  w.db.seed('user', { name: 'Patty Self', email: 'self@x.dev' });
  const me = actor(w.db.tables.user.at(-1).id, []);
  assert.deepEqual(await w.svc.lookup(me, 'p'), []);
  assert.deepEqual(await w.svc.lookup(me, undefined), []);
  const out = await w.svc.lookup(me, 'PAT');
  assert.equal(out.length, 8);
  assert.deepEqual(Object.keys(out[0]).sort(), ['email', 'id', 'name']);
  assert.ok(out.every((u) => u.name !== 'Pat Gone' && u.name !== 'Patty Self'));
  assert.deepEqual((await w.svc.lookup(me, 'pat3@')).map((u) => u.email), ['pat3@x.dev']);
});

// ------------------------------------------------------------- jobs
function jobsWorld({ retention = 30, warn = 90, failDelete = new Set() } = {}) {
  let clock = new Date('2026-06-30T03:00:00Z');
  const now = () => clock;
  const db = createSocialDb({ now });
  const deletedPrefixes = []; const sent = []; const logs = []; const errors = [];
  const storage = { deletePrefix: async (p) => { if ([...failDelete].some((f) => p.includes(f))) throw new Error('io'); deletedPrefixes.push(p); } };
  const notifications = { create: async (n) => { sent.push(n); return n; } };
  const jobs = createJobs({ db, storage, notifications, activity: { log: async (e) => logs.push(e) }, logger: { error: (...a) => errors.push(a), warn() {}, info() {} }, now, config: { trashRetentionDays: retention, warningPercent: warn } });
  const owner = db.seed('user', { name: 'o', email: 'o@x.dev', storageUsedBytes: 500n });
  return { db, jobs, deletedPrefixes, sent, logs, errors, owner, advance: (ms) => { clock = new Date(clock.getTime() + ms); } };
}
const daysAgo = (n) => new Date(new Date('2026-06-30T03:00:00Z').getTime() - n * 86_400_000);

test('purgeTrash removes only items past retention: blobs, rows, quota, logs', async () => {
  const w = jobsWorld();
  const old = w.db.seed('file', { ownerId: w.owner.id, name: 'old.pdf', extension: 'pdf', deletedAt: daysAgo(31) });
  const fresh = w.db.seed('file', { ownerId: w.owner.id, name: 'fresh.pdf', extension: 'pdf', deletedAt: daysAgo(5) });
  const live = w.db.seed('file', { ownerId: w.owner.id, name: 'live.pdf', extension: 'pdf' });
  w.db.seed('fileVersion', { fileId: old.id, versionNumber: 1, size: 100n }); w.db.seed('fileVersion', { fileId: old.id, versionNumber: 2, size: 50n });
  w.db.seed('fileVersion', { fileId: fresh.id, versionNumber: 1, size: 999n });
  const oldFolder = w.db.seed('folder', { ownerId: w.owner.id, name: 'F', path: '/a/', deletedAt: daysAgo(40) });
  w.db.seed('folder', { ownerId: w.owner.id, name: 'G', path: '/b/', deletedAt: daysAgo(1) });

  const out = await w.jobs.purgeTrash();
  assert.deepEqual(out, { files: 1, folders: 1, bytes: 150, failed: 0 });
  assert.deepEqual(w.deletedPrefixes, [`versions/users/${w.owner.id}/${old.id}/`]);
  assert.deepEqual(w.db.tables.file.map((f) => f.id).sort(), [fresh.id, live.id].sort());
  assert.equal(w.db.tables.fileVersion.length, 1); // old versions cascaded away
  assert.equal(w.db.tables.user[0].storageUsedBytes, 350n);
  assert.equal(w.db.tables.folder.some((f) => f.id === oldFolder.id), false);
  assert.equal(w.db.tables.folder.length, 1);
  assert.deepEqual([w.logs[0].action, w.logs[0].userId, w.logs[0].metadata], ['FILE_PERMANENT_DELETE', w.owner.id, { automatic: true }]);
});

test('purgeTrash keeps rows whose blobs could not be deleted, and still finishes the rest', async () => {
  const w = jobsWorld({ failDelete: new Set(['BAD']) });
  const bad = w.db.seed('file', { id: 'BAD-file', ownerId: w.owner.id, name: 'bad.pdf', extension: 'pdf', deletedAt: daysAgo(60) });
  const good = w.db.seed('file', { ownerId: w.owner.id, name: 'good.pdf', extension: 'pdf', deletedAt: daysAgo(60) });
  w.db.seed('fileVersion', { fileId: bad.id, versionNumber: 1, size: 10n });
  w.db.seed('fileVersion', { fileId: good.id, versionNumber: 1, size: 20n });
  const out = await w.jobs.purgeTrash();
  assert.deepEqual([out.files, out.failed, out.bytes], [1, 1, 20]);
  assert.deepEqual(w.db.tables.file.map((f) => f.id), [bad.id]);
  assert.equal(w.db.tables.user[0].storageUsedBytes, 480n);
  assert.equal(w.errors.length, 1);
  assert.deepEqual(await w.jobs.purgeTrash().then((r) => [r.files, r.failed]), [0, 1]); // retried, still failing, no loop
});

test('purgeTrash handles more than one batch', async () => {
  const w = jobsWorld();
  for (let i = 0; i < 450; i++) w.db.seed('file', { ownerId: w.owner.id, name: `f${i}`, extension: 'txt', deletedAt: daysAgo(31) });
  assert.equal((await w.jobs.purgeTrash()).files, 450);
  assert.equal(w.db.tables.file.length, 0);
});

test('expireLinks and pruneTokens delete only what is safely stale', async () => {
  const w = jobsWorld();
  const mk = (token, expiresAt) => w.db.seed('shareLink', { createdById: w.owner.id, resourceType: 'FILE', token, expiresAt });
  mk('old', daysAgo(40)); mk('recent', daysAgo(2)); mk('open', null); mk('future', new Date('2027-01-01'));
  assert.deepEqual(await w.jobs.expireLinks(), { deleted: 1 });
  assert.deepEqual(w.db.tables.shareLink.map((l) => l.token), ['recent', 'open', 'future']);

  const s = w.db.seed('userSession', { userId: w.owner.id, revokedAt: daysAgo(100) });
  w.db.seed('userSession', { userId: w.owner.id, revokedAt: daysAgo(3) });
  w.db.seed('userSession', { userId: w.owner.id });
  w.db.seed('refreshToken', { userId: w.owner.id, sessionId: 'x', tokenHash: '1', familyId: 'f', expiresAt: daysAgo(1) });
  w.db.seed('refreshToken', { userId: w.owner.id, sessionId: 'x', tokenHash: '2', familyId: 'f', expiresAt: daysAgo(-5), revokedAt: daysAgo(1) }); // revoked but live: kept for reuse detection
  w.db.seed('passwordResetToken', { userId: w.owner.id, tokenHash: 'a', expiresAt: daysAgo(1) });
  w.db.seed('passwordResetToken', { userId: w.owner.id, tokenHash: 'b', expiresAt: daysAgo(-1) });
  w.db.seed('emailVerificationToken', { userId: w.owner.id, tokenHash: 'c', expiresAt: daysAgo(2) });
  assert.deepEqual(await w.jobs.pruneTokens(), { refreshTokens: 1, resetTokens: 1, verificationTokens: 1, sessions: 1 });
  assert.equal(w.db.tables.refreshToken.length, 1);
  assert.equal(w.db.tables.userSession.some((x) => x.id === s.id), false);
});

test('storageWarnings: threshold, once per day, skips suspended users and zero quota', async () => {
  const w = jobsWorld();
  const mk = (name, used, quota, extra = {}) => w.db.seed('user', { name, email: `${name}@x.dev`, storageUsedBytes: BigInt(used), storageQuotaBytes: BigInt(quota), ...extra });
  const high = mk('high', 950, 1000); const edge = mk('edge', 900, 1000); mk('low', 899, 1000); mk('sus', 990, 1000, { status: 'SUSPENDED' }); mk('zero', 5, 0);
  const r1 = await w.jobs.storageWarnings();
  assert.deepEqual(r1, { checked: 5, warned: 2 }); // owner, high, edge, low, zero (suspended is not checked)
  assert.deepEqual(w.sent.map((n) => n.userId).sort(), [edge.id, high.id].sort());
  assert.equal(w.sent[0].type, 'STORAGE_WARNING');
  assert.match(w.sent.find((n) => n.userId === high.id).body, /95%/);

  for (const n of w.sent) w.db.seed('notification', { userId: n.userId, type: 'STORAGE_WARNING', title: 't', body: 'b', createdAt: new Date('2026-06-30T03:00:00Z') });
  w.sent.length = 0;
  w.advance(3_600_000);
  assert.equal((await w.jobs.storageWarnings()).warned, 0); // already warned today
  w.advance(25 * 3_600_000);
  assert.equal((await w.jobs.storageWarnings()).warned, 2);
});

test('snapshotStorage writes yesterday once per user and updates on re-run', async () => {
  const w = jobsWorld();
  const f = w.db.seed('file', { ownerId: w.owner.id, name: 'a', extension: 'pdf' });
  w.db.seed('folder', { ownerId: w.owner.id, name: 'F', path: '/a/' });
  w.db.seed('fileVersion', { fileId: f.id, versionNumber: 1, size: 70n, createdAt: new Date('2026-06-29T10:00:00Z') });
  w.db.seed('fileVersion', { fileId: f.id, versionNumber: 2, size: 5n, createdAt: new Date('2026-06-30T01:00:00Z') }); // today: excluded
  assert.deepEqual(await w.jobs.snapshotStorage(), { users: 1 });
  await w.jobs.snapshotStorage();
  assert.equal(w.db.tables.storageUsage.length, 1);
  const row = w.db.tables.storageUsage[0];
  assert.equal(row.date.toISOString(), '2026-06-29T00:00:00.000Z');
  assert.deepEqual([row.bytesUsed, row.fileCount, row.folderCount, row.bytesUploaded, row.filesUploaded], [500n, 1, 1, 70n, 1]);
});

test('guarded skips overlapping runs and swallows errors', async () => {
  const w = jobsWorld();
  let release; let calls = 0;
  const slow = w.jobs.guarded('slow', () => new Promise((r) => { calls++; release = () => r('done'); }));
  const first = slow();
  assert.equal(await slow(), null); // overlap skipped
  release();
  assert.equal(await first, 'done');
  assert.equal(calls, 1);
  const again = slow(); release(); await again; // lock released afterwards
  assert.equal(calls, 2);
  const boom = w.jobs.guarded('boom', async () => { throw new Error('x'); });
  assert.equal(await boom(), null);
  assert.equal(w.errors.length, 1);
});

// ------------------------------------------------------------- sockets
test('socket auth verifies the token like HTTP, exposes error codes, joins the user room', async () => {
  const tokens = { verifyAccess: (t) => { if (t === 'expired') throw Object.assign(new Error('expired'), { code: 'TOKEN_EXPIRED' }); if (t !== 'good') throw Object.assign(new Error('bad'), { code: 'INVALID_TOKEN' }); return { userId: 'u1', sessionId: 's1' }; } };
  const principals = { authenticate: async ({ userId, sessionId }) => { if (sessionId === 'dead') throw Object.assign(new Error('revoked'), { code: 'SESSION_REVOKED' }); return { user: { id: userId } }; } };
  const auth = createSocketAuth({ tokens, principals });
  const run = async (token, sessionOverride) => {
    const socket = { handshake: { auth: token === undefined ? {} : { token } }, data: {} };
    if (sessionOverride) tokens.verifyAccess = () => ({ userId: 'u1', sessionId: sessionOverride });
    let err; await auth(socket, (e) => { err = e; });
    return { socket, err };
  };
  const ok = await run('good');
  assert.equal(ok.err, undefined);
  assert.equal(ok.socket.data.userId, 'u1');
  assert.equal((await run(undefined)).err.data.code, 'UNAUTHORIZED');
  assert.equal((await run('')).err.data.code, 'UNAUTHORIZED');
  assert.equal((await run(42)).err.data.code, 'UNAUTHORIZED');
  assert.equal((await run('expired')).err.data.code, 'TOKEN_EXPIRED');
  assert.equal((await run('forged')).err.data.code, 'INVALID_TOKEN');
  assert.equal((await run('good', 'dead')).err.data.code, 'SESSION_REVOKED');

  const joined = []; const emitted = [];
  onConnection({ data: { userId: 'u9' }, join: (r) => joined.push(r), emit: (...a) => emitted.push(a) });
  assert.deepEqual(joined, [userRoom('u9')]);
  assert.equal(userRoom('u9'), 'user:u9');
  assert.deepEqual(emitted, [['ready', { userId: 'u9' }]]);
});
