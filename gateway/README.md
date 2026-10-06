# Ligata AI gateway

The shared inference service on the Ligata mini PC. Every website with the Ligata.AI Umbraco package sends its questions here; the gateway answers them one at a time on the RTX 3060 with Gemma 4 12B.

```
Umbraco site ──HTTPS (API key)──► Cloudflare Tunnel ──► gateway :1210 ──► llama-server :1211 (VRAM only)
                                                         admin/status :1212 (loopback only)
```

- **API keys**: one per website, `lai_<id>_<secret>`. Only a SHA-256 hash is stored (`data/keys.json`). Keys are checked in constant time, can be revoked instantly and carry their own limits.
- **Global queue**: exactly one answer is generated at a time, in arrival order, across all websites. Visitors see their position and an estimated wait.
- **Fairness**: one queued or running question per visitor and site (visitors are HMAC-pseudonymised by the site, raw IPs never arrive here), a per-site queue cap, a global queue cap and a daily quota per key. Full queues answer `503` with `Retry-After`.
- **Streaming**: Server-Sent Events with `queued`, `started`, `progress` (long prompts), `thinking`, `delta`, `done` (usage, context used/limit, speed) and `error`. Heartbeats every 15 s keep tunnels and proxies open during long prompt processing.
- **Attachments**: PNG/JPEG screenshots (≤ 5 MB, ≤ 8 per conversation) go to the vision model; PDFs (≤ 10 MB, ≤ 80 pages) are converted to text in memory (`/v1/extract`). Nothing is written to disk.
- **Failure handling**: model offline/starting → immediate `503 model_unavailable`/`model_loading` (never queued). A broken stream ends with an `error` event and the queue continues. Answers stop after 300 s. A visitor who leaves is removed from the queue, and leaving mid-answer cancels the GPU work.
- **Memory watch**: every 30 s the gateway samples llama-server's RAM, VRAM and GPU-shared RAM. Shared RAM growing more than 300 MB above its level after load is reported as a VRAM spill (`gpu.healthy: false`).
- **Logs** contain metadata only (key id, token counts, durations, error codes), never prompts, answers or files.

## Run

```powershell
cd C:\Code\Ligata.AI\gateway
npm ci
pm2 start ecosystem.config.cjs   # ligata-ai-llm + ligata-ai
pm2 save
```

The model files and llama.cpp live in `C:\Code\Ligata.AI\runtime` (not in Git); see [model/README](../model/README.md) for the download and the chosen profile.

## API keys

```powershell
node cli.mjs keys create "Example AG website" --requests-per-day 1500
node cli.mjs keys list
node cli.mjs keys limits example --max-context 131072 --max-queued 5
node cli.mjs keys revoke example
node cli.mjs status          # model, queue, memory, keys
```

The key is printed once. Paste it into the website's **AI Assistant → Connection** (stored encrypted) or set `LigataAI__ApiKey` as an environment variable on that server. Changes to keys apply immediately without a restart.

## Publish it for other servers

Websites on this machine use `http://127.0.0.1:1210`. For client sites hosted elsewhere, add a public hostname to the existing Cloudflare Tunnel (for example `ai.ligata.ch → http://127.0.0.1:1210`). Do **not** route the admin port 1212, and do not open a firewall port. The gateway has no CORS: browsers never call it directly.

## Configuration

Defaults are in `src/config.mjs`; override them in `data/config.json` (same shape) or with `LIGATA_AI_PORT`, `LIGATA_AI_ADMIN_PORT`, `LIGATA_AI_UPSTREAM`, `LIGATA_AI_DATA`, `LIGATA_AI_MEMORY_PROBE`. Useful settings: `queue.maxLength` (40), `queue.maxPerKey` (10), `queue.maxWaitSeconds` (420), `generation.maxSeconds` (300), `generation.maxTokensCap` (4096), `keyDefaults` (2000 questions/day, 256k context, 10 queued).

## API (server-to-server)

| Route | Purpose |
| --- | --- |
| `GET /v1/health` | Public liveness: `{ ok, model: ready \| loading \| down }` |
| `GET /v1/status` | Model, context size, queue, GPU health, this key's limits and usage |
| `POST /v1/chat` | `{ messages, visitor, maxTokens, temperature, thinking, contextLimit }` → SSE |
| `POST /v1/tokenize` | `{ texts: [] }` → `{ counts: [] }` (knowledge budgets) |
| `POST /v1/extract` | `{ data: base64 PDF }` → `{ text, pages, tokens }` |

Message parts: `{ type: 'text', text }`, `{ type: 'image', data }` (base64 PNG/JPEG), `{ type: 'document', name, text }`. Error responses are `{ error: { code, message } }` with codes such as `invalid_key`, `visitor_busy`, `site_busy`, `queue_full`, `queue_timeout`, `daily_quota`, `model_unavailable`, `model_loading`, `context_full`, `too_many_images`, `image_too_large`, `unsupported_image`, `pdf_no_text`.

## Tests

```powershell
npm test   # 24 tests: keys, queue, limits, disconnects, outages, broken streams, timeouts, attachments, PDF text
```

The tests run against a mock llama-server (`test/mock-llm.mjs`) with switchable failure modes; `node test/mock-server.mjs 1298` serves the mock on a fixed port for UI development.
