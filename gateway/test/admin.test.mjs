import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAdmin } from '../src/admin.mjs';
import { KeyStore } from '../src/keys.mjs';
import { Scheduler } from '../src/queue.mjs';
import { SlotManager } from '../src/slots.mjs';

const port = 18000 + Math.floor(Math.random() * 2000);
const dataDir = mkdtempSync(path.join(tmpdir(), 'ligata-admin-'));
const keys = new KeyStore(dataDir, { requestsPerDay: 10, maxContextTokens: 1000, maxQueued: 2 });
const llm = { health: async () => 'ready', props: async () => ({ model: 'm', contextTokens: 1000, slots: 1, vision: true }) };
const admin = createAdmin({ config: { adminPort: port }, keys, scheduler: new Scheduler({ maxLength: 5, maxPerKey: 2, maxWaitSeconds: 5 }), slots: new SlotManager(), monitor: { latest: null, history: [] }, llm });
before(() => new Promise(r => admin.listen(port, '127.0.0.1', r)));
after(() => { admin.close(); rmSync(dataDir, { recursive: true, force: true }); });
const base = `http://127.0.0.1:${port}`;

test('the operator page and status are served on loopback', async () => {
  assert.match(await (await fetch(base + '/')).text(), /Ligata AI gateway/);
  assert.equal((await (await fetch(base + '/status')).json()).model, 'ready');
});

test('keys can be created and revoked with the admin header only', async () => {
  const denied = await fetch(base + '/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
  assert.equal(denied.status, 404, 'no custom header, no write (CSRF)');
  const created = await (await fetch(base + '/keys', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ligata-Admin': '1' }, body: JSON.stringify({ name: 'Admin test', requestsPerDay: 5 }) })).json();
  assert.match(created.key, /^lai_[a-f0-9]{12}_/);
  assert.equal(created.record.limits.requestsPerDay, 5);
  assert.ok(keys.verify('Bearer ' + created.key));
  await fetch(`${base}/keys/${created.record.id}/revoke`, { method: 'POST', headers: { 'X-Ligata-Admin': '1' } });
  keys.reload();
  assert.equal(keys.verify('Bearer ' + created.key), null);
});

test('requests for another host name are refused (DNS rebinding)', async () => {
  const http = await import('node:http');
  const status = await new Promise(resolve => http.get({ host: '127.0.0.1', port, path: '/status', headers: { Host: 'evil.example' } }, r => resolve(r.statusCode)));
  assert.equal(status, 421);
});
