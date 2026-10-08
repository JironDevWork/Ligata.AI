import { watch } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { KeyStore } from './keys.mjs';
import { Scheduler } from './queue.mjs';
import { Llm } from './llm.mjs';
import { MemoryMonitor } from './monitor.mjs';
import { createServer } from './server.mjs';
import { SlotManager } from './slots.mjs';
import { createAdmin } from './admin.mjs';

// Logs carry metadata only: never prompts, answers, attachments or keys.
const log = (event, data = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));

export function startGateway(overrides = {}) {
  const config = loadConfig(overrides);
  mkdirSync(config.dataDir, { recursive: true });
  const keys = new KeyStore(config.dataDir, config.keyDefaults);
  if (keys.problem) log('keys_damaged', { count: keys.keys.size, problem: keys.problem });
  const scheduler = new Scheduler(config.queue);
  const llm = new Llm(config.upstream);
  const slots = new SlotManager({ maxIdleTokens: config.cache.maxIdleTokens, log });
  const monitor = new MemoryMonitor({ intervalSeconds: config.memoryProbeSeconds, spillThresholdMB: config.spillThresholdMB, log });
  if (config.memoryProbeSeconds > 0) monitor.start();

  // Keys created or revoked with the CLI apply immediately.
  let reloadTimer;
  const watcher = watch(config.dataDir, (_, file) => {
    if (file !== 'keys.json') return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { keys.reload(); log(keys.problem ? 'keys_damaged' : 'keys_reloaded', { count: keys.keys.size, ...(keys.problem ? { problem: keys.problem } : {}) }); }, 200);
  });
  const flush = setInterval(() => keys.flush(), 10000);
  flush.unref();

  const server = createServer({ config, keys, scheduler, llm, monitor, slots, log });
  server.requestTimeout = 0;              // SSE answers can stream for minutes
  server.headersTimeout = 20000;
  server.listen(config.port, config.host, () => log('listening', { host: config.host, port: server.address().port }));

  // Operator page and status, loopback only. The tunnel publishes only the public port.
  const admin = createAdmin({ config, keys, scheduler, slots, monitor, llm });
  if (config.adminPort) admin.listen(config.adminPort, '127.0.0.1');

  const stop = () => new Promise(resolve => {
    keys.flush(); watcher.close(); monitor.stop(); clearInterval(flush); admin.close();
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
  return { server, admin, config, keys, scheduler, llm, monitor, slots, stop };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('main.mjs')) {
  const gateway = startGateway();
  const shutdown = async () => { log('stopping'); await gateway.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('message', message => message === 'shutdown' && shutdown()); // PM2 on Windows
}
