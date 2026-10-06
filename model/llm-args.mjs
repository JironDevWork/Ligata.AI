import path from 'node:path';

// Every flag here exists to keep weights, KV cache and buffers in VRAM and RAM flat.
export function buildArgs(p) {
  const file = name => path.join(p.modelsDir, name);
  const args = [
    '-m', file(p.model),
    '-ngl', 'all',              // every layer on the GPU
    '--fit', 'off',             // never auto-move layers to CPU/RAM to "make it fit": fail loudly instead
    '--load-mode', 'none',      // no mmap: weights stream file -> VRAM and are not kept in system RAM
    '-fa', 'on',                // flash attention (required for a quantized V cache)
    '-c', String(p.ctx),
    '-ctk', p.kv, '-ctv', p.kv, // KV cache type; only the 8 global-attention layers grow with context
    '-b', String(Math.max(p.ubatch, 512)), '-ub', String(p.ubatch),
    '--cache-ram', '0',         // no host-RAM prompt cache (default would let RAM grow up to 8 GB)
    '--ctx-checkpoints', String(p.checkpoints ?? 2), // bounded SWA checkpoints so follow-ups reuse the prefix
    '-np', '1',                 // one slot: the gateway serializes requests anyway
    '--jinja',
    '--no-webui',
  ];
  // llama.cpp keeps the 1B-parameter token-embedding table in host RAM by default. Force it into VRAM.
  if (p.embeddingsOnGpu) args.push('-ot', 'token_embd.weight=CUDA0');
  if (p.mmproj) args.push('--mmproj', file(p.mmproj));
  else args.push('--no-mmproj');
  if (p.mtp) args.push('--spec-type', 'draft-mtp', '--model-draft', file(p.mtp), '--spec-draft-n-max', String(p.draftMax ?? 3), '-ngld', 'all', '-ctkd', p.kv, '-ctvd', p.kv);
  return args;
}
