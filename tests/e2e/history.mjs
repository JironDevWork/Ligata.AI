// The history of AI conversations (0.7), in Microsoft Edge (headless): switched on in the backoffice, announced to visitors,
// kept with the answer and the lookups, read and kept by the team, deleted by the visitor and by withdrawing consent.
//   node history.mjs
// Needs the test host with --support-fixture and the mock gateway (it looks things up for questions about a phone number),
// see docs/TESTING.md. The suite switches the history off again at the end.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', '..', '.runtime');
const out = path.join(runtime, 'e2e', 'history');
mkdirSync(out, { recursive: true });
const base = process.env.HOST || 'http://127.0.0.1:5310';
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS || path.join(runtime, 'ai-test-admin.json'), 'utf8'));
let passed = 0, failed = 0;
const errors = [];
async function check(name, fn) {
  const started = Date.now();
  try { await fn(); passed++; console.log(`✔ ${name} (${Date.now() - started} ms)`); }
  catch (error) { failed++; console.log(`✖ ${name}: ${error.message.split('\n')[0]}`); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const config = async () => (await (await fetch(base + '/api/ligata-ai/config')).json()).settings;
const before = await config();
assert(before.consent, 'the suite expects consent in the chat (the default)');

const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });

// ---------- backoffice ----------
const office = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const admin = await office.newPage();
admin.on('pageerror', e => errors.push('backoffice: ' + e.message));
admin.on('dialog', d => d.accept());
await admin.goto(base + '/umbraco');
await admin.locator('input[type=email], input[name=username]').first().fill(credentials.email);
await admin.locator('input[type=password]').first().fill(credentials.password);
await admin.keyboard.press('Enter');
await admin.waitForURL(/section/, { timeout: 30000 });
const dash = admin.locator('ligata-ai-dashboard');
const historyPage = admin.locator('ligata-ai-history');

/** Switches the history on or off in Settings → Privacy (opened from the address) and saves. */
async function setHistory(on, days) {
  await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/settings?tab=privacy');
  const card = dash.locator('section.card', { has: admin.locator('h2', { hasText: 'Conversation history' }) });
  await card.waitFor({ timeout: 20000 });
  const toggle = card.locator('label.switch input');
  if (await toggle.isChecked() !== on) await toggle.click();
  if (on && days) await card.locator('input[type=number]').fill(String(days));
  return card;
}
async function save() {
  await dash.locator('button', { hasText: 'Save changes' }).click();
  await dash.locator('.notice.success', { hasText: 'Saved' }).waitFor();
}

await check('editors switch the history on in the privacy settings, and visitors are asked again', async () => {
  await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/conversations');
  await historyPage.locator('h2', { hasText: 'No conversations are kept' }).waitFor({ timeout: 20000 });
  await admin.screenshot({ path: path.join(out, '01-history-off.png') });
  const card = await setHistory(true, 14);
  assert(/asked for consent again/.test(await card.innerText()), 'the editor learns that visitors are asked again');
  assert(/Update your privacy policy/.test(await card.innerText()), 'and that the privacy policy needs updating');
  await admin.screenshot({ path: path.join(out, '02-privacy-history-card.png') });
  await save();
  const after = await config();
  assert(after.history?.days === 14, 'the widget learns the period: ' + JSON.stringify(after.history));
  assert(after.consent.version !== before.consent.version, 'a new consent version');
  const policy = dash.locator('pre.policy');
  await dash.locator('.segmented button', { hasText: 'Deutsch' }).click();
  await policy.filter({ hasText: '14 Tage nach der letzten Nachricht' }).waitFor({ timeout: 10000 });
});

// ---------- visitor ----------
async function visitor() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const posts = [];
  page.on('request', r => { if (r.method() === 'POST') posts.push({ url: r.url(), body: r.postData() }); });
  await page.goto(base + '/');
  const widget = page.locator('#ligata-ai');
  return { context, page, widget, posts };
}
async function askAndWait(v, text) {
  const count = await v.widget.locator('.msg.bot').count();
  await v.widget.locator('.composer textarea').fill(text);
  await v.widget.locator('.composer textarea').press('Enter');
  await v.widget.locator('.msg.bot').nth(count).waitFor({ timeout: 30000 });
  await v.widget.locator('.bubble.streaming').waitFor({ state: 'detached', timeout: 30000 });
}
const v = await visitor();

await check('the consent request and the notice under the input say how long conversations are kept', async () => {
  await v.widget.locator('.launcher').click();
  const card = v.widget.locator('.agree');
  await card.waitFor();
  assert(/keeps your conversations with the assistant for 14 days/.test(await card.innerText()), 'the consent request mentions the history: ' + await card.innerText());
  await v.page.waitForTimeout(600); // the panel slides in
  await v.page.screenshot({ path: path.join(out, '03-consent-with-history.png') });
  await card.locator('[data-agree]').click();
  await card.waitFor({ state: 'hidden' });
  assert(/(Conversations are kept|keeps conversations) for 14 days/.test(await v.widget.locator('.privacy-text').innerText()), 'notice under the input: ' + await v.widget.locator('.privacy-text').innerText());
});

await check('a question and its answer reach the history, with what the AI looked up', async () => {
  await askAndWait(v, 'What is your phone number?');
  await askAndWait(v, 'And your opening hours?');
  const chat = v.posts.find(p => p.url.endsWith('/api/ligata-ai/chat'));
  const body = JSON.parse(chat.body);
  assert(/^[A-Za-z0-9_-]{32}$/.test(body.history) && body.turn && body.language === 'en', 'questions carry the conversation key, the question id and the language');
  await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/conversations');
  const item = historyPage.locator('.row-item', { hasText: 'What is your phone number?' });
  await item.waitFor({ timeout: 20000 });
  assert(/2 questions/.test(await item.innerText()), 'two questions in one conversation: ' + await item.innerText());
  await item.click();
  const thread = historyPage.locator('.messages');
  await thread.locator('.line.ai').first().waitFor();
  const text = await thread.innerText();
  assert(text.includes('What is your phone number?') && text.includes('And your opening hours?'), 'both questions are shown');
  assert(await thread.locator('.lookup').count() >= 1, 'what the AI looked up is shown: ' + text.slice(0, 400));
  await admin.screenshot({ path: path.join(out, '04-conversation.png') });
});

await check('the team keeps a conversation beyond the history period', async () => {
  await historyPage.locator('.thread-head button', { hasText: 'Keep' }).click();
  await historyPage.locator('.thread-head button', { hasText: 'Kept' }).waitFor();
  await historyPage.locator('.views button', { hasText: 'Kept' }).click();
  await historyPage.locator('.row-item', { hasText: 'What is your phone number?' }).waitFor();
  assert(/Kept until you delete it/.test(await historyPage.locator('.details').innerText()), 'the details say it is kept');
});

await check('deleting a conversation in the chat deletes the copy on the server, even a kept one', async () => {
  await v.widget.locator('[data-action="list"]').click();
  const remove = v.widget.locator('[data-remove-conversation]').first();
  assert(await remove.getAttribute('title') === 'Delete conversation', 'the chat says it deletes: ' + await remove.getAttribute('title'));
  await remove.click();
  await v.widget.locator('[data-remove-conversation]').waitFor({ state: 'detached' });
  await v.page.waitForTimeout(800);
  assert(v.posts.some(p => p.url.endsWith('/api/ligata-ai/history/delete')), 'the deletion is sent');
  await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/conversations');
  await historyPage.locator('.bar').waitFor({ timeout: 20000 });
  assert(await historyPage.locator('.row-item', { hasText: 'What is your phone number?' }).count() === 0, 'gone from the history');
  assert(await v.page.evaluate(() => !localStorage.getItem('ligata-ai:forget:' + location.host)), 'nothing left to retry');
});

await check('withdrawing consent deletes the visitor’s conversations on the server', async () => {
  await v.widget.locator('[data-action="new"]').first().click();
  await askAndWait(v, 'Do you build websites?');
  await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/conversations');
  await historyPage.locator('.row-item', { hasText: 'Do you build websites?' }).waitFor({ timeout: 20000 });
  await v.widget.locator('[data-action="list"]').click();
  await v.widget.locator('[data-withdraw-consent]').click();
  await v.page.waitForTimeout(800);
  await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/conversations');
  await historyPage.locator('.bar').waitFor({ timeout: 20000 });
  assert(await historyPage.locator('.row-item', { hasText: 'Do you build websites?' }).count() === 0, 'gone after the withdrawal');
});

await check('switching the history off keeps nothing new and restores the earlier consent version', async () => {
  await setHistory(false);
  await save();
  const after = await config();
  assert(after.history === null && after.consent.version === before.consent.version, 'history off: ' + JSON.stringify(after.history) + ' ' + after.consent.version);
  await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/conversations');
  await historyPage.locator('h2', { hasText: 'No conversations are kept' }).waitFor({ timeout: 20000 });
});

await v.context.close();
await office.close();
await browser.close();
if (errors.length) { console.log('Page errors:\n' + [...new Set(errors)].join('\n')); failed++; }
console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${out}`);
process.exit(failed ? 1 : 0);
