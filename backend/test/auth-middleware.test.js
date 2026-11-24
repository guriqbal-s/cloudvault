import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ApiError from '../src/utils/ApiError.js';
import { createTokenService } from '../src/services/auth/tokens.js';
import { createPrincipalLoader, assertAccountUsable } from '../src/services/auth/principal.js';
import { serializeUser } from '../src/services/auth/user.serializer.js';
import { createAuthenticate } from '../src/middleware/authenticate.js';
import { requirePermission, requireAnyPermission } from '../src/middleware/authorize.js';
import { createTrustedOrigin } from '../src/middleware/trustedOrigin.js';
import { setRefreshCookie, clearRefreshCookie, readRefreshCookie } from '../src/utils/refreshCookie.js';
import { describeUserAgent } from '../src/utils/userAgent.js';
import { ACTIONS } from '../src/services/access.logic.js';
import { PERMISSIONS, ROLES } from '../../prisma/seed/permissions.js';
import { createFakeDb } from './helpers/fakeDb.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const status = (code, errCode) => (e) => e instanceof ApiError && e.statusCode === code && (!errCode || e.code === errCode);

// ------------------------------------------------------------------- tokens

function fakeJwt() {
  const calls = { sign: [], verify: [] };
  return {
    calls,
    behaviour: { verify: null },
    sign(payload, secret, options) { calls.sign.push({ payload, secret, options }); return `jwt:${payload.sid}:${options.subject}`; },
    verify(token, secret, options) {
      calls.verify.push({ token, secret, options });
      if (this.behaviour.verify) throw this.behaviour.verify;
      const [, sid, sub] = token.split(':');
      return { sid, sub };
    },
  };
}

test('token service pins the algorithm and issuer on sign and verify', () => {
  const jwt = fakeJwt();
  const tokens = createTokenService({ jwt, secret: 'x'.repeat(32), expiresIn: '15m' });
  const token = tokens.signAccess({ userId: 'u1', sessionId: 's1' });
  assert.deepEqual(jwt.calls.sign[0].options, { algorithm: 'HS256', subject: 'u1', issuer: 'cloudvault', expiresIn: '15m' });
  assert.deepEqual(jwt.calls.sign[0].payload, { sid: 's1' });
  assert.deepEqual(tokens.verifyAccess(token), { userId: 'u1', sessionId: 's1' });
  assert.deepEqual(jwt.calls.verify[0].options, { algorithms: ['HS256'], issuer: 'cloudvault' });
});

test('token service maps library failures to 401s the SPA can act on', () => {
  const jwt = fakeJwt();
  const tokens = createTokenService({ jwt, secret: 'x'.repeat(32), expiresIn: '15m' });
  jwt.behaviour.verify = Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' });
  assert.throws(() => tokens.verifyAccess('t'), status(401, 'TOKEN_EXPIRED'));
  for (const name of ['JsonWebTokenError', 'NotBeforeError', 'SomethingElse']) {
    jwt.behaviour.verify = Object.assign(new Error('bad'), { name });
    assert.throws(() => tokens.verifyAccess('t'), status(401, 'INVALID_TOKEN'));
  }
  jwt.behaviour.verify = null;
  jwt.verify = () => ({ sub: 'u1' }); // missing session claim
  assert.throws(() => tokens.verifyAccess('t'), status(401, 'INVALID_TOKEN'));
  jwt.verify = () => ({ sub: 123, sid: 's' });
  assert.throws(() => tokens.verifyAccess('t'), status(401, 'INVALID_TOKEN'));
  jwt.verify = () => null;
  assert.throws(() => tokens.verifyAccess('t'), status(401, 'INVALID_TOKEN'));
  assert.throws(() => createTokenService({ jwt, secret: 'short', expiresIn: '1m' }));
});

// ---------------------------------------------------------------- principal

const roleRow = (name, rank, keys) => ({ role: { name, rank, permissions: keys.map((key) => ({ permission: { key } })) } });

function principalWorld(over = {}) {
  let current = new Date('2026-06-01T12:00:00Z');
  const clock = { now: () => current, advance: (ms) => { current = new Date(current.getTime() + ms); } };
  const db = createFakeDb({ now: clock.now });
  db.tables.user.push({
    id: 'u1', email: 'a@b.co', name: 'Ada', status: 'ACTIVE', passwordHash: 'SECRET-HASH', avatarKey: null,
    emailVerifiedAt: new Date(), storageQuotaBytes: 10n, storageUsedBytes: 1n, themePref: 'system',
    notificationPrefs: {}, lastLoginAt: null, createdAt: new Date(),
    roles: [roleRow('Standard User', 40, ['file:read', 'file:upload']), roleRow('Manager', 60, ['file:read', 'user:read'])],
    ...over.user,
  });
  db.tables.userSession.push({ id: 's1', userId: 'u1', revokedAt: null, lastActiveAt: clock.now(), ...over.session });
  const loader = createPrincipalLoader({ db, requireEmailVerification: true, now: clock.now });
  return { db, clock, loader };
}

test('principal: roles merge into one permission set and the highest rank wins', async () => {
  const { loader } = principalWorld();
  const p = await loader.authenticate({ userId: 'u1', sessionId: 's1' });
  assert.deepEqual(p.roles, ['Standard User', 'Manager']);
  assert.deepEqual([...p.permissions].sort(), ['file:read', 'file:upload', 'user:read']);
  assert.equal(p.rank, 60);
  assert.equal(p.sessionId, 's1');
});

test('principal never exposes the password hash, even if the row contains it', async () => {
  const { loader } = principalWorld();
  const p = await loader.authenticate({ userId: 'u1', sessionId: 's1' });
  assert.ok(!('passwordHash' in p.user));
  assert.ok(!JSON.stringify(serializeUser(p), (_k, v) => (typeof v === 'bigint' ? 0 : v)).includes('SECRET-HASH'));
  assert.ok(!('roles' in p.user));
});

test('principal rejects revoked, foreign, missing and unknown sessions (SESSION_REVOKED)', async () => {
  const revoked = principalWorld({ session: { revokedAt: new Date() } });
  await assert.rejects(revoked.loader.authenticate({ userId: 'u1', sessionId: 's1' }), status(401, 'SESSION_REVOKED'));
  const foreign = principalWorld({ session: { userId: 'someone-else' } });
  await assert.rejects(foreign.loader.authenticate({ userId: 'u1', sessionId: 's1' }), status(401, 'SESSION_REVOKED'));
  const { loader } = principalWorld();
  await assert.rejects(loader.authenticate({ userId: 'u1', sessionId: 'nope' }), status(401, 'SESSION_REVOKED'));
  await assert.rejects(loader.authenticate({ userId: 'ghost', sessionId: 's1' }), status(401));
});

test('suspension takes effect immediately, not when the access token expires', async () => {
  const { loader, db } = principalWorld();
  await loader.authenticate({ userId: 'u1', sessionId: 's1' });
  db.tables.user[0].status = 'SUSPENDED';
  await assert.rejects(loader.authenticate({ userId: 'u1', sessionId: 's1' }), status(403, 'ACCOUNT_SUSPENDED'));
});

test('assertAccountUsable', () => {
  assert.doesNotThrow(() => assertAccountUsable('ACTIVE', true));
  assert.doesNotThrow(() => assertAccountUsable('PENDING_VERIFICATION', false));
  assert.throws(() => assertAccountUsable('PENDING_VERIFICATION', true), status(403, 'EMAIL_NOT_VERIFIED'));
  assert.throws(() => assertAccountUsable('SUSPENDED', false), status(403, 'ACCOUNT_SUSPENDED'));
});

test('session activity is recorded at most once a minute', async () => {
  const { loader, db, clock } = principalWorld();
  const flush = () => new Promise((r) => setImmediate(r));
  const t0 = db.tables.userSession[0].lastActiveAt.getTime();

  clock.advance(30_000);
  await loader.authenticate({ userId: 'u1', sessionId: 's1' });
  await flush();
  assert.equal(db.tables.userSession[0].lastActiveAt.getTime(), t0); // too soon

  clock.advance(31_000);
  await loader.authenticate({ userId: 'u1', sessionId: 's1' });
  await flush();
  assert.equal(db.tables.userSession[0].lastActiveAt.getTime(), clock.now().getTime());
});

test('a failing activity touch does not fail the request', async () => {
  const { loader, db, clock } = principalWorld();
  db.userSession.updateMany = async () => { throw new Error('db hiccup'); };
  clock.advance(120_000);
  await loader.authenticate({ userId: 'u1', sessionId: 's1' });
  await new Promise((r) => setImmediate(r)); // no unhandled rejection
});

test('serializeUser exposes an allow-list only', async () => {
  const { loader } = principalWorld({ user: { avatarKey: 'uploads/avatars/u1' } });
  const out = serializeUser(await loader.loadUser('u1'));
  assert.deepEqual(Object.keys(out).sort(), [
    'createdAt', 'email', 'emailVerifiedAt', 'hasAvatar', 'id', 'lastLoginAt', 'name', 'notificationPrefs',
    'permissions', 'roles', 'status', 'storageQuotaBytes', 'storageUsedBytes', 'themePref',
  ]);
  assert.equal(out.hasAvatar, true);
  assert.deepEqual(out.permissions, ['file:read', 'file:upload', 'user:read']);
});

// ------------------------------------------------------------- authenticate

async function runAuth(headers, { tokens, principals } = {}) {
  const mw = createAuthenticate({
    tokens: tokens ?? { verifyAccess: (t) => ({ userId: `user-for-${t}`, sessionId: 'sess' }) },
    principals: principals ?? { authenticate: async (c) => ({ ...c, permissions: new Set() }) },
  });
  const req = { headers };
  const err = await new Promise((resolve) => mw(req, {}, resolve));
  return { req, err };
}

test('authenticate requires a well-formed Bearer header', async () => {
  for (const header of [undefined, '', 'Bearer', 'Bearer ', 'Basic abc', 'abc', 'Bearer a b', 'Token abc']) {
    const { err, req } = await runAuth(header === undefined ? {} : { authorization: header });
    assert.equal(err.statusCode, 401, String(header));
    assert.equal(req.user, undefined);
  }
});

test('authenticate attaches the principal; the scheme is case-insensitive', async () => {
  const { req, err } = await runAuth({ authorization: 'bearer abc123' });
  assert.equal(err, undefined);
  assert.equal(req.user.userId, 'user-for-abc123');
  assert.equal(req.user.sessionId, 'sess');
});

test('authenticate forwards token and principal errors unchanged', async () => {
  const tokenErr = ApiError.unauthorized('Access token expired', 'TOKEN_EXPIRED');
  const a = await runAuth({ authorization: 'Bearer x' }, { tokens: { verifyAccess: () => { throw tokenErr; } } });
  assert.equal(a.err, tokenErr);
  const suspended = new ApiError(403, 'ACCOUNT_SUSPENDED', 'no');
  const b = await runAuth({ authorization: 'Bearer x' }, { principals: { authenticate: async () => { throw suspended; } } });
  assert.equal(b.err, suspended);
});

// --------------------------------------------------------------- permissions

const call = (mw, user) => new Promise((resolve) => mw({ user }, {}, resolve));
const userWith = (...keys) => ({ permissions: new Set(keys) });

test('requirePermission needs every key; requireAnyPermission needs one', async () => {
  const all = requirePermission('file:read', 'file:upload');
  assert.equal(await call(all, userWith('file:read', 'file:upload', 'x')), undefined);
  assert.equal((await call(all, userWith('file:read'))).statusCode, 403);
  assert.equal((await call(all, userWith())).statusCode, 403);
  assert.equal((await call(all, undefined)).statusCode, 401);

  const any = requireAnyPermission('file:read', 'user:read');
  assert.equal(await call(any, userWith('user:read')), undefined);
  assert.equal((await call(any, userWith('file:upload'))).statusCode, 403);
  assert.equal((await call(any, undefined)).statusCode, 401);
});

test('permission middleware refuses to be built with no or invalid keys', () => {
  for (const fn of [requirePermission, requireAnyPermission]) {
    assert.throws(() => fn(), TypeError);
    assert.throws(() => fn(''), TypeError);
    assert.throws(() => fn('file:read', undefined), TypeError);
    assert.throws(() => fn(['file:read']), TypeError);
  }
});

test('the denial message does not reveal which permission was missing', async () => {
  const err = await call(requirePermission('admin:access'), userWith());
  assert.ok(!err.message.includes('admin'));
  assert.equal(err.details, undefined);
});

// ------------------------------------------------------------ trusted origin

test('trustedOrigin allows no Origin and the configured one, and blocks everything else', async () => {
  const mw = createTrustedOrigin('http://localhost:5173');
  const run = (origin) => new Promise((resolve) => mw({ headers: origin === undefined ? {} : { origin } }, {}, resolve));
  assert.equal(await run(undefined), undefined);
  assert.equal(await run('http://localhost:5173'), undefined);
  for (const bad of ['http://evil.example', 'http://localhost:5174', 'null', 'http://localhost:5173.evil.example', 'https://localhost:5173']) {
    const err = await run(bad);
    assert.equal(err.statusCode, 403, bad);
    assert.equal(err.code, 'ORIGIN_NOT_ALLOWED');
  }
});

// ---------------------------------------------------------------- cookie

test('refresh cookie is httpOnly, SameSite=Strict and scoped to the auth endpoints', () => {
  const calls = [];
  const res = { cookie: (...a) => calls.push(['set', ...a]), clearCookie: (...a) => calls.push(['clear', ...a]) };
  const expires = new Date('2026-07-01T00:00:00Z');
  setRefreshCookie(res, 'tok', expires, { secure: true });
  clearRefreshCookie(res, { secure: false });

  assert.deepEqual(calls[0], ['set', 'cv_rt', 'tok', { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/v1/auth', expires }]);
  assert.deepEqual(calls[1], ['clear', 'cv_rt', { httpOnly: true, secure: false, sameSite: 'strict', path: '/api/v1/auth' }]);
});

test('readRefreshCookie only accepts a sane string', () => {
  assert.equal(readRefreshCookie({ cookies: { cv_rt: 'abc' } }), 'abc');
  for (const bad of [{}, { cookies: {} }, { cookies: { cv_rt: '' } }, { cookies: { cv_rt: ['a'] } }, { cookies: { cv_rt: 'x'.repeat(300) } }, { cookies: { cv_rt: { a: 1 } } }]) {
    assert.equal(readRefreshCookie(bad), null);
  }
});

// ------------------------------------------------------------------ user agent

test('describeUserAgent', () => {
  const cases = [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 'Chrome on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari on macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', 'Safari on iOS'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 OPR/115.0', 'Opera on Windows'],
    ['curl/8.5.0', 'curl on Unknown OS'],
    ['', 'Unknown device'], [undefined, 'Unknown device'], [null, 'Unknown device'], ['totally-custom-agent', 'Unknown device'],
  ];
  for (const [ua, expected] of cases) assert.equal(describeUserAgent(ua), expected, String(ua));
});

// ------------------------------------------------- permission catalogue check

function walk(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: false })
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f));
}

test('every permission key used in routes and access rules exists in the seed catalogue', () => {
  const known = new Set(PERMISSIONS.map((p) => p.key));
  assert.equal(known.size, PERMISSIONS.length, 'duplicate permission keys in the catalogue');

  const used = new Map(); // key -> where
  const srcDir = path.join(here, '..', 'src');
  for (const file of walk(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const call of text.matchAll(/require(?:Any)?Permission\(([^)]*)\)/g)) {
      for (const key of call[1].matchAll(/['"]([^'"]+)['"]/g)) used.set(key[1], path.relative(srcDir, file));
    }
  }
  for (const [action, def] of Object.entries(ACTIONS)) {
    for (const key of Object.values(def.permission)) if (key) used.set(key, `access.logic ACTIONS.${action}`);
  }

  const unknown = [...used].filter(([key]) => !known.has(key));
  assert.deepEqual(unknown, [], 'unknown permission keys (typo?)');

  for (const role of ROLES) {
    const bad = role.permissions.filter((k) => !known.has(k));
    assert.deepEqual(bad, [], `role "${role.name}" references unknown permissions`);
  }
});

test('the default role matrix matches the Phase 1 design', () => {
  const byName = Object.fromEntries(ROLES.map((r) => [r.name, new Set(r.permissions)]));
  assert.equal(byName['Super Admin'].size, PERMISSIONS.length);
  assert.ok(!byName.Admin.has('admin:manage-admins'));
  assert.ok(byName.Admin.has('admin:access'));
  for (const denied of ['file:upload', 'file:update', 'file:delete', 'file:share', 'folder:create', 'version:create']) {
    assert.ok(!byName.Viewer.has(denied), `Viewer must not have ${denied}`);
  }
  for (const needed of ['file:read', 'file:download', 'folder:read']) assert.ok(byName.Viewer.has(needed));
  assert.ok(!byName['Standard User'].has('admin:access'));
  assert.ok(byName.Manager.has('activity:read-team') && !byName['Standard User'].has('activity:read-team'));
  const ranks = ROLES.map((r) => r.rank);
  assert.deepEqual([...ranks].sort((a, b) => b - a), ranks, 'roles should be listed from most to least privileged');
});
