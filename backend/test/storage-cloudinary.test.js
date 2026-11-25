// CloudinaryStorageProvider against an in-memory fake of the Cloudinary SDK and CDN.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';

import CloudinaryStorageProvider from '../src/services/storage/CloudinaryStorageProvider.js';
import { StorageError } from '../src/services/storage/StorageProvider.js';
import { cloudinaryCredentials, isPlaceholder } from '../src/services/storage/cloudinaryConfig.js';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const read = async (stream) => {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
};

function fakeCloudinary() {
  const objects = new Map(); // publicId -> Buffer
  const calls = [];
  const notFound = () => Object.assign(new Error('Resource not found'), { http_code: 404 });
  const check = (opts) => {
    assert.equal(opts.resource_type, 'raw');
    assert.equal(opts.type, 'authenticated');
  };
  const sdk = {
    url: (publicId, opts) => {
      check(opts);
      assert.equal(opts.sign_url, true);
      return `https://cdn.test/${encodeURIComponent(publicId)}`;
    },
    uploader: {
      upload_stream(opts, cb) {
        check(opts);
        calls.push(['upload_stream', opts.public_id]);
        const chunks = [];
        return new Writable({
          write(chunk, _e, done) { chunks.push(chunk); done(); },
          final(done) { objects.set(opts.public_id, Buffer.concat(chunks)); done(); cb(null, { public_id: opts.public_id }); },
        });
      },
      async upload(file, opts) {
        check(opts);
        calls.push(['upload', opts.public_id]);
        objects.set(opts.public_id, await fs.readFile(file));
        return { public_id: opts.public_id };
      },
      upload_large(file, opts, cb) {
        check(opts);
        calls.push(['upload_large', opts.public_id]);
        fs.readFile(file).then((b) => { objects.set(opts.public_id, b); cb(null, {}); }, cb);
      },
      async destroy(publicId, opts) {
        check(opts);
        return { result: objects.delete(publicId) ? 'ok' : 'not found' };
      },
    },
    api: {
      async resource(publicId, opts) {
        check(opts);
        if (!objects.has(publicId)) throw notFound();
        return { bytes: objects.get(publicId).length };
      },
      async delete_resources_by_prefix(prefix, opts) {
        check(opts);
        for (const k of [...objects.keys()]) if (k.startsWith(prefix)) objects.delete(k);
        return { partial: false };
      },
      async ping() { return { status: 'ok' }; },
    },
  };
  // Fake CDN: honours Range unless told not to.
  let honourRange = true;
  const fetchImpl = async (url, { headers }) => {
    const publicId = decodeURIComponent(url.replace('https://cdn.test/', ''));
    const buf = objects.get(publicId);
    if (!buf) return new Response('missing', { status: 404 });
    const m = /^bytes=(\d+)-(\d+)$/.exec(headers.Range ?? '');
    if (m && honourRange) return new Response(buf.subarray(Number(m[1]), Number(m[2]) + 1), { status: 206 });
    return new Response(buf, { status: 200 });
  };
  return { sdk, fetchImpl, objects, calls, setHonourRange: (v) => { honourRange = v; } };
}

let fake;
let store;
beforeEach(() => {
  fake = fakeCloudinary();
  store = new CloudinaryStorageProvider({ cloudName: 'c', apiKey: 'k', apiSecret: 's', folder: 'cv', sdk: fake.sdk, fetchImpl: fake.fetchImpl });
});

test('put stores under <folder>/<key> and returns size + sha256', async () => {
  const body = Buffer.from('hello cloudinary');
  const res = await store.put('versions/users/u1/f1/v1', body);
  assert.deepEqual(res, { size: body.length, checksum: sha(body) });
  assert.deepEqual(fake.objects.get('cv/versions/users/u1/f1/v1'), body);
});

test('put accepts a readable stream', async () => {
  const res = await store.put('a/b', Readable.from([Buffer.from('ab'), Buffer.from('cd')]));
  assert.equal(res.size, 4);
  assert.equal(fake.objects.get('cv/a/b').toString(), 'abcd');
});

test('putFromFile uploads, hashes and removes the staged file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-cld-'));
  const file = path.join(dir, 'upload-x');
  await fs.writeFile(file, 'staged');
  const res = await store.putFromFile('versions/users/u/f/v2', file);
  assert.equal(res.checksum, sha(Buffer.from('staged')));
  assert.equal(fake.objects.get('cv/versions/users/u/f/v2').toString(), 'staged');
  await assert.rejects(fs.access(file));
  assert.equal(fake.calls.at(-1)[0], 'upload');
  await fs.rm(dir, { recursive: true, force: true });
});

test('getStream returns whole objects and byte ranges', async () => {
  await store.put('k/v1', Buffer.from('0123456789'));
  assert.equal((await read(await store.getStream('k/v1'))).toString(), '0123456789');
  assert.equal((await read(await store.getStream('k/v1', { start: 2, end: 5 }))).toString(), '2345');
});

test('getStream slices locally when the CDN ignores Range', async () => {
  fake.setHonourRange(false);
  await store.put('k/v1', Buffer.from('0123456789'));
  assert.equal((await read(await store.getStream('k/v1', { start: 7, end: 9 }))).toString(), '789');
});

test('missing objects raise NOT_FOUND', async () => {
  await assert.rejects(store.getStream('nope/v1'), (e) => e instanceof StorageError && e.code === 'NOT_FOUND');
  await assert.rejects(store.getSize('nope/v1'), (e) => e.code === 'NOT_FOUND');
  assert.equal(await store.exists('nope/v1'), false);
  await assert.rejects(store.copy('nope/v1', 'x/v1'), (e) => e.code === 'NOT_FOUND');
});

test('getSize, exists, copy, delete and deletePrefix', async () => {
  await store.put('versions/users/u/f/v1', Buffer.from('abc'));
  await store.put('versions/users/u/f2/v1', Buffer.from('keep'));
  assert.equal(await store.getSize('versions/users/u/f/v1'), 3);
  assert.equal(await store.exists('versions/users/u/f/v1'), true);

  await store.copy('versions/users/u/f/v1', 'versions/users/u/f/v2');
  assert.equal(fake.objects.get('cv/versions/users/u/f/v2').toString(), 'abc');

  await store.delete('versions/users/u/f/v2');
  await store.delete('versions/users/u/f/v2'); // idempotent
  assert.equal(await store.exists('versions/users/u/f/v2'), false);

  await store.deletePrefix('versions/users/u/f/');
  assert.equal(await store.exists('versions/users/u/f/v1'), false);
  assert.equal(await store.exists('versions/users/u/f2/v1'), true, 'sibling prefix untouched');
});

test('rejects unsafe keys and bad prefixes', async () => {
  for (const key of ['', '/abs', 'a/../b', 'a//b', 'a\\b', 'a/./b', 'sp ace']) {
    await assert.rejects(store.put(key, 'x'), (e) => e.code === 'INVALID_KEY', key);
  }
  await assert.rejects(store.deletePrefix('versions/users/u'), (e) => e.code === 'INVALID_KEY');
});

test('downloads are streamed through the API and health is cached', async () => {
  assert.deepEqual(await store.getDownloadTarget('k/v1'), { type: 'stream' });
  let pings = 0;
  fake.sdk.api.ping = async () => { pings += 1; return { status: 'ok' }; };
  assert.equal(await store.healthCheck(), true);
  assert.equal(await store.healthCheck(), true);
  assert.equal(pings, 1);
});

test('credentials come from separate vars or CLOUDINARY_URL', () => {
  assert.deepEqual(cloudinaryCredentials({ CLOUDINARY_URL: 'cloudinary://123:s%40cret@my-cloud' }), {
    cloudName: 'my-cloud', apiKey: '123', apiSecret: 's@cret',
  });
  assert.deepEqual(
    cloudinaryCredentials({ CLOUDINARY_URL: 'cloudinary://1:2@x', CLOUDINARY_CLOUD_NAME: 'override' }).cloudName,
    'override'
  );
  assert.equal(isPlaceholder('YOUR_API_KEY'), true);
  assert.equal(isPlaceholder(''), true);
  assert.equal(isPlaceholder('abc'), false);
});
