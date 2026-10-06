import http from 'node:http';
import { watch } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { KeyStore } from './keys.mjs';
import { Scheduler } from './queue.mjs';
import { Llm } from './llm.mjs';
import { MemoryMonitor } from './monitor.mjs';
import { createServer } from './server.mjs';

// Logs carry metadata only: never prompts, answers, attachments or keys.
const log = (event, data = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));

export function startGateway(overrides = {}) {
  const config = loadConfig(overrides);
  mkdirSync(config.dataDir, { recursive: true });
  const keys = new KeyStore(config.dataDir, config.keyDefaults);
  const scheduler = new Scheduler(config.queue);
  const llm = new Llm(config.upstream);
  const monitor = new MemoryMonitor({ intervalSeconds: config.memoryProbeSeconds, spillThresholdMB: config.spillThresholdMB, log });
  if (config.memoryProbeSeconds > 0) monitor.start();

  // Keys created or revoked with the CLI apply immediately.
  let reloadTimer;
  const watcher = watch(config.dataDir, (_, file) => {
    if (file !== 'keys.json') return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { keys.reload(); log('keys_reloaded', { count: keys.keys.size }); }, 200);
  });
  const flush = setInterval(() => keys.flush(), 10000);
  flush.unref();

  const server = createServer({ config, keys, scheduler, llm, monitor, log });
  server.requestTimeout = 0;              // SSE answers can stream for minutes
  server.headersTimeout = 20000;
  server.listen(config.port, config.host, () => log('listening', { host: config.host, port: server.address().port }));

  // Operator status, loopback only. The tunnel publishes only the public port.
  const admin = http.createServer(async (request, response) => {
    if (request.url !== '/status') { response.writeHead(404).end(); return; }
    const body = { model: await llm.health(), props: await llm.props().catch(() => null), queue: scheduler.snapshot(), memory: monitor.latest, memoryHistory: monitor.history.slice(-120), keys: keys.list() };
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body, null, 2));
  });
  if (config.adminPort) admin.listen(config.adminPort, '127.0.0.1');

  const stop = () => new Promise(resolve => {
    keys.flush(); watcher.close(); monitor.stop(); clearInterval(flush); admin.close();
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
  return { server, admin, config, keys, scheduler, llm, monitor, stop };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('main.mjs')) {
  const gateway = startGateway();
  const shutdown = async () => { log('stopping'); await gateway.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('message', message => message === 'shutdown' && shutdown()); // PM2 on Windows
}
