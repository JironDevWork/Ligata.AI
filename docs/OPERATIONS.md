# Operations

## On the AI machine (mini PC with the RTX 3060 eGPU)

### First setup

1. llama.cpp and the model files go into `C:\Code\Ligata.AI\runtime` (see [model/README.md](../model/README.md#files-and-downloads)).
2. NVIDIA Control Panel → Manage 3D settings → Program Settings → `runtime\llama.cpp\llama-server.exe` → **CUDA – Sysmem Fallback Policy: Prefer No Sysmem Fallback**.
3. Install and start the two PM2 processes, then save them for the boot task:

```powershell
cd C:\Code\Ligata.AI\gateway
npm ci
pm2 start ecosystem.config.cjs
pm2 save
```

| PM2 name | What | Port |
| --- | --- | --- |
| `ligata-ai-llm` | `src/llm-launcher.mjs` → llama-server with `model/profile.json`; restarts it with back-off if it exits (eGPU unplugged, driver reset) | 1211, loopback |
| `ligata-ai` | the gateway (`src/main.mjs`) | 1210 public API, 1212 status (loopback) |

They are separate on purpose: `pm2 restart ligata-ai` (after a gateway update) takes a second and does not reload the model. `pm2 restart ligata-ai-llm` reloads the model (~10 s) and clears all prompt caches.

### Daily use

Operator page: **http://127.0.0.1:1212** (keys, usage, queue, prompt-cache slots, RAM/VRAM chart).

```powershell
node C:\Code\Ligata.AI\gateway\cli.mjs status     # model, queue, slots, RAM/VRAM, keys and today's usage
pm2 logs ligata-ai --lines 50 --nostream          # one JSON line per answer: key id, tokens, duration (no content)
powershell -ExecutionPolicy Bypass -File C:\Code\Ligata.AI\model\check-memory.ps1 -Watch
```

### Keys for a new client website

```powershell
cd C:\Code\Ligata.AI\gateway
node cli.mjs keys create "Muster AG – www.muster.ch" --requests-per-day 1000
```

Or use *Create key* on the operator page. Give the printed key to whoever configures that site (AI Assistant → Connection, or `LigataAI__ApiKey`). Revoke with `node cli.mjs keys revoke <id>`; it stops working immediately. Limits per key: `--requests-per-day`, `--max-context` (tokens per conversation), `--max-queued` (questions waiting at once).

### Publishing the gateway for sites on other servers

Sites on this machine use `http://127.0.0.1:1210`. For others, add a public hostname to the existing **Mini Server** Cloudflare Tunnel, e.g. `ai.ligata.ch → http://127.0.0.1:1210`, and give sites `https://ai.ligata.ch` as gateway address. Do not route 1211 or 1212. SSE streaming works through the tunnel; the gateway sends a heartbeat every 15 s so long prompt processing never hits Cloudflare's 100-second idle limit.

### What happens when…

| Situation | Behaviour |
| --- | --- |
| Many visitors at once | One answer at a time across all sites, FIFO. Visitors see their position and wait estimate. Max one question per visitor, 10 per site, 40 in total; beyond that a clear "busy, try again in a minute" with `Retry-After`. Waiting longer than 7 min ends with the same message. |
| A visitor closes the tab | Removed from the queue; if their answer was being written, the GPU stops. |
| llama-server crashes / eGPU disconnects | Running answer ends with "something went wrong" + retry. New questions get "offline/starting" immediately (never queued). The launcher restarts the model with back-off (10 s → 5 min). |
| Gateway down / machine off | Websites show the offline message with the configured email/contact link; the bubble keeps working on static pages. The backoffice shows "AI gateway offline". |
| VRAM overflow into RAM | Should be impossible with the fixed profile; if GPU-shared RAM grows > 300 MB above its post-load level, `cli.mjs status` and every site's dashboard show a GPU memory warning and widgets show "running slowly". Restart `ligata-ai-llm`. |
| A visitor sends a 200-page PDF | Text is extracted (max 80 pages, 10 MB); the answer starts after ~1 s per 1,000 tokens with a reading progress bar. If it exceeds the site's conversation limit the visitor is told to start a new chat. |

### Updating llama.cpp or the model

Download the new build/model into `runtime`, adjust `model/profile.json`, check with `node model/sweep.mjs --profiles <name> --depths 1000,32000,120000` and `node model/soak.mjs`, then `pm2 restart ligata-ai-llm`.

## On a client website (Umbraco)

- Install the `Ligata.AI` NuGet package, publish, open **AI Assistant**.
- Backups: settings, knowledge and counters are three tables in the CMS database, so the site's normal database backups include them. The API key is stored encrypted with the site's Data Protection keys; after restoring onto another server, paste the key again.
- Upgrading the package: publish the site; the migration is versioned and idempotent. Raise the widget version query string (`?v=`) with every release so browsers fetch the new script.
- Static hosting (Ligata.Cloudflare): add `/assets/ligata-ai/ligata-ai.js` to `AdditionalAssets`, set `LigataAI:PublicApiBase` and `AllowedOrigins`, and allow the widget's `data-api` endpoint in the exporter's origin check (like the Forms endpoint).
