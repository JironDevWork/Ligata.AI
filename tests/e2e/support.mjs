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
  const token = options.captcha || 'pass-browser';
  await context.route('https://www.google.com/recaptcha/api.js*', route => route.fulfill({ contentType: 'text/javascript', body: `window.grecaptcha={ready:function(f){f()},execute:function(){return Promise.resolve("${token}-"+Date.now())}};` }));
  const page = await context.newPage();
  if (process.env.DEBUG_POLL) await page.addInitScript(() => { const f = window.fetch; let n = 0; window.fetch = function (url, o) { if (String(url).includes('/poll')) { n++; const body = JSON.parse(o.body); if (n > 1 && body.wait) console.log('CONCURRENT-POLL', n, JSON.stringify({ after: body.after, version: body.version }), new Error().stack.split(String.fromCharCode(10)).slice(1, 6).join(' | ')); return f.apply(this, arguments).finally(() => n--); } return f.apply(this, arguments); }; });
  page.on('console', m => { if (m.text().startsWith('CONCURRENT')) console.log('  ' + name + ' ' + m.text().slice(0, 600)); });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  if (process.env.DEBUG_POLL) { const t0 = Date.now(); page.on('request', r => { if (/poll|typing|messages/.test(r.url())) console.log(`  [${name} +${((Date.now() - t0) / 1000).toFixed(1)}s] -> ${r.url().split('/').slice(-1)[0]} ${(r.postData() || '').replace(/"token":"[^"]+"/, '').slice(0, 80)}`); }); page.on('response', async r => { if (/poll/.test(r.url())) { let b = ''; try { const j = await r.json(); b = `v=${j.version} seq=${j.conversation?.seq} ev=${(j.conversation?.events || []).map(e => e.kind).join(',')} typing=${(j.conversation?.typing || []).length}`; } catch {} console.log(`  [${name} +${((Date.now() - t0) / 1000).toFixed(1)}s] <- ${r.status()} ${b}`); } }); page.on('requestfailed', r => console.log(`  [${name}] FAILED ${r.url()} ${r.failure()?.errorText}`)); }
  page.on('dialog', d => d.accept());
  await page.goto(base + (options.path || '/'));
  const widget = page.locator('#ligata-ai');
  return { context, page, widget, shot: file => page.screenshot({ path: path.join(out, file + '.png') }) };
}
const openPanel = async v => { if (!(await v.widget.getAttribute('open') !== null)) await v.widget.locator('.launcher').click(); await v.widget.locator('.panel').waitFor(); };
// A new visitor agrees before the first question to the AI.
const agree = async v => { const button = v.widget.locator('.agree:not(.hidden) [data-agree]'); if (await button.count()) { await button.click(); await v.widget.locator('.agree').waitFor({ state: 'hidden' }); } };
const ask = async (v, text) => { await agree(v); await v.widget.locator('.composer textarea').fill(text); await v.widget.locator('.composer textarea').press('Enter'); };

export const state = {};
// Presence lasts 60 s after a team member's last heartbeat; the first checks need an offline team.
await until(async () => { try { return !(await (await fetch(base + '/api/ligata-ai/config')).json()).team?.online; } catch { return false; } }, 90, 'the team to be offline');

await check('AI answer that cannot help shows the handoff card, marker never visible', async () => {
  const v = state.visitor = await visitor('visitor');
  await openPanel(v);
  await ask(v, `Can I talk to a person about my order ${run}?`);
  await v.widget.locator('.card.handoff').waitFor({ timeout: 20000 });
  const answer = await v.widget.locator('.msg.bot').last().innerText();
  assert(!answer.includes('[[') && !answer.includes('team]]') && answer.trim().length > 10, 'marker stripped: ' + answer);
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

// ---------- the team member's side ----------
async function login() {
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`agent: ${e.message}`));
  page.on('dialog', d => d.accept());
  await page.goto(base + '/umbraco');
  await page.locator('input[type=email], input[name=username]').first().fill(credentials.email);
  await page.locator('input[type=password]').first().fill(credentials.password);
  await page.keyboard.press('Enter');
  await page.waitForURL(/section/, { timeout: 30000 });
  await page.waitForTimeout(2500); // let the content tree finish loading, like a person would (long polls never let the network idle)
  return { context, page, shot: file => page.screenshot({ path: path.join(out, file + '.png') }) };
}
const inbox = a => a.page.locator('ligata-ai-inbox');

await check('header badge counts the waiting request; the inbox lists it with the AI history', async () => {
  const a = state.agent = await login();
  const badge = a.page.locator('ligata-ai-header-app .badge');
  await badge.waitFor({ timeout: 30000 });
  assert(Number((await badge.innerText()).replace('+', '')) >= 1, 'badge shows waiting conversations');
  await a.page.locator('ligata-ai-header-app uui-button').click();
  await inbox(a).locator('h1', { hasText: 'Inbox' }).waitFor({ timeout: 20000 });
  await inbox(a).locator('input[type=search]').fill(run);
  const row = inbox(a).locator('.row-item', { hasText: run }).filter({ hasText: 'Vera Visitor' });
  await row.waitFor({ timeout: 15000 });
  assert(/Vera Visitor/.test(await row.innerText()) && await row.locator('.tag.wait').count() === 1, 'waiting row with the visitor name');
  await row.click();
  await inbox(a).locator('.divider', { hasText: 'AI assistant' }).waitFor();
  assert(await inbox(a).locator('.line.history').count() >= 2, 'AI conversation before the request is visible');
  await inbox(a).locator('.presence.on', { hasText: 'On the website now' }).waitFor({ timeout: 30000 });
  await a.shot('20-inbox-request');
});

await check('join: the visitor sees the team member by name, live', async () => {
  const a = state.agent, v = state.visitor;
  await inbox(a).locator('.gate button', { hasText: 'Join' }).click();
  await inbox(a).locator('.event', { hasText: 'joined' }).waitFor();
  await v.widget.locator('.event', { hasText: /Fixture Admin joined/ }).waitFor({ timeout: 30000 });
  await until(async () => (await v.widget.locator('.title-text').innerText()).includes('Fixture Admin'), 10, 'header shows the team member');
  assert(await v.widget.locator('.status-text').innerText() !== '', 'status line');
  const photo = v.widget.locator('.who-box img');
  await photo.waitFor({ timeout: 10000 });
  assert(/\/api\/ligata-ai\/agents\/[0-9a-f-]+\/avatar\?v=/.test(await photo.getAttribute('src')), 'photo served by the public avatar endpoint');
  await until(() => photo.evaluate(i => i.complete && i.naturalWidth > 0), 10, 'the profile picture to load');
});

await check('typing indicators and messages both ways, live', async () => {
  const a = state.agent, v = state.visitor;
  const box = inbox(a).locator('.composer textarea');
  await box.click();
  await box.pressSequentially('Hi Vera, thanks for wait', { delay: 20 });
  await v.widget.locator('.typing-row', { hasText: 'Fixture Admin' }).waitFor({ timeout: 20000 });
  await v.shot('07-agent-typing');
  await box.pressSequentially(`ing! Let me check order ${run}.`, { delay: 5 });
  await box.press('Enter');
  const agentMessage = v.widget.locator('.msg.agent', { hasText: `order ${run}` });
  await agentMessage.waitFor({ timeout: 20000 });
  assert(/Fixture Admin/.test(await agentMessage.innerText()), 'agent name next to the message');
  await v.widget.locator('.typing-row').waitFor({ state: 'detached', timeout: 10000 });
  await v.widget.locator('.composer textarea').pressSequentially('Thank you so much', { delay: 25 });
  await inbox(a).locator('.typing', { hasText: 'is typing' }).waitFor({ timeout: 20000 });
  await v.widget.locator('.composer textarea').press('Enter');
  await inbox(a).locator('.line.visitor .bubble', { hasText: 'Thank you so much' }).waitFor({ timeout: 20000 });
  await v.widget.locator('.msg.user.pending').waitFor({ state: 'detached', timeout: 10000 });
  await v.shot('08-live-chat');
  await a.shot('21-inbox-live');
});

await check('internal notes stay internal; display choice changes what the visitor sees', async () => {
  const a = state.agent, v = state.visitor;
  await inbox(a).locator('.composer .modes button', { hasText: 'Internal note' }).click();
  await inbox(a).locator('.composer textarea').fill(`VIP customer ${run}`);
  await inbox(a).locator('.composer button.primary', { hasText: 'Add note' }).click();
  await inbox(a).locator('.note', { hasText: 'VIP customer' }).waitFor();
  await inbox(a).locator('button', { hasText: 'How I appear' }).click();
  await inbox(a).locator('dialog .mode-card', { hasText: 'Anonymous' }).click();
  await inbox(a).locator('dialog .mode-card[aria-pressed=true]', { hasText: 'Anonymous' }).waitFor();
  await a.shot('22-profile');
  await inbox(a).locator('dialog button', { hasText: 'Done' }).click();
  await inbox(a).locator('.composer .modes button', { hasText: 'Reply' }).click();
  await inbox(a).locator('.composer textarea').fill('This message comes from the team, anonymously.');
  await inbox(a).locator('.composer textarea').press('Enter');
  const anonymous = v.widget.locator('.msg.agent', { hasText: 'anonymously' });
  await anonymous.waitFor({ timeout: 20000 });
  if (await anonymous.count() > 1) { console.log('DEBUG duplicate:', JSON.stringify(await v.page.evaluate(() => [...document.querySelector('#ligata-ai').shadowRoot.querySelectorAll('.msg.agent')].map(n => n.className + ' | ' + n.innerText.replace(/s+/g, ' ')))), JSON.stringify(await v.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('ligata-ai:v2:' + location.host)); return s.conversations.map(c => ({ id: c.id, team: c.team && c.team.id, seq: c.team && c.team.seq, msgs: c.messages.filter(m => m.role === 'agent').map(m => m.seq + ':' + m.content.slice(0, 20)) })); }))); }
  const visible = await v.widget.locator('.log').innerText();
  assert(!visible.includes('VIP customer'), 'note never reaches the visitor');
  assert(/Ligata Support/.test(await anonymous.innerText()) && !/Fixture Admin/.test(await anonymous.innerText()), 'anonymous message shows the team name');
  await inbox(a).locator('button', { hasText: 'How I appear' }).click();
  await inbox(a).locator('dialog .mode-card', { hasText: 'Name and photo' }).click();
  await inbox(a).locator('dialog .mode-card[aria-pressed=true]', { hasText: 'Name and photo' }).waitFor();
  await inbox(a).locator('dialog button', { hasText: 'Done' }).click();
});

await check('the conversation survives a page reload and stays live', async () => {
  const a = state.agent, v = state.visitor;
  await v.page.reload();
  await v.widget.locator('.msg.agent', { hasText: 'anonymously' }).waitFor({ timeout: 15000 });
  await inbox(a).locator('.composer textarea').fill('Still there after the reload?');
  await inbox(a).locator('.composer textarea').press('Enter');
  await v.widget.locator('.msg.agent', { hasText: 'after the reload' }).waitFor({ timeout: 20000 });
});

await check('a reply while the chat is closed: unread badge and teaser on the bubble', async () => {
  const a = state.agent, v = state.visitor;
  await v.widget.locator('[data-action=close]').click();
  await inbox(a).locator('.composer textarea').fill('Your order ships tomorrow.');
  await inbox(a).locator('.composer textarea').press('Enter');
  await v.widget.locator('.teaser.agent', { hasText: 'ships tomorrow' }).waitFor({ timeout: 20000 });
  assert(await v.widget.getAttribute('unread') !== null, 'unread badge');
  await v.shot('09-teaser');
  await v.widget.locator('.teaser.agent').click();
  await v.widget.locator('.msg.agent', { hasText: 'ships tomorrow' }).waitFor();
});

await check('leave and close: the visitor sees both and can start over', async () => {
  const a = state.agent, v = state.visitor;
  await inbox(a).locator('.thread-head button', { hasText: 'Leave' }).click();
  await v.widget.locator('.event', { hasText: /Fixture Admin left/ }).waitFor({ timeout: 20000 });
  await inbox(a).locator('.thread-head button', { hasText: 'Close' }).click();
  await v.widget.locator('.closed-bar:not(.hidden)').waitFor({ timeout: 20000 });
  await v.widget.locator('.event', { hasText: /closed/ }).waitFor();
  await v.shot('10-closed');
  await inbox(a).locator('.composer .gate button', { hasText: 'Reopen' }).waitFor();
});

await check('reopen shows live on the website (the closed chat on screen is watched), closing again too', async () => {
  const a = state.agent, v = state.visitor;
  await inbox(a).locator('.thread-head button', { hasText: 'Reopen' }).click();
  await v.widget.locator('.event', { hasText: /reopened/ }).waitFor({ timeout: 20000 });
  await v.widget.locator('.closed-bar').waitFor({ state: 'hidden' });
  await inbox(a).locator('.thread-head button', { hasText: 'Close' }).waitFor();
  await v.widget.locator('.composer textarea').fill(`Back again ${run}`);
  await v.widget.locator('.composer textarea').press('Enter');
  await inbox(a).locator('.line.visitor .bubble', { hasText: `Back again ${run}` }).waitFor({ timeout: 20000 });
  await inbox(a).locator('.thread-head button', { hasText: 'Close' }).click();
  await v.widget.locator('.closed-bar:not(.hidden)').waitFor({ timeout: 20000 });
  await inbox(a).locator('.composer .gate button', { hasText: 'Reopen' }).waitFor();
});

await check('phone: second visitor sees the team online, a failed spam check can be retried, the visitor ends the chat', async () => {
  const a = state.agent;
  const v = await visitor('phone', { viewport: { width: 390, height: 760 }, captcha: 'bot' });
  await v.widget.locator('.launcher').click();
  await v.widget.locator('[data-action=team]').click();
  const sheet = v.widget.locator('.sheet');
  await sheet.waitFor();
  assert(await sheet.locator('input[name=email]').getAttribute('required') === null, 'email optional while the team is online');
  assert(/online/i.test(await sheet.locator('.sub').innerText()), 'online status in the form');
  await sheet.locator('textarea[name=message]').fill(`Phone question ${run}`);
  await sheet.locator('input[name=consent]').check();
  await sheet.locator('[type=submit]').click();
  await sheet.locator('.sheet-error.on', { hasText: /spam/i }).waitFor({ timeout: 15000 });
  await v.page.waitForTimeout(300);
  await v.shot('11-phone-captcha-failed');
  await v.page.evaluate(() => { window.grecaptcha.execute = () => Promise.resolve('pass-retry'); });
  await sheet.locator('[type=submit]').click();
  await v.widget.locator('.event.note', { hasText: /join you/i }).waitFor({ timeout: 15000 });
  assert(await v.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal scrolling on a phone');
  const box = await v.widget.locator('.panel').boundingBox();
  assert(box.width >= 388 && box.height >= 700, 'full-screen panel on a phone');
  await v.shot('12-phone-waiting');
  await v.widget.locator('[data-action=list]').click();
  await v.widget.locator('.list .item', { hasText: 'Phone question' }).locator('[data-remove-conversation]').click();
  await inbox(a).locator('.views button', { hasText: 'Closed' }).click();
  await inbox(a).locator('input[type=search]').fill(`Phone question ${run}`);
  await inbox(a).locator('.row-item', { hasText: 'Phone question' }).click();
  await inbox(a).locator('.event', { hasText: 'The visitor ended the chat' }).waitFor({ timeout: 15000 });
  await v.context.close();
});

await check('email requests are answered by email from the inbox', async () => {
  const a = state.agent;
  await inbox(a).locator('.views button', { hasText: 'All open' }).click();
  await inbox(a).locator('input[type=search]').fill('emil@example.test');
  const row = inbox(a).locator('.row-item', { hasText: 'emil@example.test' }).first();
  await row.waitFor({ timeout: 15000 });
  await row.click();
  await inbox(a).locator('.composer .modes button[aria-pressed=true]', { hasText: 'Email' }).waitFor();
  await inbox(a).locator('.composer textarea').fill(`Hallo, wir rufen morgen an. ${run}-reply`);
  await inbox(a).locator('.composer button.primary', { hasText: 'Send email' }).click();
  await inbox(a).locator('.line.agent.email').waitFor();
  await until(() => readdirSync(mail).some(f => { const t = readFileSync(path.join(mail, f), 'utf8'); return t.includes(`${run}-reply`) && /To: emil@example.test/i.test(t) && /Subject: Re: /.test(t); }), 30, 'reply email');
  await a.shot('23-email-reply');
});

await check('settings: Team & email tab, features, display choice, test email', async () => {
  const a = state.agent;
  await a.page.goto(base + '/umbraco/section/ai-assistant/dashboard/settings');
  const dash = a.page.locator('ligata-ai-dashboard');
  await dash.locator('nav.tabs button', { hasText: 'Team & email' }).click();
  await dash.locator('h2', { hasText: 'Live chat' }).waitFor({ timeout: 20000 });
  assert(await dash.locator('.feature.on').count() === 3, 'three features on');
  await dash.locator('.swatch.display', { hasText: 'Nickname' }).click();
  await dash.locator('button', { hasText: 'Save changes' }).click();
  await dash.locator('.notice.success').waitFor();
  await dash.locator('button', { hasText: 'Send a test email' }).click();
  await dash.locator('.notice.success', { hasText: 'Test email sent' }).waitFor({ timeout: 30000 });
  await a.shot('24-settings-team');
  await dash.locator('.swatch.display', { hasText: 'Name and photo' }).click();
  await dash.locator('button', { hasText: 'Save changes' }).click();
  await dash.locator('.notice.success', { hasText: 'Saved' }).waitFor();
  await dash.locator('nav.tabs button', { hasText: 'Overview' }).click();
  await dash.locator('.team-card').waitFor();
  await a.shot('25-overview');
});

await check('no script errors', async () => { assert(!errors.length, errors.join(' | ')); });

console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${out}`);
if (!process.env.KEEP) await browser.close();
process.exit(failed ? 1 : 0);
