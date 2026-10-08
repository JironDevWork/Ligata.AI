// Does the model look the website up, find the right page and answer from it? Real questions through the whole stack:
// a website running the package (test host or a local Umbraco.BaselineV2), a gateway and the real GPU.
//   node model/lookup-check.mjs [questions.json] [--host http://127.0.0.1:5310] [--label name]
// questions.json: [{ "ask": "...", "expect": ["regex", ...], "reject": ["regex", ...], "lookup": true|false, "team": true|false, "then": [{...}] }]
// "then" asks follow-up questions in the same conversation (the earlier lookups are sent back like the widget does).
// Results are appended to model/lookups.jsonl.
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const host = arg('--host', 'http://127.0.0.1:5310');
const label = arg('--label', '');
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(here, 'lookup-questions.json');
const questions = JSON.parse(readFileSync(file, 'utf8'));

const config = await (await fetch(host + '/api/ligata-ai/config')).json();
let consent = null;
if (config.settings.consent) {
  const response = await fetch(host + '/api/ligata-ai/consent', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: host }, body: JSON.stringify({ version: config.settings.consent.version, source: 'chat', language: 'en' }) });
  consent = (await response.json()).id;
}

async function ask(messages, pagePath = '/') {
  const started = Date.now();
  const response = await fetch(host + '/api/ligata-ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: host }, body: JSON.stringify({ messages, pageTitle: 'Home', pagePath, consent }) });
  const text = await response.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map(m => ({ name: m[1], data: JSON.parse(m[2]) }));
  const answer = events.filter(e => e.name === 'delta').map(e => e.data.text).join('');
  const done = events.find(e => e.name === 'done')?.data;
  const error = events.find(e => e.name === 'error')?.data || (response.ok ? null : JSON.parse(text).error);
  const lookups = events.filter(e => e.name === 'lookup').map(e => e.data.calls);
  const firstWord = events.findIndex(e => e.name === 'delta');
  return { answer, done, error, lookups, ms: Date.now() - started, firstTokenMs: done?.timings?.firstTokenMs };
}

let passed = 0, total = 0;
async function run(question, history = []) {
  const messages = [...history, { role: 'user', content: question.ask }];
  const result = await ask(messages, question.page);
  const checks = [];
  for (const pattern of question.expect || []) checks.push([`/${pattern}/`, new RegExp(pattern, 'i').test(result.answer)]);
  for (const pattern of question.reject || []) checks.push([`not /${pattern}/`, !new RegExp(pattern, 'i').test(result.answer)]);
  if (question.lookup != null) checks.push([question.lookup ? 'looked up' : 'no lookup', (result.lookups.length > 0) === question.lookup]);
  if (question.team != null) checks.push([question.team ? 'offers the team' : 'no team offer', result.answer.includes('[[team]]') === question.team]);
  const ok = !result.error && checks.every(([, good]) => good);
  total++; if (ok) passed++;
  const calls = result.lookups.map(round => round.map(c => `${c.name}(${JSON.stringify(c.arguments)})`).join(' + ')).join(' → ');
  console.log(`${ok ? '✔' : '✖'} ${question.ask}\n   lookups: ${calls || 'none'}\n   answer (${(result.ms / 1000).toFixed(1)} s, first word ${((result.firstTokenMs || 0) / 1000).toFixed(1)} s, ${result.done?.usage?.promptTokens ?? '?'} tokens): ${result.error ? 'ERROR ' + result.error.code + ' ' + result.error.message : result.answer.replace(/\s+/g, ' ').slice(0, 260)}${checks.filter(([, good]) => !good).map(([name]) => `\n   failed: ${name}`).join('')}`);
  appendFileSync(path.join(here, 'lookups.jsonl'), JSON.stringify({ at: new Date().toISOString(), label, host, ask: question.ask, ok, lookups: result.lookups, answer: result.answer, ms: result.ms, firstTokenMs: result.firstTokenMs, promptTokens: result.done?.usage?.promptTokens, error: result.error?.code }) + '\n');
  const next = [...messages, { role: 'assistant', content: result.answer.replace('[[team]]', '').trim(), ...(result.lookups.length ? { lookups: result.lookups } : {}) }];
  for (const followUp of question.then || []) await run(followUp, next);
}

for (const question of questions) await run(question);
console.log(`\n${passed} of ${total} passed`);
