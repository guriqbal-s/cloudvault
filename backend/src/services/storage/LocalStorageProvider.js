// Local-disk implementation of StorageProvider.
//
// Security: every key is validated and the resolved absolute path must stay inside `root`
// (blocks "..", absolute paths, backslashes, NUL bytes). Writes go to a temp file in the same
// directory and are renamed into place, so readers never see a partial object.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

import StorageProvider, { StorageError } from './StorageProvider.js';

const TMP_SUFFIX = '.part-';

export default class LocalStorageProvider extends StorageProvider {
  /** @param {{ root: string }} options  absolute directory that holds all objects */
  constructor({ root }) {
    super();
    if (!root || !path.isAbsolute(root)) throw new Error('LocalStorageProvider requires an absolute root');
    this.root = path.resolve(root);
  }

  /** Validates a key and returns its absolute path. */
  resolve(key) {
    if (
      typeof key !== 'string' ||
      key.length === 0 ||
      key.length > 1024 ||
      key.includes('\0') ||
      key.includes('\\') ||
      key.startsWith('/') ||
      key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
    ) {
      throw new StorageError('INVALID_KEY', `Invalid storage key: ${JSON.stringify(key)}`);
    }
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new StorageError('INVALID_KEY', 'Storage key escapes the storage root');
    }
    return full;
  }

  async put(key, body) {
    const full = this.resolve(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}${TMP_SUFFIX}${crypto.randomBytes(6).toString('hex')}`;

    const hash = crypto.createHash('sha256');
    let size = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        size += chunk.length;
        cb(null, chunk);
      },
    });

    let source;
    if (Buffer.isBuffer(body) || typeof body === 'string') source = Readable.from([Buffer.from(body)]);
    else if (body && typeof body.pipe === 'function') source = body;
    else throw new StorageError('IO', 'put() body must be a Buffer, string or readable stream');

    try {
      await pipeline(source, counter, fs.createWriteStream(tmp, { flags: 'wx' }));
      await fsp.rename(tmp, full);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw new StorageError('IO', `Failed to write ${key}: ${err.message}`, err);
    }
    return { size, checksum: hash.digest('hex') };
  }

  async putFromFile(key, sourcePath) {
    // Hash and size come from a read pass; the copy is then moved into place atomically.
    // (A plain rename of the source would skip hashing, and checksums are mandatory.)
    const result = await this.put(key, fs.createReadStream(sourcePath));
    await fsp.rm(sourcePath, { force: true }).catch(() => {});
    return result;
  }

  async getStream(key, range) {
    const full = this.resolve(key);
    // Open first so a missing file rejects here rather than as a stream error mid-response.
    let handle;
    try {
      handle = await fsp.open(full, 'r');
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') throw new StorageError('NOT_FOUND', `Object not found: ${key}`, err);
      throw new StorageError('IO', `Failed to open ${key}: ${err.message}`, err);
    }
    // open() succeeds on a directory on Linux; only reading it fails. Reject it here.
    let isFile = false;
    try {
      isFile = (await handle.stat()).isFile();
    } catch {
      /* treated as not a file */
    }
    if (!isFile) {
      await handle.close().catch(() => {});
      throw new StorageError('NOT_FOUND', `Object not found: ${key}`);
    }

    const opts = { fd: handle, autoClose: true };
    if (range) {
      const { start, end } = range;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
        await handle.close().catch(() => {});
        throw new StorageError('IO', 'Invalid byte range');
      }
      opts.start = start;
      opts.end = end;
    }
    return fs.createReadStream(null, opts);
  }

  async exists(key) {
    try {
      const stat = await fsp.stat(this.resolve(key));
      return stat.isFile();
    } catch (err) {
      if (err instanceof StorageError) throw err;
      return false;
    }
  }

  async getSize(key) {
    try {
      const stat = await fsp.stat(this.resolve(key));
      if (!stat.isFile()) throw new StorageError('NOT_FOUND', `Object not found: ${key}`);
      return stat.size;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      if (err.code === 'ENOENT') throw new StorageError('NOT_FOUND', `Object not found: ${key}`, err);
      throw new StorageError('IO', `Failed to stat ${key}: ${err.message}`, err);
    }
  }

  async delete(key) {
    try {
      await fsp.rm(this.resolve(key), { force: true });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError('IO', `Failed to delete ${key}: ${err.message}`, err);
    }
  }

  async deletePrefix(prefix) {
    // The prefix must be a directory-style key ("a/b/c/"), which also keeps it from matching
    // siblings like "a/b/c2".
    if (typeof prefix !== 'string' || !prefix.endsWith('/')) {
      throw new StorageError('INVALID_KEY', 'deletePrefix() requires a prefix ending in "/"');
    }
    const full = this.resolve(prefix.slice(0, -1));
    if (full === this.root) throw new StorageError('INVALID_KEY', 'Refusing to delete the storage root');
    try {
      await fsp.rm(full, { recursive: true, force: true });
    } catch (err) {
      throw new StorageError('IO', `Failed to delete prefix ${prefix}: ${err.message}`, err);
    }
  }

  async copy(srcKey, destKey) {
    const src = this.resolve(srcKey);
    const dest = this.resolve(destKey);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}${TMP_SUFFIX}${crypto.randomBytes(6).toString('hex')}`;
    try {
      await fsp.copyFile(src, tmp);
      await fsp.rename(tmp, dest);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      if (err.code === 'ENOENT') throw new StorageError('NOT_FOUND', `Object not found: ${srcKey}`, err);
      throw new StorageError('IO', `Failed to copy ${srcKey}: ${err.message}`, err);
    }
  }

  async healthCheck() {
    try {
      await fsp.mkdir(this.root, { recursive: true });
      await fsp.access(this.root, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  // Local files are streamed through the API after its access check, never served statically.
  async getDownloadTarget() {
    return { type: 'stream' };
  }
}
