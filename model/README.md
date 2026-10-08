# Model runtime: Gemma 4 12B on the RTX 3060 (12 GB eGPU)

Everything the model needs lives in **VRAM**: weights, the 1-billion-parameter token-embedding table (llama.cpp keeps it in RAM by default; forced onto the GPU here), the KV cache for the whole context window, the vision projector and the MTP drafter. RAM holds only llama.cpp's fixed buffers and is **flat** after the first questions, measured up to 250k tokens of context.

## Production profile (`profile.json`)

| | |
| --- | --- |
| Weights | `gemma-4-12B-it-qat-UD-Q4_K_XL.gguf` (Unsloth, quantization-aware trained by Google, 6.7 GB) |
| Vision | `mmproj-F16.gguf` (screenshots) |
| Speed | MTP speculative decoding, `mtp-gemma-4-12B-it-Q4_0.gguf`, 3 draft tokens |
| Context | **327,680 tokens** of KV cache (`q4_0`) split into **3 slots: three conversations at once, 109k tokens each** (see below) |
| Memory | **11.1 GB VRAM**, **≈ 1.6 GB RAM, flat** |
| Speed | ~1,000–1,100 tok/s prompt processing, **61–68 tok/s** writing at short context, ~35–45 at 120k, ~25–32 at 250k |

## Several conversations at once

`slots` is how many conversations are answered at the same time, `ctx` the whole KV cache. With `unified: false` every slot owns `ctx / slots` tokens; with `unified: true` (`-kvu`) they share one pool. Measured with `parallel-test.mjs` (rows in `parallel.jsonl`, via `node model/sweep.mjs --profiles np3-split-320k --run parallel-test.mjs` while `ligata-ai-llm` is stopped):

| | 3 slots sharing 256k (until 0.5) | **3 slots × 109k, split (320k)** |
| --- | --- | --- |
| VRAM | 10.8 GB | **11.1 GB** |
| Writing, short chats: 1 / 2 / 3 at once | 53 / 37 / 38 tok/s each | 54 / 37 / 38 tok/s each (≈ 115 together) |
| Three long chats at once (89k shared, 109k split) | 3rd first word after 12 min; 3 × 89k overflowed the pool and one cache was silently dropped | 3rd first word after 8.4 min, nothing lost |
| Writing with all three full | 20 / 12.5 / 1 tok/s (one re-reading its lost cache) | **17 / 16 / 14 tok/s** |
| Two chats of 127k at once (shared only) | 2nd first word after 11 min, then 17 tok/s each | – (a split slot holds 109k) |

- In a shared pool attention spans every occupied cell: every conversation slows down as the others grow, and the pool can overflow. Split slots run at the speed of their own length and cannot take each other's memory, so the gateway needs no pool accounting and never erases a cache for room.
- **llama-server reads one long prompt at a time**, in either layout: a short question that arrives while a 40k document is read waits until it is read (40 s, then 48 tok/s), and answers being written meanwhile slow to 2–4 tok/s. Short questions in parallel are where three slots pay off; there is no fair-share option in llama.cpp b11456.
- 3 × 128k (384k) would need about 11.4 GB; 3 × 109k leaves more headroom on the 12 GB card. Conversations that reach their slot are summarized by the widget before they no longer fit.

`../gateway/src/llm-launcher.mjs` starts it (PM2 process `ligata-ai-llm`). The flags and why each exists are in `llm-args.mjs`:

- `-ngl all --fit off` — every layer on the GPU; fail loudly instead of silently moving layers to RAM.
- `--load-mode none` — no memory-mapping: weights stream file → VRAM and are not kept in RAM.
- `-ot token_embd.weight=CUDA0` — moves the 540 MB embedding table off the CPU (RAM 1.34 → 0.78 GB at load).
- `--cache-ram 0` — no host-RAM prompt cache (the default would let RAM grow up to 8 GB).
- `--ctx-checkpoints 2` — bounded sliding-window checkpoints (≈ 90 MB each with a q4 cache) so follow-ups and new visitors reuse the processed knowledge.
- `-ub 512` — larger batches did not process prompts faster (compute-bound) but pinned more RAM.
- GGML_CUDA_ENABLE_UNIFIED_MEMORY is removed: unified memory would let CUDA spill into RAM silently.

**Recommended once:** NVIDIA Control Panel → Manage 3D settings → Program Settings → add `runtime\llama.cpp\llama-server.exe` → **CUDA – Sysmem Fallback Policy = Prefer No Sysmem Fallback**. Running out of VRAM then fails loudly instead of quietly using system RAM.

## How the choice was made

Measured with `sweep.mjs` + `bench.mjs` (needle at the middle of a synthetic document, two linked facts at 12 % and 85 % for reasoning across the window, follow-up reuse, a ~180-token answer for realistic speed) and `check-memory.ps1` after every request. Full rows: `results.jsonl`.

| Profile | Context | VRAM | RAM | Prompt tok/s (32k) | Writing tok/s short / 120k / 250k | Recall 250k |
| --- | --- | --- | --- | --- | --- | --- |
| QAT Q4_K_XL, q8 KV, no MTP | 256k | 10.67 GB | 1.17 GB | 1,045 | 35 / 23 / 17 | ✔ |
| + MTP, q8 KV | 256k | **11.73 GB (too tight)** | 1.72 GB | 1,019 | 63 / 46 / – | – |
| + MTP, q8 KV | 192k | 10.80 GB | 1.60 GB | 1,019 | 67 / 46 / – | – |
| + MTP, q8 KV | 128k | 9.87 GB | 1.47 GB | 1,019 | 66 / 44 / – | – |
| **+ MTP, q4 KV (chosen)** | **256k** | **10.57 GB** | **1.56 GB** | 1,025 | **61 / 41 / 33** | **✔ + linked ✔** |
| + MTP, ub 1024 / 2048 | 128k | 10.32 / 11.24 GB | 1.77 / 2.35 GB | 1,042 / 1,038 | no gain | – |

- **MTP** (the drafter shipped with the QAT GGUF) makes answers **1.6–1.8× faster** (long answers 39 → 67 tok/s, 24 → 38 at 120k) with 50–60 % draft acceptance. It does not change the output: the main model verifies every token.
- **q4 KV vs q8 KV**: on the task that matters (70 catalogue questions over 400 products: lookups, comparisons, sums, temperature 0) both scored **identically** (40/40 lookups, 12/15 comparisons, same misses). Raw-text KL divergence against an f16 cache is higher for q4 (0.33 vs 0.10), but the instruction-tuned model is extremely uncertain on raw Wikipedia text (perplexity ≈ 1,100 even unquantized), which magnifies tiny differences. q4 is what makes 256k + MTP fit with headroom.
- **Larger quants** (UD-Q5_K_XL 8.6 GB, Q6_K 9.8 GB, not QAT) cannot hold 256k + MTP in 12 GB. QAT Q4 was trained for 4-bit and is Google's near-bf16 deployment format, so bigger post-hoc quants buy little.
- **Prompt processing dominates** for big inputs: ≈1 s per 1,000 tokens at short context, a 128k prompt takes ~3.2 min and 250k ~10.5 min before the first word. Keep knowledge lean (the backoffice budget defaults to 24k tokens ≈ 25 s cold). Follow-up questions and new visitors on the same site reuse the processed prefix and start in **0.3–0.7 s**.
- **Arithmetic** (“two of X plus one of Y”) fails without thinking at temperature 0 (0/15) on every profile; the per-site *Think before answering* option exists for such sites.

## Memory behaviour (measured)

- After load: ~1.3 GB working set (CUDA libraries, host staging, MTP drafter buffers). First request adds ~0.2 GB once (kernel initialisation). Context checkpoints add a fixed ≤ 180 MB.
- After that RAM stays flat (±30 MB) across 1k → 250k tokens and many requests; see the soak test in `soak.jsonl`.
- Task Manager's *Commit size* (~12–13 GB) is WDDM bookkeeping for VRAM, not real RAM.
- *GPU-shared RAM* ≈ 0.78 GB is pinned host memory used by llama.cpp by design. The gateway reports a spill only when it grows clearly above its level right after load.

```powershell
powershell -ExecutionPolicy Bypass -File model\check-memory.ps1 -Watch
```

## Looking things up (0.6, measured)

Since 0.6 the prompt holds the instructions and a list of the pages; the model looks up the text with two tools (`search_website`, `read_pages`, see the [package README](../README.md#how-the-assistant-knows-your-website)). Gemma 4's chat template supports tool calls and llama.cpp b11456 parses them while streaming.

- **The cache holds across rounds.** A round adds only the call and its results: round 2 processed 59 new tokens of 2,958 (64 of 3,008 with thinking), the next question 71. The template renders the arguments in Gemma's own syntax and the reasoning of the round is passed back, so the cached tokens match.
- **A forced first lookup.** With `tool_choice` `auto` the model often answered from the prompt instead (the contact email in the instructions, an owner instruction about calls, a German question on an English site): 6/9, then 10–11/13 with sharper wording. The website now asks for `required` in the first round when a meaningful word of the question occurs on the website; greetings, thanks and unrelated requests stay `auto`. A forced call costs 0.3–0.8 s. Result: 13/13 twice.
- **The team reminder goes with the results.** Results now stand between the rule and the answer; with a one-line reminder at the end of each result, "Shopify?" and "SEO in Japanese?" offer the team again.
- **A last round must answer.** After three rounds the website's results say "no more lookups", and the gateway runs one more round with `tool_choice` `none` and the `<|tool_call>` token (id 48) forbidden by `logit_bias`: with thinking, Gemma otherwise wrote the call as answer text.

`node model/lookup-check.mjs [questions.json] --host <site>` asks real questions through a website and the GPU and checks lookups, facts and the team offer (results in `lookups.jsonl`):

| Site | Questions | Result | First word (median, max) | Prompt (median) |
| --- | --- | --- | --- | --- |
| Test site (English, 3 pages, no thinking) | `lookup-questions.json`: 13 incl. a follow-up, team, German, off-topic | **13/13**, three runs | 0.8 s, 2.1 s | 1.5k tokens |
| Local copy of demo.ligata.ch (German + English, 13 pages per language, thinking on) | `lookup-demo.json`: 14 in both languages, a follow-up, a price that is not on the site | **14/14**, two runs | 4.9 s, 8.5 s | 1.9k tokens |

On the demo the whole text is small (about 2,700 tokens, the list of pages 370), so lookups add a little time there. They pay off on bigger websites: the prompt stays at instructions plus at most about 3,000 tokens of page list, whatever the size of the website, and only what a question needs is read.

## Team handoff (measured)

The AI offers the team by ending an answer with `[[team]]`, which the widget turns into buttons. `node model/handoff-check.mjs` sends 11 questions (plus one off-topic) with the system prompt the package builds (`dotnet Ligata.AI.Tests.dll --prompt`) through the real gateway, three times each:

| Prompt version | Correct | Notes |
| --- | --- | --- |
| Rule in the guardrails only | 21/22 | "SEO audits in Japanese" was declined as off-topic |
| + "related but not in the knowledge → team", "when unsure, treat it as related" | 31/33 | same question still missed sometimes |
| + one-line reminder after the knowledge (in the per-request part, so the cached prefix is unchanged) | **33/33** | the marker is never mentioned or broken |

Results are appended to `model/handoff.jsonl`. Since 0.6 the prompt expects the website's lookups, so the handoff is checked with `lookup-check.mjs` (team questions in both question files; 13/13 and 14/14 above).

## Files and downloads

Not in Git: `runtime/llama.cpp` (llama.cpp **b11456**, Windows CUDA 13.4 build from ggml-org/llama.cpp releases, plus the CUDA 13 runtime DLLs) and `runtime/models`:

```powershell
curl.exe -L -o runtime\models\gemma-4-12B-it-qat-UD-Q4_K_XL.gguf https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF/resolve/main/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf
curl.exe -L -o runtime\models\mmproj-F16.gguf https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF/resolve/main/mmproj-F16.gguf
curl.exe -L -o runtime\models\mtp-gemma-4-12B-it-Q4_0.gguf https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF/resolve/main/mtp-gemma-4-12B-it.gguf
```

## Tools

| Script | Purpose |
| --- | --- |
| `sweep.mjs` | Start a profile, run measurements (`--run bench.mjs,accuracy.mjs,cache-test.mjs`), stop |
| `bench.mjs` | Needle + linked facts + follow-up + long answer at chosen depths, with memory |
| `accuracy.mjs` | 70 catalogue questions (lookup/compare/sum) at temperature 0 |
| `cache-test.mjs` | Prefix reuse: follow-up, new visitor, site switch |
| `lookup-check.mjs` | Real questions through a website and the GPU: are things looked up, found and answered (0.6) |
| `slots-test.mjs` | Several slots over one unified KV pool |
| `slot-test.mjs`, `prime-test.mjs` | Disk snapshots of a site's prompt cache (rejected: llama.cpp re-processes after a restore with sliding-window attention) |
| `perplexity.mjs` | wikitext-2 perplexity per quantization (see the caveat above) |
| `soak.mjs` | Many mixed questions through the real gateway; RAM must stay flat |
| `check-memory.ps1` | RAM / VRAM / GPU-shared snapshot or live watch |
