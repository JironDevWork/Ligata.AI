// Can a site's prompt cache be parked on disk while another site is answered, and restored later?
//   node model/slot-test.mjs --url http://127.0.0.1:1211 [--knowledge 20000]
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postStream } from '../gateway/src/stream.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const url = arg('url', 'http://127.0.0.1:1211');
const size = Number(arg('knowledge', 20000));
const memory = () => JSON.parse(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'check-memory.ps1'), '-Json'], { encoding: 'utf8' }).trim());
const site = (name, n) => `You are the assistant of ${name}. Answer briefly from the knowledge.\n# Knowledge\n` + Array.from({ length: Math.round(n / 22) }, (_, i) => `${name} item ${i}: costs CHF ${(i * 53) % 977 + 20}, available in ${['red', 'blue', 'green'][i % 3]}.`).join('\n');
const A = site('Alpha Bikes', size), B = site('Beta Bakery', size);

async function ask(system, question) {
  const started = Date.now();
  const response = await postStream(url + '/v1/chat/completions', { messages: [{ role: 'system', content: system }, { role: 'user', content: question }], stream: true, max_tokens: 30, temperature: 0, cache_prompt: true, id_slot: 0, chat_template_kwargs: { enable_thinking: false } });
  let buffer = '', timings = null;
  for await (const chunk of response.body) {
    buffer += chunk.toString();
    for (const line of buffer.split('\n')) if (line.startsWith('data:') && line.includes('timings')) timings = JSON.parse(line.slice(5)).timings;
    buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
  }
  return { ms: Date.now() - started, processed: timings?.prompt_n, cached: timings?.cache_n };
}
async function slot(action, filename) {
  const started = Date.now();
  const response = await fetch(`${url}/slots/0?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) });
  return { status: response.status, ms: Date.now() - started, body: (await response.text()).slice(0, 200) };
}
const log = (label, data) => console.log(JSON.stringify({ label, ...data, ws: memory().workingSetMB }));

log('A cold', await ask(A, 'How much does item 12 cost?'));
log('save A', await slot('save', 'siteA.bin'));
try { log('file', { mb: Math.round(statSync(path.join(here, '..', 'runtime', 'slots', 'siteA.bin')).size / 1048576) }); } catch { }
log('B cold', await ask(B, 'How much does item 3 cost?'));
log('restore A', await slot('restore', 'siteA.bin'));
log('A new visitor after restore', await ask(A, 'What colour is item 7?'));
log('B after A', await ask(B, 'What colour is item 9?'));
