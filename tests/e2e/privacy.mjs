// Consent before the AI reads a message (GDPR), its withdrawal, Cookiebot, and the privacy policy text, in Microsoft Edge (headless).
//   node privacy.mjs                 host with the default (consent in the chat)
//   node privacy.mjs                 host restarted with LigataAI__Privacy__ConsentMode=cookiebot: the Cookiebot checks run
// Needs the test host with --support-fixture and an AI engine (mock gateway or mock Anthropic API), see docs/TESTING.md.
// Cookiebot is replaced by a stub with the same JavaScript API; no request leaves the machine.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', '..', '.runtime');
const out = path.join(runtime, 'e2e', 'privacy');
mkdirSync(out, { recursive: true });
const base = process.env.HOST || 'http://127.0.0.1:5310';
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS || path.join(runtime, 'ai-test-admin.json'), 'utf8'));
const only = process.argv.slice(2);
const run = Date.now().toString(36);
let passed = 0, failed = 0;
const errors = [];
async function check(name, fn) {
  if (only.length && !only.some(o => name.includes(o))) return;
  const started = Date.now();
  try { await fn(); passed++; console.log(`✔ ${name} (${Date.now() - started} ms)`); }
  catch (error) { failed++; console.log(`✖ ${name}: ${error.message.split('\n')[0]}`); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const api = (route, body, consent) => fetch(base + '/api/ligata-ai/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
const ask = (consent, content = 'What does hosting cost?') => api('chat', { messages: [{ role: 'user', content }], pageTitle: 'Home', pagePath: '/', consent });
const config = await (await fetch(base + '/api/ligata-ai/config')).json();
const consentConfig = config.settings.consent;
const cookiebot = consentConfig?.mode === 'cookiebot';
console.log(`Consent mode: ${consentConfig ? consentConfig.mode : 'none'}, engine: ${config.settings.engine}`);

const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
/** A visitor with an empty browser. cookiebot: a stub of Cookiebot's API that starts without consent. */
async function visitor({ withCookiebot = cookiebot, german = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  // The fixture page is English; a German page gets the German interface.
  if (german) await context.route(base + '/', async route => { const response = await route.fetch(); route.fulfill({ response, body: (await response.text()).replace('<html lang="en">', '<html lang="de">') }); });
  if (withCookiebot) await context.addInitScript(() => {
    window.Cookiebot = { consent: { necessary: true, preferences: false, statistics: false, marketing: false }, consented: false, declined: false, hasResponse: false, renewed: 0, renew() { this.renewed++; } };
    window.__cookiebot = allow => {
      Object.assign(window.Cookiebot.consent, { preferences: allow, statistics: allow, marketing: allow });
      window.dispatchEvent(new Event(allow ? 'CookiebotOnAccept' : 'CookiebotOnDecline'));
    };
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  await page.goto(base + '/');
  const widget = page.locator('#ligata-ai');
  return { context, page, widget, requests, shot: file => page.screenshot({ path: path.join(out, file + '.png') }) };
}
const storage = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('ligata-ai')).map(k => [k, JSON.parse(localStorage.getItem(k))])));
const consentOf = async page => Object.entries(await storage(page)).find(([k]) => k.startsWith('ligata-ai:consent:'))?.[1] || null;
const answered = async v => { await v.widget.locator('.msg.bot').nth(1).waitFor({ timeout: 30000 }); await v.widget.locator('.bubble.streaming').waitFor({ state: 'detached', timeout: 30000 }); };

await check('the server refuses questions and files without a recorded consent', async () => {
  assert(consentConfig && /^(gpu|api)\.\d+\.[0-9a-f]{6}$/.test(consentConfig.version), 'consent is required by default: ' + JSON.stringify(consentConfig));
  for (const id of [undefined, 'not-a-guid', '00000000-0000-4000-8000-000000000000']) {
    const response = await ask(id);
    const body = await response.json();
    assert(response.status === 403 && body.error.code === 'consent_required', `question with consent ${id}: ${response.status} ${JSON.stringify(body)}`);
  }
  const file = await api('attachments', { name: 'a.pdf', data: Buffer.from('%PDF-1.4').toString('base64') });
  assert(file.status === 403 && (await file.json()).error.code === 'consent_required', 'PDFs are not read without consent: ' + file.status);
  const outdated = await api('consent', { version: 'gpu.0.000000', source: 'chat', language: 'en' });
  assert(outdated.status === 409 && (await outdated.json()).version === consentConfig.version, 'consent to an old text is refused with the current version');
  const html = await (await fetch(base + '/')).text();
  assert(/<script[^>]+data-cookieconsent="ignore"[^>]+data-ligata-ai/.test(html), 'the script tag is exempt from Cookiebot\'s automatic blocking');
});

await check('a new visitor sees who receives the data and can only agree, not type', async () => {
  const v = await visitor();
  await v.widget.locator('.launcher').waitFor({ timeout: 15000 });
  await v.page.waitForTimeout(2000); // status check
  assert(Object.keys(await storage(v.page)).length === 0, 'nothing is stored before the visitor uses the chat');
  await v.widget.locator('.launcher').click();
  const card = v.widget.locator('.agree');
  await card.waitFor();
  const text = await card.innerText();
  const recipient = consentConfig.provider.kind === 'anthropic' ? /Anthropic \(United States\)/ : new RegExp(`AI server run by ${consentConfig.provider.name}`);
  assert(/This assistant is an AI/.test(text) && recipient.test(text), 'the request names the AI and the recipient: ' + text);
  assert(await card.locator('a', { hasText: 'Privacy policy' }).getAttribute('href') === '/privacy/', 'the privacy policy is one click away');
  assert(await v.widget.locator('.composer textarea').isHidden() && await v.widget.locator('.suggestions').count() === 0, 'no input and no suggested questions yet');
  assert(await card.locator('[data-open-sheet]').count() >= 1, 'the team can be reached without the AI');
  await v.page.evaluate(() => window.LigataAI.ask('Queued question'));
  assert(!v.requests.some(u => u.includes('/api/ligata-ai/chat')), 'the JavaScript API does not bypass consent');
  assert(Object.keys(await storage(v.page)).length === 0, 'opening the chat stores nothing');
  await v.shot('01-consent-request');
  if (!cookiebot) {
    await card.locator('[data-agree]').click();
    await card.waitFor({ state: 'hidden' });
    assert(await v.widget.locator('.composer textarea').inputValue() === 'Queued question', 'a question asked through the API waits in the input');
  }
  await v.context.close();
});

await check('team chat and email stay available without agreeing to the AI', async () => {
  const v = await visitor();
  await v.widget.locator('.launcher').click();
  await v.widget.locator('.agree [data-open-sheet]').first().click();
  await v.widget.locator('.sheet form').waitFor();
  assert(!v.requests.some(u => u.includes('/api/ligata-ai/consent')), 'no consent is recorded for the team');
  await v.context.close();
});

if (!cookiebot) {
  let firstConsent;
  await check('agreeing records the consent on the server and unlocks the AI', async () => {
    const v = await visitor({ german: true });
    await v.widget.locator('.launcher').click();
    const text = await v.widget.locator('.agree').innerText();
    assert(/Dieser Assistent ist eine KI/.test(text) && /Datenschutzerklärung/.test(text), 'German consent request: ' + text);
    await v.widget.locator('[data-agree]').click();
    await v.widget.locator('.agree').waitFor({ state: 'hidden' });
    firstConsent = await consentOf(v.page);
    assert(firstConsent && /^[0-9a-f-]{36}$/.test(firstConsent.id) && firstConsent.version === consentConfig.version && firstConsent.source === 'chat', 'consent kept in the browser: ' + JSON.stringify(firstConsent));
    assert(Date.parse(firstConsent.expires) - Date.now() > 300 * 86400000, 'valid for about a year');
    await v.widget.locator('.composer textarea').fill(`Was kostet Hosting? ${run}`);
    await v.widget.locator('.composer textarea').press('Enter');
    await answered(v);
    const stored = await storage(v.page);
    assert(Object.keys(stored).some(k => k.startsWith('ligata-ai:v2:')), 'the conversation is kept once there is one');
    assert((await ask(firstConsent.id)).status === 200, 'the recorded consent works for direct requests too');
    await v.shot('02-agreed-answer');

    // withdrawal: from the conversation list, as easy as agreeing
    await v.widget.locator('[data-action=list]').click();
    const row = v.widget.locator('.consent-row');
    assert(/zugestimmt/.test(await row.innerText()), 'the list shows the consent');
    await v.shot('03-consent-row');
    await row.locator('[data-withdraw-consent]').click();
    await v.widget.locator('.agree').waitFor();
    const left = await consentOf(v.page);
    assert(!left || left.withdraw, 'consent forgotten in the browser: ' + JSON.stringify(left));
    assert(!Object.values(await storage(v.page)).some(x => x?.conversations?.some(c => !c.team)), 'AI conversations removed from the device');
    await v.page.waitForTimeout(500);
    const refused = await ask(firstConsent.id);
    assert(refused.status === 403, 'the server refuses the withdrawn consent: ' + refused.status);
    await v.context.close();
  });

  await check('a stale consent in the browser leads back to the consent request', async () => {
    const v = await visitor();
    await v.page.evaluate(([key, version]) => localStorage.setItem(key, JSON.stringify({ id: '00000000-0000-4000-8000-000000000000', version, expires: new Date(Date.now() + 864e5).toISOString(), at: Date.now(), source: 'chat' })), ['ligata-ai:consent:' + new URL(base).host, consentConfig.version]);
    await v.page.reload();
    await v.widget.locator('.launcher').click();
    await v.widget.locator('.composer textarea').fill('Is this still allowed?');
    await v.widget.locator('.composer textarea').press('Enter');
    await v.widget.locator('.agree .agree-error:not([hidden])').waitFor({ timeout: 10000 });
    assert(await v.widget.locator('.composer textarea').isHidden(), 'asks for consent again');
    await v.widget.locator('[data-agree]').click();
    assert(await v.widget.locator('.composer textarea').inputValue() === 'Is this still allowed?', 'the question was kept for after the consent');
    await v.context.close();
  });

  await check('the backoffice shows consents, asks everyone again and writes the privacy policy text', async () => {
    const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push('backoffice: ' + e.message));
    await page.goto(base + '/umbraco');
    await page.locator('input[type=email], input[name=username]').first().fill(credentials.email);
    await page.locator('input[type=password]').first().fill(credentials.password);
    await page.keyboard.press('Enter');
    await page.waitForURL(/section/, { timeout: 30000 });
    await page.goto(base + '/umbraco/section/ai-assistant/dashboard/settings');
    const dash = page.locator('ligata-ai-dashboard');
    await dash.locator('nav.tabs button', { hasText: 'Privacy' }).click();
    await dash.locator('h2', { hasText: 'Consent before the first question' }).waitFor({ timeout: 20000 });
    assert(/\d+ agreed · \d+ asked a question · [1-9]\d* withdrew/.test(await dash.locator('dl.facts').first().innerText()), 'consent counts of the last 30 days');
    const policy = dash.locator('pre.policy');
    await policy.filter({ hasText: 'Chat auf dieser Website' }).waitFor({ timeout: 10000 });
    const german = await policy.innerText();
    assert(/Art\. 6 Abs\. 1 lit\. a DSGVO/.test(german) && !german.includes('{{') && !german.includes('<!--'), 'German privacy policy text, filled in');
    assert(config.settings.engine === 'api' ? german.includes('Anthropic') : german.includes('KI-Server von'), 'names the recipient of this setup');
    await dash.locator('.segmented button', { hasText: 'English' }).click();
    await policy.filter({ hasText: 'Chat on this website' }).waitFor({ timeout: 10000 });
    // the preview asks like the website
    const frame = page.frameLocator('ligata-ai-dashboard iframe');
    await frame.locator('.agree:not(.hidden)').waitFor({ timeout: 15000 });
    await page.screenshot({ path: path.join(out, '04-backoffice-privacy.png'), fullPage: false });
    // ask everyone again
    await dash.locator('button', { hasText: 'Ask all visitors again' }).click();
    await dash.locator('button', { hasText: 'Save changes' }).click();
    await dash.locator('.notice.success', { hasText: 'Saved' }).waitFor();
    const next = (await (await fetch(base + '/api/ligata-ai/config')).json()).settings.consent.version;
    assert(next !== consentConfig.version && next.split('.')[1] === String(+consentConfig.version.split('.')[1] + 1), 'new consent version: ' + next);
    const v = await visitor();
    const fresh = await (await api('consent', { version: next, source: 'chat', language: 'en' })).json();
    assert((await ask(fresh.id)).status === 200, 'a consent to the new text works');
    await v.context.close();
    await context.close();
  });
}

if (cookiebot) {
  await check('Cookiebot: the chat unlocks with the category and records the consent on the first question', async () => {
    const v = await visitor();
    await v.widget.locator('.launcher').click();
    const card = v.widget.locator('.agree');
    const category = { preferences: 'Preferences', statistics: 'Statistics', marketing: 'Marketing' }[consentConfig.category];
    assert(new RegExp(`allow the “${category}” category`).test(await card.innerText()), 'names the Cookiebot category');
    assert(await card.locator('[data-agree]').count() === 0, 'no own button: the choice is made in Cookiebot');
    await card.locator('[data-cookie-settings]').click();
    assert(await v.page.evaluate(() => window.Cookiebot.renewed) === 1, 'opens the Cookiebot dialog');
    await v.shot('05-cookiebot-request');
    await v.page.evaluate(() => window.__cookiebot(true));
    await card.waitFor({ state: 'hidden' });
    assert(!v.requests.some(u => u.includes('/api/ligata-ai/consent')), 'accepting cookies alone records nothing');
    await v.widget.locator('.composer textarea').fill('What does hosting cost?');
    await v.widget.locator('.composer textarea').press('Enter');
    await answered(v);
    const recorded = await consentOf(v.page);
    assert(recorded?.source === 'cookiebot' && recorded.version === consentConfig.version, 'recorded with the first question: ' + JSON.stringify(recorded));
    await v.widget.locator('[data-action=list]').click();
    assert(await v.widget.locator('.consent-row [data-cookie-settings]').count() === 1, 'the list points to the cookie settings');
    // declining in Cookiebot withdraws at once
    await v.page.evaluate(() => window.__cookiebot(false));
    assert(await v.widget.locator('.list .item').count() === 0, 'the AI conversation left the list');
    await v.widget.locator('.list [data-action=new]').click();
    await card.waitFor();
    await v.page.waitForTimeout(500);
    assert((await ask(recorded.id)).status === 403, 'the server refuses the withdrawn consent');
    assert(!Object.values(await storage(v.page)).some(x => x?.conversations?.some(c => !c.team)), 'AI conversations removed from the device');
    await v.context.close();
  });

  await check('Cookiebot with the history: the chat states the period once (Continue) and again when it changes', async () => {
    const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const admin = await context.newPage();
    admin.on('pageerror', e => errors.push('backoffice: ' + e.message));
    await admin.goto(base + '/umbraco');
    await admin.locator('input[type=email], input[name=username]').first().fill(credentials.email);
    await admin.locator('input[type=password]').first().fill(credentials.password);
    await admin.keyboard.press('Enter');
    await admin.waitForURL(/section/, { timeout: 30000 });
    const dash = admin.locator('ligata-ai-dashboard');
    async function setHistory(on, days) {
      await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/settings?tab=privacy');
      const history = dash.locator('section.card', { has: admin.locator('h2', { hasText: 'Conversation history' }) });
      await history.waitFor({ timeout: 20000 });
      if (await history.locator('label.switch input').isChecked() !== on) await history.locator('label.switch input').click();
      if (on) await history.locator('input[type=number]').fill(String(days));
      await dash.locator('button', { hasText: 'Save changes' }).click();
      await dash.locator('.notice.success', { hasText: 'Saved' }).waitFor();
    }
    try {
      await setHistory(true, 10);
      const v = await visitor();
      await v.widget.locator('.launcher').click();
      const card = v.widget.locator('.agree');
      await card.waitFor();
      assert(/for 10 days/.test(await card.innerText()) && await card.locator('[data-cookie-settings]').count() === 1, 'the period is stated next to the Cookiebot request');
      await v.page.evaluate(() => window.__cookiebot(true));
      await card.locator('[data-agree]', { hasText: 'Continue' }).waitFor();
      assert(/for 10 days/.test(await card.innerText()) && /object at any time/.test(await card.innerText()), 'Cookiebot covers the AI; the chat still states the period and the objection');
      assert(!v.requests.some(u => u.includes('/api/ligata-ai/consent')), 'nothing recorded before Continue');
      await v.page.waitForTimeout(800); // the panel slides in
      await v.shot('07-cookiebot-history');
      await card.locator('[data-agree]').click();
      await card.waitFor({ state: 'hidden' });
      const recorded = await consentOf(v.page);
      assert(recorded?.source === 'cookiebot' && recorded.version.endsWith('.h10') && recorded.history?.startsWith('10.'), 'recorded with the period: ' + JSON.stringify(recorded));
      await v.widget.locator('.composer textarea').fill('What does hosting cost?');
      await v.widget.locator('.composer textarea').press('Enter');
      await answered(v);
      await setHistory(true, 12);
      await v.page.reload();
      await v.page.evaluate(() => window.__cookiebot(true));
      await v.page.evaluate(() => window.LigataAI.open());
      await card.locator('[data-agree]', { hasText: 'Continue' }).waitFor();
      assert(/for 12 days/.test(await card.innerText()), 'the new period is stated again: ' + await card.innerText());
      await v.context.close();
    } finally {
      await setHistory(false);
      // Leave no conversation behind for the other suites.
      const history = admin.locator('ligata-ai-history');
      await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/conversations');
      await history.locator('.bar, h2').first().waitFor({ timeout: 20000 });
      admin.on('dialog', d => d.accept());
      if (await history.locator('button', { hasText: 'Delete all' }).isEnabled({ timeout: 2000 }).catch(() => false)) await history.locator('button', { hasText: 'Delete all' }).click();
      await admin.waitForTimeout(500);
      await context.close();
    }
  });

  await check('Cookiebot missing on a page: the chat asks itself', async () => {
    const v = await visitor({ withCookiebot: false });
    await v.widget.locator('.launcher').click();
    await v.widget.locator('.agree [data-agree]').click();
    await v.widget.locator('.agree').waitFor({ state: 'hidden' });
    assert((await consentOf(v.page))?.source === 'chat', 'own consent as the fallback');
    await v.context.close();
  });
}

await check('no script errors', async () => {
  assert(!errors.length, errors.join(' | '));
});

await browser.close();
console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${out}`);
process.exit(failed ? 1 : 0);
