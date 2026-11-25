import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withClusterLock } from '../src/jobs/clusterLock.js';

// Minimal fake of the one ioredis call used: SET key value PX ttl NX
function fakeRedis() {
  const keys = new Map();
  return {
    keys,
    async set(key, value, px, ttl, nx) {
      assert.equal(px, 'PX');
      assert.equal(nx, 'NX');
      assert.ok(ttl > 0);
      if (keys.has(key)) return null;
      keys.set(key, value);
      return 'OK';
    },
  };
}

test('without Redis the job runs unchanged', async () => {
  const fn = async () => 'ran';
  assert.equal(withClusterLock(null, 'j', fn), fn);
});

test('only one instance runs a given tick, even if the job finishes instantly', async () => {
  const redis = fakeRedis();
  const at = () => new Date('2026-11-25T03:00:00.200Z');
  let runs = 0;
  const instanceA = withClusterLock(redis, 'trash-purge', async () => { runs += 1; return 'a'; }, { now: at });
  const instanceB = withClusterLock(redis, 'trash-purge', async () => { runs += 1; return 'b'; }, { now: () => new Date('2026-11-25T03:00:00.900Z') });
  assert.equal(await instanceA(), 'a');
  assert.equal(await instanceB(), null); // same minute: skipped
  assert.equal(runs, 1);
  assert.ok(redis.keys.has('cv:job-tick:trash-purge:2026-11-25T03:00'));
});

test('the next tick and other jobs are claimed independently', async () => {
  const redis = fakeRedis();
  let t = new Date('2026-11-25T03:00:00Z');
  const job = withClusterLock(redis, 'link-cleanup', async () => 'ok', { now: () => t });
  const other = withClusterLock(redis, 'token-prune', async () => 'ok', { now: () => t });
  assert.equal(await job(), 'ok');
  assert.equal(await other(), 'ok');
  t = new Date('2026-11-25T03:30:00Z');
  assert.equal(await job(), 'ok');
});
