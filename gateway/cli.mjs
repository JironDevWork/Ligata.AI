#!/usr/bin/env node
// Operator CLI for API keys and status. Runs on the gateway machine only.
//   node cli.mjs keys create "Client website" [--requests-per-day 2000] [--max-context 131072] [--max-queued 5]
//   node cli.mjs keys list
//   node cli.mjs keys limits <id|name> --requests-per-day 500
//   node cli.mjs keys revoke <id|name>
//   node cli.mjs status
import { loadConfig } from './src/config.mjs';
import { KeyStore } from './src/keys.mjs';

const [, , area, action, ...rest] = process.argv;
const config = loadConfig();
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i];
  else positional.push(rest[i]);
}
const limits = Object.fromEntries(Object.entries({ requestsPerDay: flags['requests-per-day'], maxContextTokens: flags['max-context'], maxQueued: flags['max-queued'] })
  .filter(([, v]) => v !== undefined).map(([k, v]) => {
    const number = Number(v);
    if (!Number.isInteger(number) || number < 1) { console.error(`--${k} must be a positive whole number.`); process.exit(1); }
    return [k, number];
  }));

const keys = new KeyStore(config.dataDir, config.keyDefaults);
if (keys.problem) console.error(`Warning: ${keys.problem}.`);
const row = k => `${k.id}  ${k.revokedAt ? 'REVOKED ' : 'active  '}  ${k.name.padEnd(28)}  ${String(k.usage?.requests ?? 0).padStart(5)}/${k.limits.requestsPerDay} today  ctx≤${k.limits.maxContextTokens}  queue≤${k.limits.maxQueued}  last ${k.usage?.lastUsedAt ?? 'never'}`;

try {
  if (area === 'keys' && action === 'create') {
    const { key, record } = keys.create(positional.join(' '), limits);
    console.log(`Created key for "${record.name}" (id ${record.id}).\n\n  ${key}\n\nStore it in the website's Umbraco backoffice (AI Assistant → Connection) or in LigataAI:ApiKey.\nIt is shown only once; the gateway keeps only a hash.`);
  } else if (area === 'keys' && action === 'list') {
    const list = keys.list();
    console.log(list.length ? list.map(row).join('\n') : 'No keys yet. Create one with: node cli.mjs keys create "Client website"');
  } else if (area === 'keys' && action === 'revoke') {
    console.log('Revoked: ' + row(keys.revoke(positional.join(' '))));
  } else if (area === 'keys' && action === 'limits') {
    if (!Object.keys(limits).length) throw new Error('Pass at least one of --requests-per-day, --max-context, --max-queued.');
    console.log('Updated: ' + row(keys.setLimits(positional.join(' '), limits)));
  } else if (area === 'status') {
    const response = await fetch(`http://127.0.0.1:${config.adminPort}/status`).catch(() => null);
    if (!response) throw new Error('The gateway is not running (no answer on the admin port).');
    const status = await response.json();
    const m = status.memory;
    console.log(`Model: ${status.model}${status.props ? ` (${status.props.model}, ${status.props.contextTokens} tokens context, vision ${status.props.vision ? 'on' : 'off'})` : ''}`);
    console.log(`Queue: ${status.queue.running ? 'answering' : 'idle'}, ${status.queue.waiting} waiting, ${status.queue.completed} answered since start, ~${status.queue.averageSeconds}s per answer`);
    if (status.slots?.length > 1) console.log('Prompt caches: ' + status.slots.map(s => `slot ${s.id} ${s.site ? `${status.keys.find(k => k.id === s.site)?.name ?? s.site} (${s.tokens} tokens, idle ${s.idleSeconds}s)` : 'empty'}`).join(' | '));
    if (m?.running) console.log(`Memory: RAM ${m.workingSetMB} MB | VRAM ${m.processVramMB} MB (GPU ${m.gpuUsedMB}/${m.gpuTotalMB} MB) | GPU-shared RAM ${m.sharedRamMB} MB${m.spilling ? '  <-- SPILLING INTO SYSTEM RAM' : ''}`);
    console.log(status.keys.map(row).join('\n'));
  } else {
    console.log('Usage:\n  node cli.mjs keys create "Client website" [--requests-per-day N] [--max-context N] [--max-queued N]\n  node cli.mjs keys list\n  node cli.mjs keys limits <id|name> [--requests-per-day N] [--max-context N] [--max-queued N]\n  node cli.mjs keys revoke <id|name>\n  node cli.mjs status');
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
