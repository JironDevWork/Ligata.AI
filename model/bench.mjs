// Long-context benchmark for a running llama-server.
//   node model/bench.mjs --url http://127.0.0.1:1299 --depths 1000,32000,128000,250000 [--label name] [--image file.png]
// For every depth it builds a synthetic document of unique facts with one "needle" fact in the middle,
// asks for the needle, and records prefill/generation speed, cache reuse and the process memory
// (working set, VRAM, GPU-shared RAM) after the request. Results append to model/results.jsonl.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { postStream, readAll } from '../gateway/src/stream.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : pairs), []));
const url = args.url || 'http://127.0.0.1:1299';
const depths = (args.depths || '1000,32000,128000').split(',').map(Number);
const label = args.label || 'unnamed';
const here = path.dirname(fileURLToPath(import.meta.url));

const memory = () => {
  try { return JSON.parse(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'check-memory.ps1'), '-Json'], { encoding: 'utf8' }).trim()); }
  catch (error) { return { running: false, error: String(error.stdout || error.message).trim() }; }
};

// Deterministic pseudo-random facts so runs are comparable.
let seed = 42;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = list => list[Math.floor(random() * list.length)];
const towns = ['Basel', 'Zurich', 'Bern', 'Lugano', 'Chur', 'Thun', 'Aarau', 'Winterthur', 'Sion', 'Olten', 'Baden', 'Zug', 'Luzern', 'Biel', 'Uster'];
const things = ['crates of blue paint', 'bicycles', 'oak tables', 'copper pipes', 'solar panels', 'wool blankets', 'glass jars', 'printer cartridges', 'clay pots', 'garden hoses'];
const people = ['Anna', 'Luca', 'Mia', 'Noah', 'Lea', 'Elias', 'Sofia', 'Leon', 'Emma', 'Jonas', 'Lina', 'David'];
const verbs = ['inspected', 'ordered', 'repaired', 'counted', 'shipped', 'catalogued', 'returned', 'painted'];
const fact = i => `Record ${i}: In ${pick(towns)}, ${pick(people)} ${pick(verbs)} ${Math.floor(random() * 900 + 100)} ${pick(things)} on day ${Math.floor(random() * 365) + 1}.`;

async function json(pathname, body) {
  const response = await fetch(url + pathname, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(`${pathname} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}
const tokens = async text => (await json('/tokenize', { content: text })).tokens.length;

const NL = String.fromCharCode(10);
async function document(targetTokens) {
  seed = 42;
  // Measure tokens per fact once, then size the document and correct it with exact counts.
  const sample = Array.from({ length: 200 }, (_, i) => fact(i + 1));
  const perLine = (await tokens(sample.join(NL))) / sample.length;
  seed = 42;
  const lines = Array.from({ length: Math.max(1, Math.round(targetTokens / perLine)) }, (_, i) => fact(i + 1));
  let count = await tokens(lines.join(NL));
  while (Math.abs(count - targetTokens) > perLine * 4) {
    const delta = Math.round((targetTokens - count) / perLine);
    if (delta > 0) for (let i = 0; i < delta; i++) lines.push(fact(lines.length + 1)); else lines.splice(delta);
    count = await tokens(lines.join(NL));
  }
  // Two linked facts far apart test reasoning across the whole window, not just lookup.
  lines.splice(Math.floor(lines.length * 0.85), 0, "Record OMEGA: Mira Kessler's favourite number is 418.");
  lines.splice(Math.floor(lines.length / 2), 0, 'Record SECRET: The vault access code for the Ligata archive is PELICAN-7342.');
  lines.splice(Math.floor(lines.length * 0.12), 0, 'Record ALPHA: The founder of the Ligata archive is Mira Kessler.');
  return lines.join(NL);
}

async function ask(messages, extra = {}) {
  const started = performance.now();
  // node:http instead of fetch: fetch gives up after 300 s without headers, and a 250k prefill takes longer.
  const response = await postStream(url + '/v1/chat/completions', { messages, stream: true, max_tokens: 64, temperature: 0, stream_options: { include_usage: true }, chat_template_kwargs: { enable_thinking: false }, ...extra });
  if (response.status !== 200) return { error: `${response.status} ${(await readAll(response.body)).slice(0, 400)}` };
  let text = '', firstToken = 0, timings = null, buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
      if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
      const data = JSON.parse(line.slice(5));
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) { if (!firstToken) firstToken = performance.now(); text += delta; }
      if (data.timings) timings = data.timings;
    }
  }
  return { text, timings, firstTokenMs: Math.round(firstToken - started), totalMs: Math.round(performance.now() - started) };
}

const base = memory();
console.log(`[${label}] memory after load`, base);
for (const depth of depths) {
  const doc = await document(depth);
  const question = 'What is the vault access code for the Ligata archive? Reply with the code only.';
  const messages = [
    { role: 'system', content: 'You answer questions about the provided records. Be brief.' },
    { role: 'user', content: `${doc}\n\n${question}` },
  ];
  if (args.image) messages[1] = { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + readFileSync(args.image).toString('base64') } }, { type: 'text', text: `${doc}\n\nFirst describe the image in one sentence. Then: ${question}` }] };
  const first = await ask(messages, args.image ? { max_tokens: 120 } : {});
  const afterFirst = memory();
  // Follow-up turn: must reuse the cached prefix (cache_n close to the previous prompt size).
  const follow = first.error ? null : await ask([...messages, { role: 'assistant', content: first.text }, { role: 'user', content: 'What is the favourite number of the person who founded the Ligata archive? Reply with the number only.' }]);
  // Realistic answer length and sampling, where speculative decoding acceptance matters.
  const long = first.error ? null : await ask([...messages, { role: 'assistant', content: first.text }, { role: 'user', content: 'In about 150 words, explain what kind of archive this is and give three example records in your own words.' }], { max_tokens: 320, temperature: 0.7 });
  const after = memory();
  const result = {
    label, depth, at: new Date().toISOString(), ok: !first.error && /PELICAN-7342/.test(first.text), answer: (first.text || first.error).slice(0, 200),
    prompt_n: first.timings?.prompt_n, prefill_tps: first.timings && Math.round(first.timings.prompt_per_second), gen_tps: first.timings && +first.timings.predicted_per_second.toFixed(1),
    draft_n: first.timings?.draft_n, draft_accepted: first.timings?.draft_n_accepted, first_token_ms: first.firstTokenMs,
    long_gen_tps: long?.timings && +long.timings.predicted_per_second.toFixed(1), long_tokens: long?.timings?.predicted_n, long_draft_acceptance: long?.timings?.draft_n ? +(long.timings.draft_n_accepted / long.timings.draft_n).toFixed(2) : undefined,
    linked_ok: !!follow && /418/.test(follow.text), followup_cache_n: follow?.timings?.cache_n, followup_prompt_n: follow?.timings?.prompt_n, followup_first_token_ms: follow?.firstTokenMs, followup_gen_tps: follow?.timings && +follow.timings.predicted_per_second.toFixed(1),
    ws_mb: after.workingSetMB, vram_mb: after.processVramMB, shared_mb: after.sharedRamMB, spilling: after.spilling, ws_after_first_mb: afterFirst.workingSetMB,
  };
  console.log(JSON.stringify(result));
  appendFileSync(path.join(here, 'results.jsonl'), JSON.stringify(result) + '\n');
  if (first.error) break;
}
