// The Prisma repo needs MySQL, which is not available here. These tests check what can be
// checked without it: that it exposes exactly the interface the logic (and the in-memory fake)
// use, and that its JavaScript-side behaviour (error mapping, filtering, query composition) is
// right against a recording stub client. The SQL itself is NOT executed by any test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDriveRepo } from '../src/services/drive/drive.repo.js';
import { createWorld, uuid } from './helpers/driveFakes.js';

const code = (c) => (e) => e.code === c || e.statusCode === c;

/** A client whose every model method records its call and returns a canned value. */
function stub(canned = {}) {
  const calls = [];
  const model = (name) => new Proxy({}, {
    get: (_t, method) => async (args) => {
      calls.push([name, method, args]);
      const v = canned[`${name}.${method}`];
      return typeof v === 'function' ? v(args) : v ?? (method.startsWith('find') && method !== 'findUnique' ? [] : method === 'count' ? 0 : null);
    },
  });
  const client = {
    folder: model('folder'), file: model('file'), fileVersion: model('fileVersion'), user: model('user'),
    folderShare: model('folderShare'), fileShare: model('fileShare'), shareLink: model('shareLink'),
    starredResource: model('starredResource'), storageUsage: model('storageUsage'),
    $executeRaw: async (...a) => { calls.push(['$executeRaw', a]); return 1; },
    $queryRaw: async (...a) => { calls.push(['$queryRaw', a]); return canned.queryRaw ?? []; },
    // real transaction clients do not have $transaction themselves
    $transaction: async (fn) => fn({ ...client, $transaction: undefined }),
  };
  return { client, calls };
}

test('the Prisma repo exposes exactly the methods the in-memory repo (and so the logic tests) cover', () => {
  const real = Object.keys(createDriveRepo(stub().client)).sort();
  const fake = Object.keys(createWorld().repo).sort();
  assert.deepEqual(real, fake);
});

test('unique-constraint violations become NAME_TAKEN', async () => {
  const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });
  const { client } = stub({ 'folder.create': () => { throw p2002; }, 'file.update': () => { throw p2002; } });
  const repo = createDriveRepo(client);
  await assert.rejects(repo.createFolder({ name: 'X' }), code('NAME_TAKEN'));
  await assert.rejects(repo.updateFile('id', { name: 'X' }), code('NAME_TAKEN'));
  const other = Object.assign(new Error('boom'), { code: 'P2003' });
  const { client: c2 } = stub({ 'folder.create': () => { throw other; } });
  await assert.rejects(createDriveRepo(c2).createFolder({ name: 'X' }), (e) => e === other);
});

test('reserveQuota checks capacity while holding the owner row lock', async () => {
  const ok = createDriveRepo(stub({ queryRaw: [{ used: 10n, quota: 100n }] }).client);
  assert.deepEqual(await ok.reserveQuota(uuid(1), 5n), { ok: true, used: 15n, quota: 100n });
  const full = createDriveRepo(stub({ queryRaw: [{ used: 99n, quota: 100n }] }).client);
  assert.deepEqual(await full.reserveQuota(uuid(1), 5n), { ok: false });
});

test('markFolderTreeDeleted trashes live files and folders of the subtree with one batch id', async () => {
  const { client, calls } = stub({ 'folder.findMany': () => [{ id: 'a' }, { id: 'b' }] });
  await createDriveRepo(client).markFolderTreeDeleted({ ownerId: 'o', path: '/a/', batchId: 'a', deletedById: 'u', at: new Date(0) });
  const find = calls.find((c) => c[1] === 'findMany');
  assert.deepEqual(find[2].where, { ownerId: 'o', deletedAt: null, path: { startsWith: '/a/' } });
  const updates = calls.filter((c) => c[1] === 'updateMany');
  assert.equal(updates.length, 2);
  for (const u of updates) assert.equal(u[2].data.trashBatchId, 'a');
  assert.deepEqual(updates.find((u) => u[0] === 'file')[2].where, { ownerId: 'o', deletedAt: null, folderId: { in: ['a', 'b'] } });
});

test('listTrashRoots keeps only items the user deleted themselves', async () => {
  const d = new Date(0);
  const { client } = stub({
    'folder.findMany': () => [{ id: 'f1', trashBatchId: 'f1', deletedAt: d }, { id: 'f2', trashBatchId: 'f1', deletedAt: d }],
    'file.findMany': () => [
      { id: 'x', trashBatchId: 'x', _count: { versions: 2 }, currentVersion: { versionNumber: 2 } },
      { id: 'y', trashBatchId: 'f1', _count: { versions: 1 }, currentVersion: null },
    ],
  });
  const r = await createDriveRepo(client).listTrashRoots('o');
  assert.deepEqual(r.folders.map((f) => f.id), ['f1']);
  assert.deepEqual(r.files.map((f) => [f.id, f.versionCount, f.currentVersion]), [['x', 2, 2]]);
});

test('file rows are flattened: versionCount and currentVersion number, no _count leak', async () => {
  const { client } = stub({ 'file.findUnique': () => ({ id: 'f', name: 'a', _count: { versions: 3 }, currentVersion: { versionNumber: 3 } }) });
  const row = await createDriveRepo(client).getFile('f');
  assert.deepEqual(row, { id: 'f', name: 'a', versionCount: 3, currentVersion: 3 });
});

test('collectPurge for a folder gathers the subtree by path and sums ALL versions', async () => {
  const { client, calls } = stub({
    'folder.findMany': () => [{ id: 'a' }, { id: 'b' }],
    'file.findMany': () => [{ id: 'f1' }],
    'fileVersion.aggregate': () => ({ _sum: { size: 42n } }),
  });
  const r = await createDriveRepo(client).collectPurge({ ownerId: 'o', folderPath: '/a/', fileId: null });
  assert.deepEqual(r, { folderIds: ['a', 'b'], fileIds: ['f1'], bytes: 42n });
  assert.deepEqual(calls.find((c) => c[0] === 'folder')[2].where, { ownerId: 'o', path: { startsWith: '/a/' } });
  const empty = createDriveRepo(stub({ 'fileVersion.aggregate': () => ({ _sum: { size: null } }) }).client);
  assert.equal((await empty.collectPurge({ ownerId: 'o', folderPath: null, fileId: 'f' })).bytes, 0n);
});

test('transaction() hands the callback a repo bound to the transaction client; nested calls reuse it', async () => {
  const { client } = stub();
  const repo = createDriveRepo(client);
  let inner;
  await repo.transaction(async (r) => { inner = r; await r.transaction(async (r2) => assert.equal(r2, r)); });
  assert.notEqual(inner, repo);
});

test('setStar returns false for an already starred item and rethrows other errors', async () => {
  const dup = createDriveRepo(stub({ 'starredResource.create': () => { throw Object.assign(new Error(), { code: 'P2002' }); } }).client);
  assert.equal(await dup.setStar('u', 'FILE', 'f'), false);
  const bad = createDriveRepo(stub({ 'starredResource.create': () => { throw new Error('db'); } }).client);
  await assert.rejects(bad.setStar('u', 'FILE', 'f'), /db/);
  const { client, calls } = stub();
  await createDriveRepo(client).setStar('u', 'FOLDER', 'd');
  assert.deepEqual(calls[0][2].data, { userId: 'u', resourceType: 'FOLDER', folderId: 'd' });
});

test('search composes visibility from ownership, direct shares and shared-folder paths', async () => {
  const { client, calls } = stub({ 'folderShare.findMany': () => [{ folder: { path: '/shared/' } }] });
  await createDriveRepo(client).search({ actorId: 'me', q: 'bud', extensions: ['pdf'], minSize: 5n, includeFolders: true, skip: 0, take: 10 });
  const where = calls.find((c) => c[0] === 'file' && c[1] === 'findMany')[2].where;
  assert.equal(where.deletedAt, null);
  assert.deepEqual(where.name, { contains: 'bud' });
  assert.deepEqual(where.extension, { in: ['pdf'] });
  assert.deepEqual(where.size, { gte: 5n });
  assert.deepEqual(where.OR, [
    { ownerId: 'me' }, { shares: { some: { sharedWithId: 'me' } } }, { folder: { path: { startsWith: '/shared/' } } },
  ]);
  assert.equal(calls.some((c) => c[0] === 'folder' && c[1] === 'findMany'), true);
  const { client: c2, calls: calls2 } = stub();
  await createDriveRepo(c2).search({ actorId: 'me', includeFolders: true, skip: 0, take: 10 }); // no q: no folder query
  assert.equal(calls2.some((c) => c[0] === 'folder'), false);
});

test('empty id lists never reach the database', async () => {
  const { client, calls } = stub();
  const repo = createDriveRepo(client);
  assert.deepEqual(await repo.getFoldersByIds([]), []);
  assert.equal((await repo.folderShareIds('u', [])).size, 0);
  assert.equal((await repo.starredIds('u', { fileIds: [], folderIds: [] })).files.size, 0);
  assert.equal((await repo.sharedFlags('u', { fileIds: [], folderIds: [] })).files.size, 0);
  assert.equal(calls.length, 0);
});
