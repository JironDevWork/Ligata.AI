// The history of AI conversations (0.7.2), in Microsoft Edge (headless): switched on in the backoffice, stated in the consent request
// (no checkbox; every visitor agrees again when the period changes), kept with the answer and the lookups, read and kept (for a reason)
// by the team, deleted by the visitor, by objecting ("Stop keeping", which carries over to a new period) and by withdrawing consent.
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
assert(!before.history, 'the suite expects the history to be off at the start');

const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });

// ---------- backoffice ----------
const office = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const admin = await office.newPage();
admin.on('pageerror', e => errors.push('backoffice: ' + e.message));
admin.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Complaint about an invoice' : undefined));
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

/** Deletes every conversation in the history (a run that stopped half-way leaves some behind), once the list has loaded. */
async function clearHistory() {
  await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/conversations');
  const empty = historyPage.locator('h2', { hasText: 'No conversations are kept' });
  const remove = historyPage.locator('button:has-text("Delete all"):enabled');
  await empty.or(remove).first().waitFor({ timeout: 20000 });
  // Reloading before the deletion has finished would cancel it.
  if (await remove.count()) { await Promise.all([admin.waitForResponse(r => r.url().includes('/history/delete-all')), remove.click()]); await admin.reload(); }
  await empty.waitFor({ timeout: 20000 });
}

await check('editors switch the history on: the consent request states the period, so every visitor agrees again', async () => {
  await clearHistory();
  await admin.screenshot({ path: path.join(out, '01-history-off.png') });
  const card = await setHistory(true, 14);
  const text = await card.innerText();
  assert(/told the period in the consent request/.test(text) && /object at any time/.test(text) && /Art\. 6\(1\)\(f\)/.test(text), 'the editor learns how visitors are told, the objection and the legal basis: ' + text);
  assert(/Saving asks every visitor to agree again/.test(text) && /Update your privacy policy/.test(text), 'and that saving asks everyone again and the policy needs updating');
  await admin.screenshot({ path: path.join(out, '02-privacy-history-card.png') });
  await save();
  const after = await config();
  assert(after.history?.days === 14 && after.history.version === '14.' + before.consent.version.split('.')[1], 'the widget learns the period and its version: ' + JSON.stringify(after.history));
  assert(after.consent.version === before.consent.version + '.h14', 'the consent version names the period: ' + after.consent.version);
  const policy = dash.locator('pre.policy');
  await dash.locator('.segmented button', { hasText: 'Deutsch' }).click();
  await policy.filter({ hasText: 'Ihr Widerspruchsrecht' }).waitFor({ timeout: 10000 });
  assert(!/gesonderte Einwilligung/.test(await policy.innerText()), 'no separate consent in the privacy text any more');
});

// ---------- visitors ----------
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
async function newConversation(x) {
  await x.widget.locator('[data-action="list"]').click();
  await x.widget.locator('[data-action="new"]').first().click();
}
async function agree(v) {
  const card = v.widget.locator('.agree');
  await card.locator('[data-agree]').click();
  await card.waitFor({ state: 'hidden' });
}
async function listed(text) {
  await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/conversations');
  await historyPage.locator('.bar, h2').first().waitFor({ timeout: 20000 });
  await admin.waitForTimeout(300);
  return historyPage.locator('.row-item', { hasText: text }).count();
}
const chats = v => v.posts.filter(p => p.url.endsWith('/api/ligata-ai/chat')).map(p => JSON.parse(p.body));

const v = await visitor();
await check('the consent request states the period and the right to object, without a checkbox; questions, answers and lookups are kept', async () => {
  await v.widget.locator('.launcher').click();
  const card = v.widget.locator('.agree');
  await card.waitFor();
  const text = await card.innerText();
  assert(await card.locator('input[type=checkbox]').count() === 0, 'no checkbox');
  assert(/keeps your conversations with the assistant for 14 days after the last message/.test(text) && /object at any time under Conversations/.test(text), 'what, how long, and the objection: ' + text);
  assert(await card.locator('p.object').count() === 1, 'the objection stands apart from the rest');
  assert(/kept for 14 days|keeps your conversations for 14 days/.test(await v.widget.locator('.privacy-text').innerText()), 'the notice under the request says so too: ' + await v.widget.locator('.privacy-text').innerText());
  await v.page.waitForTimeout(600); // the panel slides in
  await v.page.screenshot({ path: path.join(out, '03-consent-with-history.png') });
  await agree(v);
  assert(/(Your conversations are kept|keeps your conversations) for 14 days/.test(await v.widget.locator('.privacy-text').innerText()), 'notice under the input: ' + await v.widget.locator('.privacy-text').innerText());
  await askAndWait(v, 'What is your phone number?');
  await askAndWait(v, 'And your opening hours?');
  const body = chats(v)[0];
  assert(/^[A-Za-z0-9_-]{32}$/.test(body.history) && body.turn && body.language === 'en', 'questions carry the conversation key, the question id and the language');
  await listed('What is your phone number?');
  const item = historyPage.locator('.row-item', { hasText: 'What is your phone number?' });
  assert(/2 questions/.test(await item.innerText()), 'two questions in one conversation: ' + await item.innerText());
  await item.click();
  const thread = historyPage.locator('.messages');
  await thread.locator('.line.ai').first().waitFor();
  const shown = await thread.innerText();
  assert(shown.includes('What is your phone number?') && shown.includes('And your opening hours?'), 'both questions are shown');
  assert(await thread.locator('.lookup').count() >= 1, 'what the AI looked up is shown: ' + shown.slice(0, 400));
  await admin.screenshot({ path: path.join(out, '04-conversation.png') });
});

await check('the team keeps a conversation for a reason and a limited time', async () => {
  await historyPage.locator('.thread-head button', { hasText: 'Keep' }).click();
  await historyPage.locator('.thread-head button', { hasText: 'Kept' }).waitFor();
  await historyPage.locator('.views button', { hasText: 'Kept' }).click();
  await historyPage.locator('.row-item', { hasText: 'What is your phone number?' }).waitFor();
  assert(/Kept until .*: Complaint about an invoice/.test(await historyPage.locator('.details').innerText()), 'the details say until when and why: ' + await historyPage.locator('.details').innerText());
});

await check('deleting a conversation in the chat deletes the copy on the server, even a kept one', async () => {
  await v.widget.locator('[data-action="list"]').click();
  const remove = v.widget.locator('[data-remove-conversation]').first();
  assert(await remove.getAttribute('title') === 'Delete conversation', 'the chat says it deletes: ' + await remove.getAttribute('title'));
  await remove.click();
  await v.widget.locator('[data-remove-conversation]').waitFor({ state: 'detached' });
  await v.page.waitForTimeout(800);
  assert(v.posts.some(p => p.url.endsWith('/api/ligata-ai/history/delete')), 'the deletion is sent');
  assert(await listed('What is your phone number?') === 0, 'gone from the history');
  assert(await v.page.evaluate(() => !localStorage.getItem('ligata-ai:forget:' + location.host)), 'nothing left to retry');
});

await check('objecting (“Stop keeping”) deletes what was kept, also conversations no longer in the list; the AI keeps working', async () => {
  await v.widget.locator('[data-action="new"]').first().click();
  await askAndWait(v, 'Kept before objecting: hosting?');
  // The conversation leaves the list (as after the inactivity period), its key stays.
  await v.page.evaluate(() => { const key = 'ligata-ai:v2:' + location.host; const data = JSON.parse(localStorage.getItem(key)); data.conversations = []; localStorage.setItem(key, JSON.stringify(data)); });
  await v.page.reload();
  await v.widget.locator('.launcher').waitFor({ state: 'attached' });
  await v.page.evaluate(() => window.LigataAI.open());
  assert(await listed('Kept before objecting: hosting?') === 1, 'kept');
  await v.widget.locator('[data-action="list"]').click();
  await v.widget.locator('[data-keep-history="stop"]').click();
  await v.widget.locator('[data-keep-history="start"]').waitFor();
  await v.page.waitForTimeout(800);
  assert(await listed('Kept before objecting: hosting?') === 0, 'deleted on the server');
  await v.widget.locator('[data-action="new"]').first().click();
  await askAndWait(v, 'After objecting: still answered?');
  assert(await listed('After objecting: still answered?') === 0, 'answered, not kept');
});

const w = await visitor();
await check('another period asks every visitor again before the next question; an objection carries over', async () => {
  await w.widget.locator('.launcher').click();
  await w.widget.locator('.agree').waitFor();
  await agree(w);
  await askAndWait(w, 'Asked under 14 days?');
  assert(await listed('Asked under 14 days?') === 1, 'kept under the first period');
  await setHistory(true, 21);
  assert(/the new period/.test(await dash.locator('section.card', { has: admin.locator('h2', { hasText: 'Conversation history' }) }).innerText()), 'the editor is told that visitors are asked again');
  await save();
  assert((await config()).consent.version === before.consent.version + '.h21', 'the version names the new period');
  // The page is still open with the old period: the server refuses the old consent and the chat asks again.
  await w.widget.locator('.composer textarea').fill('Asked after the change?');
  await w.widget.locator('.composer textarea').press('Enter');
  const card = w.widget.locator('.agree');
  await card.waitFor({ timeout: 15000 });
  assert(/for 21 days/.test(await card.innerText()) && /has changed/.test(await card.locator('.agree-error').innerText()), 'the new period, and why it asks again: ' + await card.innerText());
  await w.page.waitForTimeout(500); // the card rises in
  await w.page.screenshot({ path: path.join(out, '05-asked-again.png') });
  assert(await listed('Asked after the change?') === 0, 'nothing kept, nothing answered with the old consent');
  await agree(w);
  await newConversation(w); // the list shows a conversation by its first question
  await askAndWait(w, 'Asked after agreeing to 21 days?');
  assert(await listed('Asked after agreeing to 21 days?') === 1, 'kept again once the visitor agreed to the new period');
  await w.page.reload();
  await w.page.evaluate(() => window.LigataAI.open());
  await w.widget.locator('.composer textarea').waitFor();
  assert(await w.widget.locator('.agree').isHidden(), 'agreed once per period, not on every page');
  // The visitor who objected: a new page, the new period; the request says nothing is kept for them.
  await v.page.reload();
  await v.page.evaluate(() => window.LigataAI.open());
  const asked = v.widget.locator('.agree');
  await asked.waitFor();
  assert(/are not kept/.test(await asked.innerText()) && await asked.locator('p.object').count() === 0, 'the objection is remembered: ' + await asked.innerText());
  await agree(v);
  await newConversation(v);
  await askAndWait(v, 'Objected, then the period changed?');
  assert(await listed('Objected, then the period changed?') === 0, 'still not kept');
  assert(chats(v).at(-1).history === undefined, 'no conversation key is sent');
});

await check('withdrawing consent deletes the visitor’s kept conversations on the server', async () => {
  await v.widget.locator('[data-action="list"]').click();
  await v.widget.locator('[data-keep-history="start"]').click();
  await v.widget.locator('[data-keep-history="stop"]').waitFor();
  await v.widget.locator('[data-action="new"]').first().click();
  await askAndWait(v, 'Do you build websites?');
  assert(await listed('Do you build websites?') === 1, 'kept after taking the objection back');
  await v.widget.locator('[data-action="list"]').click();
  await v.widget.locator('[data-withdraw-consent]').click();
  await v.page.waitForTimeout(800);
  assert(await listed('Do you build websites?') === 0, 'gone after the withdrawal');
});

await check('switching the history off asks nobody again and keeps nothing new', async () => {
  await setHistory(false);
  await save();
  const after = await config();
  assert(after.history === null && after.consent.version === before.consent.version, 'history off: ' + JSON.stringify(after.history) + ' ' + after.consent.version);
  await w.page.reload();
  await w.page.evaluate(() => window.LigataAI.open());
  await w.widget.locator('.composer textarea').waitFor();
  assert(await w.widget.locator('.agree').isHidden(), 'the consent given with the history still covers the assistant');
  await newConversation(w);
  await askAndWait(w, 'History off: still answered?');
  assert(chats(w).at(-1).history === undefined && await listed('History off: still answered?') === 0, 'answered, not kept');
  await clearHistory();
});

await v.context.close();
await w.context.close();
await office.close();
await browser.close();
if (errors.length) { console.log('Page errors:\n' + [...new Set(errors)].join('\n')); failed++; }
console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${out}`);
process.exit(failed ? 1 : 0);
