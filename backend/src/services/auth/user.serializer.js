// The one place that decides which user fields leave the server. Explicit allow-list:
// anything not named here (passwordHash, avatarKey, ...) can never be returned by accident.

/** @param {{ user: object, roles: string[], permissions: Set<string>|string[] }} principal */
export function serializeUser({ user, roles, permissions }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    hasAvatar: Boolean(user.avatarKey),
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    themePref: user.themePref,
    notificationPrefs: user.notificationPrefs ?? {},
    storageQuotaBytes: user.storageQuotaBytes,
    storageUsedBytes: user.storageUsedBytes,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
    roles: [...roles],
    permissions: [...permissions].sort(),
  };
}
