// Starts llama-server once per profile, runs bench.mjs against it, stops it.
//   node model/sweep.mjs --profiles q4xl-256k,q4xl-256k-mtp --depths 1000,32000,128000,250000
import { spawn, execFileSync } from 'node:child_process';
import { openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArgs } from './llm-args.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', 'runtime');
const arg = name => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; };
const port = 1299;

const base = { model: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf', mmproj: 'mmproj-F16.gguf', ctx: 262144, kv: 'q8_0', ubatch: 512, embeddingsOnGpu: true };
const profiles = {
  'q4xl-256k': base,
  'q4xl-256k-mtp': { ...base, mtp: 'mtp-gemma-4-12B-it-Q4_0.gguf', draftMax: 3 },
  'q4xl-256k-ub1024': { ...base, ubatch: 1024 },
  'q4xl-256k-q4kv': { ...base, kv: 'q4_0' },
  'q4xl-128k-ub2048': { ...base, ctx: 131072, ubatch: 2048 },
  'q4xl-256k-novision': { ...base, mmproj: null },
  'q40-256k': { ...base, model: 'gemma-4-12b-it-qat-q4_0.gguf' },
  'q5xl-128k': { ...base, model: 'gemma-4-12b-it-UD-Q5_K_XL.gguf', ctx: 131072 },
  'q5xl-256k': { ...base, model: 'gemma-4-12b-it-UD-Q5_K_XL.gguf' },
  'q6k-128k': { ...base, model: 'gemma-4-12b-it-Q6_K.gguf', ctx: 131072 },
  'q4xl-128k': { ...base, ctx: 131072 },
  'q4xl-128k-mtp': { ...base, ctx: 131072, mtp: 'mtp-gemma-4-12B-it-Q4_0.gguf', draftMax: 3 },
  'q4xl-128k-mtp-ub1024': { ...base, ctx: 131072, ubatch: 1024, mtp: 'mtp-gemma-4-12B-it-Q4_0.gguf', draftMax: 3 },
  'q4xl-128k-mtp-ub2048': { ...base, ctx: 131072, ubatch: 2048, mtp: 'mtp-gemma-4-12B-it-Q4_0.gguf', draftMax: 3 },
  'q4xl-256k-mtp-q4kv': { ...base, kv: 'q4_0', mtp: 'mtp-gemma-4-12B-it-Q4_0.gguf', draftMax: 3 },
  'q4xl-192k-mtp': { ...base, ctx: 196608, mtp: 'mtp-gemma-4-12B-it-Q4_0.gguf', draftMax: 3 },
  'q6k-128k-q4kv': { ...base, model: 'gemma-4-12b-it-Q6_K.gguf', ctx: 131072, kv: 'q4_0' },
};

const kill = () => { try { execFileSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' }); } catch {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const name of (arg('profiles') || 'q4xl-256k').split(',')) {
  const profile = profiles[name];
  if (!profile) throw new Error('Unknown profile ' + name);
  kill(); await sleep(3000);
  const log = openSync(path.join(runtime, 'logs', `sweep-${name}.log`), 'w');
  const child = spawn(path.join(runtime, 'llama.cpp', 'llama-server.exe'), [...buildArgs({ ...profile, modelsDir: path.join(runtime, 'models') }), '--host', '127.0.0.1', '--port', String(port), '-lv', '4'], { cwd: runtime, stdio: ['ignore', log, log] });
  let ready = false, exited = false;
  child.on('exit', () => { exited = true; });
  for (let i = 0; i < 180 && !exited; i++) {
    await sleep(1000);
    try { if ((await (await fetch(`http://127.0.0.1:${port}/health`)).json()).status === 'ok') { ready = true; break; } } catch {}
  }
  if (!ready) { console.log(JSON.stringify({ label: name, loaded: false, note: 'failed to load (see runtime/logs)' })); kill(); continue; }
  await new Promise(resolve => {
    // --run accuracy.mjs,cache-test.mjs runs other measurements against the same server.
    const scripts = (arg('run') || 'bench.mjs').split(',');
    const next = () => {
      const script = scripts.shift();
      if (!script) return resolve();
      const extra = script === 'bench.mjs' ? ['--depths', arg('depths') || '1000,32000,128000', ...(arg('image') ? ['--image', arg('image')] : [])] : [];
      spawn(process.execPath, [path.join(here, script), '--url', `http://127.0.0.1:${port}`, '--label', name, ...extra], { stdio: 'inherit' }).on('exit', next);
    };
    next();
  });
  kill();
}
