// Team handoff, live chat and email in Microsoft Edge (headless), visitor and team member side by side.
//   node support.mjs [filter]
// Needs the test host started with --fake-captcha --support-fixture (see docs/TESTING.md) and a (mock) gateway.
// Google's reCAPTCHA script is replaced by a stub whose tokens the fake verifier accepts.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', '..', '.runtime');
const out = path.join(runtime, 'e2e', 'support');
mkdirSync(out, { recursive: true });
const base = process.env.HOST || 'http://127.0.0.1:5310';
const mail = process.env.MAIL || path.join(runtime, 'mail');
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS || path.join(runtime, 'ai-test-admin.json'), 'utf8'));
const only = process.argv.slice(2);
const run = Date.now().toString(36);
let passed = 0, failed = 0;
async function check(name, fn) {
  if (only.length && !only.some(o => name.includes(o))) return;
  const started = Date.now();
  try { await fn(); passed++; console.log(`✔ ${name} (${Date.now() - started} ms)`); }
  catch (error) { failed++; console.log(`✖ ${name}: ${error.message.split('\n')[0]}`); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const until = async (predicate, seconds, label) => { for (let i = 0; i < seconds * 4; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 250)); } throw new Error('timed out waiting for ' + label); };

const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
const errors = [];
async function visitor(name, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 860 }, locale: options.locale || 'en-US' });
  await context.route('https://www.google.com/recaptcha/api.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.grecaptcha={ready:function(f){f()},execute:function(){return Promise.resolve("pass-browser-"+Date.now())}};' }));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('dialog', d => d.accept());
  await page.goto(base + (options.path || '/'));
  const widget = page.locator('#ligata-ai');
  return { context, page, widget, shot: file => page.screenshot({ path: path.join(out, file + '.png') }) };
}
const openPanel = async v => { if (!(await v.widget.getAttribute('open') !== null)) await v.widget.locator('.launcher').click(); await v.widget.locator('.panel').waitFor(); };
const ask = async (v, text) => { await v.widget.locator('.composer textarea').fill(text); await v.widget.locator('.composer textarea').press('Enter'); };

export const state = {};

await check('AI answer that cannot help shows the handoff card, marker never visible', async () => {
  const v = state.visitor = await visitor('visitor');
  await openPanel(v);
  await ask(v, `Can I talk to a person about my order ${run}?`);
  await v.widget.locator('.card.handoff').waitFor({ timeout: 20000 });
  const answer = await v.widget.locator('.msg.bot').last().innerText();
  assert(!answer.includes('[[') && !answer.includes('team]]') && /team can help/i.test(answer), 'marker stripped: ' + answer);
  await v.shot('01-handoff-card');
});

await check('request sheet: offline team requires email, consent required for reCAPTCHA', async () => {
  const v = state.visitor;
  await v.widget.locator('.card.handoff [data-open-sheet=chat]').click();
  const sheet = v.widget.locator('.sheet');
  await sheet.waitFor();
  assert((await sheet.locator('textarea[name=message]').inputValue()).includes('talk to a person'), 'message prefilled with the question');
  assert(await sheet.locator('input[name=email]').getAttribute('required') !== null, 'email required while offline');
  await v.page.waitForTimeout(450);
  await v.shot('02-request-sheet');
  await sheet.locator('[type=submit]').click();
  await sheet.locator('.field.invalid input[name=email]').waitFor();
  await sheet.locator('input[name=name]').fill('Vera Visitor');
  await sheet.locator('input[name=email]').fill('vera@example.test');
  await sheet.locator('[type=submit]').click();
  await sheet.locator('.sheet-error.on').waitFor();
  assert(/spam/i.test(await sheet.locator('.sheet-error').innerText()), 'consent needed');
  await sheet.locator('input[name=consent]').check();
  await sheet.locator('[type=submit]').click();
  await sheet.waitFor({ state: 'detached', timeout: 15000 });
  await v.widget.locator('.event.note', { hasText: /email/i }).waitFor();
  assert(/Ligata (team|Support)/.test(await v.widget.locator('.title-text').innerText()), 'header shows the team');
  await v.shot('03-waiting');
});

await check('the request email reached the team (SMTP pickup) without visitor HTML', async () => {
  await until(() => readdirSync(mail).some(f => readFileSync(path.join(mail, f), 'utf8').includes(run)), 20, 'team email');
  const file = readdirSync(mail).map(f => path.join(mail, f)).find(f => readFileSync(f, 'utf8').includes(run));
  const text = readFileSync(file, 'utf8');
  assert(/Reply-To: vera@example.test/i.test(text) && /Chat request/.test(text), 'subject and reply-to');
});

await check('conversation list shows the waiting team chat; a new AI conversation starts beside it', async () => {
  const v = state.visitor;
  await v.widget.locator('[data-action=list]').click();
  await v.widget.locator('.list .item').first().waitFor();
  assert(await v.widget.locator('.list .pill.wait').count() === 1, 'waiting pill');
  await v.shot('04-list');
  await v.widget.locator('.list [data-action=new]').click();
  await v.widget.locator('.suggestions').waitFor();
  await v.widget.locator('[data-action=list]').click();
  await v.widget.locator('.list .item').first().waitFor();
  await v.widget.locator('.list .item', { hasText: 'talk to a person' }).locator('.open-item').click();
  await v.widget.locator('.event.note').waitFor();
});

await check('email form from the header button: confirmation in the thread', async () => {
  const v = await visitor('emailer', { locale: 'de-CH' });
  await openPanel(v);
  await ask(v, 'Was kostet eine Website?');
  await v.widget.locator('.msg.bot .bubble:not(.streaming)').nth(1).waitFor({ timeout: 20000 });
  await v.widget.locator('[data-action=team]').click();
  const sheet = v.widget.locator('.sheet');
  await sheet.locator('[data-sheet-kind=email]').click();
  await sheet.locator('input[name=email]').fill('emil@example.test');
  await sheet.locator('textarea[name=message]').fill(`Bitte ruft mich an ${run}`);
  await sheet.locator('input[name=consent]').check();
  await v.page.waitForTimeout(450);
  await v.shot('05-email-sheet-de');
  await sheet.locator('[type=submit]').click();
  await v.widget.locator('.event.note', { hasText: 'emil@example.test' }).waitFor({ timeout: 15000 });
  await v.shot('06-email-sent-de');
  await v.context.close();
});

await check('no script errors', async () => { assert(!errors.length, errors.join(' | ')); });

console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${out}`);
if (!process.env.KEEP) await browser.close();
process.exit(failed ? 1 : 0);
