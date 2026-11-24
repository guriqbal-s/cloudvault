// Notification creation (persist, respect preferences, push over Socket.IO).
//
import ApiError from '../utils/ApiError.js';
import { buildMeta } from '../utils/pagination.js';

// A failure here must never fail the action that triggered it (a share, an upload...), so
// create() swallows and logs errors.

/** NotificationType -> the preference key under notificationPrefs.inApp. SYSTEM is never muted. */
export const PREF_CATEGORY = Object.freeze({
  FILE_SHARED: 'shared',
  FOLDER_SHARED: 'shared',
  SHARED_FILE_UPDATED: 'shared',
  PERMISSION_CHANGED: 'shared',
  ACCESS_REVOKED: 'shared',
  UPLOAD_COMPLETED: 'uploads',
  UPLOAD_FAILED: 'uploads',
  STORAGE_WARNING: 'quota',
  SYSTEM: null,
});

export function toNotificationDTO(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: row.data ?? null,
    readAt: row.readAt ?? null,
    createdAt: row.createdAt,
  };
}

/** Preferences default to ON; only an explicit `false` mutes a category. */
export function isMuted(prefs, type) {
  const category = PREF_CATEGORY[type];
  if (!category) return false;
  return prefs?.inApp?.[category] === false;
}

/** @param {{ db: object, emit?: (userId: string, event: string, payload: object) => unknown, logger: {error: Function} }} deps */
export function createNotificationService({ db, emit = () => false, logger }) {
  /**
   * @param {{ userId: string, type: string, title: string, body: string, data?: object }} input
   * @returns {Promise<object|null>} the notification DTO, or null when muted or on failure
   */
  async function create({ userId, type, title, body, data }) {
    try {
      const user = await db.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
      if (!user || isMuted(user.notificationPrefs, type)) return null;

      const row = await db.notification.create({ data: { userId, type, title, body, data: data ?? undefined } });
      const unreadCount = await db.notification.count({ where: { userId, readAt: null } });
      const dto = toNotificationDTO(row);
      emit(userId, 'notification:new', { notification: dto, unreadCount });
      return dto;
    } catch (err) {
      logger.error('Failed to create notification:', err);
      return null;
    }
  }

  /** Same notification for several users (e.g. everyone a file is shared with). */
  async function createForMany(userIds, input) {
    const unique = [...new Set(userIds)];
    return Promise.all(unique.map((userId) => create({ ...input, userId })));
  }

  // ---- REST (used by routes/notifications.routes.js) ------------------------------------
  const unreadCount = (userId) => db.notification.count({ where: { userId, readAt: null } });

  /** @returns {Promise<{ items: object[], meta: object }>} meta carries unreadCount too */
  async function list(userId, { unread = false, page = 1, limit = 20 } = {}) {
    const where = { userId, ...(unread ? { readAt: null } : {}) };
    const [rows, total, unreadTotal] = await Promise.all([
      db.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
      db.notification.count({ where }),
      unreadCount(userId),
    ]);
    return { items: rows.map(toNotificationDTO), meta: { ...buildMeta({ page, limit, total }), unreadCount: unreadTotal } };
  }

  async function markRead(userId, id) {
    const { count } = await db.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    const row = await db.notification.findFirst({ where: { id, userId } });
    if (!row) throw ApiError.notFound('Notification not found');
    return { notification: toNotificationDTO(row), changed: count > 0, unreadCount: await unreadCount(userId) };
  }

  async function markAllRead(userId) {
    const { count } = await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: count, unreadCount: 0 };
  }

  async function remove(userId, id) {
    const { count } = await db.notification.deleteMany({ where: { id, userId } });
    if (!count) throw ApiError.notFound('Notification not found');
    return { unreadCount: await unreadCount(userId) };
  }

  return { create, createForMany, list, markRead, markAllRead, remove, unreadCount };
}
