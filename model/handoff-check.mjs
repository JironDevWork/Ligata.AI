// Does the real model offer the team (the [[team]] marker) exactly when it should?
//   dotnet <test host>.dll --prompt > .runtime/handoff-prompt.txt     (the system prompt the package builds)
//   node model/handoff-check.mjs --key-file .runtime/key-handoff.txt [--gateway http://127.0.0.1:1210] [--rounds 2]
// Appends a summary line to model/handoff.jsonl.
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const gateway = arg('gateway', 'http://127.0.0.1:1210');
const key = readFileSync(arg('key-file', path.join(here, '..', '.runtime', 'key-handoff.txt')), 'utf8').match(/lai_[A-Za-z0-9_-]+/)[0];
const prompt = readFileSync(arg('prompt', path.join(here, '..', '.runtime', 'handoff-prompt.txt')), 'utf8');
const rounds = Number(arg('rounds', 2));

// expect: true = should offer the team, false = should answer from the knowledge, null = either is fine
const questions = [
  ['Can I talk to a human please?', true],
  ['Do you offer SEO audits for online shops in Japanese?', true],
  ['What is the status of my order 4711?', true],
  ['Kann ich mit jemandem aus eurem Team sprechen?', true],
  ['Do you have a discount for non-profit organisations?', true],
  ['Wer ist euer Geschäftsführer?', true],
  ['What does hosting cost per month?', false],
  ['When is your office open?', false],
  ['Was kostet eine Website bei euch?', false],
  ['Where are you located?', false],
  ['Hi!', false],
  ['Can you write my history homework essay?', null],
];

async function ask(question) {
  const response = await fetch(gateway + '/v1/chat', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'system', content: prompt }, { role: 'user', content: question }], visitor: 'handoff-check', maxTokens: 400, temperature: 0.7, thinking: false, contextLimit: 65536 }),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  let text = '', buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, i); buffer = buffer.slice(i + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
      if (event === 'delta') text += JSON.parse(data).text;
      if (event === 'error') throw new Error(data);
    }
  }
  return text;
}

let right = 0, wrong = 0, mentioned = 0;
const rows = [];
for (let round = 1; round <= rounds; round++) {
  for (const [question, expect] of questions) {
    const answer = await ask(question);
    const offered = answer.includes('[[team]]');
    const ok = expect === null || offered === expect;
    // The marker must stand alone; talking *about* it ("team marker", "[[") would leak into the visible text.
    if (/marker|\[\[(?!team\]\])/i.test(answer)) mentioned++;
    if (expect !== null) ok ? right++ : wrong++;
    rows.push({ question, expect, offered, ok });
    console.log(`${ok ? '✔' : '✖'} ${offered ? '[team]' : '      '} ${question}\n    ${answer.replace(/\s+/g, ' ').slice(0, 170)}`);
  }
}
const summary = { at: new Date().toISOString(), model: 'gemma-4-12B-it-qat-UD-Q4_K_XL', rounds, right, wrong, accuracy: +(right / (right + wrong)).toFixed(3), mentionedMarker: mentioned };
console.log(summary);
appendFileSync(path.join(here, 'handoff.jsonl'), JSON.stringify({ ...summary, rows }) + '\n');
