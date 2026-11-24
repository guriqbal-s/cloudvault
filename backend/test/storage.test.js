import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import LocalStorageProvider from '../src/services/storage/LocalStorageProvider.js';
import { StorageError } from '../src/services/storage/StorageProvider.js';
import * as keys from '../src/services/storage/keys.js';

let root;
let store;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-storage-'));
  store = new LocalStorageProvider({ root });
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const read = async (stream) => {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
};
const listAll = async (dir) =>
  (await fs.readdir(dir, { recursive: true })).filter(Boolean).map((p) => p.split(path.sep).join('/'));

test('constructor requires an absolute root', () => {
  assert.throws(() => new LocalStorageProvider({ root: 'relative/dir' }));
});

test('put(Buffer) returns size and SHA-256, and content round-trips', async () => {
  const data = crypto.randomBytes(100_000);
  const res = await store.put('versions/users/u1/f1/v1', data);
  assert.equal(res.size, data.length);
  assert.equal(res.checksum, sha(data));
  assert.deepEqual(await read(await store.getStream('versions/users/u1/f1/v1')), data);
});

test('put accepts strings and streams', async () => {
  const a = await store.put('a/one', 'hello');
  assert.equal(a.size, 5);
  const b = await store.put('a/two', Readable.from([Buffer.from('he'), Buffer.from('llo')]));
  assert.equal(b.checksum, a.checksum);
});

test('put leaves no temp files behind on success', async () => {
  await store.put('x/y/z', 'data');
  assert.deepEqual(await listAll(root), ['x', 'x/y', 'x/y/z']);
});

test('a failing stream leaves neither the object nor a temp file, and keeps any previous version', async () => {
  await store.put('k/obj', 'original');
  const broken = new Readable({
    read() {
      this.push('partial');
      this.destroy(new Error('connection reset'));
    },
  });
  await assert.rejects(store.put('k/obj', broken), (e) => e instanceof StorageError && e.code === 'IO');
  assert.equal((await read(await store.getStream('k/obj'))).toString(), 'original');
  assert.deepEqual(await listAll(root), ['k', 'k/obj']);
});

test('put overwrites an existing key atomically', async () => {
  await store.put('k/obj', 'one');
  await store.put('k/obj', 'two-two');
  assert.equal((await read(await store.getStream('k/obj'))).toString(), 'two-two');
  assert.equal(await store.getSize('k/obj'), 7);
});

test('unsafe keys are rejected everywhere', async () => {
  const bad = [
    '../escape', 'a/../../escape', '/abs/path', 'a//b', 'a/./b', '', 'a\\b', 'a\0b',
    '..', 'a/..', 'x'.repeat(1025),
  ];
  for (const key of bad) {
    await assert.rejects(store.put(key, 'x'), (e) => e.code === 'INVALID_KEY', `put ${JSON.stringify(key)}`);
    await assert.rejects(store.getStream(key), (e) => e.code === 'INVALID_KEY', `getStream ${JSON.stringify(key)}`);
    await assert.rejects(store.delete(key), (e) => e.code === 'INVALID_KEY', `delete ${JSON.stringify(key)}`);
  }
  await assert.rejects(store.put(null, 'x'), (e) => e.code === 'INVALID_KEY');
  // nothing was written outside (or inside) the root
  assert.deepEqual(await listAll(root), []);
  // only the parent's own entries matter (a recursive scan of the OS temp dir can hit locked folders on Windows)
  assert.equal((await fs.readdir(path.dirname(root))).includes('escape'), false);
});

test('getStream: full, ranged (inclusive) and missing', async () => {
  await store.put('r/file', '0123456789');
  assert.equal((await read(await store.getStream('r/file', { start: 2, end: 5 }))).toString(), '2345');
  assert.equal((await read(await store.getStream('r/file', { start: 9, end: 9 }))).toString(), '9');
  await assert.rejects(store.getStream('r/missing'), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(store.getStream('r'), (e) => e.code === 'NOT_FOUND'); // a directory is not an object
  await assert.rejects(store.getStream('r/file', { start: 5, end: 2 }), (e) => e.code === 'IO');
});

test('exists / getSize', async () => {
  await store.put('e/file', 'abc');
  assert.equal(await store.exists('e/file'), true);
  assert.equal(await store.exists('e/nope'), false);
  assert.equal(await store.exists('e'), false);
  assert.equal(await store.getSize('e/file'), 3);
  await assert.rejects(store.getSize('e/nope'), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(store.exists('../x'), (e) => e.code === 'INVALID_KEY');
});

test('delete is idempotent', async () => {
  await store.put('d/file', 'x');
  await store.delete('d/file');
  await store.delete('d/file');
  assert.equal(await store.exists('d/file'), false);
});

test('deletePrefix removes the whole directory but not look-alike siblings', async () => {
  await store.put('versions/users/u/file1/v1', 'a');
  await store.put('versions/users/u/file1/v2', 'b');
  await store.put('versions/users/u/file10/v1', 'c');
  await store.deletePrefix('versions/users/u/file1/');
  assert.equal(await store.exists('versions/users/u/file1/v1'), false);
  assert.equal(await store.exists('versions/users/u/file1/v2'), false);
  assert.equal(await store.exists('versions/users/u/file10/v1'), true);
});

test('deletePrefix demands a trailing slash and never wipes the root', async () => {
  await store.put('p/q', 'x');
  await assert.rejects(store.deletePrefix('p'), (e) => e.code === 'INVALID_KEY');
  await assert.rejects(store.deletePrefix('/'), (e) => e.code === 'INVALID_KEY');
  await assert.rejects(store.deletePrefix('../'), (e) => e.code === 'INVALID_KEY');
  assert.equal(await store.exists('p/q'), true);
});

test('copy duplicates content; missing source is NOT_FOUND and leaves no debris', async () => {
  await store.put('c/src', 'payload');
  await store.copy('c/src', 'c/deep/dest');
  assert.equal((await read(await store.getStream('c/deep/dest'))).toString(), 'payload');
  await assert.rejects(store.copy('c/none', 'c/dest2'), (e) => e.code === 'NOT_FOUND');
  assert.equal(await store.exists('c/dest2'), false);
  assert.deepEqual((await listAll(root)).filter((n) => n.includes('.part-')), []);
});

test('putFromFile hashes, stores, and removes the staged source', async () => {
  const staged = path.join(root, 'staged.tmp');
  const data = crypto.randomBytes(50_000);
  await fs.writeFile(staged, data);
  const res = await store.putFromFile('up/final', staged);
  assert.equal(res.checksum, sha(data));
  assert.equal(res.size, data.length);
  await assert.rejects(fs.access(staged));
  assert.equal(await store.exists('up/final'), true);
});

test('getDownloadTarget streams locally; healthCheck reflects the root', async () => {
  assert.deepEqual(await store.getDownloadTarget('anything'), { type: 'stream' });
  assert.equal(await store.healthCheck(), true);
  // A root located "inside" a regular file can never be created: mkdir fails with ENOTDIR.
  const blocker = path.join(root, 'i-am-a-file');
  await fs.writeFile(blocker, 'x');
  const broken = new LocalStorageProvider({ root: path.join(blocker, 'sub') });
  assert.equal(await broken.healthCheck(), false);
});

test('key helpers produce the documented layout and reject unsafe ids', () => {
  assert.equal(keys.versionKey('u-1', 'f-2', 3), 'versions/users/u-1/f-2/v3');
  assert.equal(keys.filePrefix('u-1', 'f-2'), 'versions/users/u-1/f-2/');
  assert.equal(keys.avatarKey('u-1'), 'uploads/avatars/u-1');
  assert.throws(() => keys.versionKey('../x', 'f', 1), TypeError);
  assert.throws(() => keys.versionKey('u', 'f/../g', 1), TypeError);
  assert.throws(() => keys.versionKey('u', 'f', 0), TypeError);
  assert.throws(() => keys.versionKey('u', 'f', 1.5), TypeError);
  // every produced key is accepted by the provider
  assert.doesNotThrow(() => store.resolve(keys.versionKey('u-1', 'f-2', 3)));
});
