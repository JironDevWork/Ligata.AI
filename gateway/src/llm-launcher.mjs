// Runs llama-server with the production profile (model/profile.json) and keeps it running.
// PM2 runs this file as "ligata-ai-llm". Stopping PM2's process stops llama-server too.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gatewayRoot } from './config.mjs';
import { buildArgs } from '../../model/llm-args.mjs';

const root = path.resolve(gatewayRoot, '..');
const profile = JSON.parse(readFileSync(process.env.LIGATA_AI_PROFILE || path.join(root, 'model', 'profile.json'), 'utf8'));
const runtime = path.resolve(root, profile.runtimeDir || 'runtime');
const exe = path.join(runtime, 'llama.cpp', 'llama-server.exe');
const slotSavePath = profile.slotSavePath ? path.resolve(root, profile.slotSavePath) : null;
if (slotSavePath) mkdirSync(slotSavePath, { recursive: true });
const log = (event, data = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));

if (!existsSync(exe)) { log('missing_runtime', { exe }); process.exit(1); }

// A stray server from an earlier crash would hold the port and the VRAM.
function killStray() {
  if (process.platform !== 'win32') return;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object { $_.CommandLine -match '--port ${profile.port}( |$)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }`], { encoding: 'utf8' }).trim();
    if (out) log('killed_stray_server', { pids: out.split(/\s+/) });
  } catch {}
}

// CUDA unified memory would let allocations silently land in system RAM.
const env = { ...process.env };
delete env.GGML_CUDA_ENABLE_UNIFIED_MEMORY;

let child = null, stopping = false, restarts = 0;
function start() {
  killStray();
  const args = [...buildArgs({ ...profile, slotSavePath, modelsDir: path.join(runtime, 'models') }), '--host', '127.0.0.1', '--port', String(profile.port), '--threads-http', '4'];
  log('starting', { model: profile.model, ctx: profile.ctx, kv: profile.kv, mtp: !!profile.mtp });
  const started = Date.now();
  child = spawn(exe, args, { cwd: runtime, env, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return process.exit(0);
    // Back off when it keeps failing (for example the eGPU is disconnected), reset after a healthy hour.
    restarts = Date.now() - started > 3600_000 ? 0 : restarts + 1;
    const delay = Math.min(5000 * 2 ** Math.min(restarts, 6), 300_000);
    log('server_exited', { code, signal, restartInMs: delay });
    setTimeout(start, delay);
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  log('stopping');
  if (!child) return process.exit(0);
  if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  else child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('message', message => message === 'shutdown' && stop()); // PM2 on Windows
start();
