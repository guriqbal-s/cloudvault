import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, actor, ALICE, BOB, VIEWER } from './helpers/driveFakes.js';

const code = (c) => (e) => e.code === c || e.statusCode === c;
const names = (l) => l.map((x) => x.name).sort();

async function tree(w) {
  const top = await w.mkFolder(w.alice, 'Top');
  const sub = await w.mkFolder(w.alice, 'Sub', top);
  const f1 = await w.upload(w.alice, 'one.txt', '1', top);
  const f2 = await w.upload(w.alice, 'two.txt', '22', sub);
  const loose = await w.upload(w.alice, 'loose.txt', '333');
  return { top, sub, f1, f2, loose };
}

test('list shows only what the user deleted, not the contents of deleted folders', async () => {
  const w = createWorld();
  const { top, loose } = await tree(w);
  await w.folders.remove(w.alice, top);
  await w.files.remove(w.alice, loose.id);
  const t = await w.trash.list(w.alice);
  assert.deepEqual(names(t.folders), ['Top']);
  assert.deepEqual(names(t.files), ['loose.txt']);
  assert.equal(t.files[0].deletedAt instanceof Date, true);
  assert.deepEqual((await w.trash.list(w.bob)), { files: [], folders: [] });
});

test('restore a folder brings back its whole subtree (and only its own batch)', async () => {
  const w = createWorld();
  const { top, sub, f1, f2 } = await tree(w);
  await w.files.remove(w.alice, f2.id); // trashed earlier, on its own
  await w.folders.remove(w.alice, top);
  const restored = await w.trash.restore(w.alice, 'folders', top);
  assert.equal(restored.name, 'Top');
  const live = (id) => ![...w.s.folders, ...w.s.files].find((x) => x.id === id).deletedAt;
  assert.ok(live(top) && live(sub) && live(f1.id));
  assert.equal(live(f2.id), false); // deleted separately: stays in the trash
  const t = await w.trash.list(w.alice);
  assert.deepEqual(names(t.files), ['two.txt']); // still offered for restore on its own
  assert.equal(w.logs.at(-1).action, 'FOLDER_RESTORE');
});

test('restore a file: back to its folder, or to the root when the folder is gone; renames on conflict', async () => {
  const w = createWorld();
  const { top, f1 } = await tree(w);
  await w.files.remove(w.alice, f1.id);
  await w.upload(w.alice, 'one.txt', 'new', top); // someone took the name meanwhile
  const back = await w.trash.restore(w.alice, 'files', f1.id);
  assert.equal(back.name, 'one (1).txt');
  assert.equal(back.folderId, top);

  await w.files.remove(w.alice, f1.id);
  await w.folders.remove(w.alice, top); // parent trashed after the file
  const orphan = await w.trash.restore(w.alice, 'files', f1.id);
  assert.equal(orphan.folderId, null); // parent is in the trash, so it goes to the top level
  assert.equal(w.logs.at(-1).action, 'FILE_RESTORE');
});

test('restore a folder whose parent is trashed moves it to the root with corrected paths, renaming on conflict', async () => {
  const w = createWorld();
  const { top, sub, f2 } = await tree(w);
  await w.folders.remove(w.alice, sub);
  await w.folders.remove(w.alice, top);
  await w.mkFolder(w.alice, 'Sub'); // name taken at the root
  const restored = await w.trash.restore(w.alice, 'folders', sub);
  assert.equal(restored.name, 'Sub (1)');
  assert.equal(restored.parentId, null);
  assert.equal(w.s.folders.find((f) => f.id === sub).path, `/${sub}/`);
  assert.equal(w.s.files.find((f) => f.id === f2.id).deletedAt, null);
  const inside = await w.folders.contents(w.alice, sub, {});
  assert.deepEqual(names(inside.files), ['two.txt']);
});

test('restore: only roots, only trashed items, only the owner', async () => {
  const w = createWorld();
  const { top, sub, f2, loose } = await tree(w);
  await assert.rejects(w.trash.restore(w.alice, 'files', loose.id), code(400)); // not in trash
  await w.folders.remove(w.alice, top);
  await assert.rejects(w.trash.restore(w.alice, 'folders', sub), code('RESTORE_PARENT_FIRST'));
  await assert.rejects(w.trash.restore(w.alice, 'files', f2.id), code('RESTORE_PARENT_FIRST'));
  await assert.rejects(w.trash.restore(w.bob, 'folders', top), code(404));
  w.shareFolder(top, BOB, 'EDITOR');
  await assert.rejects(w.trash.restore(w.bob, 'folders', top), code(404)); // trash is owner-only even for sharees
  await assert.rejects(w.trash.restore(actor(ALICE, VIEWER), 'folders', top), code(403)); // RBAC still applies
});

test('purge: deletes rows and blobs for the whole subtree and refunds every version', async () => {
  const w = createWorld();
  const { top, f1, f2, loose } = await tree(w);
  await w.versions.upload(w.alice, f2.id, { file: w.storage.stage('two.txt', '4444') });
  assert.equal(w.user(ALICE).used, 1n + 2n + 3n + 4n);
  await w.folders.remove(w.alice, top);
  const result = await w.trash.purge(w.alice, 'folders', top);
  assert.deepEqual(result, { files: 2, folders: 2, bytes: 1 + 2 + 4 });
  assert.equal(w.s.folders.length, 0);
  assert.deepEqual(w.s.files.map((f) => f.id), [loose.id]);
  assert.equal(w.s.versions.length, 1);
  assert.equal(w.user(ALICE).used, 3n);
  assert.deepEqual([...w.storage.blobs.keys()], [`versions/users/${ALICE}/${loose.id}/v1`]);
  assert.equal(w.logs.at(-1).action, 'FOLDER_PERMANENT_DELETE');
  await assert.rejects(w.trash.purge(w.alice, 'folders', top), code(404));
  await assert.rejects(w.trash.purge(w.alice, 'files', loose.id), code(400)); // live files cannot be purged directly
  void f1;
});

test('purging a folder also removes items that were trashed on their own inside it', async () => {
  const w = createWorld();
  const { top, f2 } = await tree(w);
  await w.files.remove(w.alice, f2.id); // separate batch, inside "Sub"
  await w.folders.remove(w.alice, top);
  await w.trash.purge(w.alice, 'folders', top);
  assert.equal(w.s.files.some((f) => f.id === f2.id), false);
  assert.equal(w.user(ALICE).used, 3n); // only loose.txt remains charged
  assert.ok(![...w.storage.blobs.keys()].some((k) => k.includes(f2.id)));
});

test('a blob cleanup failure does not undo the purge (orphans are logged)', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'a.txt', 'abc');
  await w.files.remove(w.alice, f.id);
  w.storage.deletePrefix = async () => { throw new Error('disk error'); };
  const r = await w.trash.purge(w.alice, 'files', f.id);
  assert.equal(r.files, 1);
  assert.equal(w.s.files.length, 0);
  assert.equal(w.user(ALICE).used, 0n);
  assert.ok(w.errors.length);
});

test('purge database failure rolls back rows and quota together', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'a.txt', 'abc');
  await w.files.remove(w.alice, f.id);
  const original = w.repo.deleteRows;
  w.repo.deleteRows = async (args) => { await original(args); throw new Error('boom'); };
  await assert.rejects(w.trash.purge(w.alice, 'files', f.id), /boom/);
  w.repo.deleteRows = original;
  assert.equal(w.s.files.length, 1); // rolled back
  assert.equal(w.user(ALICE).used, 3n);
  assert.equal(w.storage.blobs.size, 1); // blobs only go after a successful commit
});

test('empty trash purges every root of the caller only', async () => {
  const w = createWorld();
  const { top, loose } = await tree(w);
  const bobs = await w.upload(w.bob, 'b.txt', 'bb');
  await w.files.remove(w.bob, bobs.id);
  await w.folders.remove(w.alice, top);
  await w.files.remove(w.alice, loose.id);
  const total = await w.trash.empty(w.alice);
  assert.deepEqual(total, { files: 3, folders: 2, bytes: 6 });
  assert.equal(w.s.files.length, 1); // Bob's trashed file untouched
  assert.equal(w.user(ALICE).used, 0n);
  assert.deepEqual(await w.trash.empty(w.alice), { files: 0, folders: 0, bytes: 0 });
});

test('purgeExpired removes only roots older than the retention period', async () => {
  const w = createWorld();
  const old = await w.upload(w.alice, 'old.txt', 'o');
  const recent = await w.upload(w.alice, 'recent.txt', 'r');
  const oldFolder = await w.mkFolder(w.alice, 'OldFolder');
  await w.upload(w.alice, 'in.txt', 'i', oldFolder);
  await w.files.remove(w.alice, old.id);
  await w.files.remove(w.alice, recent.id);
  await w.folders.remove(w.alice, oldFolder);
  const now = new Date('2026-06-01T00:00:00Z');
  const days = (n) => new Date(now.getTime() - n * 86_400_000);
  w.s.files.find((f) => f.id === old.id).deletedAt = days(31);
  w.s.files.find((f) => f.id === recent.id).deletedAt = days(29);
  for (const x of [...w.s.folders, ...w.s.files].filter((x) => x.trashBatchId === oldFolder)) x.deletedAt = days(40);

  const r = await w.trash.purgeExpired(now);
  assert.deepEqual({ items: r.items, failed: r.failed }, { items: 2, failed: 0 });
  assert.deepEqual(w.s.files.map((f) => f.name), ['recent.txt']);
  assert.equal(w.s.folders.length, 0);
});

test('purgeExpired keeps going when one item fails', async () => {
  const w = createWorld();
  const a = await w.upload(w.alice, 'a.txt', 'a');
  const b = await w.upload(w.alice, 'b.txt', 'b');
  for (const f of [a, b]) await w.files.remove(w.alice, f.id);
  for (const f of w.s.files) f.deletedAt = new Date('2020-01-01');
  const original = w.repo.collectPurge;
  let n = 0;
  w.repo.collectPurge = async (args) => { if (n++ === 0) throw new Error('boom'); return original(args); };
  const r = await w.trash.purgeExpired(new Date('2026-06-01'));
  assert.deepEqual({ items: r.items, failed: r.failed }, { items: 1, failed: 1 });
});
