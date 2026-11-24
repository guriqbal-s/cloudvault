import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, actor, ALICE, BOB, CAROL, VIEWER, uuid } from './helpers/driveFakes.js';

const code = (c) => (e) => e.code === c || e.statusCode === c;
const up = (w, who, files, folderId = null) => w.files.upload(who, { folderId, files });

test('upload: stores the blob, version 1, quota, activity, notification and removes the staged file', async () => {
  const w = createWorld();
  const staged = w.storage.stage('Report.PDF', 'hello world');
  const { results } = await up(w, w.alice, [staged]);
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.ok, true);
  assert.equal(r.file.name, 'Report.PDF');
  assert.equal(r.file.extension, 'pdf');
  assert.equal(r.file.mimeType, 'application/pdf'); // from the extension, never from the client
  assert.equal(r.file.category, 'pdf');
  assert.equal(r.file.size, 11n);
  assert.equal(r.file.versionCount, 1);
  assert.equal(r.file.access.level, 'OWNER');

  const key = `versions/users/${ALICE}/${r.file.id}/v1`;
  assert.equal(w.storage.blobs.get(key).toString(), 'hello world');
  assert.equal(w.user(ALICE).used, 11n);
  assert.equal(w.s.versions[0].uploadedById, ALICE);
  assert.equal(w.s.versions[0].checksum.length, 64);
  assert.deepEqual(w.removed, [staged.path]);
  assert.equal(w.logs[0].action, 'FILE_UPLOAD');
  await w.settle();
  assert.equal(w.s.notes[0].type, 'UPLOAD_COMPLETED');
  assert.equal(w.s.usage[0].files, 1);
});

test('upload: duplicate names are auto-renamed, also within one request', async () => {
  const w = createWorld();
  await w.upload(w.alice, 'a.txt', '1');
  const { results } = await up(w, w.alice, [w.storage.stage('a.txt', '2'), w.storage.stage('a.txt', '3'), w.storage.stage('A.TXT', '4')]);
  assert.deepEqual(results.map((r) => r.file.name), ['a (1).txt', 'a (2).txt', 'A (3).TXT']);
  assert.equal(w.s.files.length, 4);
});

test('upload: per-file results for disallowed type, no extension, too large and bad name', async () => {
  const w = createWorld({ maxUploadBytes: 10 });
  const { results } = await up(w, w.alice, [
    w.storage.stage('virus.exe', 'x'), w.storage.stage('README', 'x'), w.storage.stage('big.txt', 'x'.repeat(11)),
    w.storage.stage('a/b.txt', 'x'), w.storage.stage('ok.txt', 'fine'),
  ]);
  assert.deepEqual(results.map((r) => r.ok), [false, false, false, false, true]);
  assert.deepEqual(results.slice(0, 4).map((r) => r.error.code), ['FILE_TYPE_NOT_ALLOWED', 'FILE_TYPE_NOT_ALLOWED', 'FILE_TOO_LARGE', 'VALIDATION_ERROR']);
  assert.equal(w.user(ALICE).used, 4n); // only the good file was charged
  assert.equal(w.storage.blobs.size, 1);
  assert.equal(w.removed.length, 5); // every staged file is cleaned up, success or not
});

test('upload: UTF-8 names mangled to latin1 by the multipart parser are repaired', async () => {
  const w = createWorld();
  const mangled = Buffer.from('Résumé.pdf', 'utf8').toString('latin1');
  const { results } = await up(w, w.alice, [w.storage.stage(mangled, 'x')]);
  assert.equal(results[0].file.name, 'Résumé.pdf');
});

test('upload: quota is enforced per file and nothing is stored for the refused one', async () => {
  const w = createWorld({ quota: 10n });
  const { results } = await up(w, w.alice, [w.storage.stage('a.txt', '123456'), w.storage.stage('b.txt', '123456'), w.storage.stage('c.txt', '1234')]);
  assert.deepEqual(results.map((r) => r.ok), [true, false, true]);
  assert.equal(results[1].error.code, 'QUOTA_EXCEEDED');
  assert.equal(w.user(ALICE).used, 10n);
  assert.equal(w.storage.blobs.size, 2);
});

test('upload: quota counts earlier versions and trashed files until purge', async () => {
  const w = createWorld({ quota: 20n });
  const f = await w.upload(w.alice, 'a.txt', '1234567890'); // 10
  await w.versions.upload(w.alice, f.id, { file: w.storage.stage('a.txt', '1234567890') }); // +10 => 20
  await w.files.remove(w.alice, f.id);
  const { results } = await up(w, w.alice, [w.storage.stage('b.txt', 'x')]);
  assert.equal(results[0].error.code, 'QUOTA_EXCEEDED'); // trash still counts
  const root = (await w.trash.list(w.alice)).files[0];
  await w.trash.purge(w.alice, 'files', root.id);
  assert.equal(w.user(ALICE).used, 0n); // both versions refunded
  const again = await up(w, w.alice, [w.storage.stage('b.txt', 'x')]);
  assert.equal(again.results[0].ok, true);
});

test('upload: storage failure releases the quota and reports a generic error', async () => {
  const w = createWorld();
  w.storage.failPut = true;
  const { results } = await up(w, w.alice, [w.storage.stage('a.txt', 'abc')]);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error.code, 'IO');
  assert.equal(results[0].error.message, 'Upload failed'); // internal detail is not leaked
  assert.equal(w.user(ALICE).used, 0n);
  assert.equal(w.s.files.length, 0);
  assert.equal(w.errors.length > 0, true);
});

test('upload: database failure after the blob was stored removes the blob and refunds quota', async () => {
  const w = createWorld();
  const original = w.repo.createFileWithVersion;
  w.repo.createFileWithVersion = async () => { throw new Error('db down'); };
  const { results } = await up(w, w.alice, [w.storage.stage('a.txt', 'abc')]);
  w.repo.createFileWithVersion = original;
  assert.equal(results[0].ok, false);
  assert.equal(w.storage.blobs.size, 0);
  assert.equal(w.user(ALICE).used, 0n);
});

test('upload: a name taken by a concurrent request is retried with the next free name', async () => {
  const w = createWorld();
  const original = w.repo.transaction;
  let first = true;
  w.repo.transaction = async (fn) => {
    if (first) { // another request commits "a.txt" between our name check and our insert
      first = false;
      w.s.files.push({ id: uuid(5000), name: 'a.txt', ownerId: ALICE, folderId: null, extension: 'txt', size: 1n, deletedAt: null, createdAt: w.T(1), updatedAt: w.T(1) });
    }
    return original(fn);
  };
  const { results } = await up(w, w.alice, [w.storage.stage('a.txt', 'abc')]);
  w.repo.transaction = original;
  assert.equal(results[0].ok, true);
  assert.equal(results[0].file.name, 'a (1).txt');
});

test('upload into folders: Editor uploads become the owner\'s files and use the OWNER\'s quota', async () => {
  const w = createWorld({ quota: 100n });
  const shared = await w.mkFolder(w.alice, 'Shared');
  w.shareFolder(shared, BOB, 'EDITOR');
  w.shareFolder(shared, CAROL, 'VIEWER');
  const file = await w.upload(w.bob, 'b.txt', '12345', shared);
  assert.equal(file.ownerId, ALICE);
  assert.equal(w.s.versions[0].uploadedById, BOB);
  assert.equal(w.user(ALICE).used, 5n);
  assert.equal(w.user(BOB).used, 0n);
  await w.settle();
  const types = w.s.notes.map((n) => `${n.userId.slice(-1)}:${n.type}`).sort();
  assert.deepEqual(types, ['1:SHARED_FILE_UPDATED', '2:UPLOAD_COMPLETED']); // owner told, uploader confirmed
  await assert.rejects(up(w, w.carol, [w.storage.stage('c.txt', 'x')], shared), code(403));
  assert.ok(w.removed.length >= 2); // request-level failures still clean the staged file
  w.user(ALICE).quota = 5n;
  const full = await up(w, w.bob, [w.storage.stage('d.txt', 'x')], shared);
  assert.match(full.results[0].error.message, /owner of this folder/);
});

test('upload: needs at least one file, folder must exist and be live', async () => {
  const w = createWorld();
  await assert.rejects(up(w, w.alice, []), code(422));
  await assert.rejects(up(w, w.alice, [w.storage.stage('a.txt', 'x')], uuid(404)), code(404));
  const f = await w.mkFolder(w.alice, 'F');
  await w.folders.remove(w.alice, f);
  await assert.rejects(up(w, w.alice, [w.storage.stage('a.txt', 'x')], f), code(404));
});

test('upload warns once when usage crosses the threshold', async () => {
  const w = createWorld({ quota: 100n, warnPercent: 80 });
  await up(w, w.alice, [w.storage.stage('a.txt', 'x'.repeat(79))]);
  await up(w, w.alice, [w.storage.stage('b.txt', 'xx'), w.storage.stage('c.txt', 'x')]);
  await w.settle();
  assert.equal(w.s.notes.filter((n) => n.type === 'STORAGE_WARNING').length, 1);
});

test('get: shows details with capabilities; hides files from strangers; honours trash', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'a.pdf');
  const mine = await w.files.get(w.alice, f.id);
  assert.equal(mine.access.capabilities.delete, true);
  await assert.rejects(w.files.get(w.bob, f.id), code(404));
  w.shareFile(f.id, BOB, 'VIEWER');
  const theirs = await w.files.get(w.bob, f.id);
  assert.equal(theirs.access.capabilities.update, false);
  assert.equal(theirs.access.capabilities.read, true);
  await w.files.remove(w.alice, f.id);
  await assert.rejects(w.files.get(w.alice, f.id), code(404));
  await assert.rejects(w.files.get(w.alice, 'not-a-uuid'), code(404));
});

test('"shared" is reported to the owner but never to the people it is shared with', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'a.pdf');
  w.shareFile(f.id, BOB, 'VIEWER');
  w.shareFile(f.id, CAROL, 'VIEWER');
  assert.equal((await w.files.get(w.alice, f.id)).shared, true);
  assert.equal((await w.files.get(w.bob, f.id)).shared, false);
});

test('rename: keeps the extension, rejects conflicts, allows case-only changes', async () => {
  const w = createWorld();
  const a = await w.upload(w.alice, 'a.pdf');
  await w.upload(w.alice, 'b.pdf');
  assert.equal((await w.files.update(w.alice, a.id, { name: 'notes' })).name, 'notes.pdf');
  assert.equal((await w.files.update(w.alice, a.id, { name: 'v2.final' })).name, 'v2.final.pdf');
  assert.equal((await w.files.update(w.alice, a.id, { name: 'v2.FINAL.PDF' })).name, 'v2.FINAL.PDF');
  await assert.rejects(w.files.update(w.alice, a.id, { name: 'B.pdf' }), code('NAME_TAKEN'));
  await assert.rejects(w.files.update(w.alice, a.id, { name: '../x' }), code(422));
  assert.equal(w.logs.filter((l) => l.action === 'FILE_RENAME').length, 3);
});

test('move: between folders and to root; conflicts; cross-owner; editors vs viewers', async () => {
  const w = createWorld();
  const d1 = await w.mkFolder(w.alice, 'D1');
  const d2 = await w.mkFolder(w.alice, 'D2');
  const f = await w.upload(w.alice, 'a.pdf', 'x', d1);
  await w.upload(w.alice, 'a.pdf', 'y', d2);
  await assert.rejects(w.files.update(w.alice, f.id, { folderId: d2 }), code('NAME_TAKEN'));
  const toRoot = await w.files.update(w.alice, f.id, { folderId: null });
  assert.equal(toRoot.folderId, null);
  const back = await w.files.update(w.alice, f.id, { folderId: d1 });
  assert.equal(back.folderId, d1);

  const bobsFolder = await w.mkFolder(w.bob, 'Bobs');
  w.shareFolder(bobsFolder, ALICE, 'EDITOR');
  await assert.rejects(w.files.update(w.alice, f.id, { folderId: bobsFolder }), code('CROSS_OWNER_MOVE'));

  w.shareFolder(d1, BOB, 'EDITOR');
  w.shareFolder(d2, BOB, 'VIEWER');
  await assert.rejects(w.files.update(w.bob, f.id, { folderId: d2 }), code(403)); // viewer on the destination
  await assert.rejects(w.files.update(w.bob, f.id, { folderId: null }), code('CROSS_OWNER_MOVE'));
  const moved = await w.files.update(w.bob, f.id, { name: 'renamed-by-bob' });
  assert.equal(moved.name, 'renamed-by-bob.pdf');
});

test('delete: owner only, moves to trash, keeps the blob and the quota', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'a.pdf', 'hello');
  w.shareFile(f.id, BOB, 'EDITOR');
  await assert.rejects(w.files.remove(w.bob, f.id), code(403));
  await w.files.remove(w.alice, f.id);
  assert.ok(w.s.files[0].deletedAt);
  assert.equal(w.s.files[0].trashBatchId, f.id);
  assert.equal(w.storage.blobs.size, 1);
  assert.equal(w.user(ALICE).used, 5n);
  await assert.rejects(w.files.remove(w.alice, f.id), code(404)); // already trashed
});

test('delivery: download needs download rights, preview only for previewable types', async () => {
  const w = createWorld();
  const pdf = await w.upload(w.alice, 'a.pdf', 'pdfdata');
  const doc = await w.upload(w.alice, 'b.docx', 'docdata');
  w.shareFile(pdf.id, BOB, 'VIEWER', false);

  const d = await w.files.prepareDelivery(w.alice, pdf.id, 'download');
  assert.equal(d.disposition, 'attachment');
  assert.equal(d.size, 7);
  assert.equal(d.mimeType, 'application/pdf');
  assert.equal(d.filename, 'a.pdf');
  assert.equal(d.key, `versions/users/${ALICE}/${pdf.id}/v1`);
  assert.equal(w.logs.at(-1).action, 'FILE_DOWNLOAD');
  await w.settle();
  assert.ok(w.s.files.find((f) => f.id === pdf.id).lastAccessedAt);

  const p = await w.files.prepareDelivery(w.alice, pdf.id, 'preview');
  assert.equal(p.disposition, 'inline');
  await assert.rejects(w.files.prepareDelivery(w.alice, doc.id, 'preview'), code('PREVIEW_NOT_SUPPORTED'));

  await assert.rejects(w.files.prepareDelivery(w.bob, pdf.id, 'download'), code(403)); // canDownload=false
  assert.ok(await w.files.prepareDelivery(w.bob, pdf.id, 'preview')); // viewing is still allowed
  await assert.rejects(w.files.prepareDelivery(w.carol, pdf.id, 'preview'), code(404));
  const noDownloadRole = actor(BOB, VIEWER.filter((p2) => p2 !== 'file:download'));
  w.shareFile(doc.id, BOB, 'VIEWER', true);
  await assert.rejects(w.files.prepareDelivery(noDownloadRole, doc.id, 'download'), code(403)); // RBAC layer
});

test('access-url: signs a short-lived URL bound to user, file and purpose', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'pic.png', 'png');
  const { url, expiresAt } = await w.files.createAccessUrl(w.alice, f.id, 'preview');
  assert.match(url, new RegExp(`^/api/v1/files/${f.id}/preview\\?st=`));
  assert.ok(expiresAt > new Date('2026-05-31'));
  const token = decodeURIComponent(url.split('st=')[1]);
  assert.deepEqual(w.accessTokens.verify(token), { userId: ALICE, fileId: f.id, purpose: 'preview', version: undefined });
  await assert.rejects(w.files.createAccessUrl(w.bob, f.id, 'preview'), code(404)); // cannot mint for files you cannot see
  const doc = await w.upload(w.alice, 'x.docx', 'd');
  await assert.rejects(w.files.createAccessUrl(w.alice, doc.id, 'preview'), code('PREVIEW_NOT_SUPPORTED'));
  assert.ok(await w.files.createAccessUrl(w.alice, doc.id, 'download'));
});
