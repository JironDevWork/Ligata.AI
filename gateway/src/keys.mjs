import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import path from 'node:path';

// API keys look like lai_<id>_<secret>. Only SHA-256(secret) is stored, so a leaked keys.json
// cannot be used to call the gateway. The plaintext key is shown once, at creation.
//
// keys.json is written only by the CLI; the running gateway re-reads it when it changes.
// usage.json is written only by the gateway. Two writers never touch the same file.
const KEY_PATTERN = /^lai_([a-f0-9]{12})_([A-Za-z0-9_-]{43})$/;
const sha256 = value => createHash('sha256').update(value).digest();
const today = () => new Date().toISOString().slice(0, 10);

function readJson(file, fallback) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback; }
  catch { return fallback; }
}
const parses = file => { try { return Array.isArray(JSON.parse(readFileSync(file, 'utf8')).keys); } catch { return false; } };
// The data reaches the disk before the rename: after a power cut or a forced logout the file is either the old or
// the new version, never a file of zeros (which happened to keys.json once and silently disconnected every site).
// keys.json also keeps its last good version as keys.json.bak.
function writeJson(file, value, { backup = false } = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const fd = openSync(temporary, 'w', 0o600);
  try { writeSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  if (backup && existsSync(file) && parses(file)) copyFileSync(file, `${file}.bak`);
  renameSync(temporary, file);
}

export class KeyStore {
  constructor(dataDir, defaults) {
    this.file = path.join(dataDir, 'keys.json');
    this.usageFile = path.join(dataDir, 'usage.json');
    this.defaults = defaults;
    this.reload();
    this.usage = readJson(this.usageFile, {});
    this.dirty = false;
  }

  /**
   * Re-reads keys.json. A damaged file never revokes every site: the last good copy (keys.json.bak) is used,
   * or the keys already loaded stay. problem says what happened (null when keys.json was read).
   */
  reload() {
    this.problem = null;
    if (!existsSync(this.file)) { this.keys = new Map(); return; }
    const source = parses(this.file) ? this.file : existsSync(`${this.file}.bak`) && parses(`${this.file}.bak`) ? `${this.file}.bak` : null;
    if (source !== this.file) this.problem = source ? 'keys.json is damaged; using keys.json.bak' : 'keys.json is damaged and has no usable backup; keeping the keys already loaded';
    if (!source) { this.keys ||= new Map(); return; }
    this.keys = new Map((JSON.parse(readFileSync(source, 'utf8')).keys || []).map(k => [k.id, k]));
  }

  saveKeys() { writeJson(this.file, { version: 1, keys: [...this.keys.values()] }, { backup: true }); }

  create(name, limits = {}) {
    name = String(name || '').trim();
    if (!name || name.length > 100) throw new Error('A key needs a name of up to 100 characters (for example the client website).');
    this.reload();
    const id = randomBytes(6).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const record = { id, name, hash: sha256(secret).toString('hex'), createdAt: new Date().toISOString(), revokedAt: null, limits: { ...this.defaults, ...limits } };
    this.keys.set(id, record);
    this.saveKeys();
    return { key: `lai_${id}_${secret}`, record: this.visible(record) };
  }

  find(idOrName) {
    this.reload();
    const key = this.keys.get(idOrName) || [...this.keys.values()].find(k => k.name === idOrName);
    if (!key) throw new Error(`Unknown key "${idOrName}". Use "keys list" to see ids.`);
    return key;
  }

  revoke(idOrName) {
    const key = this.find(idOrName);
    key.revokedAt = new Date().toISOString();
    this.saveKeys();
    return this.visible(key);
  }

  setLimits(idOrName, limits) {
    const key = this.find(idOrName);
    key.limits = { ...key.limits, ...limits };
    this.saveKeys();
    return this.visible(key);
  }

  /** Returns the key record for a valid, active key, otherwise null. Constant-time hash comparison. */
  verify(header) {
    const token = String(header || '').replace(/^Bearer\s+/i, '').trim();
    const match = KEY_PATTERN.exec(token);
    if (!match) return null;
    const key = this.keys.get(match[1]);
    const valid = timingSafeEqual(sha256(match[2]), key ? Buffer.from(key.hash, 'hex') : sha256('no such key'));
    return valid && key && !key.revokedAt ? key : null;
  }

  usageOf(key) {
    let usage = this.usage[key.id];
    if (!usage) usage = this.usage[key.id] = { day: today(), requests: 0, promptTokens: 0, completionTokens: 0, totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, lastUsedAt: null };
    if (usage.day !== today()) Object.assign(usage, { day: today(), requests: 0, promptTokens: 0, completionTokens: 0 });
    return usage;
  }

  hasQuota(key) { return this.usageOf(key).requests < key.limits.requestsPerDay; }

  /** Counts a request against the daily quota. Returns false when the quota is used up. */
  take(key) {
    const usage = this.usageOf(key);
    if (usage.requests >= key.limits.requestsPerDay) return false;
    usage.requests++;
    usage.totalRequests++;
    usage.lastUsedAt = new Date().toISOString();
    this.dirty = true;
    return true;
  }

  record(key, promptTokens, completionTokens) {
    const usage = this.usageOf(key);
    usage.promptTokens += promptTokens; usage.totalPromptTokens += promptTokens;
    usage.completionTokens += completionTokens; usage.totalCompletionTokens += completionTokens;
    this.dirty = true;
  }

  flush() { if (this.dirty) { writeJson(this.usageFile, this.usage); this.dirty = false; } }

  visible({ hash, ...key }) { return { ...key, usage: this.usage[key.id] || null }; }
  list() { this.reload(); return [...this.keys.values()].map(k => this.visible(k)); }
}
