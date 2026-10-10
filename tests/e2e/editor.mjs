// The content assistant in the backoffice (0.9): the chat finds, reads and changes content with tools; changes wait for the
// editor's approval or run by permission mode (Manual, Auto, Bypass); everything is logged and can be undone. Runs against the
// strict mock Anthropic API, which plays a scripted assistant ("do: tool {json}; tool {json} then: text"), so no key or money:
//   node tests/e2e/mock-anthropic.mjs &                                         → :1230
//   CONFIG_KEY=0 LigataAI__Mode=api LigataAI__Claude__ApiKey=sk-ant-mock-0000000000000000 LigataAI__Claude__BaseUrl=http://127.0.0.1:1230 \
//     LigataAI__ContentAssistant__CompactAtTokens=9000 LigataAI__ContentAssistant__Effort=low bash tests/e2e/restart-host.sh --clear-keys
//   cd tests/e2e && node editor.mjs
// The host seeds a fresh "Editor fixture" (en-US and de-CH, rich text, a Block List of cards) on every start.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_KEY } from './mock-anthropic.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', '..', '.runtime');
const out = path.join(runtime, 'e2e', 'editor');
mkdirSync(out, { recursive: true });
const base = process.env.HOST || 'http://127.0.0.1:5310';
const mock = process.env.MOCK || 'http://127.0.0.1:1230';
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS || path.join(runtime, 'ai-test-admin.json'), 'utf8'));
let passed = 0, failed = 0;
const errors = [];
async function check(name, fn) {
  const started = Date.now();
  try { await fn(); passed++; console.log(`✔ ${name} (${Date.now() - started} ms)`); }
  catch (error) {
    failed++; console.log(`✖ ${name}: ${error.message.split('\n')[0]}`);
    await page.screenshot({ path: path.join(out, `failed-${name.slice(0, 30).replace(/\W+/g, '-')}.png`) }).catch(() => { });
  }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const mockState = async () => (await fetch(mock + '/__state')).json();
const mockMode = mode => fetch(mock + '/__mode', { method: 'POST', body: JSON.stringify({ mode }) });

const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const dialogs = [];
page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
page.on('pageerror', e => errors.push(e.message));
const responses = [];
page.on('response', async r => { try { if (r.url().includes('/ligata-ai/') && /json|event-stream/.test(r.headers()['content-type'] || '')) responses.push(await r.text()); } catch { } });
const panel = page.locator('ligata-ai-editor-panel');

/** The panel's own authenticated request (same login as the backoffice). */
const api = (p, method = 'GET', body) => page.evaluate(([p, method, body]) => document.querySelector('ligata-ai-editor-panel').request(p, method, body), [p, method, body]);
/** A document as the Management API returns it (values per culture). */
const documentOf = key => page.evaluate(async key => {
  const auth = document.querySelector('ligata-ai-editor-panel').auth;
  const config = auth.getOpenApiConfiguration();
  const token = typeof config.token === 'function' ? await config.token() : await config.token;
  return (await fetch('/umbraco/management/api/v1/document/' + key, { headers: { Authorization: 'Bearer ' + token } })).json();
}, key);
const valueOf = (doc, alias, culture = null) => doc.values.find(v => v.alias === alias && (v.culture ?? null) === culture)?.value;
const settingsNow = async () => (await api('/settings')).settings;
async function saveSettings(change) {
  const data = await api('/settings');
  return api('/settings', 'POST', { settings: change(structuredClone(data.settings)), version: data.version });
}
const idle = () => page.waitForFunction(() => { const p = document.querySelector('ligata-ai-editor-panel'); return p && !p.busy; }, null, { timeout: 30000 });
/** Sends a message in the panel and waits until the assistant has finished (or waits for approval). */
async function send(text) {
  const before = await panel.locator('.log > *').count();
  await panel.locator('textarea').fill(text);
  await panel.locator('textarea').press('Enter');
  await page.waitForFunction(n => document.querySelector('ligata-ai-editor-panel').shadowRoot.querySelectorAll('.log > *').length > n, before, { timeout: 15000 });
  await page.waitForTimeout(150);
  await idle();
}
const cards = () => panel.locator('article.card');
const lastCard = () => cards().last();
async function useMode(mode) {
  await panel.locator('.chooser .pill').first().click();
  await panel.locator(`.menu button.mode-${mode}`).click();
  assert((await panel.locator('.chooser .pill').first().innerText()).toLowerCase().replace(/\s/g, '').includes(mode), 'mode pill shows ' + mode);
}
async function newChat() { await panel.locator('header button[aria-label="New conversation"]').click(); await panel.locator('.empty h3').waitFor({ timeout: 5000 }); }
const script = (steps, final = 'Done.') => 'do: ' + steps.join('; ') + ' then: ' + final;
const find = 'search_content {"query":"Editor fixture"}';
const read = 'read_content {"id":"$KEY","culture":"en-US"}';
let fixtureKey;

await mockMode('ok');
await page.goto(base + '/umbraco');
await page.locator('input[type=email], input[name=username]').first().fill(credentials.email);
await page.locator('input[type=password]').first().fill(credentials.password);
await page.keyboard.press('Enter');
await page.waitForURL(/section/, { timeout: 60000 });
await panel.locator('.launcher').waitFor({ timeout: 20000 });
// Every run starts from the defaults (administrators, Manual, drafts only), with publishing allowed for the checks below.
await saveSettings(s => ({ ...s, enabled: true, access: [{ group: 'admin', modes: ['manual', 'auto', 'bypass'] }], defaultMode: 'manual', actions: ['edit', 'create', 'publish', 'unpublish', 'move', 'delete', 'media'], autoApprove: ['edit', 'create', 'media'], askAfterChanges: 10, effortInChat: true, effort: 'medium', limits: { ...s.limits, messagesPerUser: 100, messagesPerDay: 500 }, scope: { roots: [], readOnlyTypes: [], protectedFields: [], cultures: [] } }));

await check('the bubble shows for administrators; the panel knows which page is open', async () => {
  await page.goto(base + '/umbraco/section/content');
  await page.locator('umb-tree-item', { hasText: 'Editor fixture' }).first().click();
  await page.waitForURL(/workspace\/document\/edit\/[0-9a-f-]{36}\/en-US/, { timeout: 20000 });
  fixtureKey = /edit\/([0-9a-f-]{36})/.exec(page.url())[1];
  if (!(await panel.locator('section.panel.open').count())) await panel.locator('.launcher').click();
  if (await panel.locator('.msg').count()) await newChat();
  await panel.locator('.composer .context', { hasText: 'Editor fixture' }).waitFor({ timeout: 10000 });
  const welcome = await panel.locator('.empty').innerText();
  assert(welcome.includes('Editor fixture') && welcome.includes('as drafts') === false && welcome.includes('Asks before every change'), 'welcome: ' + welcome);
  await page.screenshot({ path: path.join(out, '1-welcome.png') });
});

await check('the default effort from the configuration is used, and shown locked in the settings', async () => {
  const session = await api('/session'), meta = await api('/settings');
  assert(session.effort === 'low' && meta.effortFromConfig === 'low', `session ${session.effort}, configured ${meta.effortFromConfig} (run the host with LigataAI__ContentAssistant__Effort=low)`);
  assert((await panel.locator('.chooser .pill', { hasText: 'effort' }).innerText()).startsWith('Low'), 'the chat starts at Low');
});

await check('Manual mode: a change waits with before and after; declining leaves the page as it was', async () => {
  await send(script([find, read, 'update_content {"id":"$KEY","culture":"en-US","changes":[{"path":"title","value":"Declined title"}]}'], 'Changed it.'));
  assert((await mockState()).last.output_config.effort === 'low', 'the configured effort reaches Claude');
  const card = lastCard();
  assert(await card.evaluate(c => c.classList.contains('pending')), 'the change waits');
  const text = await card.innerText();
  assert(text.includes('Needs your approval') && text.includes('Welcome to the editor fixture') && text.includes('Declined title') && text.includes('Manual mode'), 'card: ' + text);
  assert(await panel.locator('.launcher .badge').count() === 0, 'the panel is open, so no badge');
  await page.screenshot({ path: path.join(out, '2-pending.png') });
  await card.locator('button', { hasText: 'Decline' }).click();
  await card.locator('input.note').fill('Keep the welcome');
  await card.locator('button', { hasText: 'Decline' }).click();
  await idle();
  assert((await lastCard().innerText()).includes('Declined') && (await panel.locator('.msg.ai').last().innerText()).includes('I left it as it was'), 'declined and the assistant knows');
  assert(valueOf(await documentOf(fixtureKey), 'title', 'en-US') === 'Welcome to the editor fixture', 'unchanged');
  const log = await api('/activity?kind=declined');
  assert(log.items[0]?.summary.includes('Title') && log.items[0].error === 'Keep the welcome' && log.items[0].userName, 'declined is logged with the note: ' + JSON.stringify(log.items[0]));
});

await check('Approve: saved as a draft, checked, the open editor shows it, logged as approved by hand', async () => {
  await send(script([find, read, 'update_content {"id":"$KEY","culture":"en-US","changes":[{"path":"title","value":"Hello from the assistant"},{"path":"body","value":"<p>Open <strong>every day</strong>.</p><script>steal()</script>"}]}'], 'Changed it.'));
  await lastCard().locator('button', { hasText: 'Approve' }).click();
  await idle();
  const text = await lastCard().innerText();
  assert(text.includes('Saved as draft') && text.includes('approved'), 'done card: ' + text);
  const doc = await documentOf(fixtureKey);
  assert(valueOf(doc, 'title', 'en-US') === 'Hello from the assistant' && valueOf(doc, 'title', 'de-CH') === 'Willkommen in der Redaktion', 'saved in en-US only');
  assert(JSON.stringify(valueOf(doc, 'body', 'en-US')).includes('every day') && !JSON.stringify(valueOf(doc, 'body', 'en-US')).includes('script'), 'rich text without the script');
  // The workspace reloads the page the assistant changed.
  const titleInput = page.locator('umb-property-layout', { hasText: 'Title' }).first().locator('input').first();
  for (let i = 0; i < 40 && await titleInput.inputValue().catch(() => '') !== 'Hello from the assistant'; i++) await page.waitForTimeout(250);
  assert(await titleInput.inputValue() === 'Hello from the assistant', 'the open editor reloaded: ' + await titleInput.inputValue().catch(e => e.message));
  const log = await api('/activity?kind=edit');
  const row = log.items.find(r => r.outcome === 'done');
  assert(row?.approval === 'manual' && row.request.includes('Hello from the assistant') && row.culture === 'en-US', 'logged: ' + JSON.stringify(row));
  await page.screenshot({ path: path.join(out, '3-approved.png') });
});

await check('Auto mode: drafts run without asking; publishing still asks', async () => {
  await useMode('auto');
  await send(script([find, 'update_content {"id":"$KEY","culture":"en-US","changes":[{"path":"intro","value":"Auto intro."}]}', 'publish_content {"id":"$KEY","cultures":["en-US"]}'], 'Published.'));
  const all = await cards().allInnerTexts();
  assert(all.at(-2).includes('Saved as draft') && all.at(-2).includes('auto'), 'the draft ran on its own: ' + all.at(-2));
  const waiting = await lastCard().innerText();
  assert(waiting.includes('Needs your approval') && waiting.includes('Publishing always asks in Auto mode') && waiting.includes('Auto intro.'), 'publish asks, showing what goes live: ' + waiting);
  await lastCard().locator('button', { hasText: 'Approve' }).click();
  await idle();
  assert((await lastCard().innerText()).includes('Published'), 'published');
  const doc = await documentOf(fixtureKey);
  const english = doc.variants.find(v => v.culture === 'en-US');
  assert(english.state.startsWith('Published') && Date.now() - new Date(english.publishDate).getTime() < 60000 && valueOf(doc, 'intro', 'en-US') === 'Auto intro.', 'live: ' + JSON.stringify(english));
});

await check('Auto mode asks again after the set number of changes for one message', async () => {
  await saveSettings(s => ({ ...s, askAfterChanges: 2 }));
  const change = n => `update_content {"id":"$KEY","culture":"en-US","changes":[{"path":"intro","value":"Intro ${n}"}]}`;
  await send(script([find, change(1), change(2), change(3)], 'Three changes.'));
  const waiting = await lastCard().innerText();
  assert(waiting.includes('Needs your approval') && waiting.includes('2 changes were made for this message without asking'), 'third asks: ' + waiting);
  await lastCard().locator('button', { hasText: 'Decline' }).click();
  await lastCard().locator('button', { hasText: 'Decline' }).click();
  await idle();
  assert(valueOf(await documentOf(fixtureKey), 'intro', 'en-US') === 'Intro 2', 'two ran, the third did not');
  await saveSettings(s => ({ ...s, askAfterChanges: 10 }));
});

await check('Auto mode asks before a risky change: removing a block shared by all languages', async () => {
  await send(script([find, read, 'edit_blocks {"id":"$KEY","culture":"en-US","path":"cards","operation":"remove","block":"$BLOCK"}'], 'Removed.'));
  const waiting = await lastCard().innerText();
  assert(waiting.includes('Needs your approval') && waiting.includes('Auto mode asks before risky changes') && waiting.includes('removes the “Card” block in every language'), 'risky asks: ' + waiting);
  await lastCard().locator('button', { hasText: 'Decline' }).click();
  await lastCard().locator('button', { hasText: 'Decline' }).click();
  await idle();
  assert(valueOf(await documentOf(fixtureKey), 'cards').contentData.length === 2, 'the block is still there');
});

await check('Bypass mode: allowed changes run without asking, publishing too', async () => {
  await useMode('bypass');
  await send(script([find, 'update_content {"id":"$KEY","culture":"en-US","changes":[{"path":"intro","value":"Bypass intro."}]}', 'publish_content {"id":"$KEY","cultures":["en-US"]}'], 'Live.'));
  const all = await cards().allInnerTexts();
  assert(all.at(-1).includes('Published') && all.at(-1).includes('bypass') && all.at(-2).includes('bypass') && !(await panel.locator('.card.pending').count()), 'nothing asked: ' + all.slice(-2).join(' | '));
  const log = await api('/activity?kind=publish');
  assert(log.items.some(r => r.approval === 'bypass') && log.items.some(r => r.approval === 'manual'), 'both publishes logged with their approval');
});

await check('the activity log records who steered each change, when, what changed and how it was approved', async () => {
  const log = (await api('/activity?take=200')).items;
  const row = (summary, approval, outcome, asked) => log.find(r => r.summary.includes(summary) && r.approval === approval && r.outcome === outcome && (!asked || r.request.includes(asked)));
  const rows = {
    declinedByHand: row('Change Title', 'manual', 'declined', 'Declined title'),
    approvedByHand: row('Change 2 fields', 'manual', 'done', 'Hello from the assistant'),
    auto: row('Change Introduction', 'auto', 'done', 'Auto intro.'),
    publishApproved: row('Publish', 'manual', 'done'),
    riskyDeclined: row('Remove the “Card” block', 'manual', 'declined'),
    bypass: row('Change Introduction', 'bypass', 'done', 'Bypass intro.'),
    publishBypass: row('Publish', 'bypass', 'done'),
  };
  const missing = Object.entries(rows).filter(([, r]) => !r).map(([k]) => k);
  assert(missing.length === 0, 'not logged: ' + missing.join(', '));
  for (const [name, r] of Object.entries(rows))
    assert(r.userName === 'Fixture Admin' && r.request.startsWith('do:') && Date.now() - new Date(r.created).getTime() < 15 * 60000 && r.documentName === 'Editor fixture' && r.culture === 'en-US' && r.documentKey === fixtureKey, `${name}: ` + JSON.stringify(r));
  const auto = await api('/activity/' + rows.auto.id);
  assert(auto.changes[0].label === 'Introduction' && auto.changes[0].afterText === 'Auto intro.' && auto.changes[0].beforeText === 'We build furniture that lasts.' && auto.changes[0].before == null, 'before and after (stored values stay on the server): ' + JSON.stringify(auto.changes));
  assert((await api('/activity/' + rows.declinedByHand.id)).action.error === 'Keep the welcome', 'the decline note is kept');
});

await check('Blocks: a card added in English shows in English only, inside the block field', async () => {
  await send(script([find, 'edit_blocks {"id":"$KEY","culture":"en-US","path":"cards","operation":"add","type":"editorCard","position":"start","values":{"title":"Repairs","text":"We fix old pieces."}}'], 'Added.'));
  assert((await lastCard().innerText()).includes('Add a “Card” block'), 'block card');
  const cardsValue = valueOf(await documentOf(fixtureKey), 'cards');
  const added = cardsValue.contentData.find(c => c.values.some(v => v.value === 'Repairs'));
  assert(added && cardsValue.layout['Umbraco.BlockList'][0].contentKey === added.key && cardsValue.expose.filter(e => e.contentKey === added.key).map(e => e.culture).join() === 'en-US', 'first, English only: ' + JSON.stringify(cardsValue.expose));
});

await check('Undo from the chat puts the values back', async () => {
  await useMode('auto');
  await send(script([find, 'update_content {"id":"$KEY","culture":"en-US","changes":[{"path":"intro","value":"To be undone."}]}'], 'Done.'));
  assert(valueOf(await documentOf(fixtureKey), 'intro', 'en-US') === 'To be undone.', 'changed');
  await lastCard().locator('button', { hasText: 'Undo' }).click();
  await lastCard().locator('.badge', { hasText: 'Undone' }).waitFor({ timeout: 10000 });
  assert(valueOf(await documentOf(fixtureKey), 'intro', 'en-US') === 'Bypass intro.', 'back to before');
});

await check('the model is only given the tools this site allows', async () => {
  await saveSettings(s => ({ ...s, actions: ['edit'], autoApprove: ['edit'] }));
  // A conversation that already published goes on (the tool stays declared, calling it is refused) …
  await send(script(['publish_content {"id":"' + fixtureKey + '","cultures":["en-US"]}'], 'Tried.'));
  assert((await panel.locator('.step.failed').last().innerText()).includes('Could not publish') && (await mockState()).last.tools.some(t => t.name === 'publish_content'), 'refused, still declared');
  // … and a new one is not offered what the site does not allow.
  await newChat();
  await send('Which tools do you have?');
  const tools = (await mockState()).last.tools.map(t => t.name);
  assert(tools.includes('read_content') && tools.includes('update_content') && !tools.includes('publish_content') && !tools.includes('create_content') && !tools.includes('upload_media'), 'tools: ' + tools);
  assert((await mockState()).last.system[0].text.includes('You cannot:') && (await mockState()).last.system[0].cache_control, 'the instructions say what it cannot do and are cached');
  await saveSettings(s => ({ ...s, actions: ['edit', 'create', 'publish', 'unpublish', 'move', 'delete', 'media'], autoApprove: ['edit', 'create', 'media'] }));
});

await check('Read only mode: only reading tools, nothing is changed, approving is refused', async () => {
  // A change prepared in Manual waits; then the editor switches to Read only.
  await newChat();
  await useMode('manual');
  await send(script([find, read, 'update_content {"id":"$KEY","culture":"en-US","changes":[{"path":"title","value":"Read only title"}]}'], 'Changed it.'));
  assert(await lastCard().evaluate(c => c.classList.contains('pending')), 'the change waits');
  await useMode('readonly');
  assert(await lastCard().locator('button', { hasText: 'Approve' }).isDisabled(), 'Approve is off in Read only');
  const chatId = await page.evaluate(() => document.querySelector('ligata-ai-editor-panel').chatId);
  const pendingId = await page.evaluate(() => document.querySelector('ligata-ai-editor-panel').items.filter(i => i.state === 'pending').at(-1).id);
  const refused = await api('/decide', 'POST', { chatId, decisions: [{ id: pendingId, approve: true }], mode: 'readonly' }).then(() => null, e => e);
  assert(refused && /read only/i.test(refused.message || String(refused)), 'approving in Read only is refused: ' + (refused?.message || refused));
  // Declining still works.
  await lastCard().locator('button', { hasText: 'Decline' }).click();
  await lastCard().locator('button', { hasText: 'Decline' }).click();
  await idle();
  assert((await lastCard().innerText()).includes('Declined'), 'declined in Read only');
  // A change tool the conversation used before stays declared (the API needs it for the history), and calling it is refused.
  await send(script([read, 'update_content {"id":"$KEY","culture":"en-US","changes":[{"path":"title","value":"Read only title"}]}'], 'I would change the title.'));
  const step = await panel.locator('.step.failed').last().innerText();
  assert(step.includes('Could not') && step.includes('read only'), 'refused step: ' + step);
  const last = (await mockState()).last;
  const said = JSON.stringify(last.messages.filter(m => m.role === 'user').slice(-3));
  assert(said.includes('Mode: Read only') && said.includes('Read only mode'), 'the model is told the mode and why: ' + said.slice(0, 300));
  assert(!last.tools.some(t => ['create_content', 'publish_content', 'upload_media'].includes(t.name)), 'no other change tools: ' + last.tools.map(t => t.name));
  assert(valueOf(await documentOf(fixtureKey), 'title', 'en-US') !== 'Read only title', 'nothing changed');
  // A new conversation in Read only gets only the tools that find and read.
  await newChat();
  assert((await panel.locator('.empty').innerText()).includes('nothing is changed'), 'the welcome says so');
  await send('Which tools do you have?');
  const tools = (await mockState()).last.tools.map(t => t.name);
  assert(tools.includes('search_content') && tools.includes('read_content') && tools.includes('open_page') && !tools.some(t => /update|create|publish|move|delete|upload|blocks/.test(t)), 'tools: ' + tools);
  await page.screenshot({ path: path.join(out, '3b-read-only.png') });
  await useMode('manual');
});

await check('Markdown tables in answers show as tables', async () => {
  const shown = await page.evaluate(async () => {
    const { markdown } = await import('/App_Plugins/LigataAI/editor/shared.js');
    const { render } = await import('@umbraco-cms/backoffice/external/lit');
    const div = document.createElement('div');
    render(markdown('Found it on two pages:\n\n| Page | Language |\n|---|---|\n| [Kontakt](umb://document/683b5c9a51f2492681c1ffb7b06b69b9) | de-CH |\n| Impressum | **en-US** |\n\nNothing was changed.'), div);
    return { head: [...div.querySelectorAll('th')].map(t => t.textContent.trim()), rows: div.querySelectorAll('tbody tr').length, first: div.querySelector('tbody td')?.textContent.trim(), bold: !!div.querySelector('td strong'), paragraphs: div.querySelectorAll('p').length, pipes: div.textContent.includes('|') };
  });
  assert(shown.head.join(',') === 'Page,Language' && shown.rows === 2 && shown.first === 'Kontakt' && shown.bold && shown.paragraphs === 2 && !shown.pipes, 'table: ' + JSON.stringify(shown));
});

await check('the effort chosen in the chat reaches Claude', async () => {
  await panel.locator('.chooser .pill', { hasText: 'effort' }).click();
  await panel.locator('.menu button', { hasText: 'High' }).click();
  await send('Think hard about this.');
  const last = (await mockState()).last;
  assert(last.output_config.effort === 'high' && last.thinking.type === 'adaptive', 'effort: ' + JSON.stringify(last.output_config));
  await panel.locator('.chooser .pill', { hasText: 'effort' }).click();
  await panel.locator('.menu button', { hasText: 'Medium' }).click();
});

await check('open_page takes the editor to the page', async () => {
  await send(script(['search_content {"query":"Team"}', 'open_page {"id":"$KEY","culture":"de-CH"}'], 'Here it is.'));
  await page.waitForURL(/edit\/[0-9a-f-]{36}\/de-CH/, { timeout: 10000 });
  assert(!page.url().includes(fixtureKey), 'another page: ' + page.url());
  await panel.locator('.composer .context', { hasText: 'de-CH' }).waitFor({ timeout: 5000 });
});

await check('an attached image is uploaded to the media library after approval', async () => {
  await useMode('manual');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GBgYGJAQoAAPoKAX0x0YQAAAAASUVORK5CYII=', 'base64');
  writeFileSync(path.join(out, 'pixel.png'), png);
  await panel.locator('input[type=file]').setInputFiles(path.join(out, 'pixel.png'));
  await panel.locator('.attachments .thumb').waitFor({ timeout: 5000 });
  await send(script(['upload_media {"attachment":1,"name":"Assistant test image"}'], 'Uploaded.'));
  assert((await mockState()).last.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image')), 'Claude sees the image');
  assert((await lastCard().innerText()).includes('Upload the image “Assistant test image”'), 'asks to upload');
  await lastCard().locator('button', { hasText: 'Approve' }).click();
  await idle();
  assert((await lastCard().innerText()).includes('Uploaded'), 'uploaded');
  const log = await api('/activity?kind=media');
  assert(log.items[0]?.documentName === 'Assistant test image' && log.items[0].outcome === 'done', 'logged');
});

await check('the activity log shows who steered it, what changed, and undoes', async () => {
  await page.goto(base + '/umbraco/section/ai-assistant/dashboard/content-assistant');
  const dash = page.locator('ligata-ai-editor-dashboard');
  await dash.locator('.entry').first().waitFor({ timeout: 20000 });
  const feed = await dash.locator('.feed').innerText();
  assert(feed.includes('Fixture Admin') && feed.includes('approved by hand') && feed.includes('auto mode') && feed.includes('bypass mode') && feed.includes('Declined'), 'feed: ' + feed.slice(0, 400));
  await dash.locator('.toolbar select').first().selectOption('edit');
  const entry = dash.locator('.entry', { hasText: 'Change 2 fields' }).filter({ hasText: 'approved by hand' }).first();
  await entry.waitFor({ timeout: 10000 });
  await entry.locator('button').first().click();
  await entry.locator('.detail .asked').waitFor({ timeout: 10000 });
  const detail = await entry.locator('.detail').innerText();
  assert(/fixture admin asked/i.test(detail) && detail.includes('Hello from the assistant') && detail.includes('Welcome to the editor fixture'), 'detail: ' + detail);
  await page.screenshot({ path: path.join(out, '4-activity.png') });
  await entry.locator('.detail button', { hasText: 'Undo' }).click();
  await dash.locator('.notice.success', { hasText: 'Undone' }).waitFor({ timeout: 10000 });
});

await check('settings: groups, modes, actions and limits are saved and validated', async () => {
  const dash = page.locator('ligata-ai-editor-dashboard');
  await dash.locator('nav.tabs button', { hasText: 'Settings' }).click();
  await dash.locator('h2', { hasText: 'Who can use it' }).waitFor();
  const text = await dash.locator('.workspace').innerText();
  assert(text.includes('Administrators') && text.includes('Auto approves') && text.includes('Read-only page and block types') && text.includes('Editorial guidelines') && text.includes("Set in the site's configuration"), 'settings page');
  await dash.locator('textarea').first().fill('Swiss spelling: ss instead of ß.');
  await dash.locator('button', { hasText: 'Save changes' }).click();
  await dash.locator('.notice.success', { hasText: 'Saved' }).waitFor({ timeout: 10000 });
  assert((await settingsNow()).guidelines === 'Swiss spelling: ss instead of ß.', 'saved');
  await page.screenshot({ path: path.join(out, '5-settings.png'), fullPage: true });
  const bad = await api('/settings', 'POST', { settings: { ...(await settingsNow()), limits: { ...(await settingsNow()).limits, maxSteps: 1 } }, version: (await api('/settings')).version }).catch(e => e);
  assert(bad instanceof Error || bad?.message, 'invalid settings refused');
  await dash.locator('nav.tabs button', { hasText: 'Usage' }).click();
  await dash.locator('.tile').first().waitFor();
  assert((await dash.locator('.tiles').innerText()).includes('messages'), 'usage');
});

await check('privacy note: the text for staff in the settings, a line and the full note in the chat', async () => {
  const dash = page.locator('ligata-ai-editor-dashboard');
  if (await panel.locator('section.panel.open').count()) await panel.locator('header button[aria-label="Close"]').click();
  await dash.locator('nav.tabs button', { hasText: 'Privacy' }).click();
  await dash.locator('pre.policy', { hasText: 'Datenschutzhinweis' }).waitFor({ timeout: 10000 });
  assert((await dash.locator('pre.policy').innerText()).includes('[Name und Anschrift') && await dash.locator('.notice.warning', { hasText: 'placeholder' }).count() === 1, 'placeholder until someone is named');
  await dash.locator('textarea').first().fill('Fixture Ltd, 1 Test Street, Zurich\nPrivacy questions: privacy@fixture.example');
  await dash.locator('label.switch', { hasText: 'not used to monitor staff' }).click();
  await dash.locator('button', { hasText: 'Update' }).click();
  await dash.locator('pre.policy', { hasText: 'Fixture Ltd' }).waitFor({ timeout: 10000 });
  await dash.locator('.segmented button', { hasText: 'English' }).click();
  await dash.locator('pre.policy', { hasText: 'Privacy notice' }).waitFor({ timeout: 10000 });
  const english = await dash.locator('pre.policy').innerText();
  assert(english.includes('Fixture Ltd') && english.includes('Anthropic') && english.includes('deleted 30 days after the last message') && english.includes('We do not use the activity log') && !english.includes('BetrVG'), 'English note: ' + english.slice(0, 300));
  await dash.locator('button', { hasText: 'Save changes' }).click();
  await dash.locator('.notice.success', { hasText: 'Saved' }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(out, '6-privacy-settings.png'), fullPage: true });
  // In the chat: a line under the suggestions, and the note (saved settings) in the editor's backoffice language.
  if (!(await panel.locator('section.panel.open').count())) await panel.locator('.launcher').click();
  const earlier = await page.evaluate(() => document.querySelector('ligata-ai-editor-panel').chatId);
  await newChat();
  assert((await panel.locator('.empty .fine').innerText()).includes('Anthropic (USA)'), 'the welcome says where messages go');
  await panel.locator('.empty .fine button.link').click();
  await panel.locator('.note h4').first().waitFor({ timeout: 10000 });
  const note = await panel.locator('.note').innerText();
  assert(note.includes('Fixture Ltd') && note.includes('Anthropic') && !note.includes('{{'), 'the note in the chat: ' + note.slice(0, 300));
  assert((await panel.locator('header strong').innerText()) === 'Privacy note', 'titled');
  await page.screenshot({ path: path.join(out, '6-privacy-chat.png') });
  await panel.locator('.note button', { hasText: 'Back to the chat' }).click();
  await panel.locator('.empty h3').waitFor({ timeout: 5000 });
  if (earlier) await page.evaluate(id => document.querySelector('ligata-ai-editor-panel').openChat(id), earlier);
  await saveSettings(s => ({ ...s, responsible: '', notForMonitoring: false }));
});

await check('conversations survive a reload and are listed', async () => {
  await page.reload();
  await panel.locator('section.panel.open .log .msg').first().waitFor({ timeout: 20000 });
  await panel.locator('header button[aria-label="Conversations"]').click();
  const list = await panel.locator('.list').innerText();
  assert(list.includes('do: search_content') || list.includes('Which tools'), 'listed: ' + list.slice(0, 200));
  await panel.locator('header button[aria-label="Conversations"]').click();
});

await check('long conversations are summarized', async () => {
  await newChat();
  const reads = Array.from({ length: 7 }, () => read);
  await send(script([find, ...reads], 'Read it a lot.'));
  await send('And now?');
  const s = await mockState();
  assert(s.summaries >= 1 && (await panel.locator('.notice', { hasText: 'summarized' }).count()) === 1, 'summarized: ' + s.summaries);
  assert(s.last.messages[0].content.some(b => b.type === 'text' && b.text.startsWith('Summary of the earlier part')), 'continues from the summary');
});

await check('Stop ends a slow answer; the conversation stays usable', async () => {
  await mockMode('slow');
  await panel.locator('textarea').fill('Write slowly.');
  await panel.locator('textarea').press('Enter');
  await panel.locator('button.send.stop').waitFor({ timeout: 5000 });
  await page.waitForTimeout(700);
  await panel.locator('button.send.stop').click();
  await idle();
  await mockMode('ok');
  await send('Still there?');
  assert((await panel.locator('.msg.ai').last().innerText()).includes('Claude mock editor answer'), 'answers again');
});

await check('the daily limit per person is enforced', async () => {
  const usage = await api('/usage?days=1');
  const today = usage.users[0]?.today || 0;
  await saveSettings(s => ({ ...s, limits: { ...s.limits, messagesPerUser: today } }));
  await panel.locator('textarea').fill('One more?');
  await panel.locator('textarea').press('Enter');
  await panel.locator('.problem', { hasText: 'messages for today' }).waitFor({ timeout: 10000 });
  await saveSettings(s => ({ ...s, limits: { ...s.limits, messagesPerUser: 100 } }));
});

await check('without access for their group the bubble is gone', async () => {
  await saveSettings(s => ({ ...s, access: [{ group: 'editor', modes: ['manual'] }] }));
  await page.reload();
  await page.waitForTimeout(3000);
  assert(await panel.locator('.launcher, section.panel').count() === 0, 'hidden');
  const session = await page.evaluate(() => document.querySelector('ligata-ai-editor-panel').session);
  assert(session.available === false && session.reason === 'forbidden', 'session: ' + JSON.stringify(session));
  await saveSettings(s => ({ ...s, access: [{ group: 'admin', modes: ['manual', 'auto', 'bypass'] }] }));
});

await check('the API key never reaches the browser', async () => {
  assert(!responses.some(r => r.includes(MOCK_KEY) || r.includes(MOCK_KEY.slice(0, 20))), 'key leaked');
  assert(errors.length === 0, 'page errors: ' + errors.join(' | '));
  const s = await mockState();
  assert(s.errors.length === 0, 'mock refused requests: ' + s.errors.slice(-3).join(' | '));
});

console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
