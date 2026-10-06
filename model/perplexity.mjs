// Quality comparison: perplexity on wikitext-2 (test split, 4k windows) for each quantization and KV-cache type.
// Lower is better. Runs llama-perplexity fully on the GPU, one configuration at a time.
//   node model/perplexity.mjs [--chunks 40]
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '..', 'runtime');
const chunks = process.argv.includes('--chunks') ? process.argv[process.argv.indexOf('--chunks') + 1] : '40';
const text = path.join(runtime, 'downloads', 'wikitext-2-raw', 'wiki.test.raw');
const runs = [
  ['QAT UD-Q4_K_XL (Unsloth)', 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf', 'f16'],
  ['QAT UD-Q4_K_XL, q8_0 KV', 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf', 'q8_0'],
  ['QAT UD-Q4_K_XL, q4_0 KV', 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf', 'q4_0'],
  ['QAT Q4_0 (Google)', 'gemma-4-12b-it-qat-q4_0.gguf', 'f16'],
  ['UD-Q5_K_XL (not QAT)', 'gemma-4-12b-it-UD-Q5_K_XL.gguf', 'f16'],
  ['Q6_K (not QAT)', 'gemma-4-12b-it-Q6_K.gguf', 'f16'],
];
for (const [label, model, kv] of runs) {
  if (!existsSync(path.join(runtime, 'models', model))) { console.log(`${label}: model missing`); continue; }
  const started = Date.now();
  const result = spawnSync(path.join(runtime, 'llama.cpp', 'llama-perplexity.exe'), ['-m', path.join(runtime, 'models', model), '-f', text, '-c', '4096', '-b', '512', '--chunks', chunks, '-ngl', 'all', '--fit', 'off', '-fa', 'on', '-ctk', kv, '-ctv', kv, '-ot', 'token_embd.weight=CUDA0'], { cwd: runtime, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = (result.stdout || '') + (result.stderr || '');
  const final = /Final estimate: PPL = ([\d.]+) \+\/- ([\d.]+)/.exec(output);
  const line = { label, model, kv, chunks: Number(chunks), ppl: final ? Number(final[1]) : null, error: final ? undefined : output.split('\n').filter(l => /error|fail/i.test(l)).slice(-3).join(' | '), seconds: Math.round((Date.now() - started) / 1000) };
  console.log(JSON.stringify(line));
  appendFileSync(path.join(here, 'perplexity.jsonl'), JSON.stringify(line) + '\n');
}
