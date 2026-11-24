// Tests for the dependency-free pieces of the HTTP layer: errors, envelope, pagination,
// serialisation, crypto helpers and the validate middleware (with a Zod-shaped stub).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import ApiError from '../src/utils/ApiError.js';
import { ok, created, noContent, paginated } from '../src/utils/apiResponse.js';
import { parsePagination, buildMeta, parseSort } from '../src/utils/pagination.js';
import { jsonReplacer } from '../src/utils/serialize.js';
import { sha256Hex, safeEqual, randomToken } from '../src/utils/crypto.js';
import asyncHandler from '../src/utils/asyncHandler.js';
import validate from '../src/middleware/validate.js';
import { errorHandler, normalizeError, notFound } from '../src/middleware/errorHandler.js';
import { StorageError } from '../src/services/storage/StorageProvider.js';

// ---- tiny Express doubles ------------------------------------------------
function fakeRes() {
  const res = { statusCode: 200, headersSent: false, body: undefined, ended: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}
const fakeReq = (over = {}) => ({ method: 'GET', originalUrl: '/api/v1/x?token=secret', ...over });

// ---- ApiError ------------------------------------------------------------
test('ApiError factories carry status, code and operational flag', () => {
  const table = [
    [ApiError.badRequest(), 400, 'BAD_REQUEST'],
    [ApiError.unauthorized(), 401, 'UNAUTHORIZED'],
    [ApiError.forbidden(), 403, 'FORBIDDEN'],
    [ApiError.notFound(), 404, 'NOT_FOUND'],
    [ApiError.conflict(), 409, 'CONFLICT'],
    [ApiError.gone(), 410, 'GONE'],
    [ApiError.payloadTooLarge(), 413, 'PAYLOAD_TOO_LARGE'],
    [ApiError.quotaExceeded(), 413, 'QUOTA_EXCEEDED'],
    [ApiError.validation(), 422, 'VALIDATION_ERROR'],
    [ApiError.tooMany(), 429, 'RATE_LIMITED'],
    [ApiError.internal(), 500, 'INTERNAL_ERROR'],
  ];
  for (const [err, status, code] of table) {
    assert.ok(err instanceof Error);
    assert.equal(err.statusCode, status);
    assert.equal(err.code, code);
    assert.equal(err.isOperational, true);
  }
  assert.equal(ApiError.unauthorized('expired', 'TOKEN_EXPIRED').code, 'TOKEN_EXPIRED');
});

// ---- response envelope ---------------------------------------------------
test('success envelope shapes', () => {
  let res = fakeRes();
  ok(res, { a: 1 }, { message: 'done' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, data: { a: 1 }, message: 'done', meta: undefined });
  res = fakeRes(); created(res, { id: 1 });
  assert.equal(res.statusCode, 201);
  res = fakeRes(); noContent(res);
  assert.equal(res.statusCode, 204); assert.equal(res.ended, true);
  res = fakeRes(); paginated(res, [1, 2], { page: 1, limit: 2, total: 5 });
  assert.deepEqual(res.body.meta, { page: 1, limit: 2, total: 5 });
  assert.equal(res.body.success, true);
});

// ---- pagination ----------------------------------------------------------
test('parsePagination clamps and defaults', () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 25, skip: 0, take: 25 });
  assert.deepEqual(parsePagination({ page: '3', limit: '10' }), { page: 3, limit: 10, skip: 20, take: 10 });
  assert.equal(parsePagination({ limit: '100000' }).limit, 100);
  assert.equal(parsePagination({ limit: '0' }).limit, 1);
  assert.equal(parsePagination({ page: '-4' }).page, 1);
  assert.equal(parsePagination({ page: 'abc', limit: 'x' }).page, 1);
  assert.equal(parsePagination({ limit: '500' }, { maxLimit: 500 }).limit, 500);
});

test('buildMeta', () => {
  assert.deepEqual(buildMeta({ page: 1, limit: 10, total: 0 }), { page: 1, limit: 10, total: 0, totalPages: 1, hasNext: false });
  assert.deepEqual(buildMeta({ page: 2, limit: 10, total: 25 }), { page: 2, limit: 10, total: 25, totalPages: 3, hasNext: true });
  assert.equal(buildMeta({ page: 3, limit: 10, total: 25 }).hasNext, false);
});

test('parseSort only accepts whitelisted fields', () => {
  const allowed = { name: 'name', size: 'size', date: 'createdAt' };
  const fb = { field: 'date', dir: 'desc' };
  assert.deepEqual(parseSort('size:desc', allowed, fb), [{ size: 'desc' }]);
  assert.deepEqual(parseSort('name', allowed, fb), [{ name: 'asc' }]);
  assert.deepEqual(parseSort('date:sideways', allowed, fb), [{ createdAt: 'asc' }]);
  assert.deepEqual(parseSort(undefined, allowed, fb), [{ createdAt: 'desc' }]);
  assert.deepEqual(parseSort('passwordHash:asc', allowed, fb), [{ createdAt: 'desc' }]);
  assert.deepEqual(parseSort('__proto__:asc', allowed, fb), [{ createdAt: 'desc' }]);
  assert.deepEqual(parseSort('constructor:asc', allowed, fb), [{ createdAt: 'desc' }]);
});

// ---- serialisation -------------------------------------------------------
test('BigInt values serialise safely', () => {
  const out = JSON.parse(JSON.stringify({ small: 5368709120n, big: 9007199254740993n, neg: -3n, n: 1 }, jsonReplacer));
  assert.deepEqual(out, { small: 5368709120, big: '9007199254740993', neg: -3, n: 1 });
  assert.throws(() => JSON.stringify({ x: 1n })); // proves the replacer is what makes it work
});

// ---- crypto --------------------------------------------------------------
test('crypto helpers', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  const t = randomToken(); assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(randomToken(), randomToken());
});

// ---- asyncHandler --------------------------------------------------------
test('asyncHandler forwards rejections and sync throws to next()', async () => {
  const boom = new Error('boom');
  let received;
  await asyncHandler(async () => { throw boom; })({}, {}, (e) => { received = e; });
  assert.equal(received, boom);
  received = undefined;
  await asyncHandler(() => { throw boom; })({}, {}, (e) => { received = e; });
  assert.equal(received, boom);
});

// ---- validate middleware -------------------------------------------------
const stubSchema = (fn) => ({
  safeParse: (input) => fn(input),
});
const passing = (transform) => stubSchema((i) => ({ success: true, data: transform(i) }));
const failing = (issues) => stubSchema(() => ({ success: false, error: { issues } }));

test('validate replaces req parts with parsed data', () => {
  const req = { body: { n: '5' }, query: {}, params: { id: 'x' } };
  let nextArg = 'unset';
  validate({ body: passing((b) => ({ n: Number(b.n) })) })(req, {}, (e) => { nextArg = e; });
  assert.equal(nextArg, undefined);
  assert.deepEqual(req.body, { n: 5 });
  assert.deepEqual(req.params, { id: 'x' }); // untouched when no schema given
});

test('validate collects issues from every source into one 422', () => {
  const req = { body: {}, query: {}, params: {} };
  let err;
  validate({
    params: failing([{ path: ['id'], message: 'Invalid uuid' }]),
    body: failing([{ path: ['user', 'email'], message: 'Required' }]),
  })(req, {}, (e) => { err = e; });
  assert.equal(err.statusCode, 422);
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.deepEqual(err.details, [
    { in: 'params', path: 'id', message: 'Invalid uuid' },
    { in: 'body', path: 'user.email', message: 'Required' },
  ]);
});

test('validate tolerates a missing body', () => {
  const req = {};
  let err = 'unset';
  validate({ body: passing((b) => b) })(req, {}, (e) => { err = e; });
  assert.equal(err, undefined);
  assert.deepEqual(req.body, {});
});

// ---- error handling ------------------------------------------------------
test('normalizeError maps known library errors', () => {
  const zod = Object.assign(new Error('z'), { name: 'ZodError', issues: [{ path: ['a', 0], message: 'bad' }] });
  const z = normalizeError(zod);
  assert.equal(z.statusCode, 422);
  assert.deepEqual(z.details, [{ path: 'a.0', message: 'bad' }]);

  const json = Object.assign(new SyntaxError('Unexpected token'), { status: 400, body: '{bad' });
  assert.equal(normalizeError(json).statusCode, 400);
  assert.equal(normalizeError({ type: 'entity.too.large' }).statusCode, 413);

  const multer = (code) => Object.assign(new Error(code), { name: 'MulterError', code });
  assert.equal(normalizeError(multer('LIMIT_FILE_SIZE')).statusCode, 413);
  assert.equal(normalizeError(multer('LIMIT_FILE_COUNT')).statusCode, 400);
  assert.equal(normalizeError(multer('LIMIT_UNEXPECTED_FILE')).statusCode, 400);

  const prisma = (code, meta) => Object.assign(new Error(code), { name: 'PrismaClientKnownRequestError', code, meta });
  const dup = normalizeError(prisma('P2002', { target: ['email'] }));
  assert.equal(dup.statusCode, 409);
  assert.deepEqual(dup.details, { fields: ['email'] });
  assert.equal(normalizeError(prisma('P2025')).statusCode, 404);
  assert.equal(normalizeError(prisma('P2003')).statusCode, 409);
  assert.equal(normalizeError(prisma('P1001')), null); // connection errors are 500s

  assert.equal(normalizeError(new StorageError('NOT_FOUND', 'x')).statusCode, 404);
  assert.equal(normalizeError(new StorageError('INVALID_KEY', 'x')).statusCode, 400);
  assert.equal(normalizeError(new StorageError('IO', 'disk on fire')), null);
  assert.equal(normalizeError(new Error('random')), null);
});

test('errorHandler: operational errors keep their message, with details only when present', () => {
  const res = fakeRes();
  errorHandler(ApiError.forbidden('nope'), fakeReq(), res, () => {});
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { success: false, error: { code: 'FORBIDDEN', message: 'nope' } });

  const res2 = fakeRes();
  errorHandler(ApiError.validation('Validation failed', [{ path: 'x', message: 'y' }]), fakeReq(), res2, () => {});
  assert.deepEqual(res2.body.error.details, [{ path: 'x', message: 'y' }]);
});

test('errorHandler: unexpected errors never leak internals', () => {
  const res = fakeRes();
  const secret = new Error('connect ECONNREFUSED postgres://user:hunter2@db:5432/cv');
  errorHandler(secret, fakeReq(), res, () => {});
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  assert.ok(!JSON.stringify(res.body).includes('hunter2'));

  const storage = new StorageError('IO', '/srv/storage/secret/path failed');
  const res2 = fakeRes();
  errorHandler(storage, fakeReq(), res2, () => {});
  assert.equal(res2.statusCode, 500);
  assert.ok(!JSON.stringify(res2.body).includes('/srv/storage'));
});

test('errorHandler: if headers were already sent it just ends the response', () => {
  const res = fakeRes(); res.headersSent = true;
  errorHandler(new Error('late'), fakeReq(), res, () => {});
  assert.equal(res.ended, true);
  assert.equal(res.body, undefined);
});

test('notFound produces a 404 that names the route without the query string', () => {
  let err;
  notFound(fakeReq({ originalUrl: '/api/v1/nope?token=secret' }), {}, (e) => { err = e; });
  assert.equal(err.statusCode, 404);
  assert.match(err.message, /GET \/api\/v1\/nope$/);
  assert.ok(!err.message.includes('secret'));
});
