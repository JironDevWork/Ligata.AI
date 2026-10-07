// Renders the chat bubble in several looks with a seeded conversation for visual review (no model calls).
//   node gallery.mjs   → .runtime/e2e/gallery-*.png
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', '..', '.runtime', 'e2e');
mkdirSync(out, { recursive: true });
const script = readFileSync(path.join(here, '..', '..', 'src', 'Ligata.AI', 'PublicAssets', 'ligata-ai.js'), 'utf8');
const themes = {
  ligata: { accent: '#2f5bff', accentText: '#ffffff', background: '#ffffff', surface: '#f3f4f8', text: '#15171f', mutedText: '#5d6272', userBubble: '#2f5bff', userText: '#ffffff', assistantBubble: '#f3f4f8', assistantText: '#15171f', radius: 20 },
  midnight: { accent: '#8b7dff', accentText: '#14151c', background: '#14151c', surface: '#1e2029', text: '#f1f2f7', mutedText: '#a0a4b4', userBubble: '#8b7dff', userText: '#14151c', assistantBubble: '#1e2029', assistantText: '#f1f2f7', radius: 22, colorScheme: 'dark' },
  sunset: { accent: '#c9461f', accentText: '#ffffff', background: '#fffaf6', surface: '#fbeee6', text: '#2a1710', mutedText: '#7a5a4c', userBubble: '#c9461f', userText: '#ffffff', assistantBubble: '#fbeee6', assistantText: '#2a1710', radius: 24, font: 'rounded' },
  graphite: { accent: '#111317', accentText: '#ffffff', background: '#ffffff', surface: '#f2f2f3', text: '#111317', mutedText: '#63666d', userBubble: '#111317', userText: '#ffffff', assistantBubble: '#f2f2f3', assistantText: '#111317', radius: 10, position: 'right', launcherIcon: 'sparkle' },
};
const conversation = [
  { role: 'user', content: 'Was kostet eine Website für ein kleines Unternehmen?', files: [] },
  { role: 'assistant', content: 'Eine Website für kleine Unternehmen beginnt bei **CHF 4’800**. Darin enthalten sind:\n\n- Design und Umsetzung in Umbraco\n- Inhalte für bis zu 8 Seiten\n- Einführung ins CMS\n\nFür ein genaues Angebot buche am besten ein [kostenloses Erstgespräch](/kontakt/).' },
  { role: 'user', content: 'Kann ich das Hosting auch bei euch machen?', files: [{ kind: 'document', name: 'Angebot-2026.pdf', pages: 3, gone: true }] },
  { role: 'assistant', content: 'Ja, Hosting kostet **CHF 25 pro Monat** inklusive Updates und täglichen Backups.' },
];
const settings = theme => ({
  name: 'Ligata Assistent', greeting: 'Hallo! Ich beantworte Fragen zu Ligata. Wie kann ich helfen?', suggestions: ['Was kostet eine Website?', 'Wie läuft ein Projekt ab?'], avatarUrl: '', language: 'de', inputPlaceholder: '',
  privacyNotice: 'Antworten erzeugt eine KI auf unserem eigenen Server. Nachrichten werden nicht gespeichert.', privacyUrl: '/datenschutz/', fallbackMessage: '', fallbackEmail: 'info@ligata.ch', fallbackUrl: '/kontakt/',
  appearance: { theme: 'custom', colorScheme: 'light', position: 'left', font: 'inherit', launcherSize: 60, launcherIcon: 'chat', launcherLabel: 'Fragen? Frag uns', panelWidth: 400, panelHeight: 640, offsetX: 24, offsetY: 24, showContextMeter: true, showQueuePosition: true, showBranding: true, animations: false, teaser: '', teaserDelaySeconds: 0, zIndex: 2147483000, ...theme },
  allowImages: true, allowPdfs: true, contextLimit: 65536, baseTokens: 7400, limits: {},
});
const page = (theme, dark) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ligata</title>
<style>body{margin:0;font-family:"Segoe UI",system-ui,sans-serif;background:${dark ? '#0f1115' : '#f6f5f1'};color:${dark ? '#e8e9ee' : '#1c1d22'}}main{max-width:720px;margin:0 auto;padding:90px 32px}h1{font-size:52px;letter-spacing:-1.5px;margin:0 0 18px}p{font-size:19px;line-height:1.6;opacity:.75}</style></head>
<body><main><h1>Websites, die arbeiten.</h1><p>Ligata entwickelt schnelle, barrierearme Umbraco-Websites für Schweizer KMU – vom ersten Entwurf bis zum Betrieb.</p></main>
<script>sessionStorage.setItem('ligata-ai:' + location.host, JSON.stringify({ at: Date.now(), open: true, context: { used: 9800, limit: 65536 }, messages: ${JSON.stringify(conversation)} }));</script>
<script src="/ligata-ai.js" data-ligata-ai data-api="http://127.0.0.1:1/api" data-settings='${JSON.stringify(settings(theme)).replace(/'/g, '&#39;')}'></script></body></html>`;

let current = null;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/ligata-ai.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(script); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(current);
});
await new Promise(r => server.listen(5312, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const [name, theme] of Object.entries(themes)) {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 860 }], ...(name === 'ligata' || name === 'midnight' ? [['mobile', { width: 390, height: 844 }]] : [])]) {
    current = page(theme, name === 'midnight');
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const p = await context.newPage();
    await p.goto('http://127.0.0.1:5312/');
    await p.locator('#ligata-ai .msg.bot').nth(2).waitFor({ timeout: 10000 });
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(out, `gallery-${name}-${label}.png`) });
    await context.close();
  }
}
// Closed state with label and teaser
current = page(themes.ligata, false).replace(/<script>sessionStorage[^<]*<\/script>/, '').replace('"teaser":""', '"teaser":"👋 Hallo! Kann ich dir helfen, das Richtige zu finden?"');
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const p = await context.newPage();
await p.goto('http://127.0.0.1:5312/');
await p.locator('#ligata-ai .teaser').waitFor({ timeout: 10000 });
await p.screenshot({ path: path.join(out, 'gallery-closed-teaser.png') });
await browser.close();
server.close();
console.log('gallery written to ' + out);
