import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSearchFilter } from '../src/services/drive/library.logic.js';
import { createWorld, actor, ALICE, BOB, CAROL, uuid } from './helpers/driveFakes.js';

const code = (c) => (e) => e.code === c || e.statusCode === c;
const names = (l) => l.map((x) => x.name);

// -------------------------------------------------------------- starred
test('star / unstar: idempotent, logged once, requires visibility', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'a.txt');
  const d = await w.mkFolder(w.alice, 'D');
  await w.library.star(w.alice, 'files', f.id);
  await w.library.star(w.alice, 'files', f.id); // again: still fine
  await w.library.star(w.alice, 'folders', d);
  assert.equal(w.logs.filter((l) => l.action === 'STAR').length, 2);
  const listed = await w.library.listStarred(w.alice);
  assert.deepEqual([names(listed.files), names(listed.folders)], [['a.txt'], ['D']]);
  assert.equal(listed.files[0].starred, true);

  assert.deepEqual(await w.library.unstar(w.alice, 'files', f.id), { starred: false });
  await w.library.unstar(w.alice, 'files', f.id); // second time is a no-op
  assert.equal(w.logs.filter((l) => l.action === 'UNSTAR').length, 1);

  await assert.rejects(w.library.star(w.bob, 'folders', d), code(404)); // cannot star what you cannot see
  await assert.rejects(w.library.star(w.alice, 'files', uuid(404)), code(404));
});

test('starred: trashed items disappear and revoked shares stop leaking', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'a.txt');
  const g = await w.upload(w.alice, 'b.txt');
  w.shareFile(f.id, BOB, 'VIEWER');
  w.shareFile(g.id, BOB, 'VIEWER');
  await w.library.star(w.bob, 'files', f.id);
  await w.library.star(w.bob, 'files', g.id);
  assert.equal((await w.library.listStarred(w.bob)).files.length, 2);
  w.s.fileShares.splice(0, 1); // share on a.txt revoked
  await w.files.remove(w.alice, g.id); // b.txt trashed by the owner
  assert.deepEqual((await w.library.listStarred(w.bob)).files, []);
  assert.deepEqual(names((await w.library.listStarred(w.bob)).folders), []);
});

test('starred flags appear in folder listings per user', async () => {
  const w = createWorld();
  const f = await w.upload(w.alice, 'a.txt');
  await w.library.star(w.alice, 'files', f.id);
  assert.equal((await w.folders.contents(w.alice, null, {})).files[0].starred, true);
  w.shareFile(f.id, BOB, 'VIEWER');
  assert.equal((await w.files.get(w.bob, f.id)).starred, false);
});

// --------------------------------------------------------------- recent
test('recent: own live files ordered by last opened OR modified, deduplicated, limited', async () => {
  const w = createWorld();
  const a = await w.upload(w.alice, 'a.txt');
  const b = await w.upload(w.alice, 'b.txt');
  const c = await w.upload(w.alice, 'c.txt');
  const gone = await w.upload(w.alice, 'gone.txt');
  await w.upload(w.bob, 'bobs.txt');
  await w.files.remove(w.alice, gone.id);
  assert.deepEqual(names(await w.library.recent(w.alice)), ['c.txt', 'b.txt', 'a.txt']); // by modification
  w.s.files.find((f) => f.id === a.id).lastAccessedAt = new Date('2030-01-01'); // opened most recently
  assert.deepEqual(names(await w.library.recent(w.alice)), ['a.txt', 'c.txt', 'b.txt']);
  assert.deepEqual(names(await w.library.recent(w.alice, 2)), ['a.txt', 'c.txt']);
  assert.equal((await w.library.recent(w.alice, '0')).length, 3); // junk limit -> default
  assert.equal((await w.library.recent(w.alice, 9999)).length, 3); // clamped to max
  void b; void c;
});

// --------------------------------------------------------------- search
test('buildSearchFilter normalises and validates', () => {
  const f = buildSearchFilter({ q: '  Report ', type: 'pdf', from: '2026-01-01', to: '2026-02-01', minSize: '10', maxSize: 100, ownerId: ALICE });
  assert.equal(f.q, 'Report');
  assert.deepEqual(f.extensions, ['pdf']);
  assert.equal(f.minSize, 10n);
  assert.equal(f.maxSize, 100n);
  assert.equal(f.includeFolders, false); // type/size filters apply to files only
  assert.equal(buildSearchFilter({ q: 'x' }).includeFolders, true);
  assert.equal(buildSearchFilter({}).q, undefined);
  assert.equal(buildSearchFilter({ q: 'x'.repeat(300) }).q.length, 100);
  assert.throws(() => buildSearchFilter({ type: 'bogus' }), code(422));
  assert.throws(() => buildSearchFilter({ from: 'nope' }), code(422));
  assert.throws(() => buildSearchFilter({ from: '2026-03-01', to: '2026-01-01' }), code(422));
  assert.throws(() => buildSearchFilter({ minSize: 10, maxSize: 5 }), code(422));
});

test('search: own items plus shared ones, never trashed or foreign, with filters and pagination', async () => {
  const w = createWorld();
  const shared = await w.mkFolder(w.alice, 'Budget docs');
  await w.mkFolder(w.alice, 'Budget private');
  const a = await w.upload(w.alice, 'budget-2026.pdf', 'xxxx', shared);
  await w.upload(w.alice, 'budget-notes.txt', 'x');
  await w.upload(w.alice, 'unrelated.pdf', 'x');
  const trashed = await w.upload(w.alice, 'budget-old.pdf', 'x');
  await w.files.remove(w.alice, trashed.id);
  await w.upload(w.bob, 'budget-bob.pdf', 'x');
  w.shareFolder(shared, BOB, 'VIEWER');

  const mine = await w.library.search(w.alice, { q: 'BUDGET' });
  assert.deepEqual(names(mine.files).sort(), ['budget-2026.pdf', 'budget-notes.txt']);
  assert.deepEqual(names(mine.folders).sort(), ['Budget docs', 'Budget private']);

  const bobs = await w.library.search(w.bob, { q: 'budget' });
  assert.deepEqual(names(bobs.files).sort(), ['budget-2026.pdf', 'budget-bob.pdf']); // sees the shared one, not the others
  assert.deepEqual(names(bobs.folders), ['Budget docs']);
  assert.equal(bobs.files.find((f) => f.name === 'budget-2026.pdf').access.level, 'VIEWER');

  assert.deepEqual(names((await w.library.search(w.carol, { q: 'budget' })).files), []);
  assert.deepEqual(names((await w.library.search(w.alice, { q: 'budget', type: 'pdf' })).files), ['budget-2026.pdf']);
  assert.deepEqual((await w.library.search(w.alice, { q: 'budget', type: 'pdf' })).folders, []);
  assert.deepEqual(names((await w.library.search(w.alice, { q: 'budget', minSize: 2 })).files), ['budget-2026.pdf']);
  assert.deepEqual(names((await w.library.search(w.alice, { q: 'budget', ownerId: BOB })).files), []);
  const paged = await w.library.search(w.alice, { q: 'budget', page: 2, limit: 1 });
  assert.equal(paged.files.length, 1);
  assert.equal(paged.meta.total, 2);
  assert.equal(paged.meta.totalPages, 2);
  // searching without a text query lists files by filter only (no folder dump)
  assert.deepEqual((await w.library.search(w.alice, { type: 'pdf' })).folders, []);
});

// -------------------------------------------------------------- storage
test('storage summary: used, quota, percent, category breakdown, versions and trash', async () => {
  const w = createWorld({ quota: 1000n });
  await w.upload(w.alice, 'a.pdf', 'x'.repeat(100));
  await w.upload(w.alice, 'b.png', 'x'.repeat(300));
  await w.upload(w.alice, 'c.png', 'x'.repeat(50));
  const t = await w.upload(w.alice, 'd.txt', 'x'.repeat(10));
  await w.versions.upload(w.alice, t.id, { file: w.storage.stage('d.txt', 'x'.repeat(40)) });
  const doomed = await w.upload(w.alice, 'e.zip', 'x'.repeat(20));
  await w.files.remove(w.alice, doomed.id);
  await w.upload(w.bob, 'bob.pdf', 'x'.repeat(999));

  const s = await w.library.storageSummary(w.alice);
  assert.equal(s.used, 100 + 300 + 50 + 10 + 40 + 20);
  assert.equal(s.quota, 1000);
  assert.equal(s.percent, 52);
  assert.deepEqual(s.breakdown.map((b) => [b.category, b.bytes, b.count]), [['image', 350, 2], ['pdf', 100, 1], ['text', 40, 1]]);
  assert.equal(s.breakdown[0].label, 'Images');
  assert.equal(s.versionsBytes, 10); // the superseded version of d.txt
  assert.equal(s.trashBytes, 20);
});

test('storage summary handles an empty drive and a zero quota', async () => {
  const w = createWorld({ quota: 0n });
  assert.deepEqual(await w.library.storageSummary(w.carol), { used: 0, quota: 0, percent: 0, breakdown: [], versionsBytes: 0, trashBytes: 0 });
});
