import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlotManager } from '../src/slots.mjs';

test('each website keeps its own slot while slots are free', async () => {
  const slots = new SlotManager({ count: 3, contextTokens: 100000, maxIdleTokens: 50000 });
  const erased = [];
  const erase = async id => erased.push(id);
  const a = await slots.assign('site-a', 20000, erase); slots.record(a, 20000); slots.release(a);
  const b = await slots.assign('site-b', 20000, erase); slots.record(b, 20000); slots.release(b);
  assert.notEqual(a, b);
  assert.equal(await slots.assign('site-a', 21000, erase), a, 'site A returns to its warm slot');
  assert.deepEqual(erased, []);
});

test('the least recently used site gives way when all slots are taken', async () => {
  const slots = new SlotManager({ count: 2, contextTokens: 100000, maxIdleTokens: 50000 });
  const erase = async () => {};
  const a = await slots.assign('a', 1000, erase); slots.record(a, 1000); slots.release(a);
  const b = await slots.assign('b', 1000, erase); slots.record(b, 1000); slots.release(b);
  slots.release(await slots.assign('a', 1000, erase)); // a used again, b is now the oldest
  assert.equal(await slots.assign('c', 1000, erase), b);
});

test('idle caches are erased (oldest first) when a big prompt needs the shared pool', async () => {
  const slots = new SlotManager({ count: 3, contextTokens: 100000, maxIdleTokens: 90000, reserve: 0 });
  const erased = [];
  const erase = async id => erased.push(id);
  const a = await slots.assign('a', 30000, erase); slots.record(a, 30000); slots.release(a);
  const b = await slots.assign('b', 30000, erase); slots.record(b, 30000); slots.release(b);
  const c = await slots.assign('c', 50000, erase); // 30k + 30k idle + 50k needed > 100k
  assert.deepEqual(erased, [a], 'only as much as needed, oldest first');
  slots.record(c, 50000); slots.release(c);
  assert.equal(slots.slots[a].tokens, 0);
  assert.equal(await slots.assign('b', 31000, erase), b, 'b is still warm');
});

test('idle caches above the cap are erased even when there is room', async () => {
  const slots = new SlotManager({ count: 3, contextTokens: 262144, maxIdleTokens: 40000, reserve: 0 });
  const erased = [];
  const erase = async id => erased.push(id);
  const a = await slots.assign('a', 30000, erase); slots.record(a, 30000); slots.release(a);
  const b = await slots.assign('b', 30000, erase); slots.record(b, 30000); slots.release(b);
  await slots.assign('c', 1000, erase);
  assert.deepEqual(erased, [a]);
});

test('a single-slot server never erases anything', async () => {
  const slots = new SlotManager({ count: 1, contextTokens: 1000 });
  let called = false;
  assert.equal(await slots.assign('a', 999999, async () => { called = true; }), 0);
  assert.equal(called, false);
});

test('a slot in use is never given to another answer; a conversation returns to its own slot', async () => {
  const slots = new SlotManager({ count: 3, contextTokens: 100000 });
  const erase = async () => {};
  const a = await slots.assign('site', 1000, erase, 'visitor-a');
  const b = await slots.assign('site', 1000, erase, 'visitor-b');
  assert.notEqual(a, b, 'two visitors of one site at once: two slots');
  slots.record(a, 1500); slots.release(a); slots.record(b, 1500); slots.release(b);
  assert.equal(await slots.assign('site', 2000, erase, 'visitor-b'), b, 'visitor b continues in the slot with its conversation');
  assert.equal(await slots.assign('site', 2000, erase, 'visitor-c'), a, 'a new visitor takes a slot warm with the site');
  await assert.rejects(async () => { await slots.assign('site', 10, erase, 'visitor-d'); await slots.assign('site', 10, erase, 'visitor-e'); }, /No free slot/);
});

test('split slots (no shared pool) never erase anything', async () => {
  const slots = new SlotManager({ count: 3, contextTokens: 87381, maxIdleTokens: 1000, shared: false });
  const erased = [];
  const erase = async id => erased.push(id);
  for (const site of ['a', 'b', 'c', 'd']) { const id = await slots.assign(site, 80000, erase); slots.record(id, 80000); slots.release(id); }
  assert.deepEqual(erased, []);
});
