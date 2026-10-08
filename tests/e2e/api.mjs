// API mode (LigataAI:Mode = api): Claude through Anthropic, called from the website's own server.
// Runs against the strict mock Anthropic API, so no key or money is needed:
//   node mock-anthropic.mjs &
//   CONFIG_KEY=0 LigataAI__Mode=api LigataAI__Claude__ApiKey=sk-ant-mock-0000000000000000 LigataAI__Claude__BaseUrl=http://127.0.0.1:1230 bash restart-host.sh
//   node api.mjs
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_KEY } from './mock-anthropic.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', '..', '.runtime');
const out = path.join(runtime, 'e2e', 'api');
mkdirSync(out, { recursive: true });
const base = process.env.HOST || 'http://127.0.0.1:5310';
const mock = process.env.MOCK || 'http://127.0.0.1:1230';
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS || path.join(runtime, 'ai-test-admin.json'), 'utf8'));
const run = Date.now().toString(36);
let passed = 0, failed = 0;
const errors = [];
async function check(name, fn) {
  const started = Date.now();
  try { await fn(); passed++; console.log(`✔ ${name} (${Date.now() - started} ms)`); }
  catch (error) {
    failed++; console.log(`✖ ${name}: ${error.message.split('\n')[0]}`);
    for (const [label, p] of Object.entries(pages)) await p.screenshot({ path: path.join(out, `failed-${label}-${name.slice(0, 24).replace(/\W+/g, '-')}.png`) }).catch(() => { });
  }
}
const pages = {};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const mockState = async () => (await fetch(mock + '/__state')).json();
const mockMode = (mode, extra = {}) => fetch(mock + '/__mode', { method: 'POST', body: JSON.stringify({ mode, ...extra }) });
const secret = text => text.includes(MOCK_KEY) || text.includes(MOCK_KEY.slice(0, 20));

/** Same hand-built one-page PDF as the package checks. */
function fixturePdf(text) {
  const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** A recorded consent, as the chat's "Agree" button creates it. */
let consentId = null;
async function consent() {
  if (consentId) return consentId;
  const config = await (await fetch(base + '/api/ligata-ai/config')).json();
  const response = await fetch(base + '/api/ligata-ai/consent', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ version: config.settings.consent.version, source: 'chat', language: 'en' }) });
  return consentId = (await response.json()).id;
}

/** Reads one answer from the public chat endpoint as server-sent events. */
async function chat(messages) {
  const response = await fetch(base + '/api/ligata-ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ messages, pageTitle: 'Home', pagePath: '/', consent: await consent() }) });
  const text = await response.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map(m => ({ name: m[1], data: JSON.parse(m[2]) }));
  return { status: response.status, text, events, done: events.find(e => e.name === 'done')?.data, answer: events.filter(e => e.name === 'delta').map(e => e.data.text).join('') };
}

const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
page.on('pageerror', e => errors.push(e.message));
const seen = [];
page.on('response', async r => { try { const type = r.headers()['content-type'] || ''; if (/json|javascript|html|event-stream/.test(type)) seen.push(await r.text()); } catch { } });
const widget = page.locator('#ligata-ai');
const ask = async text => { await widget.locator('.composer textarea').fill(text); await widget.locator('.composer textarea').press('Enter'); };
/** Asks and returns the new answer once it has finished streaming. */
const answer = async text => {
  const before = await widget.locator('.msg.bot').count();
  await ask(text);
  await widget.locator('.msg.bot').nth(before).waitFor({ timeout: 20000 });
  await widget.locator('.bubble.streaming').waitFor({ state: 'detached', timeout: 20000 });
  return widget.locator('.msg.bot').nth(before).innerText();
};
await mockMode('ok', { errors: [] });
pages.site = page;

await check('public config: API mode is ready, names Claude, and never contains the key', async () => {
  const config = await (await fetch(base + '/api/ligata-ai/config')).json();
  assert(config.state === 'ready' && config.settings.engine === 'api', 'ready in API mode: ' + config.state);
  assert(config.settings.privacyNotice === '', 'the untouched notice is left to the widget, which names Claude in the visitor\'s language');
  assert(config.settings.limits.imageTokens === 1600, 'Claude image cost published for the memory meter');
  const html = await (await fetch(base + '/')).text();
  assert(!secret(JSON.stringify(config)) && !secret(html) && !html.includes('sk-ant'), 'no key in config or page');
});

await check('a visitor gets a streamed answer from Claude with the real prompt size', async () => {
  await page.goto(base + '/');
  await widget.locator('.launcher').click();
  assert(/Anthropic/.test(await widget.locator('.agree').innerText()), 'the consent request names Anthropic');
  await widget.locator('[data-agree]').click();
  const reply = await answer(`What does hosting cost? ${run}`);
  assert(reply.includes('Claude mock answer') && reply.includes('hosting'), 'answer: ' + reply);
  assert(/AI by Ligata/.test(await widget.locator('.brand').innerText()) && !/Private/.test(await widget.locator('.brand').innerText()), 'branding without "Private"');
  assert(/Claude/.test(await widget.locator('.privacy-text').innerText()), 'privacy notice names Claude');
  const meter = await widget.locator('.meter-text').innerText();
  assert(/\d/.test(meter), 'memory meter: ' + meter);
  await page.screenshot({ path: path.join(out, '01-api-answer.png') });
});

await check('the request to Anthropic: cached prefix, low effort, no sampling parameters, pseudonymous user', async () => {
  const { last, errors: rejected } = await mockState();
  assert(rejected.length === 0, 'mock rejected: ' + rejected.join('; '));
  assert(last.model === 'claude-haiku-5-5' && last.stream === true && last.output_config?.effort === 'low', 'model, streaming, effort');
  assert(!('temperature' in last) && !('top_p' in last) && !('thinking' in last), 'no sampling or thinking budget');
  assert(last.system.length === 2 && last.system[0].cache_control?.type === 'ephemeral' && !last.system[1].cache_control, 'breakpoint after the shared prefix');
  assert(last.system[0].text.includes('# Knowledge') || last.system[0].text.includes('You are'), 'guardrails (and knowledge) are in the cached block');
  assert(last.system[1].text.startsWith('# Current situation') && !last.system[0].text.includes('Current situation'), 'date and page come after the breakpoint');
  assert(/^[a-f0-9]{16,64}$/.test(last.metadata?.user_id || ''), 'metadata.user_id is the pseudonymous visitor id');
  assert(last.max_tokens > 1024, 'room for thinking on top of the answer limit');
});

await check('follow-up questions read the shared prefix from the cache', async () => {
  const first = await chat([{ role: 'user', content: `First ${run}` }]);
  const second = await chat([{ role: 'user', content: `First ${run}` }, { role: 'assistant', content: first.answer }, { role: 'user', content: 'And a follow-up?' }]);
  assert(first.status === 200 && second.status === 200, 'answers: ' + first.status + ' ' + second.status + ' ' + second.text.slice(0, 200));
  assert(second.done?.usage.cachedTokens > 0, 'cached tokens on the follow-up: ' + JSON.stringify(second.done?.usage));
  assert(second.events[0].name === 'started' && second.events[0].data.promptTokens > 0, 'started event with prompt size');
});

await check('unknown answers offer the team; the marker never shows', async () => {
  const reply = await answer('Can I talk to a human about this?');
  await widget.locator('.card.handoff').waitFor({ timeout: 10000 });
  assert(!reply.includes('[[') && !reply.includes('team]]'), 'marker stripped: ' + reply);
});

await check('a screenshot and a PDF reach Claude as image and document blocks', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(path.join(out, 'pixel.png'), png);
  writeFileSync(path.join(out, 'offer.pdf'), fixturePdf(`Offer ${run} valid until December`));
  await widget.locator('input[type=file]').setInputFiles([path.join(out, 'pixel.png'), path.join(out, 'offer.pdf')]);
  await widget.locator('.pending .file').nth(1).waitFor();
  await page.waitForFunction(() => !document.querySelector('#ligata-ai').shadowRoot.querySelector('.pending .file.busy'), null, { timeout: 15000 }).catch(() => { });
  const reply = await answer('What is in these files?');
  assert(reply.includes('1 image') && reply.includes('offer.pdf'), 'answer mentions both: ' + reply);
  const { last } = await mockState();
  const blocks = last.messages.at(-1).content;
  const image = blocks.find(b => b.type === 'image'), document = blocks.find(b => b.type === 'document');
  assert(image?.source.media_type === 'image/jpeg', 'screenshot as JPEG image block');
  assert(document?.source.media_type === 'text/plain' && document.source.data.includes(`Offer ${run}`), 'PDF read on this server and sent as text');
  await page.screenshot({ path: path.join(out, '02-api-attachments.png') });
});

await check('Claude overloaded: a clear "busy" message and a working retry', async () => {
  await mockMode('overloaded');
  await ask('Are you there?');
  await widget.locator('.notice.error', { hasText: /busy|asking/i }).waitFor({ timeout: 20000 });
  await mockMode('ok');
  const before = await widget.locator('.msg.bot').count();
  await widget.locator('.notice.error [data-retry]').click();
  await widget.locator('.msg.bot').nth(before).waitFor({ timeout: 20000 });
  await widget.locator('.bubble.streaming').waitFor({ state: 'detached', timeout: 20000 });
  assert((await widget.locator('.msg.bot').nth(before).innerText()).includes('Claude mock answer'), 'retry answered');
});

await check('a declined request is explained without a pointless retry', async () => {
  await ask('refuse-me please');
  await widget.locator('.notice.error', { hasText: /can’t help/ }).waitFor({ timeout: 20000 });
  assert(await widget.locator('.notice.error [data-retry]').count() === 0, 'no retry for a refusal');
});

await check('thinking that uses up the token limit is explained, with a retry', async () => {
  const exhausted = await chat([{ role: 'user', content: 'think-forever' }]);
  assert(exhausted.events.at(-1)?.name === 'error' && exhausted.events.at(-1).data.code === 'thinking_limit', 'thinking_limit error: ' + exhausted.text.slice(0, 300));
  await ask('think-forever please');
  await widget.locator('.notice.error', { hasText: /thought for too long/ }).waitFor({ timeout: 20000 });
  assert(await widget.locator('.notice.error [data-retry]').count() === 1, 'the visitor can try again');
});

const admin = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
admin.on('pageerror', e => errors.push('admin: ' + e.message));
const backoffice = [];
admin.on('response', async r => { try { if (/json/.test(r.headers()['content-type'] || '')) backoffice.push(await r.text()); } catch { } });
pages.admin = admin;
const dash = admin.locator('ligata-ai-dashboard');
const dashText = () => dash.locator('.workspace').first().innerText();
const tab = name => dash.locator('nav.tabs button', { hasText: name }).click();

await check('backoffice: the Connection tab shows Claude, with no key field and no part of the key', async () => {
  await admin.goto(base + '/umbraco');
  await admin.locator('input[type=email], input[name=username]').first().fill(credentials.email);
  await admin.locator('input[type=password]').first().fill(credentials.password);
  await admin.keyboard.press('Enter');
  await admin.waitForURL(/section/, { timeout: 30000 });
  await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/settings');
  await dash.locator('h1').first().waitFor({ timeout: 20000 });
  await tab('Connection');
  await dash.locator('h2', { hasText: 'Claude API' }).waitFor();
  assert(await dash.locator('input[type=password]').count() === 0 && await dash.locator('input[type=url]').count() === 0, 'no gateway fields');
  const card = await dash.locator('section.card', { hasText: 'Claude API' }).first().innerText();
  assert(card.includes('Claude Haiku 5.5') && card.includes('Configured'), 'model and key state: ' + card.replace(/\s+/g, ' ').slice(0, 200));
  await dash.locator('button', { hasText: 'Test connection' }).click();
  await dash.locator('.notice.success', { hasText: 'Anthropic accepted' }).waitFor({ timeout: 15000 });
  await dash.locator('dt', { hasText: 'Answers right now' }).waitFor();
  await admin.screenshot({ path: path.join(out, '03-connection.png') });
  assert(!backoffice.some(secret), 'the key never reaches the backoffice');
});

await check('backoffice: overview, behaviour and appearance speak Claude, not GPU', async () => {
  await tab('Overview');
  await dash.locator('h2', { hasText: 'Claude API' }).waitFor();
  const overview = await dashText();
  assert(overview.includes('Add your Anthropic API key') && !overview.includes('Shared AI server') && !overview.includes('shared GPU'), 'overview wording: ' + overview.replace(/s+/g, ' ').slice(0, 900));
  await tab('Behaviour');
  const behaviour = await dashText();
  assert(!behaviour.includes('Creativity') && !behaviour.includes('sharing the GPU'), 'no temperature slider in API mode');
  await tab('Privacy');
  await dash.locator('h2', { hasText: 'Privacy notice' }).waitFor();
  const privacy = await dashText();
  assert(privacy.includes('in their language') && privacy.includes('Claude'), 'explains the default notice in API mode');
  assert(privacy.includes('Anthropic (USA)'), 'the consent card names Anthropic as the recipient');
  await tab('Appearance');
  const appearance = await dashText();
  assert(appearance.includes('Show “AI by Ligata”') && !appearance.includes('queue position'), 'branding and no queue option');
  // Unreadable colours are flagged while editing (WCAG AA), and the warning goes away when fixed.
  assert(await dash.locator('.notice.warning', { hasText: 'hard to read' }).count() === 0, 'the preset passes');
  await dash.locator('summary', { hasText: 'Colours' }).click();
  const visitorText = dash.locator('label.color', { hasText: 'Visitor text' }).locator('input[type=color]');
  const original = await visitorText.inputValue();
  await visitorText.fill('#dddddd');
  await dash.locator('.notice.warning', { hasText: 'Visitor text on the visitor bubble' }).waitFor();
  await visitorText.fill(original);
  await dash.locator('.notice.warning', { hasText: 'hard to read' }).waitFor({ state: 'detached' });
  await admin.screenshot({ path: path.join(out, '04-overview.png') });
});

await check('backoffice: a PDF uploaded as knowledge is read here and counted by Claude', async () => {
  const counts = (await mockState()).counts;
  await tab('Knowledge');
  const file = path.join(out, `price-list-${run}.pdf`);
  writeFileSync(file, fixturePdf(`Maintenance costs CHF 60 per month ${run}`));
  await dash.locator('label.btn', { hasText: 'Upload files' }).locator('input[type=file]').setInputFiles(file);
  const item = dash.locator('.k-item', { hasText: `price-list-${run}` });
  await item.waitFor({ timeout: 20000 });
  assert((await item.innerText()).includes('Maintenance costs CHF 60'), 'PDF text extracted without a gateway');
  assert(!(await item.locator('.k-tokens').innerText()).includes('est'), 'exact token count');
  assert((await mockState()).counts > counts, 'counted by the token counting endpoint');
});

await check('a rejected key: the widget goes offline, Test connection explains, and recovers', async () => {
  await mockMode('unauthorized');
  try {
  const failed = await chat([{ role: 'user', content: 'Hello?' }]);
  assert(failed.status === 401 && /not available/.test(failed.text) && !/x-api-key|sk-ant/.test(failed.text), 'visitors get a neutral message: ' + failed.text);
  await new Promise(r => setTimeout(r, 5500)); // the public status is cached for five seconds
  const config = await (await fetch(base + '/api/ligata-ai/config')).json();
  assert(config.state === 'offline', 'widget state offline: ' + config.state);
  await tab('Connection');
  await dash.locator('button', { hasText: 'Test connection' }).click();
  await dash.locator('.notice.error', { hasText: /rejected/ }).waitFor({ timeout: 15000 });
  await mockMode('ok');
  await dash.locator('button', { hasText: 'Test connection' }).click();
  await dash.locator('.notice.success', { hasText: 'Anthropic accepted' }).waitFor({ timeout: 15000 });
  await new Promise(r => setTimeout(r, 5500));
  assert((await (await fetch(base + '/api/ligata-ai/config')).json()).state === 'ready', 'ready again');
  } finally { await mockMode('ok'); }
});

await check('nothing the browser received contains the key', async () => {
  assert(!seen.some(secret) && !backoffice.some(secret), 'key leaked');
  assert(errors.length === 0, 'page errors: ' + errors.join(' | '));
});

await browser.close();
console.log(`\n${passed} passed, ${failed} failed. Screenshots in ${out}`);
process.exit(failed ? 1 : 0);
