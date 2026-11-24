// Small HMAC-signed tokens ("payload.signature") for short-lived, purpose-bound grants such as
// the unlock token of a password-protected share link. Dependency free and unit-testable.
// A purpose label is mixed into the key, so a token for one purpose can never validate for another.

import crypto from 'node:crypto';

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/** @param {{ secret: string, purpose: string, now?: () => Date }} deps */
export function createHmacTokens({ secret, purpose, now = () => new Date() }) {
  if (typeof secret !== 'string' || secret.length < 16) throw new TypeError('secret must be at least 16 characters');
  const key = crypto.createHmac('sha256', secret).update(`cloudvault:${purpose}:v1`).digest();
  const mac = (data) => crypto.createHmac('sha256', key).update(data).digest();

  return {
    /** @returns {{ token: string, expiresAt: Date }} */
    sign(claims, ttlSeconds) {
      const exp = Math.floor(now().getTime() / 1000) + ttlSeconds;
      const body = b64(JSON.stringify({ ...claims, exp }));
      return { token: `${body}.${b64(mac(body))}`, expiresAt: new Date(exp * 1000) };
    },
    /** @returns {object|null} the claims, or null for anything invalid or expired */
    verify(token) {
      if (typeof token !== 'string' || token.length > 1024) return null;
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const given = Buffer.from(parts[1], 'base64url');
      const expected = mac(parts[0]);
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
      try {
        const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        if (!claims || typeof claims.exp !== 'number' || claims.exp <= Math.floor(now().getTime() / 1000)) return null;
        return claims;
      } catch {
        return null;
      }
    },
  };
}
