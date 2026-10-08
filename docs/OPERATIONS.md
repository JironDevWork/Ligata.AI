# Operations

Two ways to run the AI. **GPU mode** (below) runs Gemma on the Ligata mini PC; everything in this file is about that machine. **API mode** (`LigataAI:Mode = api`) needs none of it: each website calls Anthropic itself. Its whole setup is the website's configuration:

```powershell
# on the web server, as a secret/environment variable of the site (never in a committed appsettings file)
LigataAI__Mode=api
LigataAI__Claude__ApiKey=<key from console.anthropic.com>
```

Then restart the site and check **AI Assistant → Settings → Connection → Test connection**. Visitors are told that their messages go to Anthropic (USA) before they agree; the Privacy tab writes the matching privacy policy text. Set a monthly spend limit in the Anthropic Console as the final cost ceiling (the package also enforces `LigataAI:Claude:QuestionsPerDay`, default 1,500).


## Privacy: running the GPU for other websites

In GPU mode, visitors are told that their messages go to an AI server run by `LigataAI:Privacy:GpuOperator` (default "Ligata") in `GpuOperatorCountry` (default `CH`, where this machine runs), and they agree before anything is sent. For every website you connect:
- Nothing to configure while the GPU stays in Switzerland. If it moves, set `"LigataAI": { "Privacy": { "GpuOperatorCountry": "…" } }` on every website (visitors are then asked again).
- Sign a data processing agreement (Art. 28 GDPR) with the website owner: you process their visitors' messages on their behalf. [docs/PRIVACY.md](PRIVACY.md#technical-and-organisational-measures-software) lists the technical measures for its annex.
- Keep the gateway reachable over HTTPS only (tunnel or reverse proxy); it listens on 127.0.0.1. The public hostname answers `/robots.txt` with `Disallow: /` and every response with `X-Robots-Tag: noindex, nofollow`. Cloudflare's managed robots.txt (AI Crawl Control) only prepends comments to it.
- `gateway/data/keys.json` is written crash-safe (flushed to disk before it replaces the old file), and `keys.json.bak` holds the previous version. A damaged file never disconnects sites: the gateway uses the backup or keeps the keys it has loaded, and logs `keys_damaged`. Back up `gateway/data` with the machine.

The gateway keeps no message content: no disk storage, no content in logs, the context only in GPU memory until it is overwritten.

## On the AI machine (mini PC with the RTX 3060 eGPU)

### First setup

1. llama.cpp and the model files go into `C:\Code\Ligata.AI\runtime` (see [model/README.md](../model/README.md#files-and-downloads)).
2. NVIDIA Control Panel → Manage 3D settings → Program Settings → `runtime\llama.cpp\llama-server.exe` → **CUDA – Sysmem Fallback Policy: Prefer No Sysmem Fallback**.
3. Install and start the two PM2 processes and save them for the boot task. In your own PowerShell (as Server):

```powershell
powershell -ExecutionPolicy Bypass -File C:\Code\Ligata.AI\gateway\install-pm2.ps1
```

The script stops copies that were started by hand, runs `npm ci` if needed, then `pm2 start gateway/ecosystem.config.cjs` and `pm2 save`, waits for the model and prints the status. PM2's daemon runs in the boot task's session, which tools running in other sandboxes cannot reach, so do this step from your own shell.

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
| A visitor sends a 200-page PDF | Text is extracted (max 80 pages, 10 MB); the answer starts after ~1 s per 1,000 tokens; meanwhile the chat says *Reading…*. When the conversation would no longer fit, the widget first summarizes the earlier messages and carries on; only a single message that is too big on its own is refused. |

### Updating llama.cpp or the model

Download the new build/model into `runtime`, adjust `model/profile.json`, check with `node model/sweep.mjs --profiles <name> --depths 1000,32000,120000` and `node model/soak.mjs`, then `pm2 restart ligata-ai-llm`.

## On a client website (Umbraco)

- Install the `Ligata.AI` NuGet package, publish, open **AI Assistant** (or **Support** without the AI feature).
- **What the customer booked**: set `LigataAI:Features` (`Assistant`, `LiveChat`, `Email`). Editors can switch included features off, never on. Live chat and the email form start switched off after an upgrade from 0.1, so no site suddenly promises a team that is not there.
- **Email** (notifications, the email form, replies from the Inbox) uses the site's `Umbraco:CMS:Global:Smtp` settings, like Ligata.Forms. Without SMTP, emails wait in the queue; *Settings → Team & email* shows the state and has a test button. Set `LigataAI:BackofficeUrl` (or an absolute `PublicApiBase`) so team emails link to the Inbox.
- **reCAPTCHA**: nothing to do when the site already has `LigataForms:Recaptcha`; the chat reuses it (own action `ligata_ai_contact`). Register the public hostnames in Google's console as for Forms.
- **Who answers**: members of `LigataAI:AgentGroups` (default admin, editor) see the Inbox and the header badge; `EditorGroups` (default admin) also see the settings. Each member's name and photo come from their Umbraco profile; *How I appear* in the Inbox lets them show less.
- **Online status**: visitors see the team as online while at least one member who is *Available* has the backoffice open in a browser tab (the header badge keeps the connection). Members who close Umbraco leave their chats automatically after 15 minutes.
- **Keep the site running** (IIS: *AlwaysRunning* / no idle timeout) so the background worker closes inactive conversations, deletes old ones and sends queued email even without traffic.
- **Backups**: settings, knowledge, counters, conversations and the email queue are tables in the CMS database, so the site's normal database backups include them. Conversations are deleted after the retention period you set, which also bounds what backups contain. The API key is stored encrypted with the site's Data Protection keys; after restoring onto another server, paste the key again.
- **Upgrading the package**: publish the site; the migrations are versioned and idempotent (0.1 → 0.2 adds four tables and new counters). The widget URL carries the package version, so browsers fetch the new script.
- **Static hosting** (Ligata.Cloudflare): add `/assets/ligata-ai/ligata-ai.js` to `AdditionalAssets`, set `LigataAI:PublicApiBase` and `AllowedOrigins`, and allow the widget's `data-api` endpoint in the exporter's origin check (like the Forms endpoint). Live chat works from static pages too: it only needs the CMS API to be reachable.
