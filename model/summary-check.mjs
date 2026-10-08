// Does the real model summarize a long conversation well enough to continue from the summary alone?
//   dotnet tests/Ligata.AI.Tests/bin/Release/net10.0/Ligata.AI.Tests.dll --prompt > .runtime/handoff-prompt.txt
//   node model/summary-check.mjs --key-file .runtime/keys/<site>.txt [--gateway http://127.0.0.1:1210] [--rounds 3]
// For an English and a German conversation: the model answers four visitor messages full of details, summarizes
// the conversation with the package's instruction (as the widget's compact request does), and then answers a
// question about those details from only the summary. Appends a line per round to model/summary.jsonl.
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const gateway = arg('gateway', 'http://127.0.0.1:1210');
const key = readFileSync(arg('key-file', path.join(here, '..', '.runtime', 'key-handoff.txt')), 'utf8').match(/lai_[A-Za-z0-9_-]+/)[0];
const system = readFileSync(arg('prompt', path.join(here, '..', '.runtime', 'handoff-prompt.txt')), 'utf8');
const rounds = Number(arg('rounds', 3));
// The same instruction and summary wrapper the package sends (Services/ChatRelay.cs).
const relay = readFileSync(path.join(here, '..', 'src', 'Ligata.AI', 'Services', 'ChatRelay.cs'), 'utf8');
const instruction = JSON.parse(relay.match(/SummaryInstruction = ("(?:[^"\\]|\\.)*");/)[1]);
const wrap = summary => `Summary of the earlier part of this conversation (the older messages were removed to save memory):\n<conversation_summary>\n${summary.trim()}\n</conversation_summary>`;

const conversations = {
  en: {
    turns: [
      'Hi, I run a bakery called Sonnenkorn in Winterthur and we want a new website.',
      'We need about 6 pages and an online order form for birthday cakes.',
      'Our budget is CHF 6,000 and we would like to launch before 15 March.',
      'What would hosting cost us per month?',
    ],
    recall: 'Remind me: what is my bakery called, in which town, how many pages did I want and what was my budget?',
    facts: [/sonnenkorn/i, /winterthur/i, /\b6\b|six/i, /6[’',.]?000/],
  },
  de: {
    turns: [
      'Hallo, ich habe eine Schreinerei namens Holzwerk Brunner in Bülach und brauche eine neue Website.',
      'Wir brauchen etwa 10 Seiten und einen Blog für unsere Projekte.',
      'Unser Budget liegt bei CHF 9’000, und die Seite sollte im Mai online gehen.',
      'Was kostet das Hosting pro Monat?',
    ],
    recall: 'Erinnere mich: Wie heisst meine Firma, wo ist sie, wie viele Seiten wollte ich und welches Budget hatte ich?',
    facts: [/brunner/i, /bülach/i, /\b10\b|zehn/i, /9[’',.]?000/],
  },
};

async function chat(messages, { maxTokens = 600, temperature = 0.7 } = {}) {
  const response = await fetch(gateway + '/v1/chat', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, visitor: 'summary-check', maxTokens, temperature, thinking: false, contextLimit: 65536 }),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const text = [...(await response.text()).matchAll(/^event: delta\ndata: (.*)$/gm)].map(m => JSON.parse(m[1]).text).join('');
  return text;
}

for (let round = 1; round <= rounds; round++) {
  for (const [language, c] of Object.entries(conversations)) {
    const history = [];
    for (const turn of c.turns) {
      history.push({ role: 'user', content: turn });
      history.push({ role: 'assistant', content: (await chat([{ role: 'system', content: system }, ...history])).replace('[[team]]', '').trim() });
    }
    const started = Date.now();
    const summary = await chat([{ role: 'system', content: system }, ...history, { role: 'user', content: instruction }], { maxTokens: 2048, temperature: 0.3 });
    const summaryMs = Date.now() - started;
    const answer = await chat([{ role: 'system', content: system }, { role: 'user', content: wrap(summary) }, { role: 'user', content: c.recall }]);
    const kept = c.facts.filter(f => f.test(summary)).length, recalled = c.facts.filter(f => f.test(answer)).length;
    const german = (summary.match(/\b(und|der|das|für|wir|ist|mit)\b/gi) || []).length > 3;
    const refused = /can[’']t help|kann ich nicht helfen|\[\[team\]\]/i.test(summary);
    const row = { at: new Date().toISOString(), round, language, words: summary.split(/\s+/).length, summaryMs, kept: `${kept}/${c.facts.length}`, recalled: `${recalled}/${c.facts.length}`, summaryLanguage: german ? 'de' : 'en', languageOk: german === (language === 'de'), refused, summary: summary.slice(0, 600), answer: answer.slice(0, 300) };
    console.log(JSON.stringify(row));
    appendFileSync(path.join(here, 'summary.jsonl'), JSON.stringify(row) + '\n');
  }
}
