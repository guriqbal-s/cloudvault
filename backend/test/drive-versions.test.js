import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, actor, ALICE, BOB, CAROL, VIEWER } from './helpers/driveFakes.js';

const code = (c) => (e) => e.code === c || e.statusCode === c;
const staged = (w, name, content) => ({ file: w.storage.stage(name, content) });

test('upload version: numbers increment, file becomes the new content, quota and notifications follow', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'doc.txt', 'v1');
  w.shareFile(f.id, BOB, 'EDITOR');
  w.shareFile(f.id, CAROL, 'VIEWER');
  const before = w.s.notes.length;

  const v2 = await w.versions.upload(w.bob, f.id, { ...staged(w, 'whatever.txt', 'version two'), comment: '  fixed typos ' });
  assert.equal(v2.number, 2);
  assert.equal(v2.comment, 'fixed typos');
  assert.equal(v2.isCurrent, true);
  assert.equal(v2.uploadedBy.id, BOB);

  const row = w.s.files[0];
  assert.equal(row.size, 11n);
  assert.equal(row.currentVersionId, w.s.versions[1].id);
  assert.equal(w.storage.blobs.get(`versions/users/${ALICE}/${f.id}/v2`).toString(), 'version two');
  assert.equal(w.user(ALICE).used, 2n + 11n); // charged to the owner, not to Bob
  assert.equal(w.user(BOB).used, 0n);
  assert.equal(w.logs.at(-1).action, 'VERSION_CREATE');

  await w.settle();
  const fresh = w.s.notes.slice(before);
  assert.deepEqual(fresh.map((n) => `${n.userId.slice(-1)}:${n.type}`).sort(), ['1:SHARED_FILE_UPDATED', '3:SHARED_FILE_UPDATED']); // owner + other sharee, not the actor

  const list = await w.versions.list(w.alice, f.id);
  assert.deepEqual(list.map((v) => [v.number, v.isCurrent]), [[2, true], [1, false]]);
});

test('upload version: viewers refused, extension must match, size and quota limits, staged file removed', async () => {
  const w = createWorld({ maxUploadBytes: 10, quota: 15n });
  const f = await w.upload(w.alice, 'doc.txt', 'abcde');
  w.shareFile(f.id, CAROL, 'VIEWER');
  const s1 = w.storage.stage('x.txt', 'zz');
  await assert.rejects(w.versions.upload(w.carol, f.id, { file: s1 }), code(403));
  await assert.rejects(w.versions.upload(w.alice, f.id, staged(w, 'x.pdf', 'zz')), code('EXTENSION_MISMATCH'));
  await assert.rejects(w.versions.upload(w.alice, f.id, staged(w, 'x.txt', 'x'.repeat(11))), code('FILE_TOO_LARGE'));
  await w.versions.upload(w.alice, f.id, staged(w, 'x.txt', 'x'.repeat(10))); // 15 used: full
  await assert.rejects(w.versions.upload(w.alice, f.id, staged(w, 'x.txt', 'y')), code('QUOTA_EXCEEDED'));
  await assert.rejects(w.versions.upload(w.alice, f.id, {}), code(422));
  assert.equal(w.s.versions.length, 2);
  assert.equal(w.storage.staged.size, 0); // nothing left behind
  assert.equal(w.user(ALICE).used, 15n);
});

test('upload version: failure after storing removes the blob and refunds quota', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'doc.txt', 'abc');
  const original = w.repo.addVersion;
  w.repo.addVersion = async () => { throw new Error('db down'); };
  await assert.rejects(w.versions.upload(w.alice, f.id, staged(w, 'doc.txt', 'new')), /db down/);
  w.repo.addVersion = original;
  assert.equal(w.storage.blobs.size, 1);
  assert.equal(w.user(ALICE).used, 3n);
  w.repo.addVersion = async () => { throw Object.assign(new Error('x'), { code: 'VERSION_CONFLICT' }); };
  await assert.rejects(w.versions.upload(w.alice, f.id, staged(w, 'doc.txt', 'new')), code('VERSION_CONFLICT'));
});

test('restore: copies the old content into a NEW latest version and keeps history', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'doc.txt', 'one');
  await w.versions.upload(w.alice, f.id, staged(w, 'doc.txt', 'twotwo'));
  const restored = await w.versions.restore(w.alice, f.id, 1);
  assert.equal(restored.number, 3);
  assert.equal(restored.comment, 'Restored from version 1');
  assert.equal(w.storage.blobs.get(`versions/users/${ALICE}/${f.id}/v3`).toString(), 'one');
  assert.equal(w.s.files[0].size, 3n);
  assert.equal(w.s.versions.length, 3);
  assert.equal(w.s.versions[2].checksum, w.s.versions[0].checksum);
  assert.equal(w.user(ALICE).used, 3n + 6n + 3n);
  assert.equal(w.logs.at(-1).action, 'VERSION_RESTORE');
  await assert.rejects(w.versions.restore(w.alice, f.id, 3), code(400)); // already current
  await assert.rejects(w.versions.restore(w.alice, f.id, 99), code(404));
});

test('restore is refused for viewers and when quota is exhausted', async () => {
  const w = createWorld({ quota: 6n });
  const f = await w.upload(w.alice, 'doc.txt', 'one');
  await w.versions.upload(w.alice, f.id, staged(w, 'doc.txt', 'two'));
  w.shareFile(f.id, CAROL, 'VIEWER');
  await assert.rejects(w.versions.restore(w.carol, f.id, 1), code(403));
  await assert.rejects(w.versions.restore(w.alice, f.id, 1), code('QUOTA_EXCEEDED'));
  assert.equal(w.s.versions.length, 2);
});

test('download a specific version: honours canDownload and records the download', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'doc.txt', 'one');
  await w.versions.upload(w.alice, f.id, staged(w, 'doc.txt', 'twotwo'));
  const d = await w.versions.prepareDownload(w.alice, f.id, 1);
  assert.equal(d.key, `versions/users/${ALICE}/${f.id}/v1`);
  assert.equal(d.size, 3);
  w.shareFile(f.id, BOB, 'VIEWER', false);
  await assert.rejects(w.versions.prepareDownload(w.bob, f.id, 1), code(403));
  await assert.rejects(w.versions.prepareDownload(w.alice, f.id, 7), code(404));
  await assert.rejects(w.versions.prepareDownload(actor(CAROL), f.id, 1), code(404));
});

test('delete version: owner only, never the current one, refunds quota and removes the blob', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'doc.txt', 'one');
  await w.versions.upload(w.alice, f.id, staged(w, 'doc.txt', 'twotwo'));
  w.shareFile(f.id, BOB, 'EDITOR');
  await assert.rejects(w.versions.remove(w.bob, f.id, 1), code(403));
  await assert.rejects(w.versions.remove(w.alice, f.id, 2), code('CURRENT_VERSION'));
  await w.versions.remove(w.alice, f.id, 1);
  assert.equal(w.s.versions.length, 1);
  assert.equal(w.user(ALICE).used, 6n);
  assert.equal(w.storage.blobs.has(`versions/users/${ALICE}/${f.id}/v1`), false);
  assert.equal(w.logs.at(-1).action, 'VERSION_DELETE');
  const roleless = actor(ALICE, VIEWER);
  await assert.rejects(w.versions.remove(roleless, f.id, 1), code(403));
});

test('version numbers never get reused after a deletion (storage keys stay unique)', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'doc.txt', 'one');
  await w.versions.upload(w.alice, f.id, staged(w, 'doc.txt', 'two')); // v2
  await w.versions.upload(w.alice, f.id, staged(w, 'doc.txt', 'three')); // v3 current
  await w.versions.remove(w.alice, f.id, 2);
  const v4 = await w.versions.upload(w.alice, f.id, staged(w, 'doc.txt', 'four'));
  assert.equal(v4.number, 4);
});
