// Task accuracy on a website-style knowledge base: lookups, comparisons and small sums, answered at
// temperature 0. Compares profiles (e.g. q8 vs q4 KV cache) on what visitors actually ask.
//   node model/accuracy.mjs --url http://127.0.0.1:1299 --label q4kv [--facts 400]
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postStream } from '../gateway/src/stream.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const url = arg('url', 'http://127.0.0.1:1299');
const label = arg('label', 'unnamed');
const count = Number(arg('facts', 400));

let seed = 7;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const colours = ['red', 'blue', 'green', 'black', 'white', 'yellow'];
const items = Array.from({ length: count }, (_, i) => ({ name: `Model ${String.fromCharCode(65 + (i % 26))}${100 + i}`, price: 20 + Math.floor(random() * 980), colour: colours[Math.floor(random() * colours.length)], days: 1 + Math.floor(random() * 14) }));
const knowledge = items.map(it => `- ${it.name}: price CHF ${it.price}, colour ${it.colour}, delivery in ${it.days} days.`).join('\n');
const system = `You are the shop assistant of Velo Test AG. Use only the catalogue below. Answer with the requested value only, no explanation.\n# Catalogue\n${knowledge}`;

const pick = () => items[Math.floor(random() * items.length)];
const questions = [];
for (let i = 0; i < 30; i++) { const it = pick(); questions.push({ kind: 'lookup', q: `What is the price of ${it.name} in CHF? Number only.`, ok: a => a.includes(String(it.price)) }); }
for (let i = 0; i < 10; i++) { const it = pick(); questions.push({ kind: 'lookup', q: `What colour is ${it.name}? One word.`, ok: a => a.toLowerCase().includes(it.colour) }); }
for (let i = 0; i < 15; i++) { const a = pick(), b = pick(); if (a.price === b.price) continue; const cheaper = a.price < b.price ? a : b; questions.push({ kind: 'compare', q: `Which is cheaper, ${a.name} or ${b.name}? Answer with the model name only.`, ok: x => x.includes(cheaper.name) && !x.includes((cheaper === a ? b : a).name) }); }
for (let i = 0; i < 15; i++) { const a = pick(), b = pick(); const total = 2 * a.price + b.price; questions.push({ kind: 'sum', q: `What do two ${a.name} and one ${b.name} cost together in CHF? Number only.`, ok: x => x.replace(/[’',\s]/g, '').includes(String(total)) }); }

async function ask(question) {
  const response = await postStream(url + '/v1/chat/completions', { messages: [{ role: 'system', content: system }, { role: 'user', content: question }], stream: true, max_tokens: 24, temperature: 0, cache_prompt: true, chat_template_kwargs: { enable_thinking: false } });
  let text = '', buffer = '', timings = null;
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
  return { text: text.trim(), timings };
}

const score = {};
let cachedTotal = 0;
for (const question of questions) {
  const { text, timings } = await ask(question.q);
  const ok = question.ok(text);
  score[question.kind] ??= { right: 0, total: 0 };
  score[question.kind].total++; if (ok) score[question.kind].right++;
  cachedTotal += timings?.cache_n || 0;
  if (!ok) console.log(`✖ ${question.kind}: ${question.q} → ${text}`);
}
const right = Object.values(score).reduce((n, s) => n + s.right, 0), total = Object.values(score).reduce((n, s) => n + s.total, 0);
const result = { label, at: new Date().toISOString(), facts: count, accuracy: +(right / total).toFixed(3), right, total, byKind: score, averageCachedTokens: Math.round(cachedTotal / total) };
console.log(JSON.stringify(result));
appendFileSync(path.join(here, 'accuracy.jsonl'), JSON.stringify(result) + '\n');
