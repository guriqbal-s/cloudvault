import crypto from 'node:crypto';

/** URL-safe random token. 32 bytes = 256 bits of entropy. */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest. Used to store refresh/reset/verification tokens (never the raw value). */
export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export const uuid = () => crypto.randomUUID();
