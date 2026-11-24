import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanName, nextAvailableName, splitName, withExtension, fixFilenameEncoding, escapeLike } from '../src/utils/names.js';
import { createAccessTokenService } from '../src/services/accessToken.js';
import { createAuthenticateOrSigned } from '../src/middleware/signedAccess.js';

const code = (c) => (e) => e.code === c || e.statusCode === c;

test('cleanName trims, normalises and rejects path-like or reserved names', () => {
  assert.equal(cleanName('  report.pdf  '), 'report.pdf');
  assert.equal(cleanName('é.txt'), 'é.txt'); // NFC
  for (const bad of ['', '   ', '.', '..', 'a/b', 'a\\b', 'a\u0000b', 'a\nb', 'x'.repeat(256), null, undefined]) {
    assert.throws(() => cleanName(bad), code(422), JSON.stringify(bad));
  }
  assert.equal(cleanName('x'.repeat(255)).length, 255);
});

test('splitName and nextAvailableName', () => {
  assert.deepEqual(splitName('a.b.pdf'), { base: 'a.b', ext: '.pdf' });
  assert.deepEqual(splitName('.env'), { base: '.env', ext: '' });
  assert.deepEqual(splitName('trailing.'), { base: 'trailing.', ext: '' });
  assert.equal(nextAvailableName('a.pdf', []), 'a.pdf');
  assert.equal(nextAvailableName('a.pdf', ['A.PDF']), 'a (1).pdf');
  assert.equal(nextAvailableName('a.pdf', ['a.pdf', 'a (1).pdf', 'a (2).pdf']), 'a (3).pdf');
  assert.equal(nextAvailableName('Docs', new Set(['docs'])), 'Docs (1)');
  const long = `${'x'.repeat(251)}.pdf`; // 255 chars: the suffix must not push it over the limit
  assert.ok(nextAvailableName(long, [long]).length <= 255);
});

test('withExtension keeps the original extension', () => {
  assert.equal(withExtension('notes', 'pdf'), 'notes.pdf');
  assert.equal(withExtension('notes.PDF', 'pdf'), 'notes.PDF');
  assert.equal(withExtension('v2.final', 'pdf'), 'v2.final.pdf');
  assert.equal(withExtension('x', ''), 'x');
});

test('fixFilenameEncoding repairs latin1-decoded UTF-8 only', () => {
  const mangled = Buffer.from('Résumé.pdf', 'utf8').toString('latin1');
  assert.equal(fixFilenameEncoding(mangled), 'Résumé.pdf');
  assert.equal(fixFilenameEncoding('Résumé.pdf'), 'Résumé.pdf'); // already right: latin1 re-decode is invalid UTF-8
  assert.equal(fixFilenameEncoding('日本語.txt'), '日本語.txt'); // beyond latin1: untouched
  assert.equal(fixFilenameEncoding('plain.txt'), 'plain.txt');
  assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
});

// ------------------------------------------------------------------ access tokens
const T0 = new Date('2026-06-01T00:00:00Z');
const clock = (d) => { let t = d; return { now: () => t, set: (x) => { t = x; } }; };

test('signed tokens round-trip and expire after 60 seconds', () => {
  const c = clock(T0);
  const svc = createAccessTokenService({ secret: 'a-long-enough-secret', now: c.now });
  const { token, expiresAt } = svc.sign({ userId: 'u1', fileId: 'f1', purpose: 'preview' });
  assert.equal(expiresAt.getTime(), T0.getTime() + 60_000);
  assert.deepEqual(svc.verify(token), { userId: 'u1', fileId: 'f1', purpose: 'preview', version: undefined });
  c.set(new Date(T0.getTime() + 59_000));
  assert.doesNotThrow(() => svc.verify(token));
  c.set(new Date(T0.getTime() + 60_000));
  assert.throws(() => svc.verify(token), code('INVALID_ACCESS_URL'));
});

test('signed tokens reject tampering, other secrets, alg=none and junk', () => {
  const a = createAccessTokenService({ secret: 'secret-number-one!!', now: () => T0 });
  const b = createAccessTokenService({ secret: 'secret-number-two!!', now: () => T0 });
  const { token } = a.sign({ userId: 'u1', fileId: 'f1', purpose: 'download' });
  const [h, p, s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), fid: 'other' })).toString('base64url');
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
  for (const bad of [`${h}.${forged}.${s}`, none, `${h}.${p}.${s.slice(0, -2)}AA`, token.slice(0, -1), 'a.b', '', null, undefined, 42, `${token}.x`, 'x'.repeat(3000)]) {
    assert.throws(() => a.verify(bad), code('INVALID_ACCESS_URL'), String(bad).slice(0, 30));
  }
  assert.throws(() => b.verify(token), code('INVALID_ACCESS_URL'));
  assert.throws(() => a.sign({ userId: 'u', fileId: 'f', purpose: 'delete' }), TypeError);
  assert.throws(() => createAccessTokenService({ secret: 'short' }), TypeError);
});

test('a login access JWT can never be used as a file token (separate derived key)', async () => {
  const crypto = await import('node:crypto');
  const secret = 'a-long-enough-secret';
  const svc = createAccessTokenService({ secret, now: () => T0 });
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: 'u', fid: 'f', purpose: 'download', aud: 'cv-file', exp: 4102444800 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url'); // signed with the raw secret
  assert.throws(() => svc.verify(`${header}.${body}.${sig}`), code('INVALID_ACCESS_URL'));
});

// ------------------------------------------------------------------ middleware
function mw({ status = 'ACTIVE' } = {}) {
  const calls = [];
  const svc = createAccessTokenService({ secret: 'a-long-enough-secret', now: () => T0 });
  const auth = createAuthenticateOrSigned({
    authenticate: (req, _res, next) => { calls.push('bearer'); req.user = { via: 'bearer' }; next(); },
    accessTokens: svc,
    principals: { loadUser: async (id) => ({ user: { id, status }, permissions: new Set(), roles: [], rank: 0 }) },
  });
  const run = async (purpose, req) => { let err; await auth(purpose)(req, {}, (e) => { err = e; }); return err; };
  return { svc, run, calls };
}

test('authenticateOrSigned falls back to Bearer auth without ?st', async () => {
  const { run, calls } = mw();
  const req = { query: {}, params: { id: 'f1' } };
  assert.equal(await run('download', req), undefined);
  assert.deepEqual(calls, ['bearer']);
});

test('authenticateOrSigned accepts a token for the same file and purpose only', async () => {
  const { svc, run } = mw();
  const { token } = svc.sign({ userId: 'u1', fileId: 'f1', purpose: 'preview' });
  const ok = { query: { st: token }, params: { id: 'f1' } };
  assert.equal(await run('preview', ok), undefined);
  assert.equal(ok.user.user.id, 'u1');
  assert.equal(ok.user.sessionId, null);
  assert.equal((await run('download', { query: { st: token }, params: { id: 'f1' } })).code, 'INVALID_ACCESS_URL'); // wrong purpose
  assert.equal((await run('preview', { query: { st: token }, params: { id: 'f2' } })).code, 'INVALID_ACCESS_URL'); // other file
  assert.equal((await run('preview', { query: { st: 'junk' }, params: { id: 'f1' } })).code, 'INVALID_ACCESS_URL');
  assert.equal((await run('preview', { query: { st: ['a', 'b'] }, params: { id: 'f1' } })).code, 'INVALID_ACCESS_URL'); // ?st=a&st=b
});

test('authenticateOrSigned refuses suspended users even with a valid token', async () => {
  const { svc, run } = mw({ status: 'SUSPENDED' });
  const { token } = svc.sign({ userId: 'u1', fileId: 'f1', purpose: 'download' });
  assert.equal((await run('download', { query: { st: token }, params: { id: 'f1' } })).code, 'ACCOUNT_SUSPENDED');
});
