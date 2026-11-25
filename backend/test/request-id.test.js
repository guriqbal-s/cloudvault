// Request ids: generated or reused by requestLogger, echoed in 5xx error bodies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import requestLogger from '../src/middleware/requestLogger.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import ApiError from '../src/utils/ApiError.js';
import { logContext } from '../src/utils/logger.js';

function fakeReq(headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method: 'GET', originalUrl: '/api/v1/files?q=secret', get: (h) => lower[h.toLowerCase()] };
}
function fakeRes() {
  const res = new EventEmitter();
  Object.assign(res, { statusCode: 200, headersSent: false, headers: {} });
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

test('requestLogger generates an id, sets X-Request-Id and exposes it to the log context', () => {
  const req = fakeReq();
  const res = fakeRes();
  let seen;
  requestLogger(req, res, () => { seen = logContext.getStore(); });
  assert.match(req.id, /^[0-9a-f-]{36}$/);
  assert.equal(res.headers['x-request-id'], req.id);
  assert.deepEqual(seen, { requestId: req.id });
});

test('requestLogger reuses a sane incoming X-Request-Id and rejects a malformed one', () => {
  const good = fakeReq({ 'X-Request-Id': 'abc123def456' });
  requestLogger(good, fakeRes(), () => {});
  assert.equal(good.id, 'abc123def456');

  const bad = fakeReq({ 'X-Request-Id': 'x\nInjected: header' });
  requestLogger(bad, fakeRes(), () => {});
  assert.notEqual(bad.id, 'x\nInjected: header');
  assert.match(bad.id, /^[0-9a-f-]{36}$/);
});

test('errorHandler includes the request id only on 5xx responses', () => {
  const req = { ...fakeReq(), id: 'req-12345678' };
  const res500 = fakeRes();
  errorHandler(new Error('db exploded'), req, res500, () => {});
  assert.equal(res500.statusCode, 500);
  assert.equal(res500.body.error.requestId, 'req-12345678');
  assert.doesNotMatch(JSON.stringify(res500.body), /db exploded/);

  const res404 = fakeRes();
  errorHandler(ApiError.notFound(), req, res404, () => {});
  assert.equal(res404.body.error.requestId, undefined);
});
