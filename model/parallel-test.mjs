// Several conversations at the same time on one llama-server (slots over one unified KV pool).
//   node model/parallel-test.mjs --url http://127.0.0.1:1211 --run speed,prefix,long [--depths 2x120000,3x85000]
//
// speed   1, 2 and 3 conversations writing ~400 tokens at once: tok/s per conversation and in total
// prefix  does a second slot reuse a knowledge prefix another slot already processed?
// long    N conversations at a given depth at once (needle in the middle), with memory sampled every 5 s
// mixed   a short question while another conversation's long prompt (40k, like a big PDF) is read
// overflow two conversations that together need more than the pool: what llama-server does
// --depths auto: every slot at once, each almost full (from /props and /slots)
// Results append to model/parallel.jsonl.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postStream, readAll } from '../gateway/src/stream.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const url = arg('url', 'http://127.0.0.1:1211');
const run = arg('run', 'speed,prefix').split(',');
const label = arg('label', 'production');
let depths = arg('depths', '2x120000,3x85000');

const memory = () => {
  try { return JSON.parse(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'check-memory.ps1'), '-Json'], { encoding: 'utf8' }).trim()); }
  catch { return { running: false }; }
};
const record = row => { const line = { at: new Date().toISOString(), label, ...row }; console.log(JSON.stringify(line)); appendFileSync(path.join(here, 'parallel.jsonl'), JSON.stringify(line) + '\n'); };

// Deterministic facts; every conversation gets its own seed so prompts differ.
function facts(seedStart, count) {
  let seed = seedStart;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = list => list[Math.floor(random() * list.length)];
  const towns = ['Basel', 'Zurich', 'Bern', 'Lugano', 'Chur', 'Thun', 'Aarau', 'Winterthur', 'Sion', 'Olten'];
  const things = ['bicycles', 'oak tables', 'copper pipes', 'solar panels', 'wool blankets', 'glass jars', 'clay pots'];
  const people = ['Anna', 'Luca', 'Mia', 'Noah', 'Lea', 'Elias', 'Sofia', 'Leon', 'Emma', 'Jonas'];
  return Array.from({ length: count }, (_, i) => `Record ${i + 1}: In ${pick(towns)}, ${pick(people)} shipped ${Math.floor(random() * 900 + 100)} ${pick(things)} on day ${Math.floor(random() * 365) + 1}.`);
}
const tokens = async text => (await (await fetch(url + '/tokenize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) })).json()).tokens.length;
async function document(seed, target, code) {
  const perLine = (await tokens(facts(seed, 200).join('\n'))) / 200;
  const lines = facts(seed, Math.round(target / perLine));
  lines.splice(Math.floor(lines.length / 2), 0, `Record SECRET: The vault code of archive ${seed} is ${code}.`);
  return lines.join('\n');
}

async function ask(slot, messages, maxTokens, extra = {}) {
  const started = performance.now();
  const response = await postStream(url + '/v1/chat/completions', { messages, stream: true, max_tokens: maxTokens, temperature: 0.7, cache_prompt: true, id_slot: slot, stream_options: { include_usage: true }, chat_template_kwargs: { enable_thinking: false }, ...extra });
  if (response.status !== 200) return { slot, error: `${response.status} ${(await readAll(response.body)).slice(0, 300)}`, totalMs: Math.round(performance.now() - started) };
  let text = '', firstToken = 0, timings = null, error = null, buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
      if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
      const data = JSON.parse(line.slice(5));
      if (data.error) error = data.error;
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) { firstToken ||= performance.now(); text += delta; }
      if (data.timings) timings = data.timings;
    }
  }
  return {
    slot, text, error, firstTokenMs: firstToken ? Math.round(firstToken - started) : null, totalMs: Math.round(performance.now() - started),
    prompt: timings?.prompt_n, cached: timings?.cache_n, predicted: timings?.predicted_n,
    promptPerSecond: Math.round(timings?.prompt_per_second || 0), tokensPerSecond: Math.round((timings?.predicted_per_second || 0) * 10) / 10,
    draftAccepted: timings?.draft_n ? Math.round(100 * timings.draft_n_accepted / timings.draft_n) : null,
  };
}
// Every slot at once, each filled up to its own limit minus room for the question and answer.
if (depths === 'auto') {
  const slots = await (await fetch(url + '/slots')).json();
  depths = `${slots.length}x${Math.min(...slots.map(s => s.n_ctx)) - 6000}`;
  console.log('auto depths: ' + depths + ' (slot n_ctx ' + slots.map(s => s.n_ctx).join('/') + ')');
}
depths = depths.split(',').map(d => d.split('x').map(Number));
const erase = slots => Promise.all(slots.map(s => fetch(`${url}/slots/${s}?action=erase`, { method: 'POST' })));

// Samples memory while a batch runs; returns the peaks.
async function watched(work) {
  const peak = { workingSetMB: 0, processVramMB: 0, sharedRamMB: 0, gpuUsedMB: 0 };
  let done = false;
  const sampler = (async () => { while (!done) { const m = memory(); for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], m[k] || 0); await new Promise(r => setTimeout(r, 5000)); } })();
  const started = performance.now();
  const result = await work();
  done = true; await sampler;
  return { result, wallMs: Math.round(performance.now() - started), peak, after: memory() };
}

const topics = ['a lighthouse keeper', 'a bakery in Bern', 'a lost bicycle', 'a mountain hut', 'a rainy market day', 'an old tram'];
if (run.includes('speed')) {
  await erase([0, 1, 2]);
  const count = (await (await fetch(url + '/slots')).json()).length;
  const series = Array.from({ length: count }, (_, i) => i + 1);
  for (const n of [...series, ...series]) {
    const { result, wallMs, peak } = await watched(() => Promise.all(Array.from({ length: n }, (_, i) => ask(i, [
      { role: 'system', content: `You are a helpful assistant of shop ${i}. Write fluent English prose.` },
      { role: 'user', content: `Write a story of about 350 words about ${topics[(i + n) % topics.length]}. No title.` },
    ], 420))));
    const total = result.reduce((s, r) => s + (r.predicted || 0), 0);
    record({ test: 'speed', parallel: n, perConversation: result.map(r => r.tokensPerSecond), draftAccepted: result.map(r => r.draftAccepted), firstTokenMs: result.map(r => r.firstTokenMs), tokens: total, wallMs, totalPerSecond: Math.round(total / wallMs * 1000 * 10) / 10, peakVramMB: peak.processVramMB, errors: result.filter(r => r.error).map(r => r.error) });
  }
}

if (run.includes('prefix')) {
  await erase([0, 1, 2]);
  const knowledge = 'You are the assistant of Alpha Bikes. Answer briefly from the knowledge.\n# Knowledge\n' + (await document(7, 12000, 'ORCA-1'));
  const a = await ask(0, [{ role: 'system', content: knowledge }, { role: 'user', content: 'What is the vault code?' }], 20, { temperature: 0 });
  const b = await ask(1, [{ role: 'system', content: knowledge }, { role: 'user', content: 'Who shipped in record 5?' }], 20, { temperature: 0 });
  const c = await ask(0, [{ role: 'system', content: knowledge }, { role: 'user', content: 'Who shipped in record 9?' }], 20, { temperature: 0 });
  record({ test: 'prefix', note: 'same 12k knowledge: slot 0 cold, then slot 1, then slot 0 again', slot0Cold: { prompt: a.prompt, cached: a.cached, firstTokenMs: a.firstTokenMs }, slot1: { prompt: b.prompt, cached: b.cached, firstTokenMs: b.firstTokenMs }, slot0Warm: { prompt: c.prompt, cached: c.cached, firstTokenMs: c.firstTokenMs } });
}

for (const [n, depth] of run.includes('long') ? depths : []) {
  await erase([0, 1, 2]);
  const codes = ['PELICAN-7342', 'HERON-1185', 'FALCON-9027'];
  const docs = await Promise.all(Array.from({ length: n }, (_, i) => document(100 + i, depth, codes[i])));
  const { result, wallMs, peak, after } = await watched(() => Promise.all(docs.map((doc, i) => ask(i, [
    { role: 'system', content: 'Answer from the archive. Then write three sentences about the archive.' },
    { role: 'user', content: `${doc}\n\nWhat is the vault code of archive ${100 + i}? Give the code first.` },
  ], 160, { temperature: 0 }))));
  record({ test: 'long', parallel: n, depth, found: result.map((r, i) => r.text?.includes(codes[i]) ?? false), prompt: result.map(r => r.prompt), promptPerSecond: result.map(r => r.promptPerSecond), firstTokenMs: result.map(r => r.firstTokenMs), tokensPerSecond: result.map(r => r.tokensPerSecond), wallMs, peak, after: { ws: after.workingSetMB, vram: after.processVramMB, shared: after.sharedRamMB }, errors: result.filter(r => r.error).map(r => r.error) });
  // Writing speed with every conversation at this depth (prompts now cached).
  const { result: again } = await watched(() => Promise.all(docs.map((doc, i) => ask(i, [
    { role: 'system', content: 'Answer from the archive. Then write three sentences about the archive.' },
    { role: 'user', content: `${doc}\n\nWhat is the vault code of archive ${100 + i}? Give the code first.` },
  ], 300, { temperature: 0.7 }))));
  record({ test: 'long-writing', parallel: n, depth, cached: again.map(r => r.cached), tokensPerSecond: again.map(r => r.tokensPerSecond), firstTokenMs: again.map(r => r.firstTokenMs), errors: again.filter(r => r.error).map(r => r.error) });
}

if (run.includes('mixed')) {
  await erase([0, 1, 2]);
  const big = await document(300, 40000, 'LONG-1');
  const reading = ask(0, [{ role: 'user', content: big + '\n\nWhat is the vault code?' }], 40, { temperature: 0 });
  await new Promise(r => setTimeout(r, 4000));
  const short = await ask(1, [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: 'Write about 150 words about a bakery in Bern.' }], 220);
  const long = await reading;
  const alone = await ask(1, [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: 'Write about 150 words about a bakery in Basel.' }], 220);
  record({ test: 'mixed', note: 'short answer started 4 s into reading a 40k prompt', short: { firstTokenMs: short.firstTokenMs, tokensPerSecond: short.tokensPerSecond, totalMs: short.totalMs }, shortAlone: { firstTokenMs: alone.firstTokenMs, tokensPerSecond: alone.tokensPerSecond, totalMs: alone.totalMs }, long: { prompt: long.prompt, promptPerSecond: long.promptPerSecond, firstTokenMs: long.firstTokenMs, found: long.text?.includes('LONG-1') } });
}

if (run.includes('overflow')) {
  // Two conversations that together need more than the 262k pool.
  await erase([0, 1, 2]);
  const [a, b] = await Promise.all([document(200, 140000, 'A-1'), document(201, 140000, 'B-2')]);
  const { result, wallMs, peak } = await watched(() => Promise.all([a, b].map((doc, i) => ask(i, [{ role: 'user', content: doc + '\n\nWhat is the vault code?' }], 40, { temperature: 0 }))));
  record({ test: 'overflow', note: '2 x 140k at once in a 262k pool', results: result.map(r => ({ slot: r.slot, error: r.error, prompt: r.prompt, text: r.text?.slice(0, 40), totalMs: r.totalMs })), wallMs, peak, health: (await fetch(url + '/health').then(r => r.status).catch(() => 'down')) });
}
await erase([0, 1, 2]);
