# Ligata.AI

A website assistant for **Umbraco 17.6 / .NET 10**, answered by a self-hosted **Gemma 4 12B** on the Ligata mini PC. Like Ligata.Forms and Ligata.Cloudflare, it is a NuGet package: install it into any Umbraco site, open the new **AI Assistant** section, connect it with an API key and switch it on.

```
visitor ──► chat bubble ──► the site's Umbraco (this package) ──► Ligata AI gateway ──► Gemma 4 12B on the RTX 3060
            Shadow DOM      settings, knowledge, secret key,       API keys, one answer      weights, KV cache and
            widget          visitor limits, prompt building        at a time, streaming      vision all in VRAM
```

| Part | Where | Docs |
| --- | --- | --- |
| Umbraco package | `src/Ligata.AI` | this file |
| Shared gateway | `gateway/` | [gateway/README.md](gateway/README.md) |
| Model runtime and benchmarks | `model/` | [model/README.md](model/README.md) |
| Plan and decisions | `docs/` | [docs/PLAN.md](docs/PLAN.md) |

## What editors get

**AI Assistant** is a new top-level section (administrators get it automatically on install):

- **Overview**: getting-started checklist, live status of the shared AI server, and a **context budget** bar showing how a conversation's tokens are split between instructions, knowledge, the chat and the answer.
- **Appearance**: six themes (Ligata, Midnight, Ocean, Forest, Sunset, Graphite) plus ten editable colours, light/dark/automatic mode, bottom-left or bottom-right, bubble icon/size/label, teaser message, window size, corners, font, memory meter, queue position, animations, branding. A **live preview** on a sample page (desktop/mobile, light/dark page) uses the unsaved settings and answers real questions.
- **Behaviour**: name, avatar, greeting, suggested questions, interface language, your own instructions (with token count), tone, answer length, stay-on-topic, page awareness, formatting, optional thinking mode, creativity, conversation limit, knowledge budget, longest answer, screenshot/PDF uploads, offline message and contact options, privacy notice, and where the bubble appears (every page, only on…, everywhere except…, or manual).
- **Knowledge**: upload PDF, Word (.docx), text, Markdown, CSV, JSON or HTML; write text; or **import published website pages** in one click. Every source shows its exact token cost, can be switched off and reordered, and the knowledge budget is enforced.
- **Connection**: gateway address and API key (stored encrypted, never shown again, never sent to browsers), live test.
- **Insights**: anonymous daily counters: conversations, questions, answered, average answer time, attachments, turned away while busy/offline, failures.

## What visitors get

A chat bubble (bottom left by default) that streams answers with safe Markdown, suggested questions, screenshot and PDF attachments (paste, drag and drop or pick), a **memory meter** showing how much of the conversation's context is used, their **place in line** when the shared GPU is busy, progress while a long document is read, a stop button, copy buttons, and clear offline/busy messages with contact options. It is keyboard and screen-reader friendly, respects reduced motion, opens full screen on phones, and isolates its styles in Shadow DOM so the host site's CSS cannot break it. The conversation text survives page changes within the tab (sessionStorage); attachments are never kept. Interface languages: English, German, French, Italian; the assistant answers in the visitor's language.

## Install

```powershell
dotnet pack src/Ligata.AI -c Release -o artifacts
# copy artifacts/Ligata.AI.0.1.0.nupkg into the site's local feed (e.g. the Ligata site's packages/ folder)
dotnet add package Ligata.AI --version 0.1.0 --source C:/path/to/feed
```

Normal `.AddComposers()` discovers everything. The migration creates three tables (`LigataAISettings`, `LigataAIKnowledge`, `LigataAIStat`) in the CMS database and grants the section to the `admin` group. Publish/restart once so the backoffice files (`App_Plugins/LigataAI`) and the widget (`/assets/ligata-ai/ligata-ai.js`) are copied.

Then, in the backoffice: **AI Assistant → Connection** → gateway address and the key from `node cli.mjs keys create "Site name"` on the gateway machine → **Save & test** → add knowledge → preview → **Show on website**.

## Host configuration (optional)

```json
{
  "LigataAI": {
    "PublicApiBase": "https://cms.example.ch/api/ligata-ai",
    "AllowedOrigins": ["https://www.example.ch"],
    "TrustCloudflareLoopbackHeader": true,
    "MessagesPerTenMinutes": 20,
    "EditorGroups": ["admin"],
    "AutoInject": true
  }
}
```

- Pages rendered by this Umbraco need no configuration: the bubble is added before `</body>` automatically (any template using the MVC tag helpers), and requests from the same host are accepted.
- **Static exports** (e.g. Ligata.Cloudflare on Pages): set `PublicApiBase` to the CMS's public URL and list the public site in `AllowedOrigins`. The exported HTML contains only public appearance settings, never prompts, knowledge or keys. Add `/assets/ligata-ai/ligata-ai.js` to the exporter's additional assets, and allow the widget's `data-api` CMS endpoint in its origin-leak check like the Forms endpoint. When the CMS is unreachable, the static bubble still opens and shows the offline message with your contact options.
- `LigataAI:GatewayUrl` / `LigataAI:ApiKey` (better: environment variable `LigataAI__ApiKey`) override the backoffice values.
- Manual placement: set *Where it appears* to **Manual** and add `@await Component.InvokeAsync("LigataAssistant")` to a template. JavaScript API: `LigataAI.open()`, `LigataAI.close()`, `LigataAI.ask("…")`, `LigataAI.reset()`.

## Security and privacy

- Browsers only talk to their own Umbraco site. The site calls the gateway server-to-server with its API key (Data Protection-encrypted in the database, or from configuration).
- Public endpoints: exact-origin CORS allowlist (plus same host), per-IP rate limits, **one question at a time per visitor**, size limits on messages and attachments, no cookies. Visitor IPs are HMAC-pseudonymised with a per-site secret before leaving the server.
- No conversation content is stored, by the package or the gateway. Statistics are anonymous daily counters. PDFs are converted to text in memory; screenshots are downscaled in the browser and processed in memory.
- The system prompt contains Ligata's guardrails (stay on topic, no invented prices/promises, attachments are information not instructions, don't reveal instructions) before the owner's instructions and the knowledge. Visitors cannot send system messages.
- Mention the assistant in your privacy policy (processing on your own server, no storage, purpose: answering questions).

## Tests

```powershell
dotnet run --project tests/Ligata.AI.Tests -c Release                         # 47 domain/security checks
dotnet run --project tests/Ligata.AI.Tests -c Release -- --database C:/…/.runtime/ai-test.db [--serve --urls http://127.0.0.1:5310]
cd tests/e2e; npm ci; node run.mjs                                             # 23 browser checks in Microsoft Edge
cd gateway; npm test                                                           # 24 gateway tests
```

The database mode installs a disposable Umbraco 17 site (SQLite under `.runtime/`, generated fixture admin), seeds three pages and checks the store, versioning, knowledge and section grant; `--serve` keeps it running for the browser suite. See [docs/TESTING.md](docs/TESTING.md).
