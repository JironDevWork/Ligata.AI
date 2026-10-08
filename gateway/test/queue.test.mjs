import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/queue.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));
const scheduler = (options = {}) => new Scheduler({ maxLength: 10, maxPerKey: 5, maxWaitSeconds: 5, ...options });

test('runs jobs one at a time in FIFO order', async () => {
  const s = scheduler();
  const order = []; let active = 0, maxActive = 0;
  const job = (name) => s.enqueue({ keyId: 'k', visitor: name, run: async () => { active++; maxActive = Math.max(maxActive, active); await wait(10); order.push(name); active--; return name; } });
  assert.deepEqual(await Promise.all([job('a'), job('b'), job('c')]), ['a', 'b', 'c']);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(maxActive, 1);
});

test('reports positions and estimates', async () => {
  const s = scheduler();
  const updates = [];
  const slow = s.enqueue({ keyId: 'k', visitor: '1', run: () => wait(30) });
  const watched = s.enqueue({ keyId: 'k', visitor: '2', run: () => wait(1), onUpdate: u => updates.push(u) });
  await Promise.all([slow, watched]);
  assert.equal(updates[0].position, 1);
  assert.ok(updates[0].estimate >= 0);
  assert.equal(updates.at(-1).position, 0);
});

test('cancelling a waiting job removes it; cancelling the active job aborts its signal', async () => {
  const s = scheduler();
  const leaveWaiting = new AbortController(), leaveActive = new AbortController();
  let sawAbort = false;
  const active = s.enqueue({ keyId: 'k', visitor: 'a', signal: leaveActive.signal, run: signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => { sawAbort = true; reject(signal.reason); })) });
  const waiting = s.enqueue({ keyId: 'k', visitor: 'b', signal: leaveWaiting.signal, run: () => 'never' });
  leaveWaiting.abort();
  await assert.rejects(waiting, { code: 'cancelled' });
  assert.equal(s.waiting.length, 0);
  leaveActive.abort();
  await assert.rejects(active, { code: 'cancelled' });
  assert.ok(sawAbort);
  assert.equal(await s.enqueue({ keyId: 'k', visitor: 'c', run: () => 'next' }), 'next');
});

test('limits: per visitor, per key and global', async () => {
  const s = scheduler({ maxLength: 3, maxPerKey: 2 });
  const block = { keyId: 'k', run: () => wait(30) };
  const a = s.enqueue({ ...block, visitor: 'v1' });
  assert.throws(() => s.enqueue({ ...block, visitor: 'v1' }), { code: 'visitor_busy' });
  const b = s.enqueue({ ...block, visitor: 'v2' });
  assert.throws(() => s.enqueue({ ...block, visitor: 'v3' }), { code: 'site_busy' });
  const c = s.enqueue({ ...block, keyId: 'other', visitor: 'v1' });
  assert.throws(() => s.enqueue({ ...block, keyId: 'third', visitor: 'v9' }), { code: 'queue_full' });
  await Promise.all([a, b, c]);
  assert.equal(s.completed, 3);
});

test('jobs that wait too long time out with a busy error', async () => {
  const s = scheduler({ maxWaitSeconds: 0.05 });
  const long = s.enqueue({ keyId: 'k', visitor: '1', run: () => wait(150) });
  await assert.rejects(s.enqueue({ keyId: 'k', visitor: '2', run: () => 'late' }), { code: 'queue_timeout' });
  await long;
});

test('a failing job does not stop the queue', async () => {
  const s = scheduler();
  const failing = s.enqueue({ keyId: 'k', visitor: '1', run: async () => { throw new Error('gpu'); } });
  const next = s.enqueue({ keyId: 'k', visitor: '2', run: async () => 'ok' });
  await assert.rejects(failing, /gpu/);
  assert.equal(await next, 'ok');
});

test('runs up to the configured number of jobs at once, in arrival order', async () => {
  const s = scheduler({ parallel: 2 });
  const started = []; let active = 0, maxActive = 0;
  const job = name => s.enqueue({ keyId: 'k', visitor: name, run: async () => { started.push(name); active++; maxActive = Math.max(maxActive, active); await wait(20); active--; } });
  await Promise.all(['a', 'b', 'c', 'd'].map(job));
  assert.equal(maxActive, 2);
  assert.deepEqual(started, ['a', 'b', 'c', 'd']);
});

test('a job waits while the running ones leave too little room in the pool, and later ones do not pass it', async () => {
  const s = scheduler({ parallel: 3, capacity: 100 });
  const started = [];
  const job = (name, tokens, ms) => s.enqueue({ keyId: 'k', visitor: name, tokens, run: async () => { started.push(name); await wait(ms); } });
  const runs = [job('big1', 60, 40), job('big2', 60, 10), job('small', 10, 10)];
  await wait(5);
  assert.deepEqual(started, ['big1'], 'big2 does not fit next to big1, and small waits behind it');
  assert.equal(s.snapshot().active, 1);
  await Promise.all(runs);
  assert.deepEqual(started, ['big1', 'big2', 'small']);
});

test('wait estimates count rounds of parallel answers', async () => {
  const s = scheduler({ parallel: 2 });
  s.durations = [10000];
  assert.equal(s.estimate(1), 0, 'idle: no wait');
  const block = [s.enqueue({ keyId: 'k', visitor: '1', run: () => wait(30) }), s.enqueue({ keyId: 'k', visitor: '2', run: () => wait(30) })];
  assert.ok(s.estimate(1) <= 10 && s.estimate(2) <= 10 && s.estimate(3) >= 13, 'positions 1-2 start after the first round, 3 after the second');
  await Promise.all(block);
});
