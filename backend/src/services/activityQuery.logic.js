// Read side of the activity log: a user's own history, and the global log for admins.

import { buildMeta } from '../utils/pagination.js';
import { toActivityDTO } from './dto.js';

/** @param {{ db: object }} deps */
export function createActivityQueryService({ db }) {
  function buildWhere({ userId, action, from, to, q, resourceType } = {}) {
    const where = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (resourceType) where.resourceType = resourceType;
    if (from || to) where.createdAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    if (q) where.OR = [{ description: { contains: q, mode: 'insensitive' } }, { resourceName: { contains: q, mode: 'insensitive' } }];
    return where;
  }

  async function run(where, { page = 1, limit = 25 } = {}) {
    const [rows, total] = await Promise.all([
      db.activityLog.findMany({ where, orderBy: [{ createdAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
      db.activityLog.count({ where }),
    ]);
    const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
    const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return { items: rows.map((r) => toActivityDTO({ ...r, user: byId.get(r.userId) ?? null })), meta: buildMeta({ page, limit, total }) };
  }

  /** The caller's own history. A `userId` filter is ignored on purpose. */
  const listOwn = (userId, filters = {}, paging) => run(buildWhere({ ...filters, userId }), paging);
  /** Everything (admin:read-all). */
  const listAll = (filters = {}, paging) => run(buildWhere(filters), paging);

  return { listOwn, listAll };
}
