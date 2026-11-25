// Authentication business logic. Every dependency is injected, so the whole module is
// unit-tested without a database, bcrypt or SMTP. services/auth/auth.service.js wires the real ones.
//
// Security properties (each is covered by a test):
//  - Passwords are bcrypt-hashed; login does the same work for unknown emails (no timing oracle)
//    and returns one generic error for "no such user" and "wrong password".
//  - Refresh, reset and verification tokens are random, stored only as SHA-256 hashes, and
//    single-use. "Claim" steps are atomic conditional updates (WHERE usedAt/revokedAt IS NULL), so
//    two concurrent requests can never both win.
//  - Refresh tokens rotate on every use. Presenting an already-rotated token (reuse) means it was
//    probably stolen, so the whole token family and its session are revoked. A short grace window
//    treats a genuine double-submit (two tabs) as a harmless race instead.
//  - Resetting or changing a password revokes sessions, so a stolen session does not survive it.
//  - Forgot-password / resend-verification never reveal whether an email is registered, and are
//    throttled per account so they cannot be used to flood someone's inbox.
//  - Mail is fire-and-forget: an SMTP outage never fails a request or changes its timing.

import ApiError from '../../utils/ApiError.js';
import { randomToken, sha256Hex, uuid } from '../../utils/crypto.js';
import { describeUserAgent } from '../../utils/userAgent.js';
import { serializeUser } from './user.serializer.js';
import { assertAccountUsable } from './principal.js';

export const REFRESH_REUSE_GRACE_MS = 10_000;
export const EMAIL_THROTTLE_MS = 60_000;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

const trunc = (value, max) => (typeof value === 'string' && value ? value.slice(0, max) : null);
const addMs = (date, ms) => new Date(date.getTime() + ms);

const invalidLink = (what) =>
  new ApiError(400, 'INVALID_TOKEN', `This ${what} link is invalid or has already been used.`);
const expiredLink = (what) =>
  new ApiError(400, 'TOKEN_EXPIRED', `This ${what} link has expired. Please request a new one.`);
const emailTaken = () => new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists');

/**
 * @param {object} deps
 * @param {object} deps.db          Prisma client (or test double)
 * @param {{hash(p:string):Promise<string>, compare(p:string,h:string):Promise<boolean>}} deps.hasher
 * @param {{signAccess(c:{userId:string,sessionId:string}):string}} deps.tokens
 * @param {{loadUser(id:string):Promise<object>}} deps.principals
 * @param {{sendMail(m:object):Promise<unknown>}} deps.mailer
 * @param {{verifyEmail:Function, resetPassword:Function, passwordChanged:Function}} deps.templates
 * @param {{log:Function}} deps.activity
 * @param {{refreshTokenDays:number, requireEmailVerification:boolean, passwordResetMinutes:number,
 *          emailVerificationHours:number, clientUrl:string, defaultQuotaBytes:bigint}} deps.config
 * @param {{error:Function,warn:Function}} deps.logger
 * @param {() => Date} [deps.now]
 */
export function createAuthService(deps) {
  const { db, hasher, tokens, principals, mailer, templates, activity, config, logger } = deps;
  const now = deps.now ?? (() => new Date());

  // ------------------------------------------------------------------ helpers

  let dummyHashPromise = null;
  /** A real bcrypt hash at the configured cost, compared against when the email is unknown. */
  const dummyHash = () => (dummyHashPromise ??= hasher.hash(randomToken(16)));

  function sendSafely(message) {
    try {
      Promise.resolve(mailer.sendMail(message)).catch((err) => logger.error('Failed to send email:', err));
    } catch (err) {
      logger.error('Failed to send email:', err);
    }
  }

  const requestMeta = (meta = {}) => ({ ip: trunc(meta.ip, 64), userAgent: trunc(meta.userAgent, 255) });

  async function revokeFamily(familyId, sessionId, at) {
    await db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: at } });
    await db.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: at } });
  }

  async function revokeAllSessions(client, userId, at, exceptSessionId = null) {
    const sessionFilter = exceptSessionId ? { sessionId: { not: exceptSessionId } } : {};
    const idFilter = exceptSessionId ? { id: { not: exceptSessionId } } : {};
    await client.refreshToken.updateMany({ where: { userId, revokedAt: null, ...sessionFilter }, data: { revokedAt: at } });
    await client.userSession.updateMany({ where: { userId, revokedAt: null, ...idFilter }, data: { revokedAt: at } });
  }

  /** New session + first refresh token of a new family + access token. */
  async function openSession(userId, meta) {
    const t = now();
    const { ip, userAgent } = requestMeta(meta);
    const sessionId = uuid();
    const refreshToken = randomToken(64);
    const refreshExpiresAt = addMs(t, config.refreshTokenDays * DAY);

    await db.$transaction(async (tx) => {
      await tx.userSession.create({ data: { id: sessionId, userId, ip, userAgent, lastActiveAt: t } });
      await tx.refreshToken.create({
        data: { userId, sessionId, tokenHash: sha256Hex(refreshToken), familyId: uuid(), expiresAt: refreshExpiresAt },
      });
    });

    return { sessionId, refreshToken, refreshExpiresAt, accessToken: tokens.signAccess({ userId, sessionId }) };
  }

  /** Replaces any outstanding verification token with a fresh one and emails the link. */
  async function issueEmailVerification(user) {
    const t = now();
    await db.emailVerificationToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: t } });
    const raw = randomToken(32);
    await db.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: sha256Hex(raw), expiresAt: addMs(t, config.emailVerificationHours * HOUR) },
    });
    sendSafely(
      templates.verifyEmail({
        name: user.name,
        email: user.email,
        url: `${config.clientUrl}/verify-email/${raw}`,
        hours: config.emailVerificationHours,
      })
    );
  }

  // ----------------------------------------------------------------- register

  async function register({ name, email, password }, meta) {
    if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw emailTaken();

    const role = await db.role.findUnique({ where: { name: 'Standard User' }, select: { id: true } });
    if (!role) throw ApiError.internal('Server is not initialised (roles are missing). Run the database seed.');

    const passwordHash = await hasher.hash(password);
    const t = now();
    const needsVerification = config.requireEmailVerification;

    let user;
    try {
      user = await db.user.create({
        data: {
          email,
          name,
          passwordHash,
          status: needsVerification ? 'PENDING_VERIFICATION' : 'ACTIVE',
          emailVerifiedAt: needsVerification ? null : t,
          storageQuotaBytes: config.defaultQuotaBytes,
          roles: { create: [{ roleId: role.id }] },
        },
        select: { id: true, email: true, name: true, status: true },
      });
    } catch (err) {
      if (err?.code === 'P2002') throw emailTaken(); // lost a race with a concurrent registration
      throw err;
    }

    await activity.log({
      userId: user.id,
      action: 'REGISTER',
      description: `${user.name} created an account`,
      meta: requestMeta(meta),
    });
    if (needsVerification) await issueEmailVerification(user);

    return {
      user: { id: user.id, email: user.email, name: user.name, status: user.status },
      requiresVerification: needsVerification,
    };
  }

  // -------------------------------------------------------------------- login

  async function login({ email, password }, meta) {
    const found = await db.user.findUnique({ where: { email }, select: { id: true, passwordHash: true, status: true } });

    // Always run one bcrypt comparison so response time does not reveal whether the email exists.
    const matches = await hasher.compare(password, found?.passwordHash ?? (await dummyHash()));
    if (!found || !matches) throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');

    // Account state is only revealed to someone who proved they know the password.
    assertAccountUsable(found.status, config.requireEmailVerification);

    const session = await openSession(found.id, meta);
    await db.user.update({ where: { id: found.id }, data: { lastLoginAt: now() } });
    const principal = await principals.loadUser(found.id);

    await activity.log({
      userId: found.id,
      action: 'LOGIN',
      description: `${principal.user.name} signed in`,
      meta: requestMeta(meta),
    });

    return {
      user: serializeUser(principal),
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.refreshExpiresAt,
    };
  }

  // ------------------------------------------------------------------ refresh

  async function refresh(rawToken, meta) {
    if (!rawToken) throw ApiError.unauthorized('Not signed in', 'NO_REFRESH_TOKEN');

    const record = await db.refreshToken.findUnique({ where: { tokenHash: sha256Hex(rawToken) } });
    if (!record) throw ApiError.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');

    const t = now();

    if (record.revokedAt) {
      if (record.replacedById) {
        // A rotated token was presented again.
        if (t.getTime() - new Date(record.revokedAt).getTime() <= REFRESH_REUSE_GRACE_MS) {
          throw ApiError.unauthorized('Token was just rotated, retry with the new cookie', 'REFRESH_RACE');
        }
        await revokeFamily(record.familyId, record.sessionId, t);
        logger.warn(`Refresh token reuse detected for user ${record.userId}; session ${record.sessionId} revoked`);
        throw ApiError.unauthorized('Your session was invalidated. Please sign in again.', 'REFRESH_REUSE_DETECTED');
      }
      throw ApiError.unauthorized('Your session has ended. Please sign in again.', 'INVALID_REFRESH_TOKEN');
    }

    if (new Date(record.expiresAt).getTime() <= t.getTime()) {
      throw ApiError.unauthorized('Your session has expired. Please sign in again.', 'REFRESH_EXPIRED');
    }

    const session = await db.userSession.findUnique({ where: { id: record.sessionId } });
    if (!session || session.revokedAt) {
      throw ApiError.unauthorized('Your session has ended. Please sign in again.', 'SESSION_REVOKED');
    }

    const principal = await principals.loadUser(record.userId);
    assertAccountUsable(principal.user.status, config.requireEmailVerification);

    // Rotate atomically: only one concurrent caller can flip revokedAt from null.
    const newRaw = randomToken(64);
    const newId = uuid();
    const { ip, userAgent } = requestMeta(meta);
    const rotated = await db.$transaction(async (tx) => {
      const claim = await tx.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: t, replacedById: newId },
      });
      if (claim.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          id: newId,
          userId: record.userId,
          sessionId: record.sessionId,
          familyId: record.familyId,
          tokenHash: sha256Hex(newRaw),
          expiresAt: addMs(t, config.refreshTokenDays * DAY), // sliding expiry
        },
      });
      await tx.userSession.update({
        where: { id: record.sessionId },
        data: { lastActiveAt: t, ...(ip ? { ip } : {}), ...(userAgent ? { userAgent } : {}) },
      });
      return true;
    });
    if (!rotated) throw ApiError.unauthorized('Token was just rotated, retry with the new cookie', 'REFRESH_RACE');

    return {
      user: serializeUser(principal),
      accessToken: tokens.signAccess({ userId: record.userId, sessionId: record.sessionId }),
      refreshToken: newRaw,
      refreshExpiresAt: addMs(t, config.refreshTokenDays * DAY),
    };
  }

  // ------------------------------------------------------------------- logout

  /** Idempotent. Never throws for an unknown/expired token: the goal state is already reached. */
  async function logout(rawToken, meta) {
    if (!rawToken) return { loggedOut: false };
    const record = await db.refreshToken.findUnique({ where: { tokenHash: sha256Hex(rawToken) } });
    if (!record) return { loggedOut: false };

    await revokeFamily(record.familyId, record.sessionId, now());
    const user = await db.user.findUnique({ where: { id: record.userId }, select: { name: true } });
    await activity.log({
      userId: record.userId,
      action: 'LOGOUT',
      description: `${user?.name ?? 'A user'} signed out`,
      meta: requestMeta(meta),
    });
    return { loggedOut: true };
  }

  // ------------------------------------------------------------ verify email

  async function verifyEmail(rawToken) {
    const record = await db.emailVerificationToken.findUnique({ where: { tokenHash: sha256Hex(rawToken) } });
    if (!record) throw invalidLink('verification');

    const alreadyVerified = async () => {
      const user = await db.user.findUnique({ where: { id: record.userId }, select: { emailVerifiedAt: true } });
      return Boolean(user?.emailVerifiedAt);
    };

    // A double submit (React StrictMode, a double click) must not show an error after success.
    if (record.usedAt) {
      if (await alreadyVerified()) return { alreadyVerified: true };
      throw invalidLink('verification');
    }

    const t = now();
    if (new Date(record.expiresAt).getTime() <= t.getTime()) throw expiredLink('verification');

    const claimed = await db.$transaction(async (tx) => {
      const claim = await tx.emailVerificationToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: t } });
      if (claim.count !== 1) return false;
      const user = await tx.user.findUnique({ where: { id: record.userId }, select: { status: true } });
      await tx.user.update({
        where: { id: record.userId },
        // Only PENDING accounts become ACTIVE: verifying must never un-suspend a suspended user.
        data: { emailVerifiedAt: t, ...(user?.status === 'PENDING_VERIFICATION' ? { status: 'ACTIVE' } : {}) },
      });
      return true;
    });

    if (!claimed) {
      if (await alreadyVerified()) return { alreadyVerified: true };
      throw invalidLink('verification');
    }
    return { alreadyVerified: false };
  }

  async function resendVerification(email) {
    const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, status: true } });
    if (!user || user.status !== 'PENDING_VERIFICATION') return; // silent: no account enumeration

    const recent = await db.emailVerificationToken.findFirst({
      where: { userId: user.id, usedAt: null, createdAt: { gt: new Date(now().getTime() - EMAIL_THROTTLE_MS) } },
    });
    if (recent) return;
    await issueEmailVerification(user);
  }

  // ---------------------------------------------------------- password reset

  async function forgotPassword(email) {
    const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, status: true } });
    if (!user || user.status === 'SUSPENDED') return; // silent

    const t = now();
    const recent = await db.passwordResetToken.findFirst({
      where: { userId: user.id, usedAt: null, createdAt: { gt: new Date(t.getTime() - EMAIL_THROTTLE_MS) } },
    });
    if (recent) return;

    await db.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: t } });
    const raw = randomToken(32);
    await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256Hex(raw), expiresAt: addMs(t, config.passwordResetMinutes * MINUTE) },
    });
    sendSafely(
      templates.resetPassword({
        name: user.name,
        email: user.email,
        url: `${config.clientUrl}/reset-password/${raw}`,
        minutes: config.passwordResetMinutes,
      })
    );
  }

  async function resetPassword({ token, password }, meta) {
    const record = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!record || record.usedAt) throw invalidLink('password reset');
    const t = now();
    if (new Date(record.expiresAt).getTime() <= t.getTime()) throw expiredLink('password reset');

    const passwordHash = await hasher.hash(password); // slow step happens before the atomic claim

    const claimed = await db.$transaction(async (tx) => {
      const claim = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: t } });
      if (claim.count !== 1) return false;
      await tx.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: t } });
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await revokeAllSessions(tx, record.userId, t); // a reset signs the account out everywhere
      return true;
    });
    if (!claimed) throw invalidLink('password reset');

    const user = await db.user.findUnique({ where: { id: record.userId }, select: { name: true, email: true } });
    await activity.log({
      userId: record.userId,
      action: 'PASSWORD_CHANGE',
      description: `${user.name} reset their password`,
      metadata: { method: 'reset-link' },
      meta: requestMeta(meta),
    });
    sendSafely(templates.passwordChanged({ name: user.name, email: user.email }));
  }

  async function changePassword(userId, currentSessionId, { currentPassword, newPassword }, meta) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true, name: true, email: true } });
    if (!user) throw ApiError.unauthorized('Account no longer exists', 'INVALID_TOKEN');

    // 400 (not 401): a 401 would make the SPA think its session died and sign the user out.
    if (!(await hasher.compare(currentPassword, user.passwordHash))) {
      throw new ApiError(400, 'INVALID_CURRENT_PASSWORD', 'Your current password is incorrect');
    }

    const passwordHash = await hasher.hash(newPassword);
    const t = now();
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await revokeAllSessions(tx, userId, t, currentSessionId); // keep this device signed in
    });

    await activity.log({
      userId,
      action: 'PASSWORD_CHANGE',
      description: `${user.name} changed their password`,
      metadata: { method: 'settings' },
      meta: requestMeta(meta),
    });
    sendSafely(templates.passwordChanged({ name: user.name, email: user.email }));
  }

  // ----------------------------------------------------------------- sessions

  async function listSessions(userId, currentSessionId) {
    const rows = await db.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastActiveAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      device: describeUserAgent(s.userAgent),
      ip: s.ip ?? null,
      lastActiveAt: s.lastActiveAt,
      createdAt: s.createdAt,
      current: s.id === currentSessionId,
    }));
  }

  /** Revoke one of the caller's own sessions. 404 if it is not theirs (existence is not leaked). */
  async function revokeSession(userId, sessionId, currentSessionId) {
    const session = await db.userSession.findFirst({ where: { id: sessionId, userId, revokedAt: null } });
    if (!session) throw ApiError.notFound('Session not found');
    const t = now();
    await db.refreshToken.updateMany({ where: { sessionId, revokedAt: null }, data: { revokedAt: t } });
    await db.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: t } });
    return { revokedCurrent: sessionId === currentSessionId };
  }

  /** "Sign out everywhere else". */
  async function revokeOtherSessions(userId, currentSessionId) {
    const others = await db.userSession.findMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
    });
    await revokeAllSessions(db, userId, now(), currentSessionId);
    return { revoked: others.length };
  }

  return {
    register,
    login,
    refresh,
    logout,
    verifyEmail,
    resendVerification,
    forgotPassword,
    resetPassword,
    changePassword,
    listSessions,
    revokeSession,
    revokeOtherSessions,
  };
}
