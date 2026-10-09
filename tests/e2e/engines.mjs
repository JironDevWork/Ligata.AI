// Two engines (0.8): the Ligata GPU and Claude, each set up by its key. With both, editors switch under Connection and set how
// much each one thinks under Behaviour; with one, no switch is shown. Runs against the dev gateway (mock llama-server) and the
// strict mock Anthropic API, so no key or money is needed:
//   node gateway/test/mock-server.mjs 1298 &   (and the dev gateway on :1220, see TESTING.md)
//   node tests/e2e/mock-anthropic.mjs &          → :1230
//   LigataAI__Claude__BaseUrl=http://127.0.0.1:1230 bash tests/e2e/restart-host.sh --clear-keys
//   cd tests/e2e && node engines.mjs
// The gateway key comes from the configuration (restart-host.sh); the Claude key is stored through the backoffice like an editor would.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_KEY } from './mock-anthropic.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', '..', '.runtime');
const out = path.join(runtime, 'e2e', 'engines');
mkdirSync(out, { recursive: true });
const base = process.env.HOST || 'http://127.0.0.1:5310';
const mock = process.env.MOCK || 'http://127.0.0.1:1230';
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS || path.join(runtime, 'ai-test-admin.json'), 'utf8'));
const run = Date.now().toString(36);
let passed = 0, failed = 0;
const errors = [];
const pages = {};
async function check(name, fn) {
  const started = Date.now();
  try { await fn(); passed++; console.log(`✔ ${name} (${Date.now() - started} ms)`); }
  catch (error) {
    failed++; console.log(`✖ ${name}: ${error.message.split('\n')[0]}`);
    for (const [label, p] of Object.entries(pages)) await p.screenshot({ path: path.join(out, `failed-${label}-${name.slice(0, 24).replace(/\W+/g, '-')}.png`) }).catch(() => { });
  }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const mockState = async () => (await fetch(mock + '/__state')).json();
const secret = text => text.includes(MOCK_KEY) || text.includes(MOCK_KEY.slice(0, 20));
const config = async () => (await fetch(base + '/api/ligata-ai/config')).json();

/** One answer from the public chat endpoint, with a consent recorded for the consent version in force. */
async function chat(text) {
  const version = (await config()).settings.consent.version;
  const given = await (await fetch(base + '/api/ligata-ai/consent', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ version, source: 'chat', language: 'en' }) })).json();
  const response = await fetch(base + '/api/ligata-ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ messages: [{ role: 'user', content: text }], pageTitle: 'Home', pagePath: '/', consent: given.id }) });
  const body = await response.text();
  const events = [...body.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map(m => ({ name: m[1], data: JSON.parse(m[2]) }));
  return { status: response.status, body, answer: events.filter(e => e.name === 'delta').map(e => e.data.text).join('') };
}

const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
const admin = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const dialogs = [];
admin.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
admin.on('pageerror', e => errors.push(e.message));
const backoffice = [];
admin.on('response', async r => { try { if (/json/.test(r.headers()['content-type'] || '')) backoffice.push(await r.text()); } catch { } });
pages.admin = admin;
const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
visitor.on('pageerror', e => errors.push(e.message));
pages.visitor = visitor;
const widget = visitor.locator('#ligata-ai');
const dash = admin.locator('ligata-ai-dashboard');
const dashText = () => dash.locator('.workspace').first().innerText();
const tab = name => dash.locator('nav.tabs button', { hasText: name }).click();
const saved = async () => { await dash.locator('button', { hasText: 'Save changes' }).click(); await dash.locator('.notice.success', { hasText: 'Saved' }).waitFor({ timeout: 15000 }); };
/** Asks in the website chat and returns the answer once it has finished streaming. */
async function ask(text) {
  const before = await widget.locator('.msg.bot').count();
  await widget.locator('.composer textarea').fill(text);
  await widget.locator('.composer textarea').press('Enter');
  await widget.locator('.msg.bot').nth(before).waitFor({ timeout: 20000 });
  await widget.locator('.bubble.streaming').waitFor({ state: 'detached', timeout: 30000 });
  return widget.locator('.msg.bot').nth(before).innerText();
}
await fetch(mock + '/__mode', { method: 'POST', body: JSON.stringify({ mode: 'ok', errors: [] }) });

await check('only the GPU set up: it answers, no engine switch, the GPU on/off switch under Behaviour', async () => {
  const c = await config();
  assert(c.settings.engine === 'gpu' && c.settings.consent.version.startsWith('gpu.'), 'engine and consent: ' + c.settings.engine + ' ' + c.settings.consent?.version);
  await admin.goto(base + '/umbraco');
  await admin.locator('input[type=email], input[name=username]').first().fill(credentials.email);
  await admin.locator('input[type=password]').first().fill(credentials.password);
  await admin.keyboard.press('Enter');
  await admin.waitForURL(/section/, { timeout: 30000 });
  await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/settings');
  await dash.locator('h1').first().waitFor({ timeout: 20000 });
  await tab('Connection');
  await dash.locator('h2', { hasText: 'Ligata GPU' }).first().waitFor();
  await dash.locator('h2', { hasText: 'GPU status' }).waitFor();
  assert(await dash.locator('.engines').count() === 0, 'no engine switch with one engine');
  assert(await dash.locator('summary', { hasText: 'Add another AI engine' }).isVisible() && !(await dash.locator('input[name=claudeKey]').isVisible()), 'Claude waits, folded');
  await tab('Behaviour');
  const behaviour = await dashText();
  assert(behaviour.includes('Think before answering') && !behaviour.includes('Thinking effort'), 'the GPU thinks or does not');
  await admin.screenshot({ path: path.join(out, '01-gpu-only.png') });
});

await check('a Claude key stored in the backoffice: checked, encrypted, and only a hint comes back', async () => {
  await tab('Connection');
  await dash.locator('summary', { hasText: 'Add another AI engine' }).click();
  const field = dash.locator('input[name=claudeKey]');
  await field.fill('sk-ant-short');
  await dash.locator('button', { hasText: 'Save & test' }).last().click();
  await dash.locator('.control.invalid', { hasText: 'Anthropic API key' }).waitFor({ timeout: 10000 });
  await field.fill(MOCK_KEY);
  await dash.locator('button', { hasText: 'Save & test' }).last().click();
  await dash.locator('.notice.success', { hasText: 'Anthropic accepted' }).waitFor({ timeout: 15000 });
  await dash.locator('.engines').waitFor();
  const choice = await dash.locator('.engines').innerText();
  assert(/Ligata GPU[\s\S]*In use/.test(choice) && choice.includes('Claude API'), 'both offered, the GPU still in use (LigataAI:Mode): ' + choice.replace(/\s+/g, ' '));
  assert((await field.getAttribute('placeholder')).includes('sk-ant-moc…0000'), 'a hint of the stored key');
  assert(!backoffice.some(secret), 'the key never comes back to the backoffice');
  assert((await config()).settings.engine === 'gpu', 'adding a key does not switch the engine');
  await admin.screenshot({ path: path.join(out, '02-both.png') });
});

await check('Behaviour with both engines: the GPU switch, and Claude\'s effort one click away', async () => {
  await tab('Behaviour');
  assert(await dash.locator('label.switch', { hasText: 'Think before answering' }).isVisible(), 'the GPU switch for the engine in use');
  await dash.locator('summary', { hasText: 'When Claude answers' }).click();
  await dash.locator('.segmented[aria-label="Thinking effort"] button', { hasText: 'Extra high' }).click();
  assert((await dashText()).includes('Thinks much longer'), 'each level is explained');
  await saved();
});

await check('switching to Claude: visitors are asked again, naming Anthropic, and Claude answers at the chosen effort', async () => {
  await visitor.goto(base + '/');
  await widget.locator('.launcher').click();
  assert(!/Anthropic/.test(await widget.locator('.agree').innerText()), 'the GPU consent does not name Anthropic');
  await widget.locator('[data-agree]').click();
  const first = await ask(`Hello GPU ${run}`);
  assert(first.includes('development model'), 'the GPU answers first: ' + first);
  const requests = (await mockState()).requests;
  await tab('Connection');
  await dash.locator('.engines button', { hasText: 'Claude API' }).click();
  await dash.locator('.notice.success', { hasText: 'Claude API answers your visitors now' }).waitFor({ timeout: 15000 });
  assert(/Anthropic \(USA\)/.test(dialogs.at(-1)) && /asked again/.test(dialogs.at(-1)), 'the switch is confirmed first: ' + dialogs.at(-1));
  assert(/Claude API[\s\S]*In use/.test(await dash.locator('.engines').innerText()), 'Claude in use');
  const c = await config();
  assert(c.settings.engine === 'api' && c.settings.consent.version.startsWith('api.') && c.settings.consent.provider.kind === 'anthropic', 'public config: ' + JSON.stringify(c.settings.consent));
  await visitor.reload();
  // The chat remembers that it was open: it comes back open, asking again.
  await widget.locator('.launcher').waitFor();
  if (!(await widget.locator('.panel').isVisible())) await widget.locator('.launcher').click();
  await widget.locator('[data-agree]').waitFor({ timeout: 10000 });
  assert(/Anthropic/.test(await widget.locator('.agree').innerText()), 'the visitor is asked again, naming Anthropic');
  await widget.locator('[data-agree]').click();
  const reply = await ask(`Hello Claude ${run}`);
  assert(reply.includes('Claude mock answer'), 'Claude answers: ' + reply);
  const { last, requests: after, errors: rejected } = await mockState();
  assert(after > requests && rejected.length === 0, 'mock rejected: ' + rejected.join('; '));
  assert(last.output_config?.effort === 'xhigh' && last.thinking?.type === 'adaptive' && last.max_tokens >= 32_000, 'effort and room for thinking: ' + JSON.stringify({ effort: last.output_config, thinking: last.thinking, max: last.max_tokens }));
  await visitor.screenshot({ path: path.join(out, '03-claude-consent.png') });
});

await check('effort "Off": Claude answers without thinking', async () => {
  await tab('Behaviour');
  await dash.locator('.segmented[aria-label="Thinking effort"] button', { hasText: 'Off' }).click();
  await saved();
  const reply = await chat(`Quick one ${run}`);
  assert(reply.status === 200 && reply.answer.includes('Claude mock answer'), 'answer: ' + reply.body.slice(0, 200));
  const { last } = await mockState();
  assert(last.thinking?.type === 'disabled' && last.output_config?.effort === 'low' && last.max_tokens <= 4096, 'thinking off: ' + JSON.stringify({ thinking: last.thinking, effort: last.output_config, max: last.max_tokens }));
  await dash.locator('.segmented[aria-label="Thinking effort"] button', { hasText: 'Low' }).click();
  await saved();
});

await check('switching back to the GPU: Gemma answers and Claude is not asked', async () => {
  await tab('Connection');
  await dash.locator('.engines button', { hasText: 'Ligata GPU' }).click();
  await dash.locator('.notice.success', { hasText: 'Ligata GPU answers your visitors now' }).waitFor({ timeout: 15000 });
  const requests = (await mockState()).requests;
  const reply = await chat(`Back on the GPU ${run}`);
  assert(reply.status === 200 && reply.answer.includes('development model'), 'the GPU answers: ' + reply.body.slice(0, 200));
  assert((await mockState()).requests === requests, 'nothing went to Anthropic');
  assert((await config()).settings.consent.version.startsWith('gpu.'), 'the consent names the GPU again');
});

await check('removing Claude\'s key while Claude answers: the GPU takes over and the switch disappears', async () => {
  await dash.locator('.engines button', { hasText: 'Claude API' }).click();
  await dash.locator('.notice.success', { hasText: 'Claude API answers' }).waitFor({ timeout: 15000 });
  await dash.locator('section.card', { hasText: 'Anthropic API key' }).locator('button', { hasText: 'Remove key' }).click();
  await dash.locator('.notice.success', { hasText: 'Anthropic API key removed' }).waitFor({ timeout: 15000 });
  assert(/Ligata GPU answers instead/.test(dialogs.at(-1)), 'the editor is told what happens: ' + dialogs.at(-1));
  await dash.locator('.engines').waitFor({ state: 'detached' });
  assert((await config()).settings.engine === 'gpu', 'the GPU answers');
  await admin.screenshot({ path: path.join(out, '04-claude-removed.png') });
});

await check('nothing the browsers received contains the key, and no page errors', async () => {
  assert(!backoffice.some(secret), 'key leaked to the backoffice');
  assert(errors.length === 0, 'page errors: ' + errors.join(' | '));
});

await browser.close();
console.log(`\n${passed} passed, ${failed} failed. Screenshots in ${out}`);
process.exit(failed ? 1 : 0);
