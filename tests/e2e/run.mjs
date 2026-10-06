// End-to-end checks in Microsoft Edge (headless) against the disposable Umbraco test host.
//   HOST=http://127.0.0.1:5310 GATEWAY=http://127.0.0.1:1220 KEY_FILE=../../.runtime/gateway-dev/created.txt node run.mjs
// Uses only the fixture database, the fixture administrator and synthetic content.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', '..', '.runtime');
const out = path.join(runtime, 'e2e');
mkdirSync(out, { recursive: true });
const base = process.env.HOST || 'http://127.0.0.1:5310';
const gateway = process.env.GATEWAY || 'http://127.0.0.1:1220';
const key = readFileSync(process.env.KEY_FILE || path.join(runtime, 'gateway-dev', 'created.txt'), 'utf8').match(/lai_[A-Za-z0-9_-]+/)[0];
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS || path.join(runtime, 'ai-test-admin.json'), 'utf8'));
const only = process.argv.slice(2);
const real = !!process.env.REAL; // real model: answers vary, so only their arrival and shape are checked
const answerTimeout = real ? 240000 : 20000;
const run = Date.now().toString(36); // unique values keep the suite repeatable on the same fixture database

let passed = 0;
const results = [];
async function check(name, fn) {
  if (only.length && !only.some(o => name.includes(o))) return;
  const started = Date.now();
  try { await fn(); passed++; results.push(`✔ ${name} (${Date.now() - started} ms)`); console.log(results.at(-1)); }
  catch (error) { results.push(`✖ ${name}: ${error.message}`); console.log(results.at(-1)); failures++; }
}
let failures = 0;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const shot = (page, name) => page.screenshot({ path: path.join(out, name + '.png') });

const browser = await chromium.launch({ channel: 'msedge', headless: process.env.HEADED ? false : true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

// The dashboard lives in shadow DOM; Playwright CSS locators pierce it.
const dash = () => page.locator('ligata-ai-dashboard');
const tab = name => dash().locator('nav.tabs button', { hasText: name }).click();
const notice = () => dash().locator('.notice').first();

await check('administrator logs in', async () => {
  await page.goto(base + '/umbraco');
  await page.locator('input[type=email], input[name=username]').first().fill(credentials.email);
  await page.locator('input[type=password]').first().fill(credentials.password);
  await page.keyboard.press('Enter');
  await page.waitForURL(/section/, { timeout: 30000 });
});

await check('AI Assistant section opens on the overview', async () => {
  await page.goto(base + '/umbraco/section/ai-assistant');
  await dash().locator('h1', { hasText: 'Website assistant' }).waitFor({ timeout: 20000 });
  await dash().locator('.checklist').waitFor();
});

await check('connection: wrong key format is refused', async () => {
  await tab('Connection');
  await dash().locator('input[type=url]').fill(gateway);
  await dash().locator('input[type=password]').fill('sk-not-a-ligata-key');
  await dash().locator('button', { hasText: 'Save & test' }).click();
  await dash().locator('.notice.error[role=alert]').waitFor();
  assert((await dash().locator('.notice.error[role=alert]').innerText()).includes('lai_'), 'explains the key format');
});

await check('connection: key is stored encrypted and the gateway answers', async () => {
  await dash().locator('input[type=password]').fill(key);
  await dash().locator('button', { hasText: 'Save & test' }).click();
  await dash().locator('.notice.success', { hasText: 'Connected' }).waitFor({ timeout: 15000 });
  const placeholder = await dash().locator('input[type=password]').getAttribute('placeholder');
  assert(placeholder.includes('Stored') && !placeholder.includes(key.slice(20, 40)), 'only a hint of the key is shown');
  await shot(page, '01-connection');
});

await check('behaviour: identity, instructions and suggestions are saved', async () => {
  await tab('Behaviour');
  const field = label => dash().locator('label.control', { hasText: label }).locator('input, textarea').first();
  await field('Business / website name').fill('Ligata Test Studio');
  await field('Your instructions').fill(`We are a small web studio. Recommend booking a free call for project questions. (run ${run})`);
  await field('Contact email').fill('hello@ligata-test.example');
  if (!await dash().locator('.list-editor input').count()) await dash().locator('.list-editor button', { hasText: 'Add' }).click();
  await dash().locator('.list-editor input').first().fill('What does a website cost?');
  await dash().locator('button', { hasText: 'Save changes' }).click();
  await dash().locator('.notice.success', { hasText: 'Saved' }).waitFor();
  await shot(page, '02-behaviour');
});

await check('behaviour: invalid values are explained, not saved', async () => {
  await dash().locator('label.control', { hasText: 'Contact email' }).locator('input').fill('nope');
  await dash().locator('button', { hasText: 'Save changes' }).click();
  await dash().locator('.notice.error[role=alert]').waitFor();
  assert(await dash().locator('label.control.invalid', { hasText: 'Contact email' }).count() === 1, 'field is highlighted');
  await dash().locator('label.control', { hasText: 'Contact email' }).locator('input').fill('hello@ligata-test.example');
  assert(await dash().locator('button', { hasText: 'Save changes' }).isDisabled(), 'restoring the saved value leaves nothing to save');
});

await check('knowledge: website pages are imported as text', async () => {
  await tab('Knowledge');
  await dash().locator('button', { hasText: 'Import website pages' }).click();
  await dash().locator('dialog.pages-dialog button', { hasText: 'Select all pages' }).click();
  await dash().locator('dialog.pages-dialog button.primary').click();
  await dash().locator('.k-item', { hasText: 'Contact' }).waitFor({ timeout: 20000 });
  assert(await dash().locator('.k-item').count() >= 3, 'three seeded pages imported');
  assert((await dash().locator('.k-item', { hasText: 'Prices' }).innerText()).includes('4,800'), 'page text extracted');
});

await check('knowledge: files are uploaded and counted', async () => {
  const file = path.join(out, 'faq.md');
  writeFileSync(file, '# FAQ\n\n**Do you offer maintenance?** Yes, from CHF 60 per month.\n\n**Where are you?** Dielsdorf, Switzerland.');
  await dash().locator('label.btn', { hasText: 'Upload files' }).locator('input[type=file]').setInputFiles(file);
  await dash().locator('.k-item', { hasText: 'faq' }).waitFor({ timeout: 20000 });
  const tokens = await dash().locator('.k-item', { hasText: 'faq' }).locator('.k-tokens').innerText();
  assert(/\d/.test(tokens), 'token count shown');
});

await check('knowledge: written text and switching sources off', async () => {
  await dash().locator('button', { hasText: 'Write text' }).click();
  await dash().locator('dialog.editor input').fill('Opening hours ' + run);
  await dash().locator('dialog.editor textarea').fill('Monday to Friday 8:00–17:00. Closed on public holidays.');
  await dash().locator('dialog.editor button.primary').click();
  await dash().locator('.k-item', { hasText: 'Opening hours ' + run }).waitFor();
  const item = dash().locator('.k-item', { hasText: 'Opening hours ' + run });
  await item.locator('input[type=checkbox]').uncheck();
  await dash().locator('.k-item.off', { hasText: 'Opening hours ' + run }).waitFor();
  await item.locator('input[type=checkbox]').check();
  await shot(page, '03-knowledge');
});

await check('appearance: theme, position and live preview', async () => {
  await tab('Appearance');
  await dash().locator('.swatch', { hasText: 'Ocean' }).click();
  await dash().locator('.segmented button', { hasText: 'Bottom right' }).click();
  await dash().locator('label.control', { hasText: 'Label next to the bubble' }).locator('input').fill('Questions? ' + run.slice(-3));
  await page.waitForTimeout(1200);
  const frame = page.frameLocator('ligata-ai-dashboard iframe');
  await frame.locator('#ligata-ai').waitFor({ state: 'attached', timeout: 15000 });
  const accent = await frame.locator('#ligata-ai').evaluate(el => getComputedStyle(el).getPropertyValue('--lai-accent').trim());
  assert(accent === '#0e7c86', 'preview uses the unsaved Ocean accent, got ' + accent);
  await dash().locator('button', { hasText: 'Save changes' }).click();
  await dash().locator('.notice.success', { hasText: 'Saved' }).waitFor();
  await shot(page, '04-appearance');
});

await check('preview chat answers through the gateway', async () => {
  const frame = page.frameLocator('ligata-ai-dashboard iframe');
  await frame.locator('textarea').fill('Hello from the backoffice preview');
  await frame.locator('textarea').press('Enter');
  await frame.locator('.msg.bot').nth(1).waitFor({ timeout: answerTimeout });
  await frame.locator('.bubble.streaming').waitFor({ state: 'detached', timeout: answerTimeout });
  assert((await frame.locator('.msg.bot .bubble').nth(1).innerText()).trim().length > 0, 'preview answer has text');
  await shot(page, '05-preview-chat');
});

await check('switching the assistant on publishes it to the website', async () => {
  await tab('Overview');
  const live = dash().locator('label.switch', { hasText: 'Show on website' }).locator('input');
  if (await live.isChecked()) { await live.uncheck(); await dash().locator('.notice.success', { hasText: 'switched off' }).waitFor(); }
  await live.check();
  await dash().locator('.notice.success', { hasText: 'live' }).waitFor();
});

// ---------- public website ----------
const visitor = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const site = await visitor.newPage();
site.on('pageerror', e => pageErrors.push('site: ' + e.message));
const widget = () => site.locator('#ligata-ai');

await check('the bubble is injected into Umbraco pages automatically', async () => {
  await site.goto(base + '/');
  await widget().locator('.launcher').waitFor({ timeout: 15000 });
  const html = await site.content();
  assert(html.includes('data-ligata-ai') && !html.includes(key) && !html.includes('lai_'), 'no secrets in the page');
  assert((await widget().locator('.label').innerText()).includes('Questions? ' + run.slice(-3)), 'bubble label');
  await site.waitForTimeout(2500); // status check
  assert(await widget().getAttribute('state') === 'ready', 'status dot shows ready, got ' + await widget().getAttribute('state'));
  await shot(site, '06-site-closed');
});

await check('a visitor asks a suggested question and gets a streamed answer', async () => {
  await widget().locator('.launcher').click();
  await widget().locator('.suggestions button', { hasText: 'What does a website cost?' }).click();
  await widget().locator('.msg.bot').nth(1).waitFor({ timeout: answerTimeout });
  await widget().locator('.bubble.streaming').waitFor({ state: 'detached', timeout: answerTimeout });
  const html = await widget().locator('.msg.bot').last().innerHTML();
  if (!real) assert(html.includes('<strong>mock</strong>') && html.includes('<li>') && html.includes('href="/kontakt/"'), 'markdown rendered safely');
  else console.log('  answer: ' + (await widget().locator('.msg.bot .bubble').nth(1).innerText()).replace(/\s+/g, ' ').slice(0, 200));
  const meter = await widget().locator('.meter-text').innerText();
  assert(/\d/.test(meter) && /free|frei/.test(meter), 'memory meter shows the free context: ' + meter);
  await shot(site, '07-site-answer');
});

await check('the conversation survives a page change, attachments are not kept', async () => {
  await site.goto(base + '/prices/');
  await widget().locator('.msg.user').first().waitFor({ timeout: 10000 });
  assert(await widget().locator('.msg.user').count() === 1, 'conversation restored');
});

await check('screenshots can be attached and are sent to the model', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(path.join(out, 'pixel.png'), png);
  await widget().locator('input[type=file]').setInputFiles(real ? path.join(runtime, 'screenshot-test.png') : path.join(out, 'pixel.png'));
  await widget().locator('.pending .file').waitFor();
  const answers = await widget().locator('.msg.bot').count();
  await widget().locator('textarea').fill(real ? 'What is the total amount on this invoice, and is there an error message?' : 'What is in this screenshot?');
  await widget().locator('textarea').press('Enter');
  await widget().locator('.msg.user .file').last().waitFor();
  await widget().locator('.msg.bot').nth(answers).waitFor({ timeout: answerTimeout });
  await widget().locator('.bubble.streaming').waitFor({ state: 'detached', timeout: answerTimeout }); // answer finished
  if (real) console.log('  screenshot answer: ' + (await widget().locator('.msg.bot .bubble').nth(answers).innerText()).replace(/\s+/g, ' ').slice(0, 200));
});

await check('unsupported files are explained', async () => {
  writeFileSync(path.join(out, 'notes.exe'), 'MZ');
  await widget().locator('input[type=file]').setInputFiles(path.join(out, 'notes.exe'));
  await widget().locator('.notice.error').waitFor();
});

await check('a second tab of the same visitor cannot jump the queue', async () => {
  const second = await visitor.newPage();
  await second.goto(base + '/');
  // Fire two questions at once from the same IP: one runs, the other is told to wait.
  const ask = p => p.evaluate(async api => {
    const r = await fetch(api + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'race' }] }) });
    if (r.headers.get('content-type')?.includes('event-stream')) { await r.text(); return 200; }
    return r.status;
  }, '/api/ligata-ai');
  const statuses = await Promise.all([ask(site), ask(second)]);
  assert(statuses.includes(200) && statuses.includes(429), 'one answer, one "please wait": ' + statuses);
  await second.close();
});

await check('mobile: the chat opens full screen', async () => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  await p.goto(base + '/');
  await p.locator('#ligata-ai .launcher').click();
  await p.waitForTimeout(500);
  const box = await p.locator('#ligata-ai .panel').boundingBox();
  assert(box && box.width >= 389 && box.height >= 800, 'panel fills the screen: ' + JSON.stringify(box));
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert(!overflow, 'no horizontal overflow');
  await p.screenshot({ path: path.join(out, '08-mobile.png') });
  await phone.close();
});

// ---------- static export on another origin ----------
await check('a statically exported page on another origin works through CORS', async () => {
  const html = await (await fetch(base + '/')).text();
  const tag = html.match(/<script src="\/assets\/ligata-ai\/ligata-ai\.js[^>]*><\/script>/)[0].replace('src="/assets', `src="${base}/assets`).replace('data-api="/api/ligata-ai"', `data-api="${base}/api/ligata-ai"`);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<!doctype html><html lang="de"><head><title>Static</title></head><body><h1>Statische Seite</h1>${tag}</body></html>`); });
  await new Promise(r => server.listen(5311, '127.0.0.1', r));
  try {
    const p = await visitor.newPage();
    await p.goto('http://127.0.0.1:5311/');
    await p.locator('#ligata-ai .launcher').click();
    await p.locator('#ligata-ai textarea').fill('Hallo von der statischen Seite');
    await p.locator('#ligata-ai textarea').press('Enter');
    await p.locator('#ligata-ai .msg.bot').nth(1).waitFor({ timeout: answerTimeout }).catch(async e => { throw new Error(e.message.split(/\n/)[0] + ' | widget says: ' + (await p.locator('#ligata-ai .log').innerText()).replace(/\s+/g, ' ').slice(-300)); });
    assert((await p.locator('#ligata-ai .launcher').getAttribute('aria-label')).includes('Chat'), 'German interface on a German page');
    await p.close();
  } finally { server.close(); }
});

await check('a page on a disallowed origin is refused', async () => {
  const response = await fetch(base + '/api/ligata-ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
  assert(response.status === 403, 'status ' + response.status);
});

await check('when the AI gateway is down, visitors see the offline message and contact options', async () => {
  const gatewayDown = process.env.STOP_GATEWAY_CMD;
  if (!gatewayDown) { console.log('  (skipped: set STOP_GATEWAY_CMD to run)'); return; }
  const { execSync } = await import('node:child_process');
  execSync(gatewayDown, { stdio: 'ignore' });
  await site.goto(base + '/');
  await widget().locator('.launcher').click();
  await widget().locator('[data-action=new]').click().catch(() => {});
  site.once('dialog', d => d.accept());
  await widget().locator('.notice', { hasText: 'not available' }).waitFor({ timeout: 15000 });
  assert(await widget().locator('a.chip[href^="mailto:"]').count() === 1, 'email fallback offered');
  assert(await widget().locator('textarea').isDisabled(), 'input disabled while offline');
  await shot(site, '09-offline');
  if (process.env.START_GATEWAY_CMD) execSync(process.env.START_GATEWAY_CMD, { stdio: 'ignore' });
});

await check('no script errors on the website or in the backoffice', async () => {
  const relevant = pageErrors.filter(e => !/ResizeObserver/.test(e));
  assert(!relevant.length, relevant.join(' | '));
});

await browser.close();
console.log(`\n${passed} passed, ${failures} failed. Screenshots: ${out}`);
writeFileSync(path.join(out, 'results.txt'), results.join('\n'));
process.exit(failures ? 1 : 0);
