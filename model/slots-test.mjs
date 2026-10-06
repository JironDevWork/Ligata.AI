// Several slots over one unified KV pool: does each site keep its prefix in VRAM, and can a huge
// prompt still use the whole window after the other slots are erased?
//   node model/slots-test.mjs --url http://127.0.0.1:1299
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postStream } from '../gateway/src/stream.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const url = arg('url', 'http://127.0.0.1:1299');
const memory = () => JSON.parse(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'check-memory.ps1'), '-Json'], { encoding: 'utf8' }).trim());
const site = (name, n) => `You are the assistant of ${name}. Answer briefly from the knowledge.\n# Knowledge\n` + Array.from({ length: Math.round(n / 22) }, (_, i) => `${name} item ${i}: costs CHF ${(i * 53) % 977 + 20}, available in ${['red', 'blue', 'green'][i % 3]}.`).join('\n');
const S = { A: site('Alpha Bikes', 20000), B: site('Beta Bakery', 20000), C: site('Gamma Garden', 20000) };
async function ask(slot, system, question, maxTokens = 30) {
  const started = Date.now();
  const response = await postStream(url + '/v1/chat/completions', { messages: [{ role: 'system', content: system }, { role: 'user', content: question }], stream: true, max_tokens: maxTokens, temperature: 0, cache_prompt: true, id_slot: slot, chat_template_kwargs: { enable_thinking: false } });
  if (response.status !== 200) { let t = ''; for await (const c of response.body) t += c; return { status: response.status, error: t.slice(0, 300) }; }
  let text = '', timings = null, error = null;
  for await (const chunk of response.body) for (const line of chunk.toString().split('\n')) if (line.startsWith('data:') && !line.includes('[DONE]')) { const d = JSON.parse(line.slice(5)); if (d.error) error = d.error; text += d.choices?.[0]?.delta?.content || ''; if (d.timings) timings = d.timings; }
  return { ms: Date.now() - started, processed: timings?.prompt_n, cached: timings?.cache_n, text: text.slice(0, 40), error };
}
const log = (label, data) => console.log(JSON.stringify({ label, ...data, ws: memory().workingSetMB }));
log('A visitor 1 (slot 0, cold)', await ask(0, S.A, 'How much does item 12 cost?'));
log('B visitor 2 (slot 1, cold)', await ask(1, S.B, 'How much does item 3 cost?'));
log('C visitor 3 (slot 2, cold)', await ask(2, S.C, 'How much does item 5 cost?'));
log('A visitor 4 (slot 0, warm?)', await ask(0, S.A, 'What colour is item 7?'));
log('B visitor 5 (slot 1, warm?)', await ask(1, S.B, 'What colour is item 9?'));
log('C visitor 6 (slot 2, warm?)', await ask(2, S.C, 'What colour is item 2?'));
const huge = site('Delta Docs', 215000);
log('huge 215k prompt on slot 3 while 3 slots hold 20k each', await ask(3, huge, 'How much does item 4000 cost?'));
for (const s of [0, 1, 2]) await fetch(`${url}/slots/${s}?action=erase`, { method: 'POST' });
log('huge again after erasing slots 0-2', await ask(3, huge, 'How much does item 4001 cost?'));
log('A after erase (cold again)', await ask(0, S.A, 'How much does item 13 cost?'));
