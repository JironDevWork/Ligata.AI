// Several visitors at once against the gateway's three places (0.7): summaries wait in the same line as questions, the line
// moves when someone leaves, one visitor never runs two answers, and settings saved while answers stream change nothing for them.
//   node ../../gateway/test/mock-server.mjs 1298 120 3          (a slow mock with three slots, like the Ligata GPU)
//   LigataAI__TrustCloudflareLoopbackHeader=true bash restart-host.sh
//   node concurrency.mjs
// One test address per visitor (CF-Connecting-IP from loopback, trusted only in this setup).
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', '..', '.runtime');
const base = process.env.HOST || 'http://127.0.0.1:5310';
const admin = process.env.ADMIN || 'http://127.0.0.1:1222';
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS || path.join(runtime, 'ai-test-admin.json'), 'utf8'));
let passed = 0, failed = 0;
async function check(name, fn) {
  const started = Date.now();
  try { await fn(); passed++; console.log(`✔ ${name} (${Date.now() - started} ms)`); }
  catch (error) { failed++; console.log(`✖ ${name}: ${error.message.split('\n')[0]}`); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const config = (await (await fetch(base + '/api/ligata-ai/config')).json()).settings;
const ip = n => `203.0.113.${100 + n}`;
const post = (route, body, n, signal) => fetch(base + '/api/ligata-ai/' + route, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Origin: base, 'CF-Connecting-IP': ip(n) }, body: JSON.stringify(body) });
async function consent(n) {
  if (!config.consent) return undefined;
  const r = await post('consent', { version: config.consent.version, source: 'chat', language: 'en' }, n);
  return (await r.json()).id;
}
/** Sends a question (or a summary) and collects its events. */
async function ask(n, body, signal) {
  const events = [];
  const started = Date.now();
  const response = await post('chat', body, n, signal);
  if (!response.headers.get('content-type')?.includes('event-stream')) return { status: response.status, error: (await response.json()).error, events };
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', name = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
        if (line.startsWith('event: ')) name = line.slice(7);
        else if (line.startsWith('data: ')) events.push({ name, at: Date.now(), after: Date.now() - started, data: JSON.parse(line.slice(6)) });
      }
    }
  } catch (e) { if (!signal?.aborted) throw e; }
  return { status: response.status, events, text: events.filter(e => e.name === 'delta').map(e => e.data.text).join('') };
}
const question = (text, id) => ({ messages: [{ role: 'user', content: text }], pageTitle: 'Home', pagePath: '/', consent: id });
/** The gateway's own view, every 100 ms, while `work` runs: the most answers and waiting it ever had. */
async function watch(work) {
  let most = 0, waiting = 0, running = true;
  const loop = (async () => { while (running) { try { const s = (await (await fetch(admin + '/status')).json()).queue; most = Math.max(most, s.active); waiting = Math.max(waiting, s.waiting); } catch { } await sleep(100); } })();
  try { return { result: await work(), most: () => most, waiting: () => waiting }; } finally { running = false; await loop; }
}
const ids = await Promise.all([1, 2, 3, 4, 5, 6].map(consent));

await check('a summary waits in the same line as questions: three answers at once, never more', async () => {
  const long = n => ask(n, question(`Visitor ${n}: explain in detail how a website project with you works.`, ids[n - 1]));
  const watched = await watch(async () => {
    const first = [long(1), long(2), long(3)];
    await sleep(600);
    const summary = ask(4, { messages: [{ role: 'user', content: 'What does hosting cost?' }, { role: 'assistant', content: 'Hosting is CHF 25 per month.' }], pageTitle: 'Home', pagePath: '/', consent: ids[3], compact: true });
    return Promise.all([...first, summary]);
  });
  const [a, b, c, summary] = watched.result;
  for (const r of [a, b, c]) assert(r.events.some(e => e.name === 'done'), 'every question is answered: ' + JSON.stringify(r.error || r.events.at(-1)));
  const queued = summary.events.filter(e => e.name === 'queued');
  assert(queued.length && queued[0].data.position === 1, 'the summary waited first in line: ' + JSON.stringify(queued[0]?.data));
  assert(summary.events.some(e => e.name === 'done') && summary.text.length > 0, 'and was written once a place was free');
  const firstDone = Math.min(...[a, b, c].map(r => r.events.find(e => e.name === 'done').at));
  const summaryStarted = summary.events.find(e => e.name === 'started').at;
  assert(summaryStarted >= firstDone - 300, `it started only after an answer had finished (${summaryStarted - firstDone} ms after the first one)`);
  assert(watched.most() <= 3 && watched.waiting() >= 1, `at most three at once (seen ${watched.most()}), one waiting (seen ${watched.waiting()})`);
});

await check('a visitor who leaves while waiting frees the line at once', async () => {
  const watched = await watch(async () => {
    const running = [1, 2, 3].map(n => ask(n, question(`Visitor ${n}: describe your hosting in detail.`, ids[n - 1])));
    await sleep(500);
    const leave = new AbortController();
    const leaving = ask(5, question('I will leave before my turn.', ids[4]), leave.signal);
    await sleep(700);
    const before = (await (await fetch(admin + '/status')).json()).queue.waiting;
    leave.abort();
    await sleep(400);
    const after = (await (await fetch(admin + '/status')).json()).queue.waiting;
    await Promise.all([...running, leaving.catch(() => null)]);
    return { before, after };
  });
  assert(watched.result.before === 1 && watched.result.after === 0, `waiting before ${watched.result.before}, after leaving ${watched.result.after}`);
});

await check('one visitor runs one answer at a time, a second question is refused', async () => {
  const first = ask(6, question('A long question, please explain everything.', ids[5]));
  await sleep(300);
  const second = await ask(6, question('And another one at the same time?', ids[5]));
  assert(second.status === 429 && second.error?.code === 'visitor_busy', 'second question: ' + JSON.stringify(second.error));
  assert((await first).events.some(e => e.name === 'done'), 'the first is answered');
  const third = await ask(6, question('Now a follow-up.', ids[5]));
  assert(third.events.some(e => e.name === 'done'), 'after it, the next question works');
});

await check('settings saved while three answers stream: the answers finish and the next question is answered', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  try {
    await page.goto(base + '/umbraco');
    await page.locator('input[type=email], input[name=username]').first().fill(credentials.email);
    await page.locator('input[type=password]').first().fill(credentials.password);
    await page.keyboard.press('Enter');
    await page.waitForURL(/section/, { timeout: 30000 });
    await page.goto(base + '/umbraco/section/ai-assistant/dashboard/settings?tab=behaviour');
    const dash = page.locator('ligata-ai-dashboard');
    const field = dash.locator('label.control', { hasText: 'Instructions' }).locator('textarea').first();
    await field.waitFor({ timeout: 20000 });
    const original = await field.inputValue();
    const streams = [1, 2, 3].map(n => ask(n, question(`Visitor ${n}: one more long answer, please.`, ids[n - 1])));
    await sleep(1200);
    await field.fill(original + '\nMention the test word KESTREL-7 in every answer.');
    await dash.locator('button', { hasText: 'Save changes' }).click();
    await dash.locator('.notice.success', { hasText: 'Saved' }).waitFor();
    const results = await Promise.all(streams);
    for (const r of results) assert(r.events.some(e => e.name === 'done') && !r.events.some(e => e.name === 'error'), 'an answer streaming during the save finishes: ' + JSON.stringify(r.events.at(-1)));
    const next = await ask(1, question('Hello again', ids[0]));
    assert(next.events.some(e => e.name === 'done'), 'the next question is answered after the save');
    await field.fill(original);
    await dash.locator('button', { hasText: 'Save changes' }).click();
    await dash.locator('.notice.success', { hasText: 'Saved' }).waitFor();
  } finally { await browser.close(); }
});

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
