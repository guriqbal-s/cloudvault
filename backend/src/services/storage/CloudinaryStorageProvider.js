// Cloudinary implementation of StorageProvider.
//
// Every object is stored as a Cloudinary "raw" asset with delivery type "authenticated", so
// it can only be fetched through a signed URL. The API keeps doing its own access checks and
// streams the bytes to the browser (getDownloadTarget returns { type: 'stream' }). Cloudinary
// URLs are never sent to clients.
//
// Keys map to public IDs as `<folder>/<key>`, e.g. cloudvault/versions/users/<owner>/<file>/v1.
// "raw" keeps the original bytes exactly: no transformations, no format conversion, and any
// file type is accepted.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { v2 as cloudinarySdk } from 'cloudinary';

import StorageProvider, { StorageError } from './StorageProvider.js';

const RESOURCE = Object.freeze({ resource_type: 'raw', type: 'authenticated' });
// Files above this size go through Cloudinary's chunked upload API (required above 100 MB).
const CHUNK_THRESHOLD = 20 * 1024 * 1024;
const CHUNK_SIZE = 20 * 1024 * 1024;
const HEALTH_CACHE_MS = 60_000; // ping() uses the rate-limited Admin API

const isNotFound = (err) => err?.http_code === 404 || err?.error?.http_code === 404;

export default class CloudinaryStorageProvider extends StorageProvider {
  /**
   * @param {{ cloudName: string, apiKey: string, apiSecret: string, folder?: string, sdk?: object, fetchImpl?: typeof fetch }} options
   *   `sdk` and `fetchImpl` exist for tests.
   */
  constructor({ cloudName, apiKey, apiSecret, folder = 'cloudvault', sdk = cloudinarySdk, fetchImpl = globalThis.fetch }) {
    super();
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error('CloudinaryStorageProvider requires cloudName, apiKey and apiSecret');
    }
    this.folder = String(folder).replace(/^\/+|\/+$/g, '');
    this.sdk = sdk;
    this.fetch = fetchImpl;
    this.config = { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true };
    this.health = { at: 0, ok: false };
  }

  /** Validates a key (same rules as the local provider) and returns its public ID. */
  publicId(key) {
    if (
      typeof key !== 'string' ||
      key.length === 0 ||
      key.length > 900 ||
      key.includes('\0') ||
      key.includes('\\') ||
      key.startsWith('/') ||
      !/^[A-Za-z0-9/_.-]+$/.test(key) ||
      key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
    ) {
      throw new StorageError('INVALID_KEY', `Invalid storage key: ${JSON.stringify(key)}`);
    }
    return this.folder ? `${this.folder}/${key}` : key;
  }

  /** Signed, server-side-only delivery URL for an authenticated raw asset. */
  signedUrl(publicId) {
    return this.sdk.url(publicId, { ...this.config, ...RESOURCE, sign_url: true });
  }

  uploadOptions(publicId) {
    return { ...this.config, ...RESOURCE, public_id: publicId, overwrite: true, invalidate: true };
  }

  async put(key, body) {
    const publicId = this.publicId(key);
    let source;
    if (Buffer.isBuffer(body) || typeof body === 'string') source = Readable.from([Buffer.from(body)]);
    else if (body && typeof body.pipe === 'function') source = body;
    else throw new StorageError('IO', 'put() body must be a Buffer, string or readable stream');

    const hash = crypto.createHash('sha256');
    let size = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        size += chunk.length;
        cb(null, chunk);
      },
    });

    try {
      await new Promise((resolve, reject) => {
        const upload = this.sdk.uploader.upload_stream(this.uploadOptions(publicId), (err, result) =>
          err ? reject(err) : resolve(result)
        );
        pipeline(source, counter, upload).catch(reject);
      });
    } catch (err) {
      throw new StorageError('IO', `Cloudinary upload failed for ${key}: ${err?.message ?? err}`, err);
    }
    return { size, checksum: hash.digest('hex') };
  }

  async putFromFile(key, sourcePath) {
    const publicId = this.publicId(key);
    try {
      // Hash and size come from a read pass of the staged file; the upload is a second pass.
      const hash = crypto.createHash('sha256');
      let size = 0;
      for await (const chunk of fs.createReadStream(sourcePath)) {
        hash.update(chunk);
        size += chunk.length;
      }
      if (size > CHUNK_THRESHOLD) {
        await new Promise((resolve, reject) =>
          this.sdk.uploader.upload_large(sourcePath, { ...this.uploadOptions(publicId), chunk_size: CHUNK_SIZE }, (err, result) =>
            err ? reject(err) : resolve(result)
          )
        );
      } else {
        await this.sdk.uploader.upload(sourcePath, this.uploadOptions(publicId));
      }
      return { size, checksum: hash.digest('hex') };
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError('IO', `Cloudinary upload failed for ${key}: ${err?.message ?? err}`, err);
    } finally {
      await fsp.rm(sourcePath, { force: true }).catch(() => {});
    }
  }

  async getStream(key, range) {
    const publicId = this.publicId(key);
    if (range) {
      const { start, end } = range;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
        throw new StorageError('IO', 'Invalid byte range');
      }
    }
    let res;
    try {
      res = await this.fetch(this.signedUrl(publicId), {
        headers: range ? { Range: `bytes=${range.start}-${range.end}` } : {},
      });
    } catch (err) {
      throw new StorageError('IO', `Cloudinary download failed for ${key}: ${err.message}`, err);
    }
    if (res.status === 404 || res.status === 401) {
      await res.body?.cancel?.().catch(() => {});
      throw new StorageError('NOT_FOUND', `Object not found: ${key}`);
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel?.().catch(() => {});
      throw new StorageError('IO', `Cloudinary download failed for ${key}: HTTP ${res.status}`);
    }
    const stream = Readable.fromWeb(res.body);
    // The CDN normally honours Range (206). If it sent the whole object (200), slice it here.
    if (range && res.status === 200) return stream.pipe(sliceBytes(range.start, range.end));
    return stream;
  }

  async getSize(key) {
    const publicId = this.publicId(key);
    try {
      const info = await this.sdk.api.resource(publicId, { ...this.config, ...RESOURCE });
      return Number(info.bytes);
    } catch (err) {
      if (isNotFound(err)) throw new StorageError('NOT_FOUND', `Object not found: ${key}`, err);
      throw new StorageError('IO', `Cloudinary lookup failed for ${key}: ${err?.message ?? err}`, err);
    }
  }

  async exists(key) {
    try {
      await this.getSize(key);
      return true;
    } catch (err) {
      if (err.code === 'NOT_FOUND') return false;
      throw err;
    }
  }

  async delete(key) {
    const publicId = this.publicId(key);
    try {
      // result is "ok" or "not found"; both mean the object is gone.
      await this.sdk.uploader.destroy(publicId, { ...this.config, ...RESOURCE, invalidate: true });
    } catch (err) {
      if (isNotFound(err)) return;
      throw new StorageError('IO', `Cloudinary delete failed for ${key}: ${err?.message ?? err}`, err);
    }
  }

  async deletePrefix(prefix) {
    if (typeof prefix !== 'string' || !prefix.endsWith('/')) {
      throw new StorageError('INVALID_KEY', 'deletePrefix() requires a prefix ending in "/"');
    }
    const fullPrefix = `${this.publicId(prefix.slice(0, -1))}/`;
    try {
      // Cloudinary deletes up to 1000 assets per call and reports `partial` when more remain.
      for (let i = 0; i < 100; i += 1) {
        const result = await this.sdk.api.delete_resources_by_prefix(fullPrefix, { ...this.config, ...RESOURCE, invalidate: true });
        if (!result?.partial) return;
      }
      throw new Error('too many objects under prefix');
    } catch (err) {
      throw new StorageError('IO', `Cloudinary delete failed for prefix ${prefix}: ${err?.message ?? err}`, err);
    }
  }

  async copy(srcKey, destKey) {
    this.publicId(destKey); // validate before downloading anything
    const stream = await this.getStream(srcKey); // throws NOT_FOUND for a missing source
    await this.put(destKey, stream);
  }

  /**
   * Cached result of a Cloudinary ping. The first call waits for a ping; later calls return the
   * last result at once and refresh it in the background when it is older than a minute, so a
   * slow ping never makes a load balancer health check time out.
   */
  async healthCheck() {
    const stale = Date.now() - this.health.at >= HEALTH_CACHE_MS;
    if (stale && !this.pinging) {
      this.pinging = this.sdk.api
        .ping({ ...this.config })
        .then((res) => res?.status === 'ok', () => false)
        .then((ok) => {
          this.health = { at: Date.now(), ok };
          this.pinging = null;
          return ok;
        });
    }
    if (this.health.at === 0) return this.pinging; // never checked yet: wait for the first ping
    return this.health.ok;
  }

  // Streamed through the API after its access check, exactly like local storage.
  async getDownloadTarget() {
    return { type: 'stream' };
  }
}

/** Pass through only bytes start..end (inclusive) of a stream. */
function sliceBytes(start, end) {
  let offset = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      const chunkStart = offset;
      offset += chunk.length;
      if (offset <= start || chunkStart > end) return cb();
      const from = Math.max(0, start - chunkStart);
      const to = Math.min(chunk.length, end - chunkStart + 1);
      cb(null, chunk.subarray(from, to));
      if (offset > end) this.push(null);
    },
  });
}
