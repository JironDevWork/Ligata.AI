// The chat's memory in Microsoft Edge (headless), against a scripted stand-in for the site's API (no model, no host):
// "Reading…" without numbers, the memory bar without tokens, and long conversations summarized before they no longer fit.
//   node memory.mjs   → screenshots in .runtime/e2e/memory-*.png
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', '..', '.runtime', 'e2e');
mkdirSync(out, { recursive: true });
const script = readFileSync(path.join(here, '..', '..', 'src', 'Ligata.AI', 'wwwroot', 'assets', 'ligata-ai', 'ligata-ai.js'), 'utf8');

const LIMIT = 8000, BASE = 1000, RESERVE = 2560;
const settings = {
  name: 'Test Assistant', greeting: 'Hi! Ask me anything about this test site.', suggestions: [], language: 'en', privacyNotice: '', fallbackEmail: 'team@example.com',
  appearance: { position: 'right', showContextMeter: true, animations: false, sound: false }, allowImages: true, allowPdfs: true,
  contextLimit: LIMIT, baseTokens: BASE, reserveTokens: RESERVE, limits: { imageTokens: 280 }, features: { assistant: true, liveChat: false, email: false }, engine: 'gpu', consent: null,
};
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Memory test</title></head><body><h1>Memory test</h1>
<script src="/ligata-ai.js" data-ligata-ai data-api="/api/ligata-ai" data-settings='${JSON.stringify(settings).replace(/'/g, '&#39;')}'></script></body></html>`;

// The stand-in counts tokens like the widget (characters / 3.5) and answers in the gateway's event format.
const tokens = text => Math.ceil(String(text || '').length / 3.5);
const requests = [];
let failNext = null; // 'context_full' makes the next question fail as if the estimate had been too low
const SUMMARY = 'The visitor asked about the long test questions one and two. Facts given: blue plan CHF 40. Language: English.';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/ligata-ai.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(script); }
  if (url.pathname === '/api/ligata-ai/config') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ version: 1, state: 'ready', queue: { waiting: 0, running: false }, vision: true, settings })); }
  if (url.pathname === '/api/ligata-ai/chat') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const prompt = BASE + tokens(body.summary) + body.messages.reduce((n, m) => n + tokens(m.content), 0) + (body.compact ? 150 : 0);
    if (!body.compact && failNext) {
      const code = failNext; failNext = null;
      res.writeHead(413, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code, message: 'Too long.', promptTokens: LIMIT, contextTokens: LIMIT } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    send('started', { promptTokens: prompt, contextTokens: LIMIT });
    // Reading takes a moment, then the text streams.
    for (const done of [0.3, 0.7]) { send('progress', { processed: Math.round(prompt * done), total: prompt }); await sleep(350); }
    const text = body.compact ? SUMMARY : `Answer ${requests.filter(r => !r.compact).length}.`;
    for (const part of text.match(/.{1,12}/g)) { send('delta', { text: part }); await sleep(body.compact ? 60 : 10); }
    send('done', { finishReason: 'stop', usage: { promptTokens: prompt, completionTokens: tokens(text) }, context: { used: prompt + tokens(text), limit: LIMIT }, timings: {} });
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page);
});
await new Promise(r => server.listen(5313, '127.0.0.1', r));

let passed = 0, failures = 0;
async function check(name, fn) {
  const started = Date.now();
  try { await fn(); passed++; console.log(`✔ ${name} (${Date.now() - started} ms)`); }
  catch (error) { failures++; console.log(`✖ ${name}: ${error.message}`); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const tab = await context.newPage();
const errors = [];
tab.on('pageerror', e => errors.push(e.message));
await tab.goto('http://127.0.0.1:5313/');
const widget = tab.locator('#ligata-ai');
await widget.locator('.launcher').click();
const input = widget.locator('#lai-input');
async function ask(text) {
  const before = await widget.locator('.msg.bot').count();
  await input.fill(text);
  await input.press('Enter');
  await settled(before);
}
// The answer is in and nothing is reading or writing any more.
async function settled(before) {
  await widget.locator('.msg.bot').nth(before).waitFor({ timeout: 15000 });
  await widget.locator('.bubble.streaming').waitFor({ state: 'detached', timeout: 15000 });
  await widget.locator('.waiting').waitFor({ state: 'detached', timeout: 15000 });
}
const long = (label, n) => `${label}: ` + 'This is a long test question with plenty of words. '.repeat(n);

await check('reading a long prompt says "Reading…", without a percentage or a bar', async () => {
  await input.fill(long('Question one', 55)); // ~800 tokens
  await input.press('Enter');
  const waiting = widget.locator('.waiting');
  await waiting.locator('.wait-text', { hasText: 'Reading…' }).waitFor({ timeout: 5000 });
  const text = await waiting.innerText();
  assert(!/\d/.test(text), 'no number while reading: ' + text);
  assert(await waiting.locator('.progress').count() === 0, 'no progress bar while reading');
  await tab.screenshot({ path: path.join(out, 'memory-reading.png') });
  await settled(1);
});

await check('the memory bar shows how full the memory is, not tokens', async () => {
  const meter = await widget.locator('.meter-text').innerText();
  assert(/^\d+%$/.test(meter.trim()), 'a percentage: ' + meter);
  const help = await widget.locator('.meter').getAttribute('title');
  assert(help.includes('summarizes the earlier messages') && !/token/i.test(help), 'explains in words: ' + help);
  // Full means "the next answer needs a summary first": used / (limit - reserve).
  const used = requests.at(-1) && (BASE + requests.at(-1).messages.reduce((n, m) => n + tokens(m.content), 0) + tokens('Answer 1.'));
  const expected = Math.round(used / (LIMIT - RESERVE) * 100);
  assert(Math.abs(parseInt(meter, 10) - expected) <= 1, `measured against the summary line: ${meter} vs ${expected}%`);
  const chips = await widget.locator('.composer .file small').count();
  assert(chips === 0, 'no attachment chips');
});

await check('a question that would not fit is asked after the earlier messages are summarized', async () => {
  await ask(long('Question two', 110)); // ~1,600 tokens: about 3,500 in memory now
  assert(!requests.some(r => r.compact), 'no summary while everything fits');
  const count = requests.length;
  await input.fill(long('Question three', 150)); // 3,500 + 2,200 cross the summary line at 8,000 - 2,560
  await input.press('Enter');
  const row = widget.locator('.waiting.compacting');
  await row.locator('.wait-text', { hasText: 'Summarizing the conversation so far' }).waitFor({ timeout: 5000 });
  assert(await row.locator('.progress').count() === 1, 'a progress bar while summarizing');
  await tab.screenshot({ path: path.join(out, 'memory-summarizing.png') });
  await settled(3);
  const [summary, question] = requests.slice(count);
  assert(summary?.compact === true, 'first a summary request');
  assert(summary.messages.length === 4 && summary.messages.at(-1).role === 'assistant', 'the summary covers the conversation before the new question: ' + summary.messages.map(m => m.role).join(','));
  assert(question && !question.compact && question.summary === SUMMARY, 'the question goes with the summary');
  assert(question.messages.length === 1 && question.messages[0].content.startsWith('Question three'), 'and without the summarized messages: ' + question.messages.map(m => m.content.slice(0, 20)).join(' | '));
  const divider = widget.locator('.event', { hasText: 'Earlier messages were summarized' });
  assert(await divider.count() === 1, 'a divider where the summary starts');
  const bubbles = await widget.locator('.msg.user').allInnerTexts();
  assert(bubbles.length === 3 && bubbles[0].startsWith('Question one'), 'the visitor still sees every message');
  const meter = parseInt(await widget.locator('.meter-text').innerText(), 10);
  assert(meter < 60, 'the memory bar dropped after the summary: ' + meter + '%');
  await tab.screenshot({ path: path.join(out, 'memory-summarized.png') });
});

await check('the summary is kept on the device and used after a reload', async () => {
  const stored = await tab.evaluate(() => JSON.parse(localStorage.getItem('ligata-ai:v2:' + location.host)));
  const c = stored.conversations[0];
  assert(c.summary === SUMMARY, 'summary stored');
  assert(c.messages.filter(m => m.summarized).length === 4, 'earlier messages marked as summarized');
  await tab.reload();
  await widget.locator('.event', { hasText: 'Earlier messages were summarized' }).waitFor({ timeout: 10000 });
  const count = requests.length;
  await ask('Short follow-up?');
  const next = requests.slice(count);
  assert(next.length === 1 && next[0].summary === SUMMARY && next[0].messages.length === 3, 'summary plus the messages after it: ' + next.map(r => r.messages.length).join(','));
});

await check('when the server finds the conversation too long anyway, it is summarized and asked again once', async () => {
  const count = requests.length;
  failNext = 'context_full';
  await ask('One more question?');
  const next = requests.slice(count).map(r => r.compact ? 'summary' : r.summary ? 'question+summary' : 'question');
  assert(next.join(',') === 'question+summary,summary,question+summary', 'refused, summarized, asked again: ' + next.join(','));
  assert(await widget.locator('.notice.error').count() === 0, 'no error shown');
  const [, again, last] = requests.slice(count);
  assert(again.summary === SUMMARY, 'the second summary includes the first one');
  // The latest exchange was short, so it stays word for word next to the summary.
  assert(/^Short follow-up\? \| Answer \d+\. \| One more question\?$/.test(last.messages.map(m => m.content).join(' | ')), 'the latest exchange and the new question: ' + last.messages.map(m => m.content.slice(0, 20)).join(' | '));
});

await check('no script errors', async () => { assert(!errors.length, errors.join('; ')); });

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
