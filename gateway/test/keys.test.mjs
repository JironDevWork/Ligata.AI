import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KeyStore } from '../src/keys.mjs';

const limits = { requestsPerDay: 10, maxContextTokens: 1000, maxQueued: 2 };
const fresh = () => mkdtempSync(path.join(tmpdir(), 'ligata-keys-'));

test('every write keeps the previous good keys.json as keys.json.bak', () => {
  const dir = fresh();
  try {
    const keys = new KeyStore(dir, limits);
    const first = keys.create('First site');
    assert.equal(existsSync(path.join(dir, 'keys.json.bak')), false, 'nothing to back up on the first write');
    keys.create('Second site');
    const backup = JSON.parse(readFileSync(path.join(dir, 'keys.json.bak'), 'utf8'));
    assert.deepEqual(backup.keys.map(k => k.id), [first.record.id]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a keys.json full of zeros (unclean shutdown) falls back to the backup instead of revoking every site', () => {
  const dir = fresh();
  try {
    const keys = new KeyStore(dir, limits);
    const site = keys.create('Site');
    keys.create('Another site');
    writeFileSync(path.join(dir, 'keys.json'), Buffer.alloc(1914));
    const restarted = new KeyStore(dir, limits);
    assert.match(restarted.problem, /damaged; using keys\.json\.bak/);
    assert.ok(restarted.verify('Bearer ' + site.key), 'the site from the last good version still works');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('without a usable backup the keys already loaded stay', () => {
  const dir = fresh();
  try {
    const keys = new KeyStore(dir, limits);
    const site = keys.create('Site');
    writeFileSync(path.join(dir, 'keys.json'), 'not json');
    keys.reload();
    assert.match(keys.problem, /no usable backup/);
    assert.ok(keys.verify('Bearer ' + site.key), 'a damaged file does not disconnect a running gateway');
    rmSync(path.join(dir, 'keys.json'));
    keys.reload();
    assert.equal(keys.problem, null);
    assert.equal(keys.keys.size, 0, 'a removed file means no keys');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
