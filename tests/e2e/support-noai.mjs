// Live chat and email without the AI (LigataAI:Features:Assistant=false), in Microsoft Edge (headless).
//   bash restart-host.sh --LigataAI:Features:Assistant=false && node support-noai.mjs
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', '..', '.runtime');
const out = path.join(runtime, 'e2e', 'support');
mkdirSync(out, { recursive: true });
const base = process.env.HOST || 'http://127.0.0.1:5310';
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS || path.join(runtime, 'ai-test-admin.json'), 'utf8'));
const run = Date.now().toString(36);
let passed = 0, failed = 0;
const errors = [];
async function check(name, fn) {
  const started = Date.now();
  try { await fn(); passed++; console.log(`✔ ${name} (${Date.now() - started} ms)`); }
  catch (error) { failed++; console.log(`✖ ${name}: ${error.message.split('\n')[0]}`); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await context.route('https://www.google.com/recaptcha/api.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.grecaptcha={ready:function(f){f()},execute:function(){return Promise.resolve("pass-noai")}};' }));
const page = await context.newPage();
page.on('pageerror', e => errors.push(e.message));
const widget = page.locator('#ligata-ai');

await check('the public API has no AI: chat answers 503 disabled', async () => {
  const config = await (await fetch(base + '/api/ligata-ai/config')).json();
  assert(config.state === 'ready' && config.settings.features.assistant === false && config.settings.features.liveChat, 'config without AI');
  const chat = await fetch(base + '/api/ligata-ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
  assert(chat.status === 503 && (await chat.json()).error.code === 'disabled', 'chat refused');
});

await check('the bubble opens a contact home: chat with the team or email, no AI parts', async () => {
  await page.goto(base + '/');
  await widget.locator('.launcher').click();
  await widget.locator('.home .option[data-open-sheet=chat]').waitFor();
  assert(await widget.locator('.home .option[data-open-sheet=email]').count() === 1, 'email option');
  assert(await widget.locator('.composer-form').isHidden() && await widget.locator('.meter').isHidden(), 'no AI composer or memory meter');
  assert(/Chat by Ligata/.test(await widget.locator('.brand').innerText()), 'branding without "AI"');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, '30-noai-home.png') });
});

await check('starting a chat from the home: request, then a live team thread', async () => {
  await widget.locator('.home .option[data-open-sheet=chat]').click();
  const sheet = widget.locator('.sheet');
  await sheet.waitFor();
  assert(await sheet.locator('textarea[name=message]').inputValue() === '', 'no prefilled AI question');
  await sheet.locator('input[name=email]').fill('nora@example.test');
  await sheet.locator('textarea[name=message]').fill(`Do you build online shops? ${run}`);
  await sheet.locator('input[name=consent]').check();
  await sheet.locator('[type=submit]').click();
  await widget.locator('.event.note').waitFor({ timeout: 15000 });
  assert(await widget.locator('.composer-form').isVisible(), 'composer for the team');
  assert(await widget.locator('.msg.user', { hasText: 'online shops' }).count() === 1, 'request shown once');
  await page.screenshot({ path: path.join(out, '31-noai-chat.png') });
});

await check('backoffice: "Support" section without Knowledge and Connection', async () => {
  const admin = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  admin.on('pageerror', e => errors.push('admin: ' + e.message));
  await admin.goto(base + '/umbraco');
  await admin.locator('input[type=email], input[name=username]').first().fill(credentials.email);
  await admin.locator('input[type=password]').first().fill(credentials.password);
  await admin.keyboard.press('Enter');
  await admin.waitForURL(/section/, { timeout: 30000 });
  await admin.waitForTimeout(2500);
  assert(await admin.getByText('Support', { exact: true }).first().isVisible(), 'section called Support');
  await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/settings');
  const dash = admin.locator('ligata-ai-dashboard');
  await dash.locator('h1', { hasText: 'Website chat' }).waitFor({ timeout: 20000 });
  const tabs = await dash.locator('nav.tabs').innerText();
  assert(!tabs.includes('Knowledge') && !tabs.includes('Connection') && tabs.includes('Team & email'), 'tabs: ' + tabs.replace(/\s+/g, ' '));
  await dash.locator('nav.tabs button', { hasText: 'Team & email' }).click();
  await dash.locator('.feature', { hasText: 'AI answers' }).locator('small', { hasText: 'Not included' }).waitFor();
  await admin.screenshot({ path: path.join(out, '32-noai-settings.png') });
});

await check('no script errors', async () => { assert(!errors.length, errors.join(' | ')); });
console.log(`\n${passed} passed, ${failed} failed.`);
await browser.close();
process.exit(failed ? 1 : 0);
