// Prefix priming: process only the shared system prompt, snapshot that exact state, and check that
// new visitors (and returning sites after a restore) reuse it.
//   node model/prime-test.mjs --url http://127.0.0.1:1211
import { postStream } from '../gateway/src/stream.mjs';
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const url = arg('url', 'http://127.0.0.1:1211');
const site = (name, n) => `You are the assistant of ${name}. Answer briefly from the knowledge.\n# Knowledge\n` + Array.from({ length: Math.round(n / 22) }, (_, i) => `${name} item ${i}: costs CHF ${(i * 53) % 977 + 20}, available in ${['red', 'blue', 'green'][i % 3]}.`).join('\n');
const A = site('Alpha Bikes', 20000), B = site('Beta Bakery', 20000);
const post = async (path, body) => (await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

async function prefixText(system) {
  const render = async q => (await post('/apply-template', { messages: [{ role: 'system', content: system }, { role: 'user', content: q }], chat_template_kwargs: { enable_thinking: false } })).prompt;
  const [x, y] = [await render('first'), await render('second')];
  let i = 0; while (i < x.length && x[i] === y[i]) i++;
  const common = x.slice(0, i);
  return common.slice(0, common.lastIndexOf('<start_of_turn>')); // cut at a special-token boundary
}
async function prime(system) {
  const started = Date.now();
  const r = await post('/completion', { prompt: await prefixText(system), n_predict: 0, cache_prompt: true, id_slot: 0 });
  return { ms: Date.now() - started, processed: r.timings?.prompt_n, cached: r.timings?.cache_n, tokens: r.tokens_evaluated };
}
async function ask(system, question) {
  const started = Date.now();
  const response = await postStream(url + '/v1/chat/completions', { messages: [{ role: 'system', content: system }, { role: 'user', content: question }], stream: true, max_tokens: 30, temperature: 0, cache_prompt: true, id_slot: 0, chat_template_kwargs: { enable_thinking: false } });
  let text = '', timings = null;
  for await (const chunk of response.body) for (const line of chunk.toString().split('\n')) if (line.startsWith('data:') && !line.includes('[DONE]')) { const d = JSON.parse(line.slice(5)); text += d.choices?.[0]?.delta?.content || ''; if (d.timings) timings = d.timings; }
  return { ms: Date.now() - started, processed: timings?.prompt_n, cached: timings?.cache_n, text: text.slice(0, 40) };
}
const slot = async (action, filename) => { const t = Date.now(); const r = await post(`/slots/0?action=${action}`, { filename }); return { ms: Date.now() - t, n: r.n_saved ?? r.n_restored, error: r.error?.message }; };
const log = (label, data) => console.log(JSON.stringify({ label, ...data }));
log('prime A', await prime(A));
log('save A prefix', await slot('save', 'prefix-A.bin'));
log('A visitor 1', await ask(A, 'How much does item 12 cost?'));
log('prime B', await prime(B));
log('save B prefix', await slot('save', 'prefix-B.bin'));
log('B visitor 2', await ask(B, 'How much does item 3 cost?'));
log('restore A prefix', await slot('restore', 'prefix-A.bin'));
log('A visitor 3 (after restore)', await ask(A, 'What colour is item 7?'));
log('restore B prefix', await slot('restore', 'prefix-B.bin'));
log('B visitor 4 (after restore)', await ask(B, 'What colour is item 9?'));
