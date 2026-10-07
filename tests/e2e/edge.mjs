// Failure and load cases against the REAL stack (llama-server via the launcher + gateway on :1210),
// with two Umbraco test sites (A :5310, B :5320) that are already connected and switched on.
//   node edge.mjs [filter]
// Kills and restarts local processes it started itself: llama-server (the launcher restarts it) and
// the gateway (restarted with the same command line).
import { chromium } from 'playwright-core';
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePdf } from '../../gateway/test/mock-llm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const out = path.join(root, '.runtime', 'e2e');
mkdirSync(out, { recursive: true });
const A = process.env.HOST_A || 'http://127.0.0.1:5310', B = process.env.HOST_B || 'http://127.0.0.1:5320';
const only = process.argv.slice(2);
let passed = 0, failed = 0;
async function check(name, fn) {
  if (only.length && !only.some(o => name.includes(o))) return;
  await idleGateway();
  const started = Date.now();
  try { await fn(); passed++; console.log(`✔ ${name} (${Math.round((Date.now() - started) / 1000)} s)`); }
  catch (error) { failed++; console.log(`✖ ${name}: ${error.message.split('\n')[0]}`); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
// -EncodedCommand avoids every layer of quoting between Node, cmd and PowerShell.
const ps = command => execSync(`powershell -NoProfile -EncodedCommand ${Buffer.from(command, 'utf16le').toString('base64')}`, { encoding: 'utf8' });
const health = async () => { try { return (await (await fetch('http://127.0.0.1:1210/v1/health')).json()).model; } catch { return 'gateway-down'; } };
const idleGateway = () => until(async () => { try { const s = await (await fetch('http://127.0.0.1:1212/status')).json(); return !s.queue.running && !s.queue.waiting; } catch { return true; } }, 600, 'the queue to drain');
async function until(predicate, seconds, label) {
  for (let i = 0; i < seconds * 2; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 500)); }
  throw new Error('timed out waiting for ' + label);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const open = async (host, name) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  page.on('pageerror', e => console.log('  page error: ' + e.message));
  page.on('console', m => m.type() === 'error' && console.log('  console: ' + m.text()));
  await page.goto(host + '/');
  const widget = page.locator('#ligata-ai');
  await widget.locator('.launcher').click();
  await widget.locator('textarea').waitFor();
  await widget.locator('[data-action=new]').click().catch(() => {});
  page.on('dialog', d => d.accept());
  return { page, widget, name };
};
const ask = async (w, text) => { await w.widget.locator('textarea').fill(text); await w.widget.locator('textarea').press('Enter'); };
const answers = w => w.widget.locator('.msg.bot');
const idle = w => w.widget.locator('.bubble.streaming').waitFor({ state: 'detached', timeout: 300000 });

await check('two websites at once: the second visitor sees their place in line, both get answers', async () => {
  const a = await open(A, 'A'), b = await open(B, 'B');
  const before = await answers(b).count();
  await ask(a, 'Please write a detailed answer of about 300 words describing everything you know about this studio and its prices.');
  await a.widget.locator('.msg.bot .bubble.streaming').waitFor({ timeout: 120000 });
  await ask(b, 'What does hosting cost per month?');
  await b.widget.locator('.queue-pos').waitFor({ timeout: 20000 });
  const queued = await b.widget.locator('.wait-text').innerText();
  assert(/line|next|Warteschlange|Nächstes/.test(queued), 'queue text shown: ' + queued);
  await b.page.screenshot({ path: path.join(out, '10-queued.png') });
  await idle(a);
  await answers(b).nth(before).waitFor({ timeout: 300000 });
  await idle(b);
  console.log('  B saw: "' + queued + '"');
  await a.page.context().close(); await b.page.context().close();
});

await check('a huge PDF shows reading progress and is answered', async () => {
  const lines = Array.from({ length: 1400 }, (_, i) => `Clause ${i}: The supplier delivers part ${i} within ${1 + i % 30} days for CHF ${100 + (i * 13) % 900}.`);
  lines.splice(900, 0, 'Clause SPECIAL: The contract may be cancelled with 47 days notice.');
  lines.unshift(`Contract reference ${Date.now()}`); // unique, so the prompt is never already cached
  const file = path.join(out, 'contract.pdf');
  writeFileSync(file, makePdf(lines.map(l => l.slice(0, 120))));
  const a = await open(A, 'A');
  await a.widget.locator('input[type=file]').setInputFiles(file);
  await a.widget.locator('.pending .file:not(.busy)').waitFor({ timeout: 60000 });
  console.log('  attachment: ' + (await a.widget.locator('.pending .file').innerText()).replace(/\s+/g, ' '));
  const before = await answers(a).count();
  await ask(a, 'How many days notice are needed to cancel the contract?');
  await a.widget.locator('.wait-text .progress').waitFor({ timeout: 60000 }).catch(async e => { throw new Error('no progress; widget shows: ' + (await a.widget.locator('.log').innerText()).replace(/s+/g, ' ').slice(-300)); });
  console.log('  progress: ' + (await a.widget.locator('.wait-text').innerText()).replace(/\s+/g, ' '));
  await a.page.screenshot({ path: path.join(out, '11-reading.png') });
  await answers(a).nth(before).waitFor({ timeout: 300000 });
  await idle(a);
  const text = await answers(a).nth(before).innerText();
  console.log('  answer: ' + text.replace(/\s+/g, ' ').slice(0, 160));
  assert(/47/.test(text), 'found the clause in the PDF');
  const meter = await a.widget.locator('.meter-text').innerText();
  console.log('  memory meter: ' + meter);
  await a.page.context().close();
});

await check('the model crashing mid-answer: visible error, automatic restart, retry works', async () => {
  const a = await open(A, 'A');
  await ask(a, 'Write a long, detailed description (about 400 words) of how a website project with this studio works.');
  await a.widget.locator('.msg.bot .bubble.streaming').waitFor({ timeout: 120000 });
  ps("Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force");
  await a.widget.locator('.notice.error').waitFor({ timeout: 30000 });
  console.log('  visitor saw: ' + (await a.widget.locator('.notice.error').innerText()).replace(/\s+/g, ' '));
  await a.page.screenshot({ path: path.join(out, '12-crash.png') });
  await until(async () => (await health()) !== 'ready', 10, 'gateway to notice');
  await until(async () => (await health()) === 'ready', 180, 'the launcher to restart the model');
  await a.widget.locator('.notice.error [data-retry]').click();
  await answers(a).nth(2).waitFor({ timeout: 300000 }).catch(() => answers(a).nth(1).waitFor({ timeout: 300000 }));
  await idle(a);
  await a.page.context().close();
});

await check('gateway down: offline state with contact options, then reconnect', async () => {
  // Stop whichever process serves the public gateway port.
  ps("Get-NetTCPConnection -LocalPort 1210 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }");
  await until(async () => (await health()) === 'gateway-down', 10, 'gateway to stop');
  const a = await open(A, 'A');
  await a.page.waitForTimeout(2500);
  assert(await a.widget.getAttribute('state') === 'offline', 'status offline, got ' + await a.widget.getAttribute('state'));
  await a.widget.locator('.notice', { hasText: /not available|offline/i }).waitFor({ timeout: 10000 });
  assert(await a.widget.locator('textarea').isDisabled(), 'input disabled while offline');
  await a.page.screenshot({ path: path.join(out, '13-offline.png') });
  const log = openSync(path.join(root, 'runtime', 'logs', 'gateway.log'), 'a');
  spawn(process.execPath, ['src/main.mjs'], { cwd: path.join(root, 'gateway'), detached: true, stdio: ['ignore', log, log], windowsHide: true }).unref();
  await until(async () => (await health()) === 'ready', 30, 'gateway to come back');
  await a.widget.locator('[data-reconnect]').click({ timeout: 3000 }).catch(() => {}); // the widget may already have reconnected on its own
  await until(async () => (await a.widget.getAttribute('state')) === 'ready', 20, 'widget to reconnect');
  await ask(a, 'Hello again!');
  await answers(a).nth(1).waitFor({ timeout: 120000 });
  await a.page.context().close();
  console.log('  gateway restarted');
});

await browser.close();
console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${out}`);
process.exit(failed ? 1 : 0);
