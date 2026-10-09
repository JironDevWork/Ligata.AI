// A short check against the real Claude API (costs a fraction of a cent; never part of the regular suites). Both engines are set
// up, Claude answers, and one question is asked at each thinking effort set in the backoffice, as an editor would:
//   LigataAI__Mode=api LigataAI__Claude__ApiKey=<a real key, from a secret store> bash tests/e2e/restart-host.sh --clear-keys
//   cd tests/e2e && node claude-live.mjs
// Prints the timings, tokens, lookups and answers. The key stays in the host's environment; nothing here sees it.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', '..', '.runtime');
const base = process.env.HOST || 'http://127.0.0.1:5310';
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS || path.join(runtime, 'ai-test-admin.json'), 'utf8'));
const config = async () => (await fetch(base + '/api/ligata-ai/config')).json();

/** One answer with its timings: started, first text, done; the lookups and the token counts. */
async function chat(messages) {
  const version = (await config()).settings.consent.version;
  const given = await (await fetch(base + '/api/ligata-ai/consent', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ version, source: 'chat', language: 'en' }) })).json();
  const started = Date.now();
  const response = await fetch(base + '/api/ligata-ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ messages, pageTitle: 'Home', pagePath: '/', consent: given.id }) });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '', first = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (!first && text.includes('event: delta')) first = Date.now() - started;
  }
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map(m => ({ name: m[1], data: JSON.parse(m[2]) }));
  return {
    status: response.status, firstMs: first, totalMs: Date.now() - started,
    thought: events.some(e => e.name === 'thinking'),
    lookups: events.filter(e => e.name === 'lookup').flatMap(e => e.data.calls.map(c => `${c.name}(${JSON.stringify(c.arguments)})`)),
    usage: events.find(e => e.name === 'done')?.data.usage, error: events.find(e => e.name === 'error')?.data ?? (response.status !== 200 ? text.slice(0, 300) : null),
    answer: events.filter(e => e.name === 'delta').map(e => e.data.text).join(''),
  };
}

const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
const admin = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
admin.on('dialog', d => d.accept());
await admin.goto(base + '/umbraco');
await admin.locator('input[type=email], input[name=username]').first().fill(credentials.email);
await admin.locator('input[type=password]').first().fill(credentials.password);
await admin.keyboard.press('Enter');
await admin.waitForURL(/section/, { timeout: 30000 });
await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/settings?tab=connection');
const dash = admin.locator('ligata-ai-dashboard');
await dash.locator('.engines').waitFor({ timeout: 20000 });
console.log('Engines:', (await dash.locator('.engines').innerText()).replace(/\s+/g, ' '));
await dash.locator('section.card', { hasText: 'Anthropic API key' }).locator('button', { hasText: 'Test again' }).click();
await dash.locator('.notice.success, .notice.error').first().waitFor({ timeout: 20000 });
console.log('Test again:', (await dash.locator('.notice.success, .notice.error').first().innerText()).trim());
console.log('Claude status:', (await dash.locator('section.card', { hasText: 'Claude status' }).innerText()).replace(/\s+/g, ' ').slice(0, 300));

async function effort(level, label) {
  await dash.locator('nav.tabs button', { hasText: 'Behaviour' }).click();
  await dash.locator(`.segmented[aria-label="Thinking effort"] button`, { hasText: new RegExp(`^${label}$`) }).click();
  if (await dash.locator('button', { hasText: 'Save changes' }).isEnabled()) {
    await dash.locator('button', { hasText: 'Save changes' }).click();
    await dash.locator('.notice.success', { hasText: 'Saved' }).waitFor({ timeout: 15000 });
  }
  return level;
}

const questions = [
  ['off', 'Off', [{ role: 'user', content: 'Hi! Who are you?' }]],
  ['low', 'Low', [{ role: 'user', content: 'What are your opening hours?' }]],
  ['medium', 'Medium', [{ role: 'user', content: 'Was kostet eine Website bei euch, und kann ich auch das Hosting buchen?' }]],
  ['high', 'High', [{ role: 'user', content: 'Where is your office, and how can I reach you by phone?' }]],
  ['xhigh', 'Extra high', [{ role: 'user', content: 'Do you also build online shops? Please answer in one or two sentences.' }]],
];
for (const [level, label, messages] of questions) {
  await effort(level, label);
  const r = await chat(messages);
  console.log(`\n[${level}] ${messages.at(-1).content}`);
  console.log(`  status ${r.status} · first text ${r.firstMs} ms · total ${r.totalMs} ms · thinking ${r.thought ? 'yes' : 'no'} · tokens ${JSON.stringify(r.usage)}`);
  if (r.lookups.length) console.log('  lookups: ' + r.lookups.join(', '));
  if (r.error) console.log('  error: ' + JSON.stringify(r.error));
  console.log('  answer: ' + r.answer.replace(/\s+/g, ' ').slice(0, 400));
}
await effort('low', 'Low');
await browser.close();
