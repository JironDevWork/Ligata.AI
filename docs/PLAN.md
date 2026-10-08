# Ligata.AI — plan

Ligata.AI adds a website assistant to any Umbraco 17 site. Like Ligata.Forms and Ligata.Cloudflare, it is a NuGet package the host installs. Each site keeps its own settings, appearance, knowledge and API key inside its own Umbraco database. One shared inference gateway runs on the Ligata mini PC (RTX 3060 12 GB eGPU) and answers for every site, one answer at a time.

```
visitor browser ──► client Umbraco site (Ligata.AI package) ──► Ligata AI gateway (mini PC) ──► llama-server (Gemma 4 12B, VRAM only)
   chat bubble        public API, settings, knowledge,          API keys, global FIFO queue,       weights, KV cache and vision
   (Shadow DOM)       secret API key, visitor rate limits        per-visitor limits, PDF text,      projector all in VRAM
                                                                 status/metrics, SSE streaming
```

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Model | Gemma 4 12B QAT, Unsloth UD-Q4_K_XL GGUF, vision projector F16 | QAT keeps near-bf16 quality at 4 bit; measured in [MODEL.md](MODEL.md). |
| Runtime | llama.cpp `llama-server` (CUDA 13.4), `--load-mode none`, `--fit off`, every layer and the token-embedding table forced into VRAM, `--cache-ram 0`, bounded checkpoints | Weights stream file → VRAM, never kept in RAM; failing loudly beats silently spilling. RAM must stay flat. |
| Context | Three slots, KV cache preallocated in VRAM at start and split between them (109k tokens each) | The KV buffer is allocated once. No per-request offloading, and nothing is copied to RAM between questions. Each slot keeps its last conversation, so a follow-up or the next visitor of the same site reuses the cached prefix. Long conversations are summarized by the widget before they would no longer fit. |
| Concurrency | Up to three answers at once (one per slot), then a global FIFO queue across all sites | Measured: three short answers at once write at ~38 tok/s each (~115 tok/s together) against ~53 tok/s alone; with split slots each runs at the speed of its own length. Visitors see their live queue position. See [model/README.md](../model/README.md). |
| Fairness / abuse | Max one queued or active request per visitor (HMAC of IP, per site), per-key queue cap, global queue cap, per-key daily quota, request size limits | “Every IP has one request max”, without sending raw IPs to the gateway. |
| Secrets | Gateway keys `lai_<id>_<secret>`, stored only as SHA-256 hashes on the gateway. On the site, the key is protected with ASP.NET Data Protection in the DB (or config/env), and is never sent to browsers | Browsers talk only to their own Umbraco site. The gateway is server-to-server only. |
| Attachments | Screenshots (PNG/JPEG/WebP ≤ 5 MB, downscaled in the browser) go to the vision model. PDFs (≤ 10 MB, ≤ 60 pages) are converted to text by the gateway. Nothing is stored; attachments live only in page memory and request memory | Meets “not stored”. Text PDFs are far cheaper in context than page images. |
| Knowledge | Every published page (in every language) and uploaded or written documents are searchable on the site's own server (keyword index, BM25 over passages). The model gets a list of the pages and looks up what a question needs with two tools, `search_website` and `read_pages`, while it answers (0.6). Short essentials can be *always known* (in the prompt, within a token budget) | The prompt no longer grows with the website, pages are always current, and new pages are included without an editor. Until 0.5 everything enabled was in the prompt, which filled the conversation's memory on big sites. |
| Widget | Vanilla JS + Shadow DOM, configurable themes and tokens, bottom-right by default (0.4.3; consent banners such as Cookiebot sit bottom left), works on static exports (Cloudflare Pages) | Isolated from host CSS, no framework dependency. |
| Backoffice | Own **AI Assistant** section with Overview, Appearance (live preview), Behaviour, Knowledge (budget meter), Connection, Test chat | “A user-friendly and neat Umbraco tab”. |

## Milestones (each is committed and pushed to `main`)

1. **Plan and scaffolding**: repo layout, plan, ignore rules.
2. **Model runtime**: quantization and context benchmarks on the RTX 3060, MTP/speed tests, chosen launch profile, memory probe, RAM soak test, documented results.
3. **Gateway**: API keys and CLI, global queue, per-visitor/key limits, SSE streaming proxy to llama-server, PDF extraction, tokenization, status/health, failure handling, PM2 config, unit and integration tests (mock upstream plus real GPU).
4. **Umbraco package backend**: options, migration, settings/knowledge store, protected API key, management API, public chat proxy with CORS and rate limits, page-content import, view component and automatic injection.
5. **Chat widget**: bubble and panel design, themes, customization tokens, attachments, context meter, queue/busy/offline/error states, accessibility, mobile.
6. **Backoffice section**: settings UI with live preview, knowledge manager with budget meter, connection test and key handling, test chat, usage stats.
7. **End-to-end qualification**: install the real `.nupkg` into disposable Umbraco hosts (two sites against one gateway), browser tests, edge cases (gateway down, model down, queue full, oversized files, disconnects, context full), RAM soak, packaging and docs.
8. **Deployment on the mini PC**: PM2 processes for the model and gateway, operator guide (keys, tunnel, monitoring).

## Out of scope for the first release

Fine-tuning/LoRA training, vector retrieval (keyword search with prefix matching suffices for website content and needs no embedding model), audio input, persistent chat transcripts (only anonymous daily counters are stored), and multi-GPU scheduling.
