# Ligata AI gateway

The shared inference service on the Ligata mini PC. Every website with the Ligata.AI Umbraco package sends its questions here; the gateway answers up to three at once on the RTX 3060 with Gemma 4 12B.

```
Umbraco site ──HTTPS (API key)──► Cloudflare Tunnel ──► gateway :1210 ──► llama-server :1211 (VRAM only)
                                                         admin/status :1212 (loopback only)
```

- **API keys**: one per website, `lai_<id>_<secret>`. Only a SHA-256 hash is stored (`data/keys.json`). Keys are checked in constant time, can be revoked instantly and carry their own limits.
- **Several answers at once, then a global queue**: up to `parallel.conversations` answers (3, at most one per llama-server slot) are written at the same time; further questions wait in arrival order across all websites. Visitors see their position and an estimated wait.
- **Fairness**: one queued or running question per visitor and site (visitors are HMAC-pseudonymised by the site, raw IPs never arrive here), a per-site queue cap, a global queue cap and a daily quota per key. Full queues answer `503` with `Retry-After`.
- **Streaming**: Server-Sent Events with `queued`, `started`, `progress` (long prompts), `thinking`, `delta`, `done` (usage, context used/limit, speed) and `error`. Heartbeats every 15 s keep tunnels and proxies open during long prompt processing.
- **Slots and prompt caches**: llama-server runs 3 slots over a 320k KV cache split between them (`model/profile.json`: `slots`, `ctx`, `unified: false`), so each conversation may use 109k tokens and runs at the speed of its own length. Each answer gets the slot that holds its conversation, else one that holds its website's instructions and knowledge, so follow-ups and the next visitor of a recently active site get the first word in well under a second instead of waiting ~1 s per 1,000 tokens. With a shared pool (`unified: true`, `-kvu`) one conversation could use the whole window, but attention then spans every occupied cell and conversations slow each other down: the gateway caps a conversation at `parallel.conversationTokens`, starts an answer only when it fits next to the running ones and erases idle caches least-recently-used first.
- **Attachments**: PNG/JPEG screenshots (≤ 5 MB, ≤ 8 per conversation) go to the vision model; PDFs (≤ 10 MB, ≤ 80 pages) are converted to text in memory (`/v1/extract`). Nothing is written to disk.
- **Failure handling**: model offline/starting → immediate `503 model_unavailable`/`model_loading` (never queued). A broken stream ends with an `error` event and the queue continues. Answers stop 300 s after the model starts on them. A visitor who leaves is removed from the queue, and leaving mid-answer cancels the GPU work.
- **Memory watch**: every 30 s the gateway samples llama-server's RAM, VRAM and GPU-shared RAM. Shared RAM growing more than 300 MB above its level after load is reported as a VRAM spill (`gpu.healthy: false`).
- **Logs** contain metadata only (key id, token counts, durations, error codes), never prompts, answers or files.

## Run

```powershell
powershell -ExecutionPolicy Bypass -File C:\Code\Ligata.AI\gateway\install-pm2.ps1
```

It stops hand-started copies, runs `npm ci` if needed, `pm2 start ecosystem.config.cjs` (ligata-ai-llm + ligata-ai) and `pm2 save`, then prints the status.

The model files and llama.cpp live in `C:\Code\Ligata.AI\runtime` (not in Git); see [model/README](../model/README.md) for the download and the chosen profile.

## API keys

Open **http://127.0.0.1:1212** on the AI machine for the operator page: model and queue status, prompt-cache slots, RAM/VRAM over time, and every website key with today's usage, limits, *Create key* and *Revoke*. It only answers on loopback, only for the `127.0.0.1`/`localhost` host name, and writes need a custom header, so other websites open in the same browser cannot use it. The same works from the command line:

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

Defaults are in `src/config.mjs`; override them in `data/config.json` (same shape) or with `LIGATA_AI_PORT`, `LIGATA_AI_ADMIN_PORT`, `LIGATA_AI_UPSTREAM`, `LIGATA_AI_DATA`, `LIGATA_AI_MEMORY_PROBE`. Useful settings: `queue.maxLength` (40), `queue.maxPerKey` (10), `queue.maxWaitSeconds` (420), `generation.maxSeconds` (300, counted from the moment the model starts on the answer), `generation.maxTokensCap` (8192), `keyDefaults` (2000 questions/day, 256k context, 10 queued), `parallel.conversations` (3: answers at once, at most llama-server's slots), `parallel.sharedPool` (`auto` reads `unified` from `model/profile.json`) and `parallel.conversationTokens` (131072: the most one conversation may use of a shared pool).

How many conversations run at once and how much memory each gets is set in `model/profile.json`: `slots` (conversations at once) and `ctx` (the whole KV cache, split evenly). Restart `ligata-ai-llm` and then `ligata-ai` after a change. Measurements and limits: [model/README](../model/README.md#several-conversations-at-once).

## API (server-to-server)

| Route | Purpose |
| --- | --- |
| `GET /v1/health` | Public liveness: `{ ok, model: ready \| loading \| down }` |
| `GET /robots.txt` | Public: `Disallow: /` for every crawler. Every answer also carries `X-Robots-Tag: noindex, nofollow`, so the public hostname (e.g. ai.ligata.ch) stays out of search engines and AI crawlers |
| `GET /v1/status` | Model, context size, queue, GPU health, this key's limits and usage, `features: ["tools"]` |
| `POST /v1/chat` | `{ messages, visitor, maxTokens, temperature, thinking, contextLimit, tools?, toolChoice?, lookupRounds? }` → SSE |
| `POST /v1/chat/tool-results` | `{ round, results: [{ id, content }] }`: the website's results for a round of lookups (see below) |
| `POST /v1/tokenize` | `{ texts: [] }` → `{ counts: [] }` (knowledge budgets) |
| `POST /v1/extract` | `{ data: base64 PDF }` → `{ text, pages, tokens }` |

**Lookups (tools, 0.6).** The website may pass up to eight `tools` (`{ name, description, parameters }`, JSON schema). When the model calls them, the stream carries `event: tool_calls` with `{ round, calls: [{ id, name, arguments }] }`; the website runs the calls and posts the results to `/v1/chat/tool-results` within `tools.waitSeconds` (20 s). The answer keeps its place and its slot meanwhile and continues with the results (llama-server reuses the cached prompt: a round adds only the call and its results). After `lookupRounds` rounds (at most `tools.maxRounds`, 4) one more round must answer: `tool_choice` `none`, and the special tokens of the tool syntax are forbidden, because Gemma otherwise writes the call as text. `toolChoice: "required"` makes the first round look something up; `"none"` keeps the tools declared without calling them (summaries: the prompt, and so the cache, stays the same). Earlier lookups arrive in the history as an assistant message with `toolCalls: [{ id, name, arguments }]`, then one `{ role: 'tool', toolCallId, content }` per call.

Message parts: `{ type: 'text', text }`, `{ type: 'image', data }` (base64 PNG/JPEG), `{ type: 'document', name, text }`. Error responses are `{ error: { code, message } }` with codes such as `invalid_key`, `visitor_busy`, `site_busy`, `queue_full`, `queue_timeout`, `daily_quota`, `model_unavailable`, `model_loading`, `context_full`, `too_many_images`, `image_too_large`, `unsupported_image`, `pdf_no_text`.

## Tests

```powershell
npm test   # 62 tests: keys, queue, several answers at once, lookups, limits, disconnects (also while the prompt is counted), outages, broken streams, timeouts, attachments, PDF text, slots (also after llama-server came back), admin page
```

The tests run against a mock llama-server (`test/mock-llm.mjs`) with switchable failure modes; `node test/mock-server.mjs 1298` serves the mock on a fixed port for UI development.
