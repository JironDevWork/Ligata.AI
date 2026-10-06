// RAM soak test through the real gateway: many mixed questions from several visitors and two sites,
// sampling llama-server's memory after every answer. RAM must stay flat after warm-up.
//   node model/soak.mjs --gateway http://127.0.0.1:1210 --keys keyA,keyB --requests 60 --concurrency 4 [--image shot.png]
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const gateway = arg('gateway', 'http://127.0.0.1:1210');
const keys = arg('keys', '').split(',').filter(Boolean);
const total = Number(arg('requests', 60));
const concurrency = Number(arg('concurrency', 4));
const image = arg('image') ? readFileSync(arg('image')).toString('base64') : null;
if (!keys.length) throw new Error('Pass --keys lai_...,lai_...');

const memory = () => JSON.parse(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'check-memory.ps1'), '-Json'], { encoding: 'utf8' }).trim());
const knowledge = Array.from({ length: 1400 }, (_, i) => `Fact ${i}: Product ${i} costs CHF ${100 + (i * 37) % 900} and ships within ${1 + i % 9} days.`).join('\n');
const scenarios = [
  () => ({ messages: [{ role: 'system', content: 'You are a helpful website assistant. Be brief.' }, { role: 'user', content: 'Hi! What can you help me with?' }] }),
  () => ({ messages: [{ role: 'system', content: 'Answer from the catalogue. Be brief.\n' + knowledge }, { role: 'user', content: `How much does product ${Math.floor(Math.random() * 1400)} cost?` }] }),
  () => ({ messages: [{ role: 'system', content: 'Answer from the catalogue. Be brief.\n' + knowledge }, { role: 'user', content: 'Which product ships fastest?' }, { role: 'assistant', content: 'Several products ship within one day.' }, { role: 'user', content: 'Name three of them.' }] }),
  () => image ? ({ messages: [{ role: 'system', content: 'Describe screenshots briefly.' }, { role: 'user', content: [{ type: 'image', data: image }, { type: 'text', text: 'What does this screenshot show?' }] }] }) : null,
  () => ({ messages: [{ role: 'system', content: 'You are a helpful website assistant.' }, { role: 'user', content: [{ type: 'document', name: 'offer.pdf', text: 'Offer 2026\n' + 'Line item: design, development, hosting. '.repeat(400) }, { type: 'text', text: 'Summarise this offer in two sentences.' }] }] }),
];

const stats = { done: 0, failed: 0, busy: 0, codes: {}, samples: [] };
const baseline = memory();
console.log('baseline', baseline);
let next = 0;
async function worker(id) {
  while (next < total) {
    const n = next++;
    const body = scenarios[n % scenarios.length]() || scenarios[0]();
    const started = Date.now();
    const response = await fetch(gateway + '/v1/chat', { method: 'POST', headers: { Authorization: 'Bearer ' + keys[n % keys.length], 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, visitor: `soak-${id}`, maxTokens: 200, temperature: 0.7 }) });
    if (!response.headers.get('content-type')?.includes('event-stream')) {
      const error = (await response.json()).error;
      stats.codes[error.code] = (stats.codes[error.code] || 0) + 1;
      if (['queue_full', 'site_busy', 'visitor_busy'].includes(error.code)) stats.busy++; else stats.failed++;
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    const text = await response.text();
    const done = /event: done\ndata: (.*)/.exec(text);
    const failed = /event: error\ndata: (.*)/.exec(text);
    if (done) {
      stats.done++;
      const data = JSON.parse(done[1]);
      const m = memory();
      const sample = { n, scenario: n % scenarios.length, ms: Date.now() - started, prompt: data.usage.promptTokens, cached: data.usage.cachedTokens, tps: data.timings.tokensPerSecond, ws: m.workingSetMB, vram: m.processVramMB, shared: m.sharedRamMB };
      stats.samples.push(sample);
      console.log(JSON.stringify(sample));
    } else { stats.failed++; const code = failed ? JSON.parse(failed[1]).code : 'no_done'; stats.codes[code] = (stats.codes[code] || 0) + 1; }
  }
}
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
const ws = stats.samples.map(s => s.ws);
const warm = ws.slice(0, 8), late = ws.slice(-8);
const average = list => Math.round(list.reduce((a, b) => a + b, 0) / Math.max(1, list.length));
const summary = {
  at: new Date().toISOString(), requests: total, answered: stats.done, turnedAway: stats.busy, failed: stats.failed, codes: stats.codes,
  ramStartMB: baseline.workingSetMB, ramMinMB: Math.min(...ws), ramMaxMB: Math.max(...ws), ramEarlyAvgMB: average(warm), ramLateAvgMB: average(late),
  vramMB: [...new Set(stats.samples.map(s => s.vram))], sharedMaxMB: Math.max(...stats.samples.map(s => s.shared)),
  flat: average(late) - average(warm) < 150,
};
console.log(JSON.stringify(summary, null, 1));
appendFileSync(path.join(here, 'soak.jsonl'), JSON.stringify(summary) + '\n');
