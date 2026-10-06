// How much prompt work is reused between requests, the way websites actually use the model:
// a follow-up in the same chat, a different visitor on the same site, and switching between sites.
//   node model/cache-test.mjs --url http://127.0.0.1:1299 [--knowledge 20000]
import { postStream } from '../gateway/src/stream.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const url = arg('url', 'http://127.0.0.1:1299');
const size = Number(arg('knowledge', 20000));
const site = (name, n) => `You are the assistant of ${name}. Answer briefly from the knowledge.\n# Knowledge\n` + Array.from({ length: Math.round(n / 22) }, (_, i) => `${name} item ${i}: costs CHF ${(i * 53) % 977 + 20}, available in ${['red', 'blue', 'green'][i % 3]}.`).join('\n');
const siteA = site('Alpha Bikes', size), siteB = site('Beta Bakery', size);

async function ask(system, turns) {
  const started = Date.now();
  const response = await postStream(url + '/v1/chat/completions', { messages: [{ role: 'system', content: system }, ...turns], stream: true, max_tokens: 40, temperature: 0, cache_prompt: true, chat_template_kwargs: { enable_thinking: false } });
  let text = '', timings = null, buffer = '';
  for await (const chunk of response.body) {
    buffer += chunk.toString();
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      const data = JSON.parse(line.slice(5));
      text += data.choices?.[0]?.delta?.content || '';
      if (data.timings) timings = data.timings;
    }
  }
  return { text, ms: Date.now() - started, processed: timings?.prompt_n, cached: timings?.cache_n };
}

const steps = [];
const run = async (label, system, turns) => { const r = await ask(system, turns); steps.push({ label, ...r, text: r.text.slice(0, 60) }); console.log(JSON.stringify(steps.at(-1))); return r; };
const q1 = { role: 'user', content: 'How much does item 12 cost?' };
const a1 = await run('site A, visitor 1, first question (cold)', siteA, [q1]);
await run('site A, visitor 1, follow-up', siteA, [q1, { role: 'assistant', content: a1.text }, { role: 'user', content: 'And item 40?' }]);
await run('site A, visitor 2, new chat (same knowledge)', siteA, [{ role: 'user', content: 'What colour is item 7?' }]);
await run('site B, visitor 3 (site switch)', siteB, [{ role: 'user', content: 'How much does item 3 cost?' }]);
await run('site A, visitor 4 (switch back)', siteA, [{ role: 'user', content: 'How much does item 99 cost?' }]);
console.log(JSON.stringify({ knowledgeTokens: size, steps }));
