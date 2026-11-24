// Self-service profile: name, preferences (theme + notification settings), avatar, and the
// user lookup that powers the share dialog's autocomplete.

import ApiError from '../utils/ApiError.js';
import { avatarKey } from './storage/keys.js';
import { isUuid } from './access.logic.js';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** Detect an image by its magic bytes (never trust the client's Content-Type). */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const head = buf.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  return null;
}

/** Shallow-per-group merge: { inApp: {...}, email: {...} } updates only the keys that were sent. */
export function mergePrefs(existing, incoming) {
  const out = { ...(existing ?? {}) };
  for (const [group, values] of Object.entries(incoming ?? {})) out[group] = { ...(out[group] ?? {}), ...values };
  return out;
}

async function collect(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of stream) {
    size += c.length;
    if (size > limit) throw new Error('stored avatar is larger than expected');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/** @param {{ db, storage, activity, logger? }} deps */
export function createProfileService({ db, storage, activity, logger = console }) {
  async function updateProfile(userId, { name }, meta) {
    await db.user.update({ where: { id: userId }, data: { name } });
    await activity.log({ userId, action: 'PROFILE_UPDATE', description: 'Updated profile', metadata: { fields: ['name'] }, meta });
  }

  async function updatePreferences(userId, { theme, notificationPrefs }, meta) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    if (!user) throw ApiError.notFound('User not found');
    const data = {};
    if (theme !== undefined) data.themePref = theme;
    if (notificationPrefs !== undefined) data.notificationPrefs = mergePrefs(user.notificationPrefs, notificationPrefs);
    if (!Object.keys(data).length) return;
    await db.user.update({ where: { id: userId }, data });
    await activity.log({ userId, action: 'PROFILE_UPDATE', description: 'Updated preferences', metadata: { fields: Object.keys(data) }, meta });
  }

  async function setAvatar(userId, buffer, meta) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw ApiError.badRequest('Choose an image to upload');
    if (buffer.length > MAX_AVATAR_BYTES) throw ApiError.payloadTooLarge('Profile pictures can be at most 2 MB');
    if (!sniffImage(buffer)) throw new ApiError(415, 'UNSUPPORTED_IMAGE', 'Profile pictures must be PNG, JPEG or GIF images');
    const key = avatarKey(userId);
    await storage.put(key, buffer);
    await db.user.update({ where: { id: userId }, data: { avatarKey: key } });
    await activity.log({ userId, action: 'PROFILE_UPDATE', description: 'Changed profile picture', metadata: { fields: ['avatar'] }, meta });
  }

  async function removeAvatar(userId, meta) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { avatarKey: true } });
    if (user?.avatarKey) {
      await db.user.update({ where: { id: userId }, data: { avatarKey: null } });
      await Promise.resolve(storage.delete(user.avatarKey)).catch((err) => logger.error?.('Avatar delete failed:', err));
      await activity.log({ userId, action: 'PROFILE_UPDATE', description: 'Removed profile picture', metadata: { fields: ['avatar'] }, meta });
    }
  }

  /** @returns {Promise<{ buffer: Buffer, mimeType: string }>} */
  async function getAvatar(userId) {
    const user = isUuid(userId) ? await db.user.findUnique({ where: { id: userId }, select: { avatarKey: true, status: true } }) : null;
    if (!user?.avatarKey || user.status === 'SUSPENDED') throw ApiError.notFound('No profile picture');
    let buffer;
    try {
      buffer = await collect(await storage.getStream(user.avatarKey), MAX_AVATAR_BYTES);
    } catch (err) {
      if (err?.code === 'NOT_FOUND') throw ApiError.notFound('No profile picture');
      throw err;
    }
    const mimeType = sniffImage(buffer);
    if (!mimeType) throw ApiError.notFound('No profile picture');
    return { buffer, mimeType };
  }

  /** Active users matching a name/email fragment (min. 2 characters), excluding the caller. */
  async function lookup(actor, q) {
    const term = String(q ?? '').trim();
    if (term.length < 2) return [];
    return db.user.findMany({
      where: { status: 'ACTIVE', id: { not: actor.id }, OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }] },
      orderBy: [{ name: 'asc' }],
      take: 8,
      select: { id: true, name: true, email: true },
    });
  }

  return { updateProfile, updatePreferences, setAvatar, removeAvatar, getAvatar, lookup };
}
