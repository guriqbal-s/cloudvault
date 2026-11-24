// Administration: platform stats, user management with role-rank rules, roles, sharing monitor
// and storage ranking. Route-level middleware requires admin:access; each operation re-checks
// the specific permission it needs, so the rules live next to the data they protect.
//
// RANK RULES (Role.rank; higher = more privileged)
//   - An actor may manage a user, or assign a role, only when that rank is BELOW their own.
//   - Peers (same rank) are manageable only with admin:manage-admins (Super Admin).
//   - Nobody changes their own roles, status, quota or deletes themselves here.
//   - The last ACTIVE Super Admin can never be demoted, suspended or deleted.

import ApiError from '../utils/ApiError.js';
import { buildMeta, parseSort } from '../utils/pagination.js';
import { filePrefix, avatarKey } from './storage/keys.js';
import { breakdownByCategory, dailySeries, percentOf } from './dashboard.logic.js';
import { isUuid } from './access.logic.js';

export const SUPER_ADMIN_ROLE = 'Super Admin';
export const roleSlug = (name) => String(name).toLowerCase().trim().replace(/\s+/g, '-');

const USER_FIELDS = {
  id: true, email: true, name: true, status: true, emailVerifiedAt: true, storageQuotaBytes: true,
  storageUsedBytes: true, lastLoginAt: true, createdAt: true, avatarKey: true,
};
const SORTS = { name: 'name', email: 'email', createdAt: 'createdAt', lastLoginAt: 'lastLoginAt', storageUsedBytes: 'storageUsedBytes', status: 'status' };
const DAY = 86_400_000;

/** @param {{ db, hasher, storage, activity, notifications, defaultQuotaBytes?: bigint, now?: () => Date, logger? }} deps */
export function createAdminService({ db, hasher, storage, activity, notifications, defaultQuotaBytes = 5368709120n, now = () => new Date(), logger = console }) {
  const adminUserDTO = (u, roles = []) => ({
    id: u.id, email: u.email, name: u.name, status: u.status, hasAvatar: Boolean(u.avatarKey),
    emailVerifiedAt: u.emailVerifiedAt ?? null, storageQuotaBytes: u.storageQuotaBytes, storageUsedBytes: u.storageUsedBytes,
    storagePercent: percentOf(u.storageUsedBytes, u.storageQuotaBytes), lastLoginAt: u.lastLoginAt ?? null, createdAt: u.createdAt,
    roles: roles.map((r) => r.name), rank: roles.reduce((m, r) => Math.max(m, r.rank), 0),
  });

  // ------------------------------------------------------------------ helpers
  async function rolesOfUsers(userIds) {
    const out = new Map(userIds.map((id) => [id, []]));
    if (!userIds.length) return out;
    const links = await db.userRole.findMany({ where: { userId: { in: userIds } } });
    const roles = await db.role.findMany({ where: { id: { in: [...new Set(links.map((l) => l.roleId))] } } });
    const byId = new Map(roles.map((r) => [r.id, r]));
    for (const l of links) if (byId.has(l.roleId)) out.get(l.userId).push({ id: l.roleId, name: byId.get(l.roleId).name, rank: byId.get(l.roleId).rank });
    return out;
  }

  const canReach = (actor, rank) => rank < actor.rank || (actor.permissions.has('admin:manage-admins') && rank <= actor.rank);

  function assertCanManage(actor, rank) {
    if (!canReach(actor, rank)) throw ApiError.forbidden('You cannot manage users with this role');
  }

  async function loadTarget(id) {
    const user = isUuid(id) ? await db.user.findUnique({ where: { id }, select: USER_FIELDS }) : null;
    if (!user) throw ApiError.notFound('User not found');
    const roles = (await rolesOfUsers([id])).get(id);
    return { user, roles, rank: roles.reduce((m, r) => Math.max(m, r.rank), 0) };
  }

  async function isLastActiveSuperAdmin(userId) {
    const role = await db.role.findUnique({ where: { name: SUPER_ADMIN_ROLE } });
    if (!role) return false;
    const links = await db.userRole.findMany({ where: { roleId: role.id } });
    const active = await db.user.findMany({ where: { id: { in: links.map((l) => l.userId) }, status: 'ACTIVE' }, select: { id: true } });
    return active.length === 1 && active[0].id === userId;
  }

  async function revokeAllSessions(userId) {
    const at = now();
    await db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });
    const { count } = await db.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });
    return count;
  }

  async function resolveRoles(keys) {
    const all = await db.role.findMany({});
    const found = [];
    for (const key of keys) {
      const k = String(key).toLowerCase().trim();
      const role = all.find((r) => roleSlug(r.name) === k || r.name.toLowerCase() === k);
      if (!role) throw ApiError.validation('Unknown role', [{ in: 'body', path: 'roleKeys', message: `Unknown role "${key}"` }]);
      if (!found.includes(role)) found.push(role);
    }
    return found;
  }

  // ------------------------------------------------------------------ stats
  async function stats() {
    const t = now();
    const since = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - 29 * DAY);
    const [byStatus, files, folders, sumUsed, sumQuota, sessions, links, filePeople, folderPeople, signups, groups] = await Promise.all([
      db.user.groupBy({ by: ['status'], _count: { _all: true } }),
      db.file.count({ where: { deletedAt: null } }),
      db.folder.count({ where: { deletedAt: null } }),
      db.user.aggregate({ _sum: { storageUsedBytes: true } }),
      db.user.aggregate({ _sum: { storageQuotaBytes: true } }),
      db.userSession.count({ where: { revokedAt: null, lastActiveAt: { gte: new Date(t.getTime() - 30 * DAY) } } }),
      db.shareLink.count({ where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: t } }] } }),
      db.fileShare.count({}),
      db.folderShare.count({}),
      db.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      db.file.groupBy({ by: ['extension'], where: { deletedAt: null }, _sum: { size: true }, _count: { _all: true } }),
    ]);
    const n = (s) => byStatus.find((g) => g.status === s)?._count._all ?? 0;
    const used = sumUsed._sum.storageUsedBytes ?? 0n;
    const quota = sumQuota._sum.storageQuotaBytes ?? 0n;
    return {
      users: { total: byStatus.reduce((a, g) => a + g._count._all, 0), active: n('ACTIVE'), suspended: n('SUSPENDED'), pending: n('PENDING_VERIFICATION') },
      files, folders,
      storage: { used: Number(used), quota: Number(quota), percent: percentOf(used, quota) },
      activeSessions: sessions,
      shares: { links, people: filePeople + folderPeople },
      signups: dailySeries(signups, () => 0, { now: t }).map(({ date, count }) => ({ date, count })),
      byCategory: breakdownByCategory(groups),
    };
  }

  // ------------------------------------------------------------------ users
  async function listUsers({ q, status, role, page = 1, limit = 25, sort } = {}) {
    const where = {};
    if (status) where.status = status;
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }];
    if (role) {
      const [r] = await resolveRoles([role]).catch(() => []);
      const ids = r ? (await db.userRole.findMany({ where: { roleId: r.id } })).map((l) => l.userId) : [];
      where.id = { in: ids };
    }
    const orderBy = parseSort(sort, SORTS, { field: 'createdAt', dir: 'desc' });
    const [rows, total] = await Promise.all([
      db.user.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit, select: USER_FIELDS }),
      db.user.count({ where }),
    ]);
    const roles = await rolesOfUsers(rows.map((u) => u.id));
    return { items: rows.map((u) => adminUserDTO(u, roles.get(u.id))), meta: buildMeta({ page, limit, total }) };
  }

  async function getUser(id) {
    const { user, roles } = await loadTarget(id);
    const [files, folders, sessions] = await Promise.all([
      db.file.count({ where: { ownerId: id, deletedAt: null } }),
      db.folder.count({ where: { ownerId: id, deletedAt: null } }),
      db.userSession.count({ where: { userId: id, revokedAt: null } }),
    ]);
    return { ...adminUserDTO(user, roles), fileCount: files, folderCount: folders, activeSessions: sessions };
  }

  async function createUser(actor, { name, email, password, roleKey, quotaBytes }, meta) {
    const [role] = await resolveRoles([roleKey ?? 'standard-user']);
    assertCanManage(actor, role.rank);
    const normalised = String(email).trim().toLowerCase();
    if (await db.user.findUnique({ where: { email: normalised }, select: { id: true } })) {
      throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    const passwordHash = await hasher.hash(password);
    let user;
    try {
      user = await db.user.create({
        data: {
          name, email: normalised, passwordHash, status: 'ACTIVE', emailVerifiedAt: now(),
          storageQuotaBytes: quotaBytes != null ? BigInt(quotaBytes) : defaultQuotaBytes,
        },
        select: USER_FIELDS,
      });
    } catch (err) {
      if (err?.code === 'P2002') throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      throw err;
    }
    await db.userRole.createMany({ data: [{ userId: user.id, roleId: role.id }] });
    await activity.log({ userId: actor.id, action: 'REGISTER', description: `Created the account ${normalised} (${role.name})`, metadata: { targetUserId: user.id, role: role.name }, meta });
    return adminUserDTO(user, [role]);
  }

  async function updateUser(actor, id, patch, meta) {
    const { user, rank } = await loadTarget(id);
    if (user.id === actor.id && (patch.status !== undefined || patch.quotaBytes !== undefined)) {
      throw ApiError.forbidden('You cannot change your own status or quota here');
    }
    if (user.id !== actor.id) assertCanManage(actor, rank);
    const need = (perm) => { if (!actor.permissions.has(perm)) throw ApiError.forbidden('Your role does not allow this action'); };

    const data = {};
    if (patch.name !== undefined && patch.name !== user.name) { need('user:manage'); data.name = patch.name; }
    if (patch.status !== undefined && patch.status !== user.status) {
      need('user:suspend');
      if (patch.status === 'SUSPENDED' && (await isLastActiveSuperAdmin(id))) throw new ApiError(409, 'LAST_SUPER_ADMIN', 'The last active Super Admin cannot be suspended');
      data.status = patch.status;
      if (patch.status === 'ACTIVE' && !user.emailVerifiedAt) data.emailVerifiedAt = now();
    }
    if (patch.quotaBytes !== undefined && BigInt(patch.quotaBytes) !== user.storageQuotaBytes) { need('user:quota'); data.storageQuotaBytes = BigInt(patch.quotaBytes); }
    if (!Object.keys(data).length) return getUser(id);

    await db.user.update({ where: { id }, data });
    if (data.status === 'SUSPENDED') await revokeAllSessions(id);
    if (data.status) {
      await activity.log({ userId: actor.id, action: 'ADMIN_USER_STATUS_CHANGE', description: `${data.status === 'SUSPENDED' ? 'Suspended' : 'Reactivated'} ${user.email}`, metadata: { targetUserId: id, status: data.status }, meta });
    }
    if (data.storageQuotaBytes !== undefined) {
      await activity.log({ userId: actor.id, action: 'ADMIN_QUOTA_CHANGE', description: `Changed the storage quota of ${user.email}`, metadata: { targetUserId: id, from: user.storageQuotaBytes, to: data.storageQuotaBytes }, meta });
      await notifications.create({ userId: id, type: 'SYSTEM', title: 'Storage quota updated', body: 'An administrator changed your storage quota.', data: { actorId: actor.id } });
    }
    if (data.name) await activity.log({ userId: actor.id, action: 'PROFILE_UPDATE', description: `Renamed ${user.email} to ${data.name}`, metadata: { targetUserId: id }, meta });
    return getUser(id);
  }

  async function setRoles(actor, id, roleKeys, meta) {
    if (id === actor.id) throw ApiError.forbidden('You cannot change your own roles');
    const { user, roles: current, rank } = await loadTarget(id);
    assertCanManage(actor, rank);
    const next = await resolveRoles(roleKeys);
    for (const r of next) assertCanManage(actor, r.rank);
    const hadSuper = current.some((r) => r.name === SUPER_ADMIN_ROLE);
    if (hadSuper && !next.some((r) => r.name === SUPER_ADMIN_ROLE) && (await isLastActiveSuperAdmin(id))) {
      throw new ApiError(409, 'LAST_SUPER_ADMIN', 'The last active Super Admin cannot lose that role');
    }
    await db.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: next.map((r) => ({ userId: id, roleId: r.id })) });
    });
    await activity.log({ userId: actor.id, action: 'ADMIN_ROLE_CHANGE', description: `Set the roles of ${user.email} to ${next.map((r) => r.name).join(', ')}`, metadata: { targetUserId: id, from: current.map((r) => r.name), to: next.map((r) => r.name) }, meta });
    await notifications.create({ userId: id, type: 'SYSTEM', title: 'Your role changed', body: `You are now: ${next.map((r) => r.name).join(', ')}.`, data: { actorId: actor.id } });
    return getUser(id);
  }

  async function revokeSessions(actor, id, meta) {
    const { user, rank } = await loadTarget(id);
    if (user.id !== actor.id) assertCanManage(actor, rank);
    const revoked = await revokeAllSessions(id);
    await activity.log({ userId: actor.id, action: 'ADMIN_USER_STATUS_CHANGE', description: `Signed ${user.email} out of all devices`, metadata: { targetUserId: id, revoked }, meta });
    return { revoked };
  }

  async function removeUser(actor, id, { purge = false } = {}, meta) {
    const { user, rank } = await loadTarget(id);
    if (user.id === actor.id) throw ApiError.forbidden('You cannot delete your own account here');
    assertCanManage(actor, rank);
    if (await isLastActiveSuperAdmin(id)) throw new ApiError(409, 'LAST_SUPER_ADMIN', 'The last active Super Admin cannot be deleted');

    const versions = await db.fileVersion.findMany({ where: { uploadedById: id }, select: { id: true, fileId: true } });
    const touched = versions.length ? await db.file.findMany({ where: { id: { in: [...new Set(versions.map((v) => v.fileId))] } }, select: { id: true, ownerId: true } }) : [];
    const ownerOf = new Map(touched.map((f) => [f.id, f.ownerId]));
    const foreign = versions.filter((v) => ownerOf.get(v.fileId) && ownerOf.get(v.fileId) !== id);
    const [files, folders] = await Promise.all([db.file.count({ where: { ownerId: id } }), db.folder.count({ where: { ownerId: id } })]);

    if (!purge && (files || folders || foreign.length)) {
      throw new ApiError(409, 'USER_HAS_CONTENT', 'This user still owns content. Suspend the account, or delete it with purge to remove their files permanently.', { files, folders, versionsOnOthersFiles: foreign.length });
    }
    if (purge) {
      for (const v of foreign) await db.fileVersion.update({ where: { id: v.id }, data: { uploadedById: ownerOf.get(v.fileId) } });
      for (;;) {
        const batch = await db.file.findMany({ where: { ownerId: id }, select: { id: true }, take: 200 });
        if (!batch.length) break;
        for (const f of batch) await storage.deletePrefix(filePrefix(id, f.id)); // a storage failure aborts: nothing is half-deleted
        await db.file.deleteMany({ where: { id: { in: batch.map((f) => f.id) } } });
      }
      await db.folder.deleteMany({ where: { ownerId: id } });
      await Promise.resolve(storage.delete(avatarKey(id))).catch((err) => logger.error?.('Avatar cleanup failed:', err));
    } else if (user.avatarKey) {
      await Promise.resolve(storage.delete(avatarKey(id))).catch(() => {});
    }
    await db.user.delete({ where: { id } });
    await activity.log({ userId: actor.id, action: 'ADMIN_USER_STATUS_CHANGE', description: `Deleted the account ${user.email}${purge ? ' and its files' : ''}`, metadata: { deletedUserId: id, email: user.email, purge }, meta });
    return { deleted: true };
  }

  // ------------------------------------------------------------------ roles, sharing, storage
  async function listRoles() {
    const [roles, perms, links, counts] = await Promise.all([
      db.role.findMany({ orderBy: [{ rank: 'desc' }] }),
      db.permission.findMany({}),
      db.rolePermission.findMany({}),
      db.userRole.groupBy({ by: ['roleId'], _count: { _all: true } }),
    ]);
    const key = new Map(perms.map((p) => [p.id, p.key]));
    return roles.map((r) => ({
      id: r.id, name: r.name, key: roleSlug(r.name), description: r.description ?? null, rank: r.rank,
      permissions: links.filter((l) => l.roleId === r.id).map((l) => key.get(l.permissionId)).filter(Boolean).sort(),
      userCount: counts.find((c) => c.roleId === r.id)?._count._all ?? 0,
    }));
  }

  /** Live public links across all users (admin:monitor-sharing). */
  async function listLinks({ page = 1, limit = 25 } = {}) {
    const where = { revokedAt: null };
    const [rows, total] = await Promise.all([
      db.shareLink.findMany({ where, orderBy: [{ createdAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
      db.shareLink.count({ where }),
    ]);
    const uid = [...new Set(rows.map((l) => l.createdById))];
    const fid = rows.map((l) => l.fileId).filter(Boolean);
    const did = rows.map((l) => l.folderId).filter(Boolean);
    const [users, files, folders] = await Promise.all([
      uid.length ? db.user.findMany({ where: { id: { in: uid } }, select: { id: true, name: true, email: true } }) : [],
      fid.length ? db.file.findMany({ where: { id: { in: fid } }, select: { id: true, name: true } }) : [],
      did.length ? db.folder.findMany({ where: { id: { in: did } }, select: { id: true, name: true } }) : [],
    ]);
    const t = now();
    return {
      items: rows.map((l) => ({
        id: l.id, resourceType: l.resourceType,
        resourceName: (l.fileId ? files.find((f) => f.id === l.fileId) : folders.find((f) => f.id === l.folderId))?.name ?? null,
        createdBy: users.find((u) => u.id === l.createdById) ?? null, hasPassword: Boolean(l.passwordHash), canDownload: l.allowDownload,
        expiresAt: l.expiresAt ?? null, expired: Boolean(l.expiresAt && l.expiresAt <= t), accessCount: l.accessCount, createdAt: l.createdAt,
      })),
      meta: buildMeta({ page, limit, total }),
    };
  }

  async function revokeLink(actor, linkId, meta) {
    const link = isUuid(linkId) ? await db.shareLink.findUnique({ where: { id: linkId } }) : null;
    if (!link) throw ApiError.notFound('Link not found');
    if (!link.revokedAt) await db.shareLink.update({ where: { id: link.id }, data: { revokedAt: now() } });
    await activity.log({ userId: actor.id, action: 'LINK_REVOKE', description: 'Revoked a share link as an administrator', resourceType: link.resourceType, resourceId: link.fileId ?? link.folderId, metadata: { linkId, createdById: link.createdById }, meta });
    return { revoked: true };
  }

  async function storageRanking({ limit = 10 } = {}) {
    const [rows, sum] = await Promise.all([
      db.user.findMany({ orderBy: [{ storageUsedBytes: 'desc' }], take: limit, select: USER_FIELDS }),
      db.user.aggregate({ _sum: { storageUsedBytes: true, storageQuotaBytes: true } }),
    ]);
    return {
      totals: { used: Number(sum._sum.storageUsedBytes ?? 0n), quota: Number(sum._sum.storageQuotaBytes ?? 0n) },
      users: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, used: Number(u.storageUsedBytes), quota: Number(u.storageQuotaBytes), percent: percentOf(u.storageUsedBytes, u.storageQuotaBytes) })),
    };
  }

  return { stats, listUsers, getUser, createUser, updateUser, setRoles, revokeSessions, removeUser, listRoles, listLinks, revokeLink, storageRanking };
}
