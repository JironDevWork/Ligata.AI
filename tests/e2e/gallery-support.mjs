// Visual review of the team features in other themes and sizes: the real widget with a mocked API and seeded conversations.
//   node gallery-support.mjs   → .runtime/e2e/gallery-support/*.png
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', '..', '.runtime', 'e2e', 'gallery-support');
mkdirSync(out, { recursive: true });
const widget = readFileSync(path.join(here, '..', '..', 'src', 'Ligata.AI', 'PublicAssets', 'ligata-ai.js'), 'utf8');
const themes = {
  midnight: { theme: 'midnight', colorScheme: 'dark', accent: '#8b7dff', accentText: '#ffffff', background: '#14151c', surface: '#1e2029', text: '#f1f2f7', mutedText: '#a0a4b4', userBubble: '#8b7dff', userText: '#ffffff', assistantBubble: '#1e2029', assistantText: '#f1f2f7', radius: 22 },
  sunset: { theme: 'sunset', colorScheme: 'light', accent: '#e2552d', accentText: '#ffffff', background: '#fffaf6', surface: '#fbeee6', text: '#2a1710', mutedText: '#7a5a4c', userBubble: '#e2552d', userText: '#ffffff', assistantBubble: '#fbeee6', assistantText: '#2a1710', radius: 24 },
};
const settings = appearance => ({
  name: 'Lia', greeting: 'Hi! I am Lia, the assistant of Ligata. How can I help?', suggestions: [], language: 'en', privacyNotice: 'Answers come from an AI on our own server and can be wrong.', privacyUrl: '/privacy/',
  appearance: { ...appearance, position: 'left' }, allowImages: true, allowPdfs: true, contextLimit: 65536, baseTokens: 4200, limits: {},
  features: { assistant: true, liveChat: true, email: true },
  team: { teamName: 'Ligata Support', suggest: true, button: true, nameField: 'optional', emailField: 'optional', emailWhenOffline: true, days: 3 },
  contact: { title: '', intro: '' }, captcha: { siteKey: 'x', consentMode: 'explicit', cookiebotCategory: 'marketing' },
});
const now = Date.now();
const anna = { id: '7d3c0f2e-1111-4a4a-9c9c-000000000001', name: 'Anna Keller', initials: 'AK', photo: false };
const conversations = [
  {
    id: 'c1', kind: 'ai', title: 'Can you migrate our old Joomla site?', created: now - 900000, updated: now - 60000, unread: 0, context: { used: 6100, limit: 65536 },
    messages: [
      { role: 'user', content: 'Can you migrate our old Joomla site with 400 pages?', at: now - 900000 },
      { role: 'assistant', content: 'I could not find anything about Joomla migrations in my information. Our team can tell you more.\n[[team]]', handoff: true, at: now - 880000 },
      { role: 'system', event: 'request', at: now - 870000, seq: 3 },
      { role: 'system', event: 'waiting', content: 'Thanks! We let the team know. Someone will join you here shortly.', at: now - 869000 },
      { role: 'system', event: 'join', agent: anna, at: now - 600000, seq: 5 },
      { role: 'agent', agent: anna, content: 'Hi! I am Anna from the Ligata team. Yes, we migrate Joomla sites regularly. Do you know roughly how many of the 400 pages still matter?', at: now - 590000, seq: 6 },
      { role: 'user', content: 'Maybe 120. The rest is old news.', at: now - 300000, seq: 7 },
      { role: 'agent', agent: anna, content: 'Perfect, then we would import those 120 and redirect the rest. I will send you a short proposal by email today.', at: now - 120000, seq: 8 },
    ],
    team: { id: '00000000-0000-0000-0000-0000000000c1', token: 'x', kind: 'chat', seq: 8, version: 0, state: 'active', agents: [anna], typing: ['Anna Keller'] },
  },
  { id: 'c2', kind: 'ai', title: 'What does hosting cost?', created: now - 86400000, updated: now - 86000000, unread: 0, messages: [{ role: 'user', content: 'What does hosting cost?', at: now - 86400000 }, { role: 'assistant', content: 'Hosting is **CHF 25** per month.', at: now - 86390000 }], context: { used: 4400, limit: 65536 }, team: null },
  { id: 'c3', kind: 'email', title: 'Invoice question', created: now - 7200000, updated: now - 7200000, unread: 0, messages: [{ role: 'user', content: 'Invoice question', at: now - 7200000 }, { role: 'system', event: 'email-sent', content: 'me@example.ch', at: now - 7200000 }], team: { id: 'c3', token: 'x', kind: 'email', seq: 2, state: 'open', agents: [] } },
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function shot(name, theme, { viewport = { width: 1100, height: 820 }, activeId = 'c1', view = 'chat', action } = {}) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  const page = await context.newPage();
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.endsWith('/widget.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: widget });
    if (url.includes('/api/config')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'ready', team: { online: 2 }, settings: {} }) });
    if (url.includes('/poll')) return new Promise(() => {}); // a long poll that never answers: the seeded state stays
    if (url.includes('/api/')) return route.fulfill({ status: 404, body: '' });
    const dark = theme.colorScheme === 'dark';
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui,sans-serif;background:${dark ? '#0d0e12' : '#f6f4f1'};color:${dark ? '#ddd' : '#222'}}main{padding:60px;max-width:640px}h1{font-size:40px;margin:0 0 12px}p{opacity:.7;line-height:1.6}</style>
      <script>localStorage.setItem('ligata-ai:v2:' + location.host, ${JSON.stringify(JSON.stringify({ conversations, activeId, open: true, view }))});</script></head>
      <body><main><h1>Ligata</h1><p>Websites, carefully made in Zurich.</p></main><script src="/widget.js" data-ligata-ai data-api="/api" data-settings='${JSON.stringify(settings(theme)).replace(/'/g, '&#39;')}'></script></body></html>` });
  });
  await page.goto('http://gallery.test/');
  await page.waitForTimeout(700);
  if (action) await action(page.locator('#ligata-ai'), page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, name + '.png') });
  await context.close();
}

await shot('dark-live-chat', themes.midnight);
await shot('dark-list', themes.midnight, { view: 'list' });
await shot('dark-request-sheet', themes.midnight, { activeId: 'c2', action: w => w.locator('[data-action=team]').click() });
await shot('sunset-handoff', themes.sunset, { activeId: 'c2', action: async (w, page) => {
  await page.evaluate(() => {});
  await w.locator('[data-action=list]').click(); await w.locator('.list .item', { hasText: 'Joomla' }).locator('.open-item').click();
} });
await shot('phone-live-chat', themes.sunset, { viewport: { width: 390, height: 780 } });
await shot('phone-request-sheet', themes.midnight, { viewport: { width: 390, height: 780 }, activeId: 'c2', action: w => w.locator('[data-action=team]').click() });
await browser.close();
console.log('Screenshots in ' + out);
