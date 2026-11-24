import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, actor, ALICE, BOB, CAROL, VIEWER, uuid } from './helpers/driveFakes.js';

const code = (c) => (e) => e.code === c || e.statusCode === c;
const names = (list) => list.map((x) => x.name);

test('create: root folder, nested folder, materialised paths, activity', async () => {
  const w = createWorld();
  const a = await w.folders.create(w.alice, { name: ' Projects ' });
  assert.equal(a.name, 'Projects');
  assert.equal(a.parentId, null);
  assert.equal(a.access.level, 'OWNER');
  const b = await w.folders.create(w.alice, { name: 'Q1', parentId: a.id });
  const rowA = w.s.folders.find((f) => f.id === a.id);
  const rowB = w.s.folders.find((f) => f.id === b.id);
  assert.equal(rowA.path, `/${a.id}/`);
  assert.equal(rowB.path, `/${a.id}/${b.id}/`);
  assert.deepEqual(w.logs.map((l) => l.action), ['FOLDER_CREATE', 'FOLDER_CREATE']);
});

test('create: duplicate names conflict case-insensitively, but only among live siblings', async () => {
  const w = createWorld();
  const id = await w.mkFolder(w.alice, 'Docs');
  await assert.rejects(w.folders.create(w.alice, { name: 'docs' }), code('NAME_TAKEN'));
  await w.mkFolder(w.alice, 'docs', id); // same name, different parent: fine
  await w.mkFolder(w.bob, 'Docs'); // different owner: fine
  await w.folders.remove(w.alice, id);
  await w.mkFolder(w.alice, 'Docs'); // the trashed one no longer blocks the name
});

test('create: invalid names, missing parent and depth limit', async () => {
  const w = createWorld();
  await assert.rejects(w.folders.create(w.alice, { name: 'a/b' }), code(422));
  await assert.rejects(w.folders.create(w.alice, { name: 'x', parentId: uuid(999) }), code(404));
  let parent = null;
  for (let i = 0; i < 20; i += 1) parent = await w.mkFolder(w.alice, `d${i}`, parent);
  await assert.rejects(w.folders.create(w.alice, { name: 'too-deep', parentId: parent }), code(422));
});

test('create inside a shared folder: Editor allowed (owner keeps ownership), Viewer refused, stranger sees 404', async () => {
  const w = createWorld();
  const shared = await w.mkFolder(w.alice, 'Shared');
  w.shareFolder(shared, BOB, 'EDITOR');
  w.shareFolder(shared, CAROL, 'VIEWER');
  const child = await w.folders.create(w.bob, { name: 'By Bob', parentId: shared });
  assert.equal(child.ownerId, ALICE); // ownership invariant
  await assert.rejects(w.folders.create(w.carol, { name: 'nope', parentId: shared }), code(403));
  const dave = actor(uuid(9));
  await assert.rejects(w.folders.create(dave, { name: 'nope', parentId: shared }), code(404));
});

test('a global Viewer role cannot write even as share Editor (two-layer rule)', async () => {
  const w = createWorld();
  const shared = await w.mkFolder(w.alice, 'Shared');
  w.shareFolder(shared, BOB, 'EDITOR');
  const bobViewer = actor(BOB, VIEWER);
  await assert.rejects(w.folders.update(bobViewer, shared, { name: 'x' }), code(403));
  assert.ok(await w.folders.contents(bobViewer, shared)); // reading is fine
});

test('contents: root listing with files, pagination, search, type filter and sort', async () => {
  const w = createWorld();
  const docs = await w.mkFolder(w.alice, 'Docs');
  await w.mkFolder(w.alice, 'Archive');
  await w.upload(w.alice, 'b.pdf', 'bb');
  await w.upload(w.alice, 'a.txt', 'a');
  await w.upload(w.alice, 'c.png', 'cccc');
  await w.upload(w.alice, 'inside.pdf', 'x', docs);

  const root = await w.folders.contents(w.alice, null, {});
  assert.deepEqual(names(root.folders), ['Archive', 'Docs']);
  assert.deepEqual(names(root.files), ['a.txt', 'b.pdf', 'c.png']);
  assert.equal(root.folder, null);
  assert.deepEqual(root.breadcrumbs, []);
  assert.equal(root.meta.total, 3);
  assert.equal(root.folders.find((f) => f.name === 'Docs').itemCount, 1);

  const bySize = await w.folders.contents(w.alice, null, { sort: 'size', order: 'desc' });
  assert.deepEqual(names(bySize.files), ['c.png', 'b.pdf', 'a.txt']);
  const bogus = await w.folders.contents(w.alice, null, { sort: 'passwordHash', order: 'sideways' });
  assert.deepEqual(names(bogus.files), ['a.txt', 'b.pdf', 'c.png']); // falls back to name asc

  const page = await w.folders.contents(w.alice, null, { page: 2, limit: 2 });
  assert.deepEqual(names(page.files), ['c.png']);
  assert.equal(page.meta.totalPages, 2);

  const q = await w.folders.contents(w.alice, null, { q: 'ARCH' });
  assert.deepEqual(names(q.folders), ['Archive']);
  const typed = await w.folders.contents(w.alice, null, { type: 'image' });
  assert.deepEqual(names(typed.files), ['c.png']);
  assert.deepEqual(typed.folders, []); // folders have no type

  const inDocs = await w.folders.contents(w.alice, docs, {});
  assert.deepEqual(names(inDocs.files), ['inside.pdf']);
  assert.deepEqual(inDocs.breadcrumbs, [{ id: docs, name: 'Docs' }]);
});

test('contents: items in other drives and trash never appear', async () => {
  const w = createWorld();
  await w.upload(w.alice, 'mine.pdf');
  await w.upload(w.bob, 'bobs.pdf');
  const gone = await w.upload(w.alice, 'gone.pdf');
  await w.files.remove(w.alice, gone.id);
  assert.deepEqual(names((await w.folders.contents(w.alice, null, {})).files), ['mine.pdf']);
});

test('contents of a shared folder: sharee gets inherited access and a trimmed breadcrumb', async () => {
  const w = createWorld();
  const top = await w.mkFolder(w.alice, 'Private top');
  const shared = await w.mkFolder(w.alice, 'Shared', top);
  const deeper = await w.mkFolder(w.alice, 'Deeper', shared);
  await w.upload(w.alice, 'doc.pdf', 'x', shared);
  w.shareFolder(shared, BOB, 'VIEWER', false);

  const view = await w.folders.contents(w.bob, deeper, {});
  assert.deepEqual(view.breadcrumbs.map((b) => b.name), ['Shared', 'Deeper']); // "Private top" is hidden
  const listing = await w.folders.contents(w.bob, shared, {});
  assert.equal(listing.files[0].access.level, 'VIEWER');
  assert.equal(listing.files[0].access.capabilities.download, false); // canDownload=false is honoured
  assert.equal(listing.files[0].shared, false); // sharing state is only shown to owners
  await assert.rejects(w.folders.contents(w.bob, top, {}), code(404)); // the parent is not shared
  const own = await w.folders.contents(w.alice, deeper, {});
  assert.deepEqual(own.breadcrumbs.map((b) => b.name), ['Private top', 'Shared', 'Deeper']);
});

test('contents: a trashed folder is 404', async () => {
  const w = createWorld();
  const id = await w.mkFolder(w.alice, 'Temp');
  await w.folders.remove(w.alice, id);
  await assert.rejects(w.folders.contents(w.alice, id, {}), code(404));
});

test('rename: conflicts, case-only rename, no-op', async () => {
  const w = createWorld();
  const a = await w.mkFolder(w.alice, 'A');
  await w.mkFolder(w.alice, 'B');
  await assert.rejects(w.folders.update(w.alice, a, { name: 'b' }), code('NAME_TAKEN'));
  const renamed = await w.folders.update(w.alice, a, { name: 'a' }); // only the case changes: not a conflict with itself
  assert.equal(renamed.name, 'a');
  const same = await w.folders.update(w.alice, a, { name: 'a' });
  assert.equal(same.name, 'a');
  assert.equal(w.logs.filter((l) => l.action === 'FOLDER_RENAME').length, 1);
});

test('move: rewrites descendant paths and rejects cycles, cross-owner moves and conflicts', async () => {
  const w = createWorld();
  const a = await w.mkFolder(w.alice, 'A');
  const b = await w.mkFolder(w.alice, 'B', a);
  const c = await w.mkFolder(w.alice, 'C', b);
  const other = await w.mkFolder(w.alice, 'Other');
  const path = (id) => w.s.folders.find((f) => f.id === id).path;

  await w.folders.update(w.alice, b, { parentId: other });
  assert.equal(path(b), `/${other}/${b}/`);
  assert.equal(path(c), `/${other}/${b}/${c}/`); // descendant followed

  await assert.rejects(w.folders.update(w.alice, other, { parentId: c }), code('INVALID_MOVE')); // into own descendant
  await assert.rejects(w.folders.update(w.alice, other, { parentId: other }), code('INVALID_MOVE')); // into itself
  const bobsFolder = await w.mkFolder(w.bob, 'Bobs');
  await assert.rejects(w.folders.update(w.alice, a, { parentId: bobsFolder }), code(404)); // not visible to Alice at all
  w.shareFolder(bobsFolder, ALICE, 'EDITOR');
  await assert.rejects(w.folders.update(w.alice, a, { parentId: bobsFolder }), code('CROSS_OWNER_MOVE'));

  await w.mkFolder(w.alice, 'B'); // now a "B" exists at the root
  await assert.rejects(w.folders.update(w.alice, b, { parentId: null }), code('NAME_TAKEN'));
  await w.folders.update(w.alice, b, { parentId: null, name: 'B2' }); // move + rename together
  assert.equal(path(c), `/${b}/${c}/`);
});

test('move to root is owner-only', async () => {
  const w = createWorld();
  const shared = await w.mkFolder(w.alice, 'Shared');
  const inner = await w.mkFolder(w.alice, 'Inner', shared);
  w.shareFolder(shared, BOB, 'EDITOR');
  await assert.rejects(w.folders.update(w.bob, inner, { parentId: null }), code('CROSS_OWNER_MOVE'));
});

test('remove: owner only; soft-deletes the whole subtree with one batch id', async () => {
  const w = createWorld();
  const a = await w.mkFolder(w.alice, 'A');
  const b = await w.mkFolder(w.alice, 'B', a);
  const f1 = await w.upload(w.alice, 'one.pdf', '1', a);
  const f2 = await w.upload(w.alice, 'two.pdf', '2', b);
  const untouched = await w.upload(w.alice, 'keep.pdf', 'k');
  w.shareFolder(a, BOB, 'EDITOR');
  await assert.rejects(w.folders.remove(w.bob, a), code(403)); // editors cannot delete
  await w.folders.remove(w.alice, a);
  const state = (id) => [...w.s.folders, ...w.s.files].find((x) => x.id === id);
  for (const id of [a, b, f1.id, f2.id]) {
    assert.ok(state(id).deletedAt, id);
    assert.equal(state(id).trashBatchId, a);
  }
  assert.equal(state(untouched.id).deletedAt, null);
  await assert.rejects(w.folders.contents(w.bob, a, {}), code(404)); // the trash is owner-only
  assert.equal(w.logs.at(-1).action, 'FOLDER_DELETE');
});
