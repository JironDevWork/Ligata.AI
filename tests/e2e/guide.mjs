// Showing the way (0.12): the website assistant points at a place on this page or another page of the website, scrolls there and
// highlights it, asking first as the site chose; on phones the chat steps aside. Runs against the strict mock Anthropic API, which
// is scripted by the visitor's message ("do: show_on_website {...} then: Text."), so no key or money is needed:
//   node mock-anthropic.mjs &
//   CONFIG_KEY=0 LigataAI__Mode=api LigataAI__Claude__ApiKey=sk-ant-mock-0000000000000000 LigataAI__Claude__BaseUrl=http://127.0.0.1:1230 bash restart-host.sh --clear-keys
//   node guide.mjs
import { chromium, devices } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', '..', '.runtime');
const out = path.join(runtime, 'e2e', 'guide');
mkdirSync(out, { recursive: true });
const base = process.env.HOST || 'http://127.0.0.1:5310';
const mock = process.env.MOCK || 'http://127.0.0.1:1230';
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS || path.join(runtime, 'ai-test-admin.json'), 'utf8'));
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const show = (spec, then = 'It is right here.') => `do: show_on_website ${JSON.stringify(spec)} then: ${then}`;

const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });

// ---------- helpers for a visitor page ----------
function visitor(p) {
  const widget = p.locator('#ligata-ai');
  p.on('pageerror', e => errors.push(e.message));
  return {
    widget,
    async start(url = '/') {
      await p.goto(base + url);
      await widget.locator('.panel').waitFor({ state: 'attached' });
      await sleep(400);
      if (!(await widget.locator('.panel').evaluate(el => getComputedStyle(el).visibility === 'visible'))) await widget.locator('.launcher').click();
      if (await widget.locator('[data-agree]').isVisible().catch(() => false)) await widget.locator('[data-agree]').click();
      await widget.locator('.composer textarea').waitFor();
    },
    /** Asks and waits until the answer has finished (and the widget has decided about the place). */
    async ask(text) {
      const before = await widget.locator('.msg.bot:not(.guide-note)').count();
      await widget.locator('.composer textarea').fill(text);
      await widget.locator('.composer textarea').press('Enter');
      await widget.locator('.msg.bot:not(.guide-note)').nth(before).waitFor({ timeout: 20000 });
      await widget.locator('.bubble.streaming').waitFor({ state: 'detached', timeout: 20000 });
      await sleep(300);
    },
    card: () => widget.locator('.card.guide').last(),
    mark: () => p.locator('#ligata-ai-guide .mark'),
    /** Where the words are on screen (first in main or footer). */
    words: words => p.evaluate(words => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.nodeValue.indexOf(words);
        if (i < 0 || !n.parentElement.closest('main,footer')) continue;
        const range = document.createRange(); range.setStart(n, i); range.setEnd(n, i + words.length);
        const b = range.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, vh: innerHeight, vw: innerWidth };
      }
      return null;
    }, words),
    /** The highlight surrounds the words, and the words are on screen. */
    async marks(words) {
      await this.mark().first().waitFor({ timeout: 8000 });
      await sleep(250);
      const box = await this.mark().first().boundingBox(), target = await this.words(words);
      assert(box && target, 'highlight and words found');
      assert(target.y >= 0 && target.y + target.h <= target.vh, `the words are on screen: ${JSON.stringify(target)}`);
      assert(box.x <= target.x + 1 && box.y <= target.y + 1 && box.x + box.width >= target.x + target.w - 1 && box.y + box.height >= target.y + target.h - 1, `the highlight surrounds the words: ${JSON.stringify({ box, target })}`);
      return { box, target };
    },
  };
}

// ---------- the backoffice ----------
const admin = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
admin.on('dialog', d => d.accept());
pages.admin = admin;
const dash = admin.locator('ligata-ai-dashboard');
const guideCard = () => dash.locator('section.card', { hasText: 'Showing the way' });
const pick = async (label, option) => { await guideCard().locator('.control', { hasText: label }).locator('button', { hasText: option }).first().click(); };
async function saved() {
  const button = dash.locator('button', { hasText: 'Save changes' });
  if (await button.isDisabled()) return;
  await button.click();
  await dash.locator('.notice.success', { hasText: 'Saved' }).waitFor({ timeout: 15000 });
}
await admin.goto(base + '/umbraco');
await admin.locator('input[type=email], input[name=username]').first().fill(credentials.email);
await admin.locator('input[type=password]').first().fill(credentials.password);
await admin.keyboard.press('Enter');
await admin.waitForURL(/section/, { timeout: 30000 });
await admin.goto(base + '/umbraco/section/ai-assistant/dashboard/settings?tab=behaviour');
await guideCard().waitFor({ timeout: 20000 });

await check('backoffice: "Showing the way" is on, opens pages and asks first; the highlight can be tried in the preview', async () => {
  // Start from the defaults (an earlier run may have left other choices).
  if (!(await guideCard().locator('input[type=checkbox]').isChecked())) await guideCard().locator('input[type=checkbox]').check();
  await pick('What it may do', 'Open pages too');
  await pick('Ask the visitor first', 'Before scrolling or opening a page');
  await pick('Highlight', 'Ring');
  await saved();
  const text = (await guideCard().innerText()).replace(/\s+/g, ' ');
  assert(text.includes('never clicks, fills in or sends anything') && text.includes('Highlight only') && text.includes('Scroll and highlight') && text.includes('Open pages too') && text.includes('Only before opening a page'), 'the card explains the choices: ' + text.slice(0, 500));
  await pick('Highlight', 'Spotlight');
  await guideCard().locator('button', { hasText: 'Try it in the preview' }).click();
  const frame = admin.frameLocator('ligata-ai-dashboard .preview iframe');
  await frame.locator('#ligata-ai-guide .mark.spotlight').waitFor({ timeout: 8000 });
  await admin.screenshot({ path: path.join(out, '01-backoffice-preview.png') });
  await pick('Highlight', 'Ring');
  await saved();
});

// ---------- a visitor on a computer ----------
const desktop = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
pages.desktop = desktop;
const d = visitor(desktop);
await d.start('/');

await check('something already on screen is highlighted at once, without asking, and the chat says so', async () => {
  await d.ask(show({ text: 'Ligata Test Studio', label: 'Studio name' }, 'The name is at the top.'));
  assert(await d.widget.locator('.card.guide').count() === 0, 'no question for what needs no scrolling');
  await d.marks('Ligata Test Studio');
  const note = await d.widget.locator('.msg.guide-note').last().innerText();
  assert(note.includes('I’ve highlighted “Studio name” for you.') && note.includes('Show again'), 'the chat says it: ' + note);
  assert(await desktop.evaluate(() => scrollY) === 0, 'nothing moved');
  await desktop.screenshot({ path: path.join(out, '02-desktop-here.png') });
});

await check('further down the page: a card asks first, then the page scrolls there and highlights it', async () => {
  await d.ask(show({ text: 'FAR-AWAY-5', label: 'Entrance' }, 'The entrance is described further down.'));
  const card = (await d.card().innerText()).replace(/\s+/g, ' ');
  assert(card.includes('Entrance') && card.includes('Further down this page') && card.includes('Show me') && card.includes('No thanks'), 'card: ' + card);
  assert(await desktop.evaluate(() => scrollY) === 0, 'nothing moves before the visitor agrees');
  await desktop.screenshot({ path: path.join(out, '03-desktop-card.png') });
  await d.card().locator('[data-guide=go]').click();
  const { box } = await d.marks('FAR-AWAY-5');
  assert(await desktop.evaluate(() => scrollY) > 800, 'scrolled down');
  const panelOpen = await d.widget.locator('.panel').evaluate(p => getComputedStyle(p).visibility === 'visible');
  const panel = await d.widget.locator('.panel').boundingBox();
  const overlapping = panel && box.x < panel.x + panel.width && box.x + box.width > panel.x && box.y < panel.y + panel.height && box.y + box.height > panel.y;
  assert(!(panelOpen && overlapping), 'the chat never covers what it shows');
  await desktop.screenshot({ path: path.join(out, '04-desktop-scrolled.png') });
  assert(await d.widget.locator('.card.guide').count() === 0, 'the card is gone once shown');
});

await check('words hidden in a closed <details> are revealed and highlighted', async () => {
  await desktop.evaluate(() => scrollTo(0, 0));
  if (!(await d.widget.locator('.panel').evaluate(p => getComputedStyle(p).visibility === 'visible'))) await d.widget.locator('.launcher').click();
  await d.ask(show({ text: 'FOLDED-OAK-8', label: 'Door code' }));
  await d.card().locator('[data-guide=go]').click();
  await d.marks('FOLDED-OAK-8');
  assert(await desktop.evaluate(() => document.querySelector('details').open), 'the details were opened');
});

await check('words that are not on the page: the chat says so, nothing moves', async () => {
  if (!(await d.widget.locator('.panel').evaluate(p => getComputedStyle(p).visibility === 'visible'))) await d.widget.locator('.launcher').click();
  await d.ask(show({ text: 'NOT-ON-THIS-PAGE-9', label: 'Nothing' }, 'Here.'));
  assert((await d.widget.locator('.msg.guide-note.missing').last().innerText()).includes('I couldn’t find “Nothing” on this page.'), 'missing note');
  assert(await d.widget.locator('.card.guide').count() === 0, 'no card');
});

await check('an answer that only points at a place still has words, and the card under it', async () => {
  await desktop.evaluate(() => scrollTo(0, 0));
  await d.ask(show({ text: 'FAR-AWAY-5', label: 'Entrance' }, ''));
  const last = await d.widget.locator('.msg.bot:not(.guide-note)').last().innerText();
  assert(last.includes('Here’s where to find “Entrance”.'), 'fallback words: ' + last);
  assert(await d.card().isVisible(), 'card shown');
  await d.card().locator('[data-guide=no]').click();
  assert(await d.widget.locator('.card.guide').count() === 0, 'No thanks removes the card');
});

await check('declining is remembered: the next request tells the assistant the visitor chose not to see it', async () => {
  await d.ask('do: search_website {"query":"opening hours"} then: We are open on weekdays.');
  const wire = JSON.stringify((await mockState()).last);
  assert(wire.includes('chose not to be shown “Entrance”') && wire.includes('Shown: the visitor saw “Studio name”') && wire.includes('could not find “NOT-ON-THIS-PAGE-9”'), 'outcomes in the replayed results');
});

await check('words that are not on another page are refused by the server: no card, the assistant is told why', async () => {
  await d.ask(show({ page: '/contact/', text: 'NOT-ON-CONTACT-1', label: 'Nothing' }, 'Sorry, I could not find it.'));
  assert(await d.widget.locator('.card.guide').count() === 0, 'no card');
  assert((await mockState()).websiteResults.some(r => r.includes('is not on Contact')), 'the model learned why');
});

await check('another page: "Take me there" opens it, the highlight follows the visitor, and the chat steps aside where it covers it', async () => {
  await desktop.evaluate(() => scrollTo(0, 0));
  await d.ask(show({ page: '/contact/', text: 'BLUE-HERON-42', label: 'Secret phrase' }, 'It is on the contact page.'));
  const card = (await d.card().innerText()).replace(/\s+/g, ' ');
  assert(card.includes('On the page “Contact”') && card.includes('Take me there'), 'card: ' + card);
  await d.card().locator('[data-guide=go]').click();
  await desktop.waitForURL(/\/contact\/?$/, { timeout: 15000 });
  await d.marks('BLUE-HERON-42');
  // On this page the open chat would cover the words (they end under its left edge): it steps aside and the bar says what was shown.
  const bar = d.widget.locator('.guide-bar');
  await bar.waitFor({ timeout: 5000 });
  assert((await bar.innerText()).includes('I’ve highlighted “Secret phrase” for you.') && await d.widget.getAttribute('open') === null, 'the chat stepped aside: ' + await bar.innerText());
  await desktop.screenshot({ path: path.join(out, '05-desktop-other-page.png') });
  await bar.locator('button[data-guide=back]').click();
  await d.widget.locator('.msg.guide-note').last().waitFor();
  const note = await d.widget.locator('.msg.guide-note').last().innerText();
  assert(note.includes('Secret phrase') && (await d.widget.locator('.log').innerText()).includes('It is on the contact page.'), 'back in the same conversation, which says it: ' + note);
  assert(await desktop.evaluate(() => sessionStorage.getItem('ligata-ai:guide:' + location.host)) === null, 'the hand-over is used once');
});

await check('"Show again" from the chat repeats it', async () => {
  await desktop.evaluate(() => scrollTo(0, 2000));
  await sleep(200);
  if (!(await d.widget.locator('.panel').evaluate(p => getComputedStyle(p).visibility === 'visible'))) await d.widget.locator('.launcher').click();
  await d.widget.locator('.msg.guide-note [data-guide=again]').last().click();
  await d.marks('BLUE-HERON-42');
});

await check('the site\'s own code can show the way: LigataAI.show()', async () => {
  assert(await desktop.evaluate(() => window.LigataAI.show({ text: 'FAR-AWAY-5', label: 'From the page' })) === true, 'found');
  await d.marks('FAR-AWAY-5');
  assert(await desktop.evaluate(() => window.LigataAI.show({ text: 'nowhere at all 123' })) === false, 'not found is false');
});

await check('the page\'s own title wins over the menu item of the same name', async () => {
  assert(new URL(desktop.url()).pathname.startsWith('/contact'), 'on the contact page');
  assert(await desktop.evaluate(() => window.LigataAI.show({ text: 'Contact', label: 'Title' })) === true, 'found');
  await d.marks('Contact');
});

// ---------- forms and other parts the page's text does not hold (0.13) ----------
/** The highlight surrounds the element (its start on screen, when it is taller than the screen). */
async function marksElement(p, selector) {
  const mark = p.locator('#ligata-ai-guide .mark').first();
  await mark.waitFor({ timeout: 8000 });
  await sleep(300);
  const box = await mark.boundingBox(), target = await p.locator(selector).first().boundingBox(), vh = await p.evaluate(() => innerHeight);
  assert(box && target, 'highlight and element found');
  assert(target.y >= 0 && target.y < vh * 0.6, `the element's start is on screen: ${JSON.stringify(target)}`);
  assert(box.x <= target.x + 1 && box.y <= target.y + 1 && box.x + box.width >= target.x + target.width - 1 && box.y + box.height >= target.y + target.height - 1, `the highlight surrounds the element: ${JSON.stringify({ box, target })}`);
  return { box, target };
}

await check('a form the page\'s text does not hold is read from the page as visitors get it, and listed with its page', async () => {
  await d.start('/');
  let result = '';
  // The pages are read in the background shortly after the site starts.
  for (let i = 0; i < 15 && !result.includes('Book a visit'); i++) {
    if (i) await sleep(2000);
    await d.ask('do: read_pages {"pages":["/contact/"]} then: Read it.');
    result = (await mockState()).websiteResults.join('\n');
  }
  assert(result.includes('Form “Book a visit”: Tell us when you would like to come by. · Your name * · Preferred day · Monday · Friday · Anything we should know? · Request a visit'), 'the form, as the visitor sees it: ' + result.slice(result.indexOf('Form')));
  assert(result.includes('Embedded “Map to the studio”'), 'the embedded map');
  assert(!/Newsletter|PREFILLED-NOTE|Checking connection|Leave empty|Please choose|Try again/.test(result), 'no footer form, typed text, status, trap field, placeholder or hidden button');
  const system = JSON.stringify((await mockState()).last.system);
  assert(system.includes('/contact/ · Form “Book a visit”, Embedded “Map to the studio”'), 'the list of pages names the form');
});

await check('"Take me there" to a form by its name: the other page opens and the whole form is highlighted', async () => {
  await d.start('/');
  await d.ask(show({ page: '/contact/', text: 'Book a visit', label: 'Booking form' }, 'The booking form is on the contact page.'));
  assert((await d.card().innerText()).includes('Take me there'), 'offered');
  await d.card().locator('[data-guide=go]').click();
  await desktop.waitForURL(/\/contact\/?$/, { timeout: 15000 });
  await marksElement(desktop, '.booking form');
  await desktop.screenshot({ path: path.join(out, '10-form.png') });
});

await check('the kind alone points at the content\'s form, not the newsletter in the footer; a map by its title', async () => {
  assert(await desktop.evaluate(() => window.LigataAI.show({ text: 'Form', label: 'Form' })) === true, 'found');
  await marksElement(desktop, '.booking form');
  assert(await desktop.evaluate(() => window.LigataAI.show({ text: 'Map to the studio', label: 'Map' })) === true, 'map found');
  await marksElement(desktop, 'iframe[title="Map to the studio"]');
});

await check('a field\'s label is highlighted together with its field', async () => {
  assert(await desktop.evaluate(() => window.LigataAI.show({ text: 'Preferred day', label: 'Day' })) === true, 'found');
  await marksElement(desktop, '#visit-day');
  await marksElement(desktop, 'label[for=visit-day]');
});

await check('an answer written before it shows a place ends there: the model is not asked again (it wrote the answer twice)', async () => {
  await d.start('/');
  const before = (await mockState()).requests;
  await d.ask('say: The booking form is on the contact page. do: show_on_website {"page":"/contact/","text":"Book a visit","label":"Booking form"} then: The booking form is on the contact page. A button below takes you there.');
  assert((await mockState()).requests - before === 1, 'one request to the model: ' + ((await mockState()).requests - before));
  const answer = await d.widget.locator('.msg.bot:not(.guide-note)').last().innerText();
  assert(answer.includes('The booking form is on the contact page.') && !answer.includes('A button below'), 'the answer, once: ' + answer);
  assert((await d.card().innerText()).includes('Take me there'), 'with the card');
  await d.ask('Thanks, that is all.');
  const replayed = JSON.stringify((await mockState()).last.messages);
  assert(replayed.includes('"name":"show_on_website"') && replayed.includes('Offered to show “Booking form”'), 'the next question repeats the round with its result');
});

// ---------- a visitor on a phone ----------
const phoneContext = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined });
const phone = await phoneContext.newPage();
pages.phone = phone;
const m = visitor(phone);

await check('phone: "Take me there" closes the full-screen chat, opens the page and shows a bar to come back', async () => {
  await m.start('/');
  await m.ask(show({ page: '/contact/', text: 'BLUE-HERON-42', label: 'Secret phrase' }, 'It is on the contact page.'));
  await phone.screenshot({ path: path.join(out, '06-phone-card.png') });
  await m.card().locator('[data-guide=go]').tap();
  await phone.waitForURL(/\/contact\/?$/, { timeout: 15000 });
  const { box } = await m.marks('BLUE-HERON-42');
  const bar = m.widget.locator('.guide-bar');
  await bar.waitFor({ timeout: 5000 });
  assert((await bar.innerText()).includes('I’ve highlighted “Secret phrase” for you.') && (await bar.innerText()).includes('Back to chat'), 'bar: ' + await bar.innerText());
  assert(await m.widget.getAttribute('open') === null, 'the chat stepped aside');
  const barBox = await bar.boundingBox();
  assert(!(box.y < barBox.y + barBox.height && box.y + box.height > barBox.y), 'the bar does not hide the highlight');
  assert(await m.widget.locator('.launcher').isHidden(), 'the bar stands in for the bubble');
  await phone.screenshot({ path: path.join(out, '07-phone-shown.png') });
  await bar.locator('[data-guide=back]').last().tap();
  await m.widget.locator('.msg.guide-note').last().waitFor();
  assert(await m.widget.locator('.panel').evaluate(p => getComputedStyle(p).visibility === 'visible') && await bar.isHidden(), 'back in the conversation');
  assert((await m.widget.locator('.log').innerText()).includes('It is on the contact page.'), 'the conversation survived the page change');
});

await check('phone: further down the same page, the chat steps aside, the page scrolls and the bar moves out of the way', async () => {
  await m.ask(show({ text: 'Studio line +41 44 000 00 00', label: 'Studio line' }, 'It is at the very bottom.'));
  const card = (await m.card().innerText()).replace(/\s+/g, ' ');
  assert(card.includes('Show me'), 'asks first on a phone, where the chat covers the page: ' + card);
  await m.card().locator('[data-guide=go]').tap();
  const { box } = await m.marks('Studio line +41 44 000 00 00');
  const barBox = await m.widget.locator('.guide-bar').boundingBox();
  assert(barBox && !(box.y < barBox.y + barBox.height && box.y + box.height > barBox.y), `the bar never covers the highlight: ${JSON.stringify({ box, barBox })}`);
  assert(await phone.evaluate(() => document.documentElement.style.overflow !== 'hidden'), 'the page can scroll again');
  await phone.screenshot({ path: path.join(out, '08-phone-footer.png') });
  await m.widget.locator('.guide-bar [data-guide=close]').tap();
  assert(await m.widget.locator('.guide-bar').isHidden() && await m.widget.locator('.launcher').isVisible(), 'closing the bar brings the bubble back');
});

// On a phone the keyboard comes up, and the page moves up above it, only when the visitor's tap focuses the field. A field focused
// from code has no keyboard, and the tap that follows lifts nothing until a letter is typed (seen when reopening a conversation).
await check('phone: an open conversation never focuses the field by itself, so the visitor\'s tap lifts it above the keyboard', async () => {
  const focused = () => m.widget.evaluate(el => el.shadowRoot.activeElement?.tagName || null);
  await m.widget.locator('.launcher').tap();
  await sleep(400);
  assert(await m.widget.getAttribute('open') !== null && await m.widget.locator('.msg.bot').count() > 0, 'a conversation with messages is open');
  assert(await focused() === null, 'opened with the bubble, the field is focused: ' + await focused());
  await phone.reload();
  await m.widget.locator('.composer textarea').waitFor();
  await sleep(400);
  assert(await m.widget.getAttribute('open') !== null, 'still open after the reload');
  assert(await focused() === null, 'after a reload, the field is focused: ' + await focused());
  // Focus that came another way (a browser can bring it back) is let go on the tap, so that the tap focuses the field afresh.
  await m.widget.evaluate(el => { const field = el.shadowRoot.querySelector('.composer textarea'); window.focuses = 0; field.addEventListener('focus', () => window.focuses++); field.focus(); });
  await m.widget.locator('.composer textarea').tap();
  assert(await focused() === 'TEXTAREA' && await phone.evaluate(() => window.focuses) === 2, 'the tap focused the field afresh: ' + await phone.evaluate(() => window.focuses));
  await m.widget.locator('.composer textarea').tap();
  assert(await phone.evaluate(() => window.focuses) === 2, 'a tap into a field the visitor focused leaves it be');
});

await check('phone: a place is scrolled below the site\'s sticky header, not under it', async () => {
  await phone.goto(base + '/contact/');
  await m.widget.locator('.panel').waitFor({ state: 'attached' });
  await phone.evaluate(() => window.LigataAI.close());
  await phone.evaluate(() => { const h = document.querySelector('header.site'); h.style.cssText = 'position:sticky;top:0;z-index:5;height:140px;background:#fff'; });
  assert(await phone.evaluate(() => window.LigataAI.show({ text: 'Form', label: 'Form' })) === true, 'found');
  await marksElement(phone, '.booking form');
  const { form, header } = await phone.evaluate(() => ({ form: document.querySelector('.booking form').getBoundingClientRect().top, header: document.querySelector('header.site').getBoundingClientRect().bottom }));
  assert(form >= header + 4, `the form starts below the header: ${JSON.stringify({ form, header })}`);
  await phone.screenshot({ path: path.join(out, '11-phone-sticky.png') });
});

await check('computer: opening the chat still puts the cursor in the field', async () => {
  await desktop.evaluate(() => { window.LigataAI.close(); window.LigataAI.open(); });
  await sleep(300);
  assert(await d.widget.evaluate(el => el.shadowRoot.activeElement?.tagName) === 'TEXTAREA', 'the field has the cursor');
});

// ---------- the site's choices ----------
await check('"Never" ask: another page opens after a short countdown the visitor can cancel', async () => {
  await pick('Ask the visitor first', 'Never');
  await saved();
  await d.start('/');
  await d.ask(show({ page: '/prices/', text: 'CHF 4,800', label: 'Price' }, 'Prices start at the top of the prices page.'));
  const card = (await d.card().innerText()).replace(/\s+/g, ' ');
  assert(card.includes('Opening “Prices”') && card.includes('Cancel'), 'countdown card: ' + card);
  await d.card().locator('[data-guide=cancel]').click();
  await sleep(3200);
  assert(new URL(desktop.url()).pathname === '/', 'cancelled: still on the home page');
  await d.ask(show({ page: '/prices/', text: 'CHF 4,800', label: 'Price' }, 'Prices are on the prices page.'));
  await desktop.waitForURL(/\/prices\/?$/, { timeout: 10000 });
  await d.marks('CHF 4,800');
});

await check('"Highlight only": nothing scrolls, the place is highlighted once the visitor gets there, and other pages are not offered', async () => {
  await pick('What it may do', 'Highlight only');
  await saved();
  await d.start('/');
  await d.ask(show({ page: '/contact/', text: 'BLUE-HERON-42', label: 'x' }, 'See the contact page.'));
  assert(await d.widget.locator('.card.guide').count() === 0 && (await mockState()).websiteResults.some(r => r.includes('Only things on the page the visitor is on')), 'another page is refused');
  await d.ask(show({ text: 'FAR-AWAY-5', label: 'Entrance' }, 'Further down the page.'));
  assert((await d.widget.locator('.event.note').last().innerText()).includes('as soon as it’s on your screen'), 'says it waits');
  assert(await desktop.evaluate(() => scrollY) === 0, 'nothing scrolled');
  await desktop.evaluate(() => document.querySelector('.far').scrollIntoView({ block: 'center' }));
  await d.marks('FAR-AWAY-5');
});

await check('switched off: the assistant gets no such tool and the widget nothing to show', async () => {
  await pick('What it may do', 'Open pages too');
  await pick('Ask the visitor first', 'Before scrolling or opening a page');
  await guideCard().locator('input[type=checkbox]').uncheck();
  await saved();
  const config = await (await fetch(base + '/api/ligata-ai/config')).json();
  assert(config.settings.guide === null, 'no guide settings for the widget');
  await d.start('/');
  await d.ask('Where is the phone number?');
  assert(!(await mockState()).last.tools.some(t => t.name === 'show_on_website'), 'no tool declared');
  await guideCard().locator('input[type=checkbox]').check();
  await saved();
  assert((await (await fetch(base + '/api/ligata-ai/config')).json()).settings.guide?.reach === 'pages', 'back on');
});

await check('reduced motion: no pulsing, and the page jumps instead of gliding', async () => {
  const calm = await (await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' })).newPage();
  pages.calm = calm;
  const c = visitor(calm);
  await c.start('/');
  await c.ask(show({ text: 'FAR-AWAY-5', label: 'Entrance' }));
  await c.card().locator('[data-guide=go]').click();
  await c.marks('FAR-AWAY-5');
  const pulse = await calm.evaluate(() => getComputedStyle(document.querySelector('#ligata-ai-guide').shadowRoot.querySelector('.mark'), '::after').animationName);
  assert(pulse === 'none', 'no pulse: ' + pulse);
  await calm.close();
  delete pages.calm;
});

await check('no page errors', async () => {
  assert(errors.length === 0, 'page errors: ' + errors.join(' | '));
});

await browser.close();
console.log(`\n${passed} passed, ${failed} failed. Screenshots in ${out}`);
process.exit(failed ? 1 : 0);
