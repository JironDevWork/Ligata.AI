// Long-context benchmark for a running llama-server.
//   node model/bench.mjs --url http://127.0.0.1:1299 --depths 1000,32000,128000,250000 [--label name] [--image file.png]
// For every depth it builds a synthetic document of unique facts with one "needle" fact in the middle,
// asks for the needle, and records prefill/generation speed, cache reuse and the process memory
// (working set, VRAM, GPU-shared RAM) after the request. Results append to model/results.jsonl.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

async function document(targetTokens) {
  seed = 42;
  // ~19 tokens per fact; build, measure, then trim/extend to land close to the target.
  const lines = [];
  let count = 0, i = 0;
  while (count < targetTokens) {
    const batch = Array.from({ length: Math.max(1, Math.ceil((targetTokens - count) / 19)) }, () => fact(++i));
    lines.push(...batch);
    count = await tokens(lines.join('\n'));
  }
  while (count > targetTokens && lines.length > 1) { const drop = Math.max(1, Math.floor((count - targetTokens) / 19)); lines.splice(-drop, drop); count = await tokens(lines.join('\n')); }
  const middle = Math.floor(lines.length / 2);
  lines.splice(middle, 0, 'Record SECRET: The vault access code for the Ligata archive is PELICAN-7342.');
  return lines.join('\n');
}

async function ask(messages, extra = {}) {
  const started = performance.now();
  const response = await fetch(url + '/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: true, max_tokens: 64, temperature: 0, stream_options: { include_usage: true }, chat_template_kwargs: { enable_thinking: false }, ...extra }),
  });
  if (!response.ok) return { error: `${response.status} ${(await response.text()).slice(0, 400)}` };
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
  const follow = first.error ? null : await ask([...messages, { role: 'assistant', content: first.text }, { role: 'user', content: 'Which town appears in Record 1? One word.' }]);
  const after = memory();
  const result = {
    label, depth, at: new Date().toISOString(), ok: !first.error && /PELICAN-7342/.test(first.text), answer: (first.text || first.error).slice(0, 200),
    prompt_n: first.timings?.prompt_n, prefill_tps: first.timings && Math.round(first.timings.prompt_per_second), gen_tps: first.timings && +first.timings.predicted_per_second.toFixed(1),
    draft_n: first.timings?.draft_n, draft_accepted: first.timings?.draft_n_accepted, first_token_ms: first.firstTokenMs,
    followup_cache_n: follow?.timings?.cache_n, followup_prompt_n: follow?.timings?.prompt_n, followup_first_token_ms: follow?.firstTokenMs, followup_gen_tps: follow?.timings && +follow.timings.predicted_per_second.toFixed(1),
    ws_mb: after.workingSetMB, vram_mb: after.processVramMB, shared_mb: after.sharedRamMB, spilling: after.spilling, ws_after_first_mb: afterFirst.workingSetMB,
  };
  console.log(JSON.stringify(result));
  appendFileSync(path.join(here, 'results.jsonl'), JSON.stringify(result) + '\n');
  if (first.error) break;
}
