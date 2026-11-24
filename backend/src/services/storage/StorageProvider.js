// The contract every storage backend implements (local disk now, S3 later).
//
// RULES for implementers and callers:
//  - Keys are opaque, forward-slash separated strings (see keys.js). Never absolute paths.
//  - Providers move bytes only. They know nothing about users, permissions or the database.
//  - Providers throw StorageError (code: NOT_FOUND | INVALID_KEY | IO) and nothing else.
//  - Writes must be atomic: a failed put() must not leave a partial object at `key`.

export class StorageError extends Error {
  /** @param {'NOT_FOUND'|'INVALID_KEY'|'IO'} code */
  constructor(code, message, cause) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export default class StorageProvider {
  /**
   * Store content under `key`, replacing any existing object.
   * @param {string} key
   * @param {NodeJS.ReadableStream|Buffer|string} body
   * @returns {Promise<{size: number, checksum: string}>} byte length and SHA-256 hex
   */
  async put(key, body) { throw new Error('put() not implemented'); }

  /**
   * Store an existing local file under `key`. Local providers may move it (fast, same disk);
   * remote providers upload then delete the source. The source is gone afterwards either way.
   * @returns {Promise<{size: number, checksum: string}>}
   */
  async putFromFile(key, sourcePath) { throw new Error('putFromFile() not implemented'); }

  /**
   * Open a read stream. `range` is inclusive on both ends, like an HTTP Range header.
   * @param {string} key
   * @param {{start: number, end: number}} [range]
   * @returns {Promise<NodeJS.ReadableStream>}
   */
  async getStream(key, range) { throw new Error('getStream() not implemented'); }

  /** @returns {Promise<boolean>} */
  async exists(key) { throw new Error('exists() not implemented'); }

  /** @returns {Promise<number>} size in bytes; throws NOT_FOUND */
  async getSize(key) { throw new Error('getSize() not implemented'); }

  /** Idempotent: deleting a missing key is not an error. */
  async delete(key) { throw new Error('delete() not implemented'); }

  /** Delete every object whose key starts with `prefix` (used to purge a whole file). */
  async deletePrefix(prefix) { throw new Error('deletePrefix() not implemented'); }

  /** Server-side copy. Throws NOT_FOUND if `srcKey` is missing. */
  async copy(srcKey, destKey) { throw new Error('copy() not implemented'); }

  /** @returns {Promise<boolean>} true when the backend is reachable and writable. Never throws. */
  async healthCheck() { throw new Error('healthCheck() not implemented'); }

  /**
   * How a client can fetch the object. Local: `{ type: 'stream' }` (the API streams it after
   * its access check). S3: `{ type: 'redirect', url }` with a short-lived presigned URL.
   * Controllers branch on `type`, so they do not change when the driver does.
   * @param {string} key
   * @param {{filename?: string, mimeType?: string, expiresInSeconds?: number}} [opts]
   * @returns {Promise<{type: 'stream'} | {type: 'redirect', url: string}>}
   */
  async getDownloadTarget(key, opts) { throw new Error('getDownloadTarget() not implemented'); }
}
