import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startMockLlm, makePdf } from './mock-llm.mjs';
import { startGateway } from '../src/main.mjs';

let mock, gateway, base, dataDir, keyA, keyB, idA;
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

before(async () => {
  mock = await startMockLlm();
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligata-ai-test-'));
  gateway = startGateway({ port: 0, adminPort: 0, upstream: mock.url, dataDir, memoryProbeSeconds: 0, queue: { maxLength: 4, maxPerKey: 3, maxWaitSeconds: 5 }, generation: { maxSeconds: 3 } });
  await new Promise(r => gateway.server.listening ? r() : gateway.server.once('listening', r));
  base = `http://127.0.0.1:${gateway.server.address().port}`;
  const a = gateway.keys.create('Site A'); keyA = a.key; idA = a.record.id;
  keyB = gateway.keys.create('Site B').key;
});
after(async () => { await gateway.stop(); await mock.close(); rmSync(dataDir, { recursive: true, force: true }); });
beforeEach(() => { Object.assign(mock.state, { mode: 'ok', delayMs: 20, maxActive: 0, active: 0, aborted: 0, contextTokens: 8192, vision: true, slots: 1, erased: [] }); gateway.llm.cachedProps = null; });

const call = (route, key, body, method = body ? 'POST' : 'GET') => fetch(base + route, { method, headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

/** Posts a chat and collects SSE events. `stopAfter(event)` returning true aborts the request (visitor leaves). */
async function chat(key, body, { stopAfter } = {}) {
  const controller = new AbortController();
  const response = await fetch(base + '/v1/chat', { method: 'POST', signal: controller.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }], ...body }) });
  if (!response.headers.get('content-type')?.includes('event-stream')) return { status: response.status, error: (await response.json()).error, headers: response.headers };
  const events = [];
  const decoder = new TextDecoder();
  let buffer = '', aborted = false;
  try {
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const name = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (!name) continue;
        const event = { name, data: JSON.parse(data) };
        events.push(event);
        if (stopAfter?.(event)) { aborted = true; controller.abort(); return { status: 200, events, aborted }; }
      }
    }
  } catch (error) { if (!controller.signal.aborted) throw error; }
  return { status: 200, events, aborted, text: events.filter(e => e.name === 'delta').map(e => e.data.text).join('') };
}

test('keys are stored as hashes only and verified in constant time', () => {
  const stored = readFileSync(path.join(dataDir, 'keys.json'), 'utf8');
  assert.ok(!stored.includes(keyA.split('_')[2]), 'secret must not be stored');
  assert.ok(gateway.keys.verify('Bearer ' + keyA));
  assert.equal(gateway.keys.verify('Bearer ' + keyA.slice(0, -1) + (keyA.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(gateway.keys.verify('Bearer lai_000000000000_' + 'x'.repeat(43)), null);
  assert.equal(gateway.keys.verify('nonsense'), null);
});

test('crawlers are kept out: robots.txt disallows everything and every answer says noindex', async () => {
  const robots = await call('/robots.txt');
  assert.equal(robots.status, 200);
  assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
  for (const answer of [robots, await call('/v1/health'), await call('/v1/status'), await call('/nothing-here')])
    assert.equal(answer.headers.get('x-robots-tag'), 'noindex, nofollow', answer.url);
});

test('health is public, everything else requires a valid key', async () => {
  assert.equal((await call('/v1/health')).status, 200);
  assert.equal((await call('/v1/status')).status, 401);
  assert.equal((await call('/v1/status', 'lai_000000000000_' + 'x'.repeat(43))).status, 401);
  const status = await (await call('/v1/status', keyA)).json();
  assert.equal(status.model.state, 'ready');
  assert.equal(status.model.contextTokens, 8192);
  assert.equal((await call('/v1/nope', keyA)).status, 404);
});

test('revoked keys stop working immediately', async () => {
  const temporary = gateway.keys.create('Temporary');
  assert.equal((await call('/v1/status', temporary.key)).status, 200);
  gateway.keys.revoke(temporary.record.id);
  assert.equal((await call('/v1/status', temporary.key)).status, 401);
});

test('a chat streams started, deltas and done with usage and context', async () => {
  const result = await chat(keyA, { visitor: 'v1' });
  assert.equal(result.text, 'Hello from the mock.');
  const names = result.events.map(e => e.name);
  assert.deepEqual([names[0], names.at(-1)], ['started', 'done']);
  const done = result.events.at(-1).data;
  assert.equal(done.usage.completionTokens, 5);
  assert.equal(done.context.limit, 8192);
  assert.ok(done.context.used > 0);
  assert.equal(mock.state.lastBody.chat_template_kwargs.enable_thinking, false);
});

test('answers run strictly one at a time across sites, in arrival order, with queue positions', async () => {
  mock.state.delayMs = 40;
  const runs = [chat(keyA, { visitor: 'q1' }), chat(keyB, { visitor: 'q2' }), chat(keyA, { visitor: 'q3' })];
  const results = await Promise.all(runs);
  assert.equal(mock.state.maxActive, 1, 'never more than one generation on the GPU');
  assert.ok(results.every(r => r.text === 'Hello from the mock.'));
  const queued = results[2].events.filter(e => e.name === 'queued');
  assert.ok(queued.length && queued[0].data.position === 2, 'third request waits behind two');
  assert.ok(queued.some(e => e.data.position === 1), 'position updates as the queue moves');
});

test('one question per visitor: a second parallel request from the same visitor is refused', async () => {
  mock.state.delayMs = 60;
  const first = chat(keyA, { visitor: 'same' });
  await new Promise(r => setTimeout(r, 30));
  const second = await chat(keyA, { visitor: 'same' });
  assert.equal(second.status, 429);
  assert.equal(second.error.code, 'visitor_busy');
  assert.equal((await first).text, 'Hello from the mock.');
  // Another site with the same visitor hash is a different visitor.
  assert.equal((await chat(keyB, { visitor: 'same' })).text, 'Hello from the mock.');
});

test('queue caps: per site and global, with Retry-After', async () => {
  mock.state.delayMs = 80;
  const pending = [1, 2, 3].map(i => chat(keyA, { visitor: 'cap' + i }));
  await new Promise(r => setTimeout(r, 40));
  const siteFull = await chat(keyA, { visitor: 'cap4' });
  assert.equal(siteFull.status, 503);
  assert.equal(siteFull.error.code, 'site_busy');
  assert.ok(Number(siteFull.headers.get('retry-after')) > 0);
  const other = chat(keyB, { visitor: 'b1' });
  await new Promise(r => setTimeout(r, 20));
  const globalFull = await chat(keyB, { visitor: 'b2' });
  assert.equal(globalFull.error.code, 'queue_full');
  await Promise.all([...pending, other]);
});

test('model offline or loading answers 503 with a clear code and is never queued', async () => {
  mock.state.mode = 'down';
  let result = await chat(keyA, { visitor: 'down' });
  assert.equal(result.status, 503);
  assert.equal(result.error.code, 'model_unavailable');
  mock.state.mode = 'loading';
  result = await chat(keyA, { visitor: 'loading' });
  assert.equal(result.error.code, 'model_loading');
  assert.equal(gateway.scheduler.length, 0);
  const health = await (await call('/v1/health')).json();
  assert.equal(health.model, 'loading');
});

test('a stream that breaks mid-answer ends with an error event and the queue keeps going', async () => {
  mock.state.mode = 'drop';
  const broken = chat(keyA, { visitor: 'drop1' });
  const next = chat(keyB, { visitor: 'drop2' });
  const result = await broken;
  assert.equal(result.events.at(-1).name, 'error');
  assert.equal(result.events.at(-1).data.code, 'model_failed');
  mock.state.mode = 'ok';
  const following = await next;
  assert.ok(['done', 'error'].includes(following.events.at(-1).name));
  assert.equal((await chat(keyB, { visitor: 'drop3' })).text, 'Hello from the mock.');
});

test('a visitor leaving while queued is removed; leaving while answering aborts the GPU work', async () => {
  mock.state.delayMs = 80;
  const running = chat(keyA, { visitor: 'leave1' }, { stopAfter: e => e.name === 'delta' });
  const waiting = chat(keyB, { visitor: 'leave2' }, { stopAfter: e => e.name === 'queued' });
  const third = chat(keyB, { visitor: 'leave3' });
  const waited = await waiting;
  assert.ok(waited.aborted, JSON.stringify(waited));
  assert.ok((await running).aborted);
  const result = await third;
  assert.equal(result.text, 'Hello from the mock.');
  await new Promise(r => setTimeout(r, 100));
  assert.ok(mock.state.aborted >= 1, 'upstream generation was cancelled');
  assert.equal(gateway.scheduler.length, 0);
});

test('answers that run too long are stopped', async () => {
  mock.state.delayMs = 1000; // 5 tokens > 3 s limit
  const result = await chat(keyA, { visitor: 'slow' });
  assert.equal(result.events.at(-1).name, 'error');
  assert.equal(result.events.at(-1).data.code, 'answer_timeout');
});

test('context is checked before queueing', async () => {
  mock.state.contextTokens = 300;
  const result = await chat(keyA, { visitor: 'ctx', messages: [{ role: 'user', content: 'x'.repeat(4000) }] });
  assert.equal(result.status, 413);
  assert.equal(result.error.code, 'context_full');
  assert.ok(result.error.promptTokens > 300);
});

test('message and attachment validation', async () => {
  const bad = async (messages, code, status) => {
    const result = await chat(keyA, { visitor: 'val', messages });
    assert.equal(result.status, status, JSON.stringify(result.error));
    assert.equal(result.error.code, code);
  };
  await bad([], 'invalid_messages', 400);
  await bad([{ role: 'tool', content: 'x' }], 'invalid_messages', 400);
  await bad([{ role: 'user', content: 'a' }, { role: 'system', content: 'b' }], 'invalid_messages', 400);
  await bad([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], 'invalid_messages', 400);
  await bad([{ role: 'user', content: [{ type: 'image', data: Buffer.from('GIF89a...').toString('base64') }] }], 'unsupported_image', 415);
  await bad([{ role: 'user', content: [{ type: 'image', data: Buffer.alloc(6 * 1024 * 1024, 0xff).toString('base64') }] }], 'image_too_large', 413);
  await bad([{ role: 'user', content: Array.from({ length: 9 }, () => ({ type: 'image', data: png.toString('base64') })) }], 'too_many_images', 413);
  mock.state.vision = false; gateway.llm.cachedProps = null;
  await bad([{ role: 'user', content: [{ type: 'image', data: png.toString('base64') }] }], 'vision_unavailable', 422);
  gateway.llm.cachedProps = null;
});

test('images and documents reach the model in llama-server format', async () => {
  const result = await chat(keyA, { visitor: 'img', messages: [{ role: 'user', content: [{ type: 'image', data: png.toString('base64') }, { type: 'document', name: 'offer.pdf', text: 'Price: 42' }, { type: 'text', text: 'What is the price?' }] }] });
  assert.equal(result.text, 'Hello from the mock.');
  const parts = mock.state.lastBody.messages[0].content;
  assert.match(parts[0].image_url.url, /^data:image\/png;base64,/);
  assert.match(parts[1].text, /<attached_document name="offer.pdf">\nPrice: 42/);
});

test('PDF text extraction, without storing anything', async () => {
  const response = await call('/v1/extract', keyA, { data: makePdf(['Ligata opening hours', 'Monday to Friday 8-17']).toString('base64') });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(body.text, /Ligata opening hours/);
  assert.match(body.text, /Monday to Friday/);
  assert.equal(body.pages, 1);
  assert.ok(body.tokens > 0);
  const notPdf = await call('/v1/extract', keyA, { data: Buffer.from('hello').toString('base64') });
  assert.equal(notPdf.status, 422);
  assert.equal((await notPdf.json()).error.code, 'invalid_pdf');
  const empty = await call('/v1/extract', keyA, { data: makePdf([]).toString('base64') });
  assert.equal((await empty.json()).error.code, 'pdf_no_text');
});

test('token counting for knowledge budgets', async () => {
  const response = await call('/v1/tokenize', keyA, { texts: ['abcd', 'abcdefgh', ''] });
  assert.deepEqual((await response.json()).counts, [1, 2, 0]);
  assert.equal((await call('/v1/tokenize', keyA, { texts: 'nope' })).status, 400);
});

test('oversized bodies and malformed JSON are rejected', async () => {
  const huge = await fetch(base + '/v1/tokenize', { method: 'POST', headers: { Authorization: 'Bearer ' + keyA, 'Content-Type': 'application/json' }, body: '{"texts":["' + 'x'.repeat(41 * 1024 * 1024) + '"]}' }).catch(error => ({ status: 413, error }));
  assert.equal(huge.status, 413);
  const broken = await fetch(base + '/v1/tokenize', { method: 'POST', headers: { Authorization: 'Bearer ' + keyA }, body: '{nope' });
  assert.equal(broken.status, 400);
});

test('daily quota per key', async () => {
  gateway.keys.setLimits(idA, { requestsPerDay: 0 });
  gateway.keys.reload();
  const result = await chat(keyA, { visitor: 'quota' });
  assert.equal(result.status, 429);
  assert.equal(result.error.code, 'daily_quota');
  gateway.keys.setLimits(idA, { requestsPerDay: 2000 });
  gateway.keys.reload();
});

test('websites are pinned to prompt-cache slots and idle caches are freed for big prompts', async () => {
  mock.state.slots = 3; mock.state.contextTokens = 9000; gateway.llm.cachedProps = null;
  const long = 'x'.repeat(6000); // ~1500 tokens per site in the mock tokenizer (4 characters per token)
  await chat(keyA, { visitor: 's1', messages: [{ role: 'system', content: long }, { role: 'user', content: 'a' }], maxTokens: 64 });
  const slotA = mock.state.lastBody.id_slot;
  await chat(keyB, { visitor: 's2', messages: [{ role: 'system', content: long }, { role: 'user', content: 'b' }], maxTokens: 64 });
  const slotB = mock.state.lastBody.id_slot;
  assert.notEqual(slotA, slotB, 'two sites, two slots');
  await chat(keyA, { visitor: 's3', messages: [{ role: 'system', content: long }, { role: 'user', content: 'c' }], maxTokens: 64 });
  assert.equal(mock.state.lastBody.id_slot, slotA, 'site A returns to its warm slot');
  assert.deepEqual(mock.state.erased, [], 'nothing erased while the pool has room');
  const third = gateway.keys.create('Site C').key;
  await chat(third, { visitor: 's4', messages: [{ role: 'system', content: 'y'.repeat(16000) }, { role: 'user', content: 'd' }], maxTokens: 64 });
  assert.deepEqual(mock.state.erased, [slotB], 'the least recently used idle site is erased to make room');
});
