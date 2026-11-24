// Loads "who is making this request" from the database: the user, their roles, the union of
// their role permissions and (for authenticated requests) the validity of their session.
//
// The database is consulted on every authenticated request on purpose. That makes suspending a
// user, revoking a session or changing a role take effect immediately instead of when the
// 15-minute access token expires.

import ApiError from '../../utils/ApiError.js';

const TOUCH_INTERVAL_MS = 60_000;

const USER_FIELDS = [
  'id', 'email', 'name', 'avatarKey', 'status', 'emailVerifiedAt', 'storageQuotaBytes',
  'storageUsedBytes', 'themePref', 'notificationPrefs', 'lastLoginAt', 'createdAt',
];

const userSelect = {
  ...Object.fromEntries(USER_FIELDS.map((f) => [f, true])),
  // passwordHash is deliberately never selected
  roles: {
    select: {
      role: {
        select: {
          name: true,
          rank: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  },
};

/** Throws for accounts that may not use the application. */
export function assertAccountUsable(status, requireEmailVerification) {
  if (status === 'SUSPENDED') {
    throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended. Contact an administrator.');
  }
  if (status === 'PENDING_VERIFICATION' && requireEmailVerification) {
    throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address before signing in.');
  }
}

function shape(row) {
  // Copy an allow-list of fields instead of spreading the row, so nothing extra can leak.
  const user = {};
  for (const field of USER_FIELDS) user[field] = row[field];
  const roles = (row.roles ?? []).map((r) => r.role);
  return {
    user,
    roles: roles.map((r) => r.name),
    permissions: new Set(roles.flatMap((r) => (r.permissions ?? []).map((p) => p.permission.key))),
    rank: roles.reduce((max, r) => Math.max(max, r.rank ?? 0), 0),
  };
}

/** @param {{ db: object, requireEmailVerification: boolean, now?: () => Date }} deps */
export function createPrincipalLoader({ db, requireEmailVerification, now = () => new Date() }) {
  const findUser = (userId) => db.user.findUnique({ where: { id: userId }, select: userSelect });

  /** Profile + access for a user id (no session involved). */
  async function loadUser(userId) {
    const row = await findUser(userId);
    if (!row) throw ApiError.unauthorized('Account no longer exists', 'INVALID_TOKEN');
    return shape(row);
  }

  /**
   * Full authentication of an access token's claims. Returns the principal that
   * middleware/authenticate.js attaches as req.user.
   */
  async function authenticate({ userId, sessionId }) {
    const [row, session] = await Promise.all([
      findUser(userId),
      db.userSession.findUnique({
        where: { id: sessionId },
        select: { userId: true, revokedAt: true, lastActiveAt: true },
      }),
    ]);

    if (!session || session.userId !== userId || session.revokedAt) {
      throw ApiError.unauthorized('Your session has ended. Please sign in again.', 'SESSION_REVOKED');
    }
    if (!row) throw ApiError.unauthorized('Account no longer exists', 'INVALID_TOKEN');
    assertAccountUsable(row.status, requireEmailVerification);

    // Record activity at most once a minute, without making the request wait for it.
    const t = now();
    if (t.getTime() - new Date(session.lastActiveAt).getTime() > TOUCH_INTERVAL_MS) {
      Promise.resolve(
        db.userSession.updateMany({
          where: { id: sessionId, revokedAt: null, lastActiveAt: { lt: new Date(t.getTime() - TOUCH_INTERVAL_MS) } },
          data: { lastActiveAt: t },
        })
      ).catch(() => {});
    }

    return { ...shape(row), sessionId };
  }

  return { loadUser, authenticate };
}
