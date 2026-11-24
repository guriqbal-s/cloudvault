import { test } from 'node:test';
import assert from 'node:assert/strict';

import ApiError from '../src/utils/ApiError.js';
import { sha256Hex } from '../src/utils/crypto.js';
import { createAuthService, REFRESH_REUSE_GRACE_MS, EMAIL_THROTTLE_MS } from '../src/services/auth/auth.logic.js';
import { createActivityService } from '../src/services/activity.logic.js';
import { verifyEmailMail, resetPasswordMail, passwordChangedMail } from '../src/services/auth/auth.mail.js';
import { createFakeDb } from './helpers/fakeDb.js';

const DAY = 86_400_000;
const dump = (tables) => JSON.stringify(tables, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
const PASSWORD = 'Sup3rSecret-pass';

function setup({ requireEmailVerification = true } = {}) {
  let current = new Date('2026-06-01T12:00:00Z');
  const clock = { now: () => current, advance: (ms) => { current = new Date(current.getTime() + ms); } };
  const db = createFakeDb({ now: clock.now });
  const mail = [];
  const errors = [];
  const logger = { error: (...a) => errors.push(a), warn: () => {} };
  let compareCalls = 0;
  const produced = new Set(); // every hash the hasher has ever created
  const compared = []; // every hash a password was compared against
  const hasher = {
    hash: async (p) => { const h = `h:${p}`; produced.add(h); return h; },
    compare: async (p, h) => { compareCalls++; compared.push(h); return h === `h:${p}`; },
  };
  const principals = {
    loadUser: async (id) => {
      const u = db.tables.user.find((x) => x.id === id);
      if (!u) throw ApiError.unauthorized('Account no longer exists', 'INVALID_TOKEN');
      const { passwordHash, ...safe } = u; // eslint-disable-line no-unused-vars
      return { user: { ...safe }, roles: ['Standard User'], permissions: new Set(['file:read']), rank: 40 };
    },
  };
  const mailer = { sendMail: async (m) => { mail.push(m); } };
  const svc = createAuthService({
    db, hasher, principals, mailer, logger, now: clock.now,
    tokens: { signAccess: ({ userId, sessionId }) => `access.${userId}.${sessionId}` },
    templates: { verifyEmail: verifyEmailMail, resetPassword: resetPasswordMail, passwordChanged: passwordChangedMail },
    activity: createActivityService({ db, logger }),
    config: {
      refreshTokenDays: 30, requireEmailVerification, passwordResetMinutes: 60, emailVerificationHours: 24,
      clientUrl: 'http://localhost:5173', defaultQuotaBytes: 5368709120n,
    },
  });
  db.tables.role.push({ id: 'role-std', name: 'Standard User' });
  return { svc, db, mail, errors, clock, compareCalls: () => compareCalls, compared, produced, hasher, mailer };
}

const meta = { ip: '10.0.0.1', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36' };
const reg = (over = {}) => ({ name: 'Ada Lovelace', email: 'ada@example.com', password: PASSWORD, ...over });
const status = (code, errCode) => (e) => e instanceof ApiError && e.statusCode === code && (!errCode || e.code === errCode);

/** Register + verify via the emailed link. Returns the active user's id. */
async function activeUser(ctx, over = {}) {
  const { user } = await ctx.svc.register(reg(over), meta);
  const raw = /verify-email\/([A-Za-z0-9_-]+)/.exec(ctx.mail.at(-1).text)[1];
  await ctx.svc.verifyEmail(raw);
  return user.id;
}
const rawTokenFrom = (ctx, kind) => new RegExp(`${kind}/([A-Za-z0-9_-]+)`).exec(ctx.mail.at(-1).text)[1];

// ------------------------------------------------------------------ register

test('register creates a pending user, a hashed verification token and one email', async () => {
  const ctx = setup();
  const out = await ctx.svc.register(reg(), meta);

  assert.equal(out.requiresVerification, true);
  assert.deepEqual(Object.keys(out.user).sort(), ['email', 'id', 'name', 'status']);
  const row = ctx.db.tables.user[0];
  assert.equal(row.status, 'PENDING_VERIFICATION');
  assert.equal(row.emailVerifiedAt, null);
  assert.equal(row.passwordHash, `h:${PASSWORD}`);
  assert.notEqual(row.passwordHash, PASSWORD);
  assert.equal(row.storageQuotaBytes, 5368709120n);
  assert.deepEqual(row.roleLinks, [{ roleId: 'role-std' }]);

  assert.equal(ctx.mail.length, 1);
  assert.equal(ctx.mail[0].to, 'ada@example.com');
  const raw = rawTokenFrom(ctx, 'verify-email');
  assert.match(ctx.mail[0].text, /^Hi Ada Lovelace/);
  const stored = ctx.db.tables.emailVerificationToken[0];
  assert.equal(stored.tokenHash, sha256Hex(raw));
  assert.ok(!dump(ctx.db.tables).includes(raw), 'raw token must never be stored');
  assert.equal(stored.expiresAt.getTime(), ctx.clock.now().getTime() + 24 * 3_600_000);
  assert.equal(ctx.db.tables.activityLog[0].action, 'REGISTER');
});

test('register rejects an existing email, including when it loses a creation race', async () => {
  const ctx = setup();
  await ctx.svc.register(reg(), meta);
  await assert.rejects(ctx.svc.register(reg({ name: 'Other' }), meta), status(409, 'EMAIL_TAKEN'));

  const racy = setup();
  racy.db.user.create = async () => { throw Object.assign(new Error('dup'), { code: 'P2002' }); };
  await assert.rejects(racy.svc.register(reg(), meta), status(409, 'EMAIL_TAKEN'));

  const other = setup();
  other.db.user.create = async () => { throw new Error('disk full'); };
  await assert.rejects(other.svc.register(reg(), meta), /disk full/); // unrelated errors are not masked
});

test('with verification disabled, users are active at once and no email is sent', async () => {
  const ctx = setup({ requireEmailVerification: false });
  const out = await ctx.svc.register(reg(), meta);
  assert.equal(out.requiresVerification, false);
  assert.equal(out.user.status, 'ACTIVE');
  assert.ok(ctx.db.tables.user[0].emailVerifiedAt instanceof Date);
  assert.equal(ctx.mail.length, 0);
  await ctx.svc.login({ email: 'ada@example.com', password: PASSWORD }, meta); // can sign in immediately
});

test('register reports a clear error when roles were never seeded', async () => {
  const ctx = setup();
  ctx.db.tables.role.length = 0;
  await assert.rejects(ctx.svc.register(reg(), meta), (e) => e.statusCode === 500 && /seed/.test(e.message));
  assert.equal(ctx.db.tables.user.length, 0);
});

test('a mail outage never fails registration (rejected promise or synchronous throw)', async () => {
  for (const make of [
    () => async () => { throw new Error('SMTP down'); },
    () => () => { throw new Error('SMTP exploded synchronously'); },
  ]) {
    const ctx = setup();
    ctx.mailer.sendMail = make();
    const out = await ctx.svc.register(reg(), meta);
    assert.equal(out.user.email, 'ada@example.com');
    await new Promise((r) => setImmediate(r));
    assert.equal(ctx.errors.length, 1);
    assert.match(String(ctx.errors[0][1]), /SMTP/);
  }
});

// ------------------------------------------------------------- verify email

test('verifyEmail activates the account, is single use, and a repeat click is not an error', async () => {
  const ctx = setup();
  await ctx.svc.register(reg(), meta);
  const raw = rawTokenFrom(ctx, 'verify-email');

  assert.deepEqual(await ctx.svc.verifyEmail(raw), { alreadyVerified: false });
  const user = ctx.db.tables.user[0];
  assert.equal(user.status, 'ACTIVE');
  assert.ok(user.emailVerifiedAt instanceof Date);

  assert.deepEqual(await ctx.svc.verifyEmail(raw), { alreadyVerified: true });
  await assert.rejects(ctx.svc.verifyEmail('x'.repeat(43)), status(400, 'INVALID_TOKEN'));
});

test('two simultaneous verifyEmail calls both succeed and verify exactly once', async () => {
  const ctx = setup();
  await ctx.svc.register(reg(), meta);
  const raw = rawTokenFrom(ctx, 'verify-email');
  const results = await Promise.all([ctx.svc.verifyEmail(raw), ctx.svc.verifyEmail(raw)]);
  assert.deepEqual(results.map((r) => r.alreadyVerified).sort(), [false, true]);
  assert.equal(ctx.db.tables.user[0].status, 'ACTIVE');
});

test('expired verification links are rejected with TOKEN_EXPIRED', async () => {
  const ctx = setup();
  await ctx.svc.register(reg(), meta);
  const raw = rawTokenFrom(ctx, 'verify-email');
  ctx.clock.advance(24 * 3_600_000);
  await assert.rejects(ctx.svc.verifyEmail(raw), status(400, 'TOKEN_EXPIRED'));
  assert.equal(ctx.db.tables.user[0].status, 'PENDING_VERIFICATION');
});

test('verifying an email never un-suspends a suspended account', async () => {
  const ctx = setup();
  await ctx.svc.register(reg(), meta);
  const raw = rawTokenFrom(ctx, 'verify-email');
  ctx.db.tables.user[0].status = 'SUSPENDED';
  await ctx.svc.verifyEmail(raw);
  assert.equal(ctx.db.tables.user[0].status, 'SUSPENDED');
  assert.ok(ctx.db.tables.user[0].emailVerifiedAt);
});

test('resendVerification is silent for unknown/active accounts, throttled, and invalidates the old link', async () => {
  const ctx = setup();
  await ctx.svc.resendVerification('nobody@example.com');
  assert.equal(ctx.mail.length, 0);

  await ctx.svc.register(reg(), meta); // mail #1
  await ctx.svc.resendVerification('ada@example.com'); // inside throttle window: ignored
  assert.equal(ctx.mail.length, 1);

  const first = rawTokenFrom(ctx, 'verify-email');
  ctx.clock.advance(EMAIL_THROTTLE_MS + 1);
  await ctx.svc.resendVerification('ada@example.com');
  assert.equal(ctx.mail.length, 2);
  await assert.rejects(ctx.svc.verifyEmail(first), status(400, 'INVALID_TOKEN')); // superseded
  await ctx.svc.verifyEmail(rawTokenFrom(ctx, 'verify-email'));

  await ctx.svc.resendVerification('ada@example.com'); // now active: silent
  assert.equal(ctx.mail.length, 2);
});

// -------------------------------------------------------------------- login

test('login returns tokens, stores only a hash, records the session and the sign-in', async () => {
  const ctx = setup();
  const id = await activeUser(ctx);
  const out = await ctx.svc.login({ email: 'ada@example.com', password: PASSWORD }, meta);

  assert.equal(out.user.id, id);
  assert.ok(!('passwordHash' in out.user));
  assert.match(out.accessToken, /^access\./);
  assert.equal(out.refreshToken.length, 86); // 64 random bytes, base64url
  assert.equal(out.refreshExpiresAt.getTime(), ctx.clock.now().getTime() + 30 * DAY);

  const [session] = ctx.db.tables.userSession;
  assert.equal(session.userId, id);
  assert.equal(session.ip, '10.0.0.1');
  assert.match(session.userAgent, /Chrome/);
  const [token] = ctx.db.tables.refreshToken;
  assert.equal(token.tokenHash, sha256Hex(out.refreshToken));
  assert.equal(token.sessionId, session.id);
  assert.ok(!dump(ctx.db.tables).includes(out.refreshToken));
  assert.ok(ctx.db.tables.user[0].lastLoginAt instanceof Date);
  assert.ok(ctx.db.tables.activityLog.some((a) => a.action === 'LOGIN' && a.userId === id));
});

test('wrong password and unknown email are indistinguishable, and both cost a password comparison', async () => {
  const ctx = setup();
  await activeUser(ctx);
  const before = ctx.compareCalls();
  const wrong = await ctx.svc.login({ email: 'ada@example.com', password: 'nope-nope-1' }, meta).catch((e) => e);
  const unknown = await ctx.svc.login({ email: 'ghost@example.com', password: 'nope-nope-1' }, meta).catch((e) => e);
  assert.equal(ctx.compareCalls() - before, 2);
  // Real bcrypt returns instantly for a malformed hash, so the unknown-email path must compare
  // against a genuine hash, otherwise response time would still reveal which emails exist.
  assert.ok(ctx.compared.slice(-2).every((h) => ctx.produced.has(h)), 'both comparisons must use real hasher output');
  for (const e of [wrong, unknown]) {
    assert.equal(e.statusCode, 401);
    assert.equal(e.code, 'INVALID_CREDENTIALS');
    assert.equal(e.message, 'Invalid email or password');
  }
  assert.equal(ctx.db.tables.userSession.length, 0);
});

test('suspended and unverified accounts are only revealed after the correct password', async () => {
  const ctx = setup();
  await ctx.svc.register(reg(), meta); // pending
  await assert.rejects(ctx.svc.login({ email: 'ada@example.com', password: PASSWORD }, meta), status(403, 'EMAIL_NOT_VERIFIED'));
  await assert.rejects(ctx.svc.login({ email: 'ada@example.com', password: 'wrong-pass-1' }, meta), status(401, 'INVALID_CREDENTIALS'));

  ctx.db.tables.user[0].status = 'SUSPENDED';
  await assert.rejects(ctx.svc.login({ email: 'ada@example.com', password: PASSWORD }, meta), status(403, 'ACCOUNT_SUSPENDED'));
  await assert.rejects(ctx.svc.login({ email: 'ada@example.com', password: 'wrong-pass-1' }, meta), status(401, 'INVALID_CREDENTIALS'));
  assert.equal(ctx.db.tables.userSession.length, 0);
});

// ------------------------------------------------------------------ refresh

async function signedIn(ctx = setup()) {
  await activeUser(ctx);
  const login = await ctx.svc.login({ email: 'ada@example.com', password: PASSWORD }, meta);
  return { ctx, login };
}

test('refresh rotates the token inside the same family and session, with sliding expiry', async () => {
  const { ctx, login } = await signedIn();
  ctx.clock.advance(5 * DAY);
  const out = await ctx.svc.refresh(login.refreshToken, meta);

  assert.notEqual(out.refreshToken, login.refreshToken);
  assert.equal(out.user.email, 'ada@example.com');
  assert.equal(out.refreshExpiresAt.getTime(), ctx.clock.now().getTime() + 30 * DAY);

  const [oldRow, newRow] = ctx.db.tables.refreshToken;
  assert.ok(oldRow.revokedAt);
  assert.equal(oldRow.replacedById, newRow.id);
  assert.equal(newRow.familyId, oldRow.familyId);
  assert.equal(newRow.sessionId, oldRow.sessionId);
  assert.equal(newRow.revokedAt, null);
  assert.equal(ctx.db.tables.userSession[0].lastActiveAt.getTime(), ctx.clock.now().getTime());

  await ctx.svc.refresh(out.refreshToken, meta); // the new token works too
});

test('reusing a rotated token after the grace window revokes the whole family and session', async () => {
  const { ctx, login } = await signedIn();
  const second = await ctx.svc.refresh(login.refreshToken, meta);
  ctx.clock.advance(REFRESH_REUSE_GRACE_MS + 1);

  await assert.rejects(ctx.svc.refresh(login.refreshToken, meta), status(401, 'REFRESH_REUSE_DETECTED'));
  assert.ok(ctx.db.tables.refreshToken.every((t) => t.revokedAt));
  assert.ok(ctx.db.tables.userSession[0].revokedAt);
  // the legitimate holder of the newest token is signed out as well
  await assert.rejects(ctx.svc.refresh(second.refreshToken, meta), status(401, 'INVALID_REFRESH_TOKEN'));
});

test('reuse inside the grace window is a harmless race and does not revoke anything', async () => {
  const { ctx, login } = await signedIn();
  const second = await ctx.svc.refresh(login.refreshToken, meta);
  ctx.clock.advance(REFRESH_REUSE_GRACE_MS - 1);

  await assert.rejects(ctx.svc.refresh(login.refreshToken, meta), status(401, 'REFRESH_RACE'));
  assert.equal(ctx.db.tables.userSession[0].revokedAt, null);
  await ctx.svc.refresh(second.refreshToken, meta); // winner's cookie still valid
});

test('two concurrent refreshes with one token: exactly one wins', async () => {
  const { ctx, login } = await signedIn();
  const results = await Promise.allSettled([ctx.svc.refresh(login.refreshToken, meta), ctx.svc.refresh(login.refreshToken, meta)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'REFRESH_RACE');
  assert.equal(ctx.db.tables.refreshToken.length, 2); // exactly one new token was issued
  assert.equal(ctx.db.tables.userSession[0].revokedAt, null);
});

test('refresh rejects missing, unknown, expired, ended-session and disabled-account cases', async () => {
  const { ctx, login } = await signedIn();
  await assert.rejects(ctx.svc.refresh(null, meta), status(401, 'NO_REFRESH_TOKEN'));
  await assert.rejects(ctx.svc.refresh('nope', meta), status(401, 'INVALID_REFRESH_TOKEN'));

  ctx.db.tables.user[0].status = 'SUSPENDED';
  await assert.rejects(ctx.svc.refresh(login.refreshToken, meta), status(403, 'ACCOUNT_SUSPENDED'));
  ctx.db.tables.user[0].status = 'ACTIVE';

  ctx.db.tables.userSession[0].revokedAt = ctx.clock.now();
  await assert.rejects(ctx.svc.refresh(login.refreshToken, meta), status(401, 'SESSION_REVOKED'));
  ctx.db.tables.userSession[0].revokedAt = null;

  ctx.clock.advance(30 * DAY);
  await assert.rejects(ctx.svc.refresh(login.refreshToken, meta), status(401, 'REFRESH_EXPIRED'));
});

// ------------------------------------------------------------------- logout

test('logout revokes the family and session, is idempotent, and ignores junk tokens', async () => {
  const { ctx, login } = await signedIn();
  assert.deepEqual(await ctx.svc.logout(login.refreshToken, meta), { loggedOut: true });
  assert.ok(ctx.db.tables.refreshToken.every((t) => t.revokedAt));
  assert.ok(ctx.db.tables.userSession[0].revokedAt);
  assert.ok(ctx.db.tables.activityLog.some((a) => a.action === 'LOGOUT'));

  await assert.rejects(ctx.svc.refresh(login.refreshToken, meta), status(401, 'INVALID_REFRESH_TOKEN'));
  assert.doesNotReject(ctx.svc.logout(login.refreshToken, meta));
  assert.deepEqual(await ctx.svc.logout('junk', meta), { loggedOut: false });
  assert.deepEqual(await ctx.svc.logout(null, meta), { loggedOut: false });
});

// ----------------------------------------------------------- password reset

test('forgotPassword is silent for unknown/suspended accounts and throttled per account', async () => {
  const ctx = setup();
  await activeUser(ctx);
  const baseline = ctx.mail.length;

  await ctx.svc.forgotPassword('ghost@example.com');
  assert.equal(ctx.mail.length, baseline);

  await ctx.svc.forgotPassword('ada@example.com');
  assert.equal(ctx.mail.length, baseline + 1);
  assert.match(ctx.mail.at(-1).text, /\/reset-password\//);
  const first = rawTokenFrom(ctx, 'reset-password');

  await ctx.svc.forgotPassword('ada@example.com'); // within throttle
  assert.equal(ctx.mail.length, baseline + 1);

  ctx.clock.advance(EMAIL_THROTTLE_MS + 1);
  await ctx.svc.forgotPassword('ada@example.com');
  assert.equal(ctx.mail.length, baseline + 2);
  await assert.rejects(ctx.svc.resetPassword({ token: first, password: 'Brand-new-pass-1' }, meta), status(400, 'INVALID_TOKEN'));

  ctx.db.tables.user[0].status = 'SUSPENDED';
  ctx.clock.advance(EMAIL_THROTTLE_MS + 1);
  await ctx.svc.forgotPassword('ada@example.com');
  assert.equal(ctx.mail.length, baseline + 2);
});

test('resetPassword sets the new password, signs out every session, notifies the user, and is single use', async () => {
  const { ctx, login } = await signedIn();
  await ctx.svc.login({ email: 'ada@example.com', password: PASSWORD }, meta); // a second device
  await ctx.svc.forgotPassword('ada@example.com');
  const raw = rawTokenFrom(ctx, 'reset-password');

  await ctx.svc.resetPassword({ token: raw, password: 'Brand-new-pass-1' }, meta);
  assert.equal(ctx.db.tables.user[0].passwordHash, 'h:Brand-new-pass-1');
  assert.ok(ctx.db.tables.userSession.every((s) => s.revokedAt));
  assert.ok(ctx.db.tables.refreshToken.every((t) => t.revokedAt));
  assert.equal(ctx.mail.at(-1).subject, 'Your CloudVault password was changed');
  assert.ok(ctx.db.tables.activityLog.some((a) => a.action === 'PASSWORD_CHANGE'));

  await assert.rejects(ctx.svc.refresh(login.refreshToken, meta), status(401));
  await assert.rejects(ctx.svc.resetPassword({ token: raw, password: 'Another-pass-22' }, meta), status(400, 'INVALID_TOKEN'));
  await assert.rejects(ctx.svc.login({ email: 'ada@example.com', password: PASSWORD }, meta), status(401, 'INVALID_CREDENTIALS'));
  await ctx.svc.login({ email: 'ada@example.com', password: 'Brand-new-pass-1' }, meta);
});

test('reset links expire, and two simultaneous uses cannot both succeed', async () => {
  const ctx = setup();
  await activeUser(ctx);
  await ctx.svc.forgotPassword('ada@example.com');
  const raw = rawTokenFrom(ctx, 'reset-password');

  const results = await Promise.allSettled([
    ctx.svc.resetPassword({ token: raw, password: 'Winner-pass-111' }, meta),
    ctx.svc.resetPassword({ token: raw, password: 'Loser-pass-2222' }, meta),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);

  const expiring = setup();
  await activeUser(expiring);
  await expiring.svc.forgotPassword('ada@example.com');
  const raw2 = rawTokenFrom(expiring, 'reset-password');
  expiring.clock.advance(60 * 60_000);
  await assert.rejects(expiring.svc.resetPassword({ token: raw2, password: 'Late-pass-12345' }, meta), status(400, 'TOKEN_EXPIRED'));
  assert.equal(expiring.db.tables.user[0].passwordHash, `h:${PASSWORD}`);
});

test('changePassword checks the current password and keeps only the current session', async () => {
  const { ctx, login } = await signedIn();
  const other = await ctx.svc.login({ email: 'ada@example.com', password: PASSWORD }, meta);
  const userId = ctx.db.tables.user[0].id;
  const currentSession = ctx.db.tables.userSession[0].id;

  await assert.rejects(
    ctx.svc.changePassword(userId, currentSession, { currentPassword: 'wrong-pass-1', newPassword: 'Fresh-password-9' }, meta),
    status(400, 'INVALID_CURRENT_PASSWORD')
  );
  assert.equal(ctx.db.tables.user[0].passwordHash, `h:${PASSWORD}`);

  await ctx.svc.changePassword(userId, currentSession, { currentPassword: PASSWORD, newPassword: 'Fresh-password-9' }, meta);
  assert.equal(ctx.db.tables.user[0].passwordHash, 'h:Fresh-password-9');
  assert.equal(ctx.db.tables.userSession[0].revokedAt, null);
  assert.ok(ctx.db.tables.userSession[1].revokedAt);
  await ctx.svc.refresh(login.refreshToken, meta); // current device still works
  await assert.rejects(ctx.svc.refresh(other.refreshToken, meta), status(401));
  assert.equal(ctx.mail.at(-1).subject, 'Your CloudVault password was changed');
});

// ----------------------------------------------------------------- sessions

test('listSessions shows only active sessions, newest activity first, with the current one flagged', async () => {
  const { ctx } = await signedIn();
  ctx.clock.advance(1000);
  await ctx.svc.login({ email: 'ada@example.com', password: PASSWORD }, { ip: '10.0.0.2', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit Version/17.5 Safari/604.1' });
  const [first, second] = ctx.db.tables.userSession;
  ctx.db.tables.userSession.push({ ...first, id: 'revoked-one', revokedAt: ctx.clock.now() });
  ctx.db.tables.userSession.push({ ...first, id: 'someone-else', userId: 'other-user' });

  const list = await ctx.svc.listSessions(first.userId, first.id);
  assert.deepEqual(list.map((s) => s.id), [second.id, first.id]);
  assert.deepEqual(list.map((s) => s.current), [false, true]);
  assert.equal(list[0].device, 'Safari on iOS');
  assert.equal(list[1].device, 'Chrome on Windows');
  assert.ok(!list.some((s) => 'userAgent' in s));
});

test('revokeSession only works on your own sessions and kills that session\'s tokens', async () => {
  const { ctx } = await signedIn();
  const second = await ctx.svc.login({ email: 'ada@example.com', password: PASSWORD }, meta);
  const [mine, theirs] = ctx.db.tables.userSession;

  await assert.rejects(ctx.svc.revokeSession('someone-else', theirs.id, mine.id), status(404));
  await assert.rejects(ctx.svc.revokeSession(mine.userId, 'does-not-exist', mine.id), status(404));

  assert.deepEqual(await ctx.svc.revokeSession(mine.userId, theirs.id, mine.id), { revokedCurrent: false });
  await assert.rejects(ctx.svc.refresh(second.refreshToken, meta), status(401));
  assert.equal((await ctx.svc.revokeSession(mine.userId, mine.id, mine.id)).revokedCurrent, true);
  await assert.rejects(ctx.svc.revokeSession(mine.userId, mine.id, mine.id), status(404)); // already gone
});

test('revokeOtherSessions signs out every device except this one', async () => {
  const { ctx, login } = await signedIn();
  const b = await ctx.svc.login({ email: 'ada@example.com', password: PASSWORD }, meta);
  const c = await ctx.svc.login({ email: 'ada@example.com', password: PASSWORD }, meta);
  const current = ctx.db.tables.userSession[0];

  assert.deepEqual(await ctx.svc.revokeOtherSessions(current.userId, current.id), { revoked: 2 });
  await ctx.svc.refresh(login.refreshToken, meta);
  await assert.rejects(ctx.svc.refresh(b.refreshToken, meta), status(401));
  await assert.rejects(ctx.svc.refresh(c.refreshToken, meta), status(401));
  assert.deepEqual(await ctx.svc.revokeOtherSessions(current.userId, current.id), { revoked: 0 });
});

// ---------------------------------------------------------------- templates

test('email templates carry the link, escape user-controlled text, and name the recipient', () => {
  const evil = '<img src=x onerror=alert(1)>';
  for (const mail of [
    verifyEmailMail({ name: evil, email: 'a@b.co', url: 'https://app/x?a=1&b="2"', hours: 24 }),
    resetPasswordMail({ name: evil, email: 'a@b.co', url: 'https://app/x?a=1&b="2"', minutes: 60 }),
  ]) {
    assert.equal(mail.to, 'a@b.co');
    assert.ok(mail.text.includes('https://app/x?a=1&b="2"'));
    assert.ok(!mail.html.includes('<img'), 'name must be HTML-escaped');
    assert.ok(mail.html.includes('&lt;img'));
    assert.ok(mail.html.includes('a=1&amp;b=&quot;2&quot;'), 'URL must be attribute-escaped');
  }
  assert.match(passwordChangedMail({ name: 'Ada', email: 'a@b.co' }).text, /was just changed/);
});

// ----------------------------------------------------------------- activity

test('a failing activity log never breaks the request and is reported', async () => {
  const ctx = setup();
  ctx.db.activityLog.create = async () => { throw new Error('log table locked'); };
  const out = await ctx.svc.register(reg(), meta);
  assert.ok(out.user.id);
  assert.match(String(ctx.errors[0][1]), /log table locked/);
});
