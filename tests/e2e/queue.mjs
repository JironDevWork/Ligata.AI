// What visitors see when more people ask than the GPU answers at once (three): screenshots of the line.
// Needs the test host against a real gateway, trusting the test IPs below (one visitor per IP):
//   KEY_FILE=<key> GATEWAY=http://127.0.0.1:1210 LigataAI__TrustCloudflareLoopbackHeader=true bash restart-host.sh
//   node queue.mjs   → .runtime/e2e/queue/*.png
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', '..', '.runtime', 'e2e', 'queue');
mkdirSync(out, { recursive: true });
const base = process.env.HOST || 'http://127.0.0.1:5310';
const admin = process.env.ADMIN || 'http://127.0.0.1:1212';
const questions = [
  'Explain in detail how a website project with you works, from the first call to the launch.',
  'What exactly is included in a small business website? Please list everything.',
  'Describe step by step how hosting, updates and backups work with you.',
  'How long does a typical project take, and what do you need from me in each phase?',
  'Can you explain the difference between your website packages in detail?',
  'What should I prepare before our first call? Give me a detailed checklist.',
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const visitors = [];
for (const [i, question] of questions.entries()) {
  const phone = i === questions.length - 1;
  // The site identifies visitors by IP (HMAC); each browser gets its own documentation-range address.
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 860 }, locale: 'en-US', extraHTTPHeaders: { 'CF-Connecting-IP': `203.0.113.${10 + i}` } });
  const page = await context.newPage();
  await page.goto(base + '/');
  const widget = page.locator('#ligata-ai');
  await widget.locator('.launcher').click();
  await widget.locator('[data-agree]').click();
  await widget.locator('#lai-input').waitFor();
  await widget.locator('#lai-input').fill(question);
  visitors.push({ i: i + 1, page, widget, phone });
}

// Everyone asks at the same moment.
await Promise.all(visitors.map(v => v.widget.locator('#lai-input').press('Enter')));
const queued = [];
await Promise.all(visitors.map(async v => {
  try { await v.widget.locator('.queue-pos').waitFor({ timeout: 8000 }); queued.push(v); } catch { /* answered at once */ }
}));
queued.sort((a, b) => a.i - b.i);
console.log(`${visitors.length - queued.length} answered at once, ${queued.length} waiting`);

for (const v of queued) {
  const text = (await v.widget.locator('.waiting .wait-text').innerText()).replace(/\s+/g, ' ');
  console.log(`  visitor ${v.i}: ${text}`);
  await v.page.screenshot({ path: path.join(out, `visitor-${v.i}-waiting${v.phone ? '-phone' : ''}.png`) });
}
const answering = visitors.find(v => !queued.includes(v));
if (answering) await answering.page.screenshot({ path: path.join(out, `visitor-${answering.i}-answering.png`) });

// The operator page on the AI machine at the same moment.
const operator = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await operator.goto(admin + '/');
await operator.waitForFunction(() => /answering|idle/.test(document.getElementById('queue')?.textContent || ''), null, { timeout: 10000 });
console.log('  operator page: ' + await operator.locator('#queue').innerText());
await operator.screenshot({ path: path.join(out, 'operator.png'), clip: { x: 0, y: 0, width: 1280, height: 520 } });

// The last in line moves up and gets its answer.
const last = queued.at(-1);
if (last) {
  await last.widget.locator('.queue-pos', { hasText: 'You are next' }).waitFor({ timeout: 180000 });
  await last.page.screenshot({ path: path.join(out, `visitor-${last.i}-next${last.phone ? '-phone' : ''}.png`) });
  await last.widget.locator('.bubble.streaming').waitFor({ timeout: 180000 });
  await last.page.waitForTimeout(1500);
  await last.page.screenshot({ path: path.join(out, `visitor-${last.i}-answer${last.phone ? '-phone' : ''}.png`) });
}
for (const v of visitors) await v.widget.locator('.waiting').waitFor({ state: 'detached', timeout: 240000 }).catch(() => {});
await browser.close();
console.log('screenshots in ' + out);
