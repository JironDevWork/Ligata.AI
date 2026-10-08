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
  gateway = startGateway({ port: 0, adminPort: 0, upstream: mock.url, dataDir, memoryProbeSeconds: 0, queue: { maxLength: 4, maxPerKey: 3, maxWaitSeconds: 5 }, generation: { maxSeconds: 3 }, tools: { maxRounds: 4, waitSeconds: 1 }, parallel: { conversations: 3, conversationTokens: 131072, sharedPool: true } });
  await new Promise(r => gateway.server.listening ? r() : gateway.server.once('listening', r));
  base = `http://127.0.0.1:${gateway.server.address().port}`;
  const a = gateway.keys.create('Site A'); keyA = a.key; idA = a.record.id;
  keyB = gateway.keys.create('Site B').key;
});
after(async () => { await gateway.stop(); await mock.close(); rmSync(dataDir, { recursive: true, force: true }); });
beforeEach(() => { Object.assign(mock.state, { mode: 'ok', delayMs: 20, maxActive: 0, active: 0, aborted: 0, contextTokens: 8192, vision: true, slots: 1, erased: [], slotLog: [] }); gateway.llm.cachedProps = null; });

const call = (route, key, body, method = body ? 'POST' : 'GET') => fetch(base + route, { method, headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

/**
 * Posts a chat and collects SSE events. `stopAfter(event)` returning true aborts the request (visitor leaves).
 * `onEvent(event)` runs for every event, e.g. to answer a round of lookups like the website does.
 */
async function chat(key, body, { stopAfter, onEvent } = {}) {
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
        await onEvent?.(event);
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

test('thinking that uses up the token limit ends with thinking_limit, not an empty answer', async () => {
  const result = await chat(keyA, { messages: [{ role: 'user', content: 'think-forever' }], thinking: true, maxTokens: 64 });
  assert.deepEqual(result.events.map(e => e.name), ['started', 'thinking', 'error']);
  assert.equal(result.events.at(-1).data.code, 'thinking_limit');
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

test('several conversations run at once when llama-server has several slots, each in its own slot', async () => {
  mock.state.slots = 3; mock.state.delayMs = 60;
  const results = await Promise.all([chat(keyA, { visitor: 'p1' }), chat(keyA, { visitor: 'p2' }), chat(keyB, { visitor: 'p3' })]);
  assert.ok(results.every(r => r.text === 'Hello from the mock.'));
  assert.equal(mock.state.maxActive, 3, 'three answers at the same time');
  assert.deepEqual([...mock.state.slotLog].sort(), [0, 1, 2], 'each in its own slot');
  assert.ok(results.every(r => !r.events.some(e => e.name === 'queued')), 'nobody waited');
});

test('more conversations than slots wait in line, and a returning visitor gets their own slot back', async () => {
  mock.state.slots = 2; mock.state.delayMs = 50;
  const runs = [chat(keyA, { visitor: 'r1' }), chat(keyB, { visitor: 'r2' }), chat(keyA, { visitor: 'r3' })];
  const results = await Promise.all(runs);
  assert.equal(mock.state.maxActive, 2, 'never more answers than slots');
  assert.ok(results[2].events.some(e => e.name === 'queued' && e.data.position === 1), 'the third waits');
  const first = mock.state.slotLog[0];
  mock.state.slotLog = [];
  await chat(keyB, { visitor: 'r2' }); await chat(keyA, { visitor: 'r1' });
  assert.equal(mock.state.slotLog[1], first, 'r1 returns to the slot that holds its conversation');
});

test('in a shared pool one conversation may use its share, and the status says so', async () => {
  mock.state.slots = 3; mock.state.contextTokens = 262144;
  const status = await (await call('/v1/status', keyA)).json();
  assert.equal(status.model.contextTokens, 131072);
  assert.equal(status.queue.parallel, 3);
  const started = (await chat(keyA, { visitor: 'share' })).events.find(e => e.name === 'started');
  assert.equal(started.data.contextTokens, 131072);
});

test('split slots: each conversation may use its whole slot, and nothing is erased to make room', async () => {
  gateway.config.parallel.sharedPool = false;
  try {
    // A pool this small would make a shared pool erase idle caches for every new conversation.
    mock.state.slots = 3; mock.state.contextTokens = 3000;
    const status = await (await call('/v1/status', keyA)).json();
    assert.equal(status.model.contextTokens, 3000, 'the slot is the limit');
    const long = 'z'.repeat(4000);
    for (const round of [0, 1]) await Promise.all([keyA, keyB, keyA].map((key, i) => chat(key, { visitor: 'split' + round + i, messages: [{ role: 'system', content: long + round }, { role: 'user', content: 'q' }], maxTokens: 64 })));
    assert.deepEqual(mock.state.erased, [], 'split slots never erase another conversation');
    assert.equal(mock.state.maxActive, 3);
  } finally { gateway.config.parallel.sharedPool = true; }
});

// ---------- lookups (tools) ----------
const tools = [{ name: 'search_website', description: 'Search this website.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }];
/** Answers every round of lookups like the website: one result per call. */
const answer = (key = keyA, results = c => `Result for ${c.arguments.query}`) => async event => {
  if (event.name !== 'tool_calls') return;
  const posted = await call('/v1/chat/tool-results', key, { round: event.data.round, results: event.data.calls.map(c => ({ id: c.id, content: results(c) })) });
  assert.equal(posted.status, 200);
};

test('the status announces lookups', async () => {
  assert.deepEqual((await (await call('/v1/status', keyA)).json()).features, ['tools']);
});

test('a lookup: the calls go to the website, the results back to the model, in the same answer', async () => {
  mock.state.slots = 3;
  const result = await chat(keyA, { visitor: 'look1', tools, messages: [{ role: 'system', content: 'Site map' }, { role: 'user', content: 'What is your phone number?' }] }, { onEvent: answer() });
  const names = result.events.map(e => e.name);
  assert.deepEqual([names[0], names[1], names.at(-1)], ['started', 'tool_calls', 'done'], names.join());
  const round = result.events[1].data;
  assert.equal(round.calls.length, 1);
  assert.equal(round.calls[0].name, 'search_website');
  assert.deepEqual(round.calls[0].arguments, { query: 'phone' }, 'arguments arrive parsed, from pieces');
  assert.equal(result.text, 'Found: Result for phone');
  assert.equal(names.filter(n => n === 'started').length, 1, 'one answer for the visitor');
  const sent = mock.state.lastBody;
  assert.equal(sent.tools[0].function.name, 'search_website');
  assert.equal(sent.tool_choice, 'auto');
  assert.deepEqual(sent.messages.slice(-2).map(m => m.role), ['assistant', 'tool']);
  assert.equal(sent.messages.at(-2).tool_calls[0].function.arguments, '{"query":"phone"}');
  assert.equal(sent.messages.at(-1).tool_call_id, round.calls[0].id);
  assert.equal(new Set(mock.state.slotLog.slice(-2)).size, 1, 'both rounds run in the same slot');
  assert.equal(result.events.at(-1).data.usage.completionTokens, 12 + 2, 'both rounds count');
  assert.equal(gateway.scheduler.length, 0);
});

test('several lookups at once get one result each', async () => {
  const result = await chat(keyA, { visitor: 'look2', tools, messages: [{ role: 'user', content: 'look up two things' }] }, { onEvent: answer() });
  const round = result.events.find(e => e.name === 'tool_calls').data;
  assert.deepEqual(round.calls.map(c => c.arguments.query), ['two things', 'opening hours']);
  assert.equal(result.text, 'Found: Result for two things | Result for opening hours');
});

test('lookup results: only the asking website, only known calls, within limits', async () => {
  let checked = false;
  const result = await chat(keyA, { visitor: 'look3', tools, messages: [{ role: 'user', content: 'look up prices' }] }, { onEvent: async event => {
    if (event.name !== 'tool_calls') return;
    const round = event.data.round, id = event.data.calls[0].id;
    assert.equal((await call('/v1/chat/tool-results', keyB, { round, results: [{ id, content: 'evil' }] })).status, 404, 'another site cannot answer');
    assert.equal((await call('/v1/chat/tool-results', keyA, { round: 'nope', results: [] })).status, 404);
    assert.equal((await call('/v1/chat/tool-results', keyA, { round, results: [{ id: 'bad id!', content: 'x' }] })).status, 400);
    assert.equal((await call('/v1/chat/tool-results', keyA, { round, results: [{ id, content: 'x'.repeat(130000) }] })).status, 413);
    await answer()(event);
    checked = true;
  } });
  assert.ok(checked);
  assert.equal(result.text, 'Found: Result for prices');
});

test('a website that does not answer a lookup ends the answer; a visitor leaving during a lookup frees the place', async () => {
  const silent = await chat(keyA, { visitor: 'look4', tools, messages: [{ role: 'user', content: 'look up anything' }] });
  assert.equal(silent.events.at(-1).name, 'error');
  assert.equal(silent.events.at(-1).data.code, 'tool_timeout');
  const left = await chat(keyA, { visitor: 'look5', tools, messages: [{ role: 'user', content: 'look up anything' }] }, { stopAfter: e => e.name === 'tool_calls' });
  assert.ok(left.aborted);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(gateway.scheduler.length, 0);
  assert.equal((await chat(keyA, { visitor: 'look6' })).text, 'Hello from the mock.');
});

test('a model that keeps looking things up must answer with what it found', async () => {
  mock.state.choices = [];
  const result = await chat(keyA, { visitor: 'look7', tools, messages: [{ role: 'user', content: 'look up forever' }] }, { onEvent: answer() });
  assert.equal(result.events.filter(e => e.name === 'tool_calls').length, 4, 'maxRounds 4: four rounds of lookups');
  assert.deepEqual(mock.state.choices, ['auto', 'auto', 'auto', 'auto', 'none'], 'then a round without lookups');
  assert.deepEqual(mock.state.lastBody.logit_bias, [[48, false], [49, false]], 'in which the model cannot even write a tool call as text');
  assert.equal(result.events.at(-1).name, 'done');
  assert.ok(result.text.startsWith('Found: '), result.text);
  const fewer = await chat(keyA, { visitor: 'look7b', tools, lookupRounds: 2, messages: [{ role: 'user', content: 'look up forever' }] }, { onEvent: answer() });
  assert.equal(fewer.events.filter(e => e.name === 'tool_calls').length, 2, 'the website may ask for fewer rounds');
  assert.equal(fewer.events.at(-1).name, 'done');
});

test('toolChoice none keeps the tools declared but never calls them (summaries)', async () => {
  const result = await chat(keyA, { visitor: 'look8', tools, toolChoice: 'none', messages: [{ role: 'user', content: 'look up phone' }] });
  assert.ok(!result.events.some(e => e.name === 'tool_calls'));
  assert.equal(mock.state.lastBody.tool_choice, 'none');
  assert.equal(mock.state.lastBody.tools.length, 1);
});

test('toolChoice required makes the first round look something up; later rounds may answer', async () => {
  mock.state.choices = [];
  const result = await chat(keyA, { visitor: 'look11', tools, toolChoice: 'required', messages: [{ role: 'user', content: 'look up prices' }] }, { onEvent: answer() });
  assert.equal(result.text, 'Found: Result for prices');
  assert.deepEqual(mock.state.choices, ['required', 'auto'], 'the round after the lookup may answer');
});

test('earlier lookups in the history are passed on; broken histories and tools are refused', async () => {
  const history = [
    { role: 'user', content: 'Phone?' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'lookup_0_0', name: 'search_website', arguments: { query: 'phone' } }] },
    { role: 'tool', toolCallId: 'lookup_0_0', content: 'Phone +41 44 000 00 00' },
    { role: 'assistant', content: 'Call +41 44 000 00 00.' },
    { role: 'user', content: 'Thanks' },
  ];
  const result = await chat(keyA, { visitor: 'look9', tools, messages: history });
  assert.equal(result.events.at(-1).name, 'done');
  const sent = mock.state.lastBody.messages;
  assert.equal(sent[1].tool_calls[0].function.arguments, '{"query":"phone"}');
  assert.deepEqual(sent[2], { role: 'tool', tool_call_id: 'lookup_0_0', content: 'Phone +41 44 000 00 00' });
  const refused = async (messages, extra = {}) => (await chat(keyA, { visitor: 'look10', messages, ...extra })).status;
  assert.equal(await refused([{ role: 'tool', toolCallId: 'x', content: 'y' }, { role: 'user', content: 'q' }]), 400, 'a result without a call');
  assert.equal(await refused([history[0], history[1], { role: 'user', content: 'q' }]), 400, 'a call without its result');
  assert.equal(await refused([history[0], { ...history[1], toolCalls: [{ id: 'a', name: 'x y', arguments: {} }] }, { role: 'tool', toolCallId: 'a', content: '' }, { role: 'user', content: 'q' }]), 400, 'tool names are checked');
  assert.equal(await refused([{ role: 'user', content: 'q' }], { tools: [{ name: 'x', description: 'd', parameters: { type: 'string' } }] }), 400, 'tool parameters are an object');
  assert.equal(await refused([{ role: 'user', content: 'q' }], { tools: Array.from({ length: 9 }, () => tools[0]) }), 400, 'at most 8 tools');
});
