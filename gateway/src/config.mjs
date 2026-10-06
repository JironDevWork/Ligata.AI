import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const defaults = {
  // Public API. Bind to loopback and publish it through Cloudflare Tunnel; never open a firewall port.
  host: '127.0.0.1',
  port: 1210,
  // Operator status endpoint. Loopback only and never routed by the tunnel.
  adminPort: 1212,
  upstream: 'http://127.0.0.1:1211',
  dataDir: path.join(gatewayRoot, 'data'),
  queue: {
    maxLength: 40,          // all sites together
    maxPerKey: 10,          // one site cannot fill the whole queue
    maxWaitSeconds: 420,    // a visitor waiting longer than this gets a clear "busy" error
  },
  generation: {
    defaultMaxTokens: 1024,
    maxTokensCap: 4096,
    maxSeconds: 300,        // hard stop for one answer, including prompt processing
    temperature: 1.0, topP: 0.95, topK: 64, // Gemma's recommended sampling
  },
  limits: {
    maxBodyBytes: 40 * 1024 * 1024,
    maxImages: 8,           // per request, including earlier turns of the conversation
    maxImageBytes: 5 * 1024 * 1024,
    maxPdfBytes: 10 * 1024 * 1024,
    maxPdfPages: 80,
    maxMessages: 200,
    maxTokenizeChars: 4_000_000,
  },
  // Default per-key limits; each key can override them.
  keyDefaults: { requestsPerDay: 2000, maxContextTokens: 262144, maxQueued: 10 },
  // Measured vision cost of one image, used before the exact count is known.
  imageTokens: 280,
  // GPU-shared RAM growing this far above its level right after load means VRAM overflowed into system RAM.
  spillThresholdMB: 300,
  memoryProbeSeconds: 30,
};

function merge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) result[key] = base && typeof base[key] === 'object' && !Array.isArray(base[key]) ? merge(base[key], value) : value;
  return result;
}

export function loadConfig(overrides = {}) {
  const file = process.env.LIGATA_AI_CONFIG || path.join(defaults.dataDir, 'config.json');
  const fromFile = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const fromEnv = {};
  if (process.env.LIGATA_AI_PORT) fromEnv.port = Number(process.env.LIGATA_AI_PORT);
  if (process.env.LIGATA_AI_ADMIN_PORT) fromEnv.adminPort = Number(process.env.LIGATA_AI_ADMIN_PORT);
  if (process.env.LIGATA_AI_UPSTREAM) fromEnv.upstream = process.env.LIGATA_AI_UPSTREAM;
  if (process.env.LIGATA_AI_DATA) fromEnv.dataDir = process.env.LIGATA_AI_DATA;
  if (process.env.LIGATA_AI_MEMORY_PROBE) fromEnv.memoryProbeSeconds = Number(process.env.LIGATA_AI_MEMORY_PROBE);
  return merge(merge(merge(defaults, fromFile), fromEnv), overrides);
}
