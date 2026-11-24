// Short-lived signed tokens that let <img>, <video>, <iframe> and plain links fetch ONE file
// without an Authorization header (browsers cannot attach one to those requests).
//
// The token is an HS256 JWT bound to a user, a file and a purpose ('download' | 'preview'),
// optionally to one version, valid for 60 seconds. The key is derived from the access-token
// secret with a label, so it can never be used as (or confused with) a login access token.
// The user is re-loaded on every use, so suspension takes effect immediately and the user's
// *current* rights apply.
//
// Hand-rolled instead of jsonwebtoken so it is dependency free and fully unit-testable.

import crypto from 'node:crypto';
import ApiError from '../utils/ApiError.js';

export const FILE_AUDIENCE = 'cv-file';
export const PURPOSES = Object.freeze(['download', 'preview']);

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const HEADER = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

/** @param {{ secret: string, now?: () => Date, ttlSeconds?: number }} deps */
export function createAccessTokenService({ secret, now = () => new Date(), ttlSeconds = 60 }) {
  if (typeof secret !== 'string' || secret.length < 16) throw new TypeError('secret must be at least 16 characters');
  const key = crypto.createHmac('sha256', secret).update('cloudvault:file-access:v1').digest();
  const mac = (data) => crypto.createHmac('sha256', key).update(data).digest();
  const invalid = () => new ApiError(401, 'INVALID_ACCESS_URL', 'This link is invalid or has expired. Reload the page and try again.');

  /** @returns {{ token: string, expiresAt: Date }} */
  function sign({ userId, fileId, purpose, version }) {
    if (!PURPOSES.includes(purpose)) throw new TypeError(`Unknown purpose: ${purpose}`);
    const iat = Math.floor(now().getTime() / 1000);
    const exp = iat + ttlSeconds;
    const claims = { sub: userId, fid: fileId, purpose, aud: FILE_AUDIENCE, iat, exp };
    if (version != null) claims.ver = version;
    const body = b64(JSON.stringify(claims));
    const token = `${HEADER}.${body}.${b64(mac(`${HEADER}.${body}`))}`;
    return { token, expiresAt: new Date(exp * 1000) };
  }

  /**
   * @returns {{ userId: string, fileId: string, purpose: string, version?: number }}
   * @throws ApiError 401 INVALID_ACCESS_URL for anything wrong (one message: no oracle)
   */
  function verify(token) {
    if (typeof token !== 'string' || token.length > 2048) throw invalid();
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== HEADER) throw invalid(); // pins alg=HS256, rejects "none"
    const given = Buffer.from(parts[2], 'base64url');
    const expected = mac(`${parts[0]}.${parts[1]}`);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw invalid();

    let claims;
    try {
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw invalid();
    }
    const nowSec = Math.floor(now().getTime() / 1000);
    if (
      claims?.aud !== FILE_AUDIENCE || typeof claims.sub !== 'string' || typeof claims.fid !== 'string' ||
      !PURPOSES.includes(claims.purpose) || !Number.isInteger(claims.exp) || claims.exp <= nowSec
    ) throw invalid();
    return { userId: claims.sub, fileId: claims.fid, purpose: claims.purpose, version: claims.ver };
  }

  return { sign, verify, ttlSeconds };
}
