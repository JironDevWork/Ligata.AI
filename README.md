# Ligata.AI

A website chat for **Umbraco 17.6 / .NET 10** with three features that work together or on their own:

- **AI assistant** answered by a self-hosted **Gemma 4 12B** on the Ligata mini PC, or by **Claude Haiku 5.5** through Anthropic's API (no extra server; see [AI engine](#ai-engine-own-gpu-or-claude-api)).
- **Live chat with your team**: when the AI cannot help, or a visitor asks for a person, the team answers in an **Inbox** inside Umbraco.
- **Email form**: visitors leave a message that arrives in your mailbox and in the Inbox.

Like Ligata.Forms and Ligata.Cloudflare, it is a NuGet package: install it into any Umbraco site, open the new section, switch on what you need.

```
visitor ──► chat bubble ──► the site's Umbraco (this package) ─┬─► Ligata AI gateway ──► Gemma 4 12B on the RTX 3060   (Mode "gpu")
            Shadow DOM      settings, knowledge, secret key,    │   API keys, one answer      weights, KV cache and vision in VRAM
            widget          Inbox, email queue, visitor limits  │   at a time, streaming
                                                                └─► Anthropic API ──► Claude Haiku 5.5                   (Mode "api")
                                                                    called directly by the site; key only in its configuration
```

| Part | Where | Docs |
| --- | --- | --- |
| Umbraco package | `src/Ligata.AI` | this file |
| Shared gateway | `gateway/` | [gateway/README.md](gateway/README.md) |
| Model runtime and benchmarks | `model/` | [model/README.md](model/README.md) |
| Plan and decisions | `docs/` | [docs/PLAN.md](docs/PLAN.md), [docs/SUPPORT.md](docs/SUPPORT.md) (team handoff, live chat, email) |

## What editors get

A new top-level section, **AI Assistant** (or **Support** when the AI is not licensed). Administrators get it on install; editors get the Inbox.

- **Inbox** (live):
  - conversations that need a reply, active chats, mine, all open and closed, with search and chat/email filters;
  - the visitor's conversation with the AI before the request;
  - join and leave, replies, internal notes, email replies, close/reopen/delete;
  - the visitor's typing and whether they are on the website now;
  - sound and desktop notifications, and an Available/Away switch.
  - **How I appear** lets each team member choose what visitors see: name and photo from their Umbraco profile, name only, a nickname, or anonymous (team name only).
- **Header badge**: a chat icon in the Umbraco header counts conversations that need a reply, from anywhere in the backoffice.
- **Settings**, organised in tabs:
  - **Overview**: getting-started checklist per feature, team inbox numbers, AI server status and the **context budget**.
  - **Appearance**:
    - six themes and ten editable colours, light/dark/automatic mode, position; every preset passes WCAG AA, and a live check flags colour pairs that are hard to read;
    - bubble icon, size and label, teaser, window size, corners, font;
    - memory meter, queue position, animations, a chime for team replies and branding.
    - A **live preview** uses unsaved settings, answers real AI questions and simulates team requests.
  - **Behaviour**:
    - name, avatar, greeting, suggested questions, language;
    - AI instructions, tone, answer length and limits;
    - uploads, fallback contacts, privacy notice, and where the bubble appears.
  - **Team & email**:
    - feature switches for AI, live chat and the email form;
    - team name, when the AI offers the team, a permanent "Talk to a person" button, which visitor details to ask for (hidden/optional/required), email required when nobody is online;
    - waiting/offline texts, how team members appear and whether they may choose;
    - email form texts and an optional visitor confirmation;
    - team notification addresses, reply-to and subject prefix, with a test email;
    - conversation lifetime (close after N days without messages, delete closed conversations after M days), spam protection and who answers.
  - **Knowledge**: upload PDF, Word, text, Markdown, CSV, JSON or HTML, write text, or import published pages; every source shows its token cost.
  - **Connection**: gateway address and API key (stored encrypted, never sent to browsers), live test. In API mode: the Claude model, whether the key is configured (never any part of it), a connection test and today's usage against the limits.
  - **Insights**: anonymous daily counters for the AI (questions, answer time, busy/offline, failures) and the team (chat requests, emails, replies, average first response, questions the AI could not answer).

## What visitors get

A chat bubble (bottom left by default). Styles are isolated in Shadow DOM, and it is keyboard and screen-reader friendly, full screen on phones and available in English, German, French and Italian.

- **AI answers**:
  - streamed, with safe Markdown;
  - suggested questions;
  - screenshot and PDF attachments;
  - a **memory meter**;
  - their **place in line** while the shared GPU is busy, with reading progress for long documents (GPU mode).
- **Talk to a person**: when the AI cannot answer, a card offers *Chat with our team* or *Send us an email*. A person icon in the header does the same at any time.
  - **The form**: name and email per the settings, the message prefilled with their question, and a storage notice. Spam protection only after consent.
  - **The live chat**: it continues in the same thread. The visitor sees who joins (name/photo as the team member chose), typing indicators, replies live, and when someone leaves or closes.
  - **When they're away**: a reply that arrives while the chat is closed shows an unread badge and a teaser with the reply, plus an optional chime.
- **Email form**: name (optional), email and message, with a confirmation in the thread (and by email if enabled).
- **Several conversations**: a list of AI, team and email threads on this device, with status, unread markers and the option to remove or end them. Threads survive page changes and reloads, and are forgotten after the configured inactivity period. Attachments are never kept.
- **Without AI**: the bubble opens a contact page with *Chat with our team* (showing whether someone is online) and *Send us an email*.

## Install

```powershell
dotnet pack src/Ligata.AI -c Release -o artifacts
# copy artifacts/Ligata.AI.0.3.0.nupkg into the site's local feed (e.g. the Ligata site's packages/ folder)
dotnet add package Ligata.AI --version 0.3.0 --source C:/path/to/feed
```

Normal `.AddComposers()` discovers everything.
- **Database**: the migrations create seven tables in the CMS database: settings, knowledge, counters, conversations, messages, team members and the email queue.
- **Access**: the section is granted to the `admin` group, and to the agent groups for the Inbox.
- **Files**: publish/restart once so the backoffice files (`App_Plugins/LigataAI`) and the widget (`/assets/ligata-ai/ligata-ai.js`) are copied.

Then, in the backoffice:
- **For the AI on the Ligata GPU**: **Settings → Connection** → gateway address and the key from `node cli.mjs keys create "Site name"` on the gateway machine → add knowledge.
- **For the AI through Claude**: set `LigataAI:Mode` to `api` and the key in the site's configuration (below), restart, check **Settings → Connection → Test connection** → add knowledge.
- **For the team**: **Settings → Team & email** → switch on live chat and/or the email form, then add team email addresses.
- Check the preview, then use **Show on website**.

## AI engine: own GPU or Claude API

`LigataAI:Mode` chooses where answers come from. Everything else (settings, knowledge, Inbox, limits, widget) is identical.

| | `"gpu"` (default) | `"api"` |
| --- | --- | --- |
| Model | Gemma 4 12B on the Ligata GPU | Claude Haiku 5.5 (`LigataAI:Claude:Model`) |
| Needs | the Ligata AI gateway (`gateway/`) and a `lai_…` key | an Anthropic API key, nothing else |
| Requests | site → gateway → GPU, one answer at a time, queue | site → Anthropic directly, several answers at once |
| PDFs | read by the gateway | read on the site's own server |
| Data | stays on your hardware | processed by Anthropic |

```json
{
  "LigataAI": {
    "Mode": "api",
    "Claude": {
      "Model": "claude-haiku-5-5",
      "Effort": "low",
      "QuestionsPerDay": 1500,
      "MaxConcurrent": 8,
      "MaxContextTokens": 100000,
      "TimeoutSeconds": 90
    }
  }
}
```

- **The key** goes into `LigataAI:Claude:ApiKey`, preferably as the environment variable or secret `LigataAI__Claude__ApiKey`. It is read on the server and sent only to Anthropic, never to browsers and never to the backoffice (not even in part). `ANTHROPIC_*` environment variables are ignored, so nothing else on the server can redirect visitor messages.
- **Limits still apply**:
  - the per-IP and per-visitor limits and one question at a time per visitor;
  - `QuestionsPerDay` (site-wide, UTC; 0 = unlimited);
  - `MaxConcurrent` answers at once (further visitors wait up to 15 s, then see "busy");
  - `MaxContextTokens` per question (Haiku 5.5 costs five times more above 100,000 prompt tokens);
  - the editor's answer and conversation limits.

  Also set a monthly spend limit in the Anthropic Console as the final ceiling.
- **Cost**: instructions and knowledge are sent as one cached block (prompt caching), so follow-up questions read them at a tenth of the input price. The date and page come after the cache breakpoint.
- **Thinking**: `Effort` `low` (default) keeps answers fast; Claude thinks only when a question needs it. *Think before answering* in the backoffice raises it one level. Claude Haiku 5.5 takes no temperature, so the *Creativity* slider is hidden in API mode.
- **Availability**: the widget's frequent status checks need no network call. A rejected key or unknown model shows as offline (and in the backoffice) until *Test connection* succeeds. Anthropic overload shows as "busy" for 30 s.
- **Privacy**: the default notice under the input becomes "Answers are generated by Claude, an AI by Anthropic …", and the branding says "AI by Ligata" instead of "Private AI". Each request carries only the pseudonymous visitor id (`metadata.user_id`), so Anthropic can act on abuse by one visitor without blocking the site.

## Host configuration

```json
{
  "LigataAI": {
    "Features": { "Assistant": true, "LiveChat": true, "Email": true },
    "PublicApiBase": "https://cms.example.ch/api/ligata-ai",
    "AllowedOrigins": ["https://www.example.ch"],
    "BackofficeUrl": "https://cms.example.ch",
    "TrustCloudflareLoopbackHeader": true,
    "EditorGroups": ["admin"],
    "AgentGroups": ["admin", "editor"],
    "MessagesPerTenMinutes": 20,
    "Support": { "OpenConversationsPerVisitor": 3, "ConversationsPerVisitorPerDay": 6, "EmailsPerVisitorPerHour": 3, "MaxOpenConversations": 500 }
  }
}
```

- **Features** decide what this installation includes, for example when a customer only books live chat. Editors can switch included features off, never on. Without `Assistant` there is no AI, no gateway connection and no Knowledge/Connection tabs; the bubble is a contact point for the team.
- **Email** uses the site's normal Umbraco SMTP settings (`Umbraco:CMS:Global:Smtp`, like Ligata.Forms). Emails wait in a queue (5 retries) until SMTP works. Links to the Inbox in team emails use `BackofficeUrl`, an absolute `PublicApiBase` or `Umbraco:CMS:WebRouting:UmbracoApplicationUrl`, never the request's host name.
- **Spam protection** reuses the Ligata.Forms reCAPTCHA v3 settings (`LigataForms:Recaptcha`: site key, secret, hostnames, minimum score, consent mode explicit/Cookiebot), so nothing is configured twice; `LigataAI:Recaptcha` (same shape) overrides them. The chat uses its own action (`ligata_ai_contact`), so a Forms token cannot be replayed against it.
- **Pages rendered by this Umbraco** need no configuration: the bubble is added before `</body>` automatically, and same-host requests are accepted.
- **Static exports** (e.g. Ligata.Cloudflare on Pages): set `PublicApiBase` to the CMS's public URL and list the public site in `AllowedOrigins`. Add `/assets/ligata-ai/ligata-ai.js` to the exporter's additional assets, and allow the widget's `data-api` CMS endpoint in its origin-leak check.
- `LigataAI:GatewayUrl` / `LigataAI:ApiKey` (better: environment variable `LigataAI__ApiKey`) override the backoffice values (GPU mode).
- **Manual placement**: set *Where it appears* to **Manual** and add `@await Component.InvokeAsync("LigataAssistant")` to a template.
- **JavaScript API**: `LigataAI.open()`, `close()`, `ask("…")`, `reset()`, `contact("chat" | "email")`.

## Security and privacy

- **Traffic and keys.** Browsers only talk to their own Umbraco site. The site calls the gateway server-to-server with its API key (Data Protection-encrypted, or from configuration), or in API mode Anthropic with the key from its configuration.
- **Public endpoints.** Exact-origin CORS allowlist (plus same host), per-IP and per-visitor limits, one AI question at a time per visitor, size limits, no cookies. Visitor IPs are HMAC-pseudonymised with a per-site secret.
- **Team conversations.**
  - Reached only with a random 256-bit token, kept by the visitor's browser and stored as a SHA-256 hash; ids alone grant nothing.
  - Limits: open chats and requests per visitor, emails per hour, messages per minute and per conversation, open conversations site-wide, concurrent connections.
  - Closed after N days without messages and deleted M days later.
  - Internal notes are never sent to visitors.
- **Team members.** They are identified to visitors only as they choose. The Umbraco user key is never exposed, and photos are served only while a team member shows them.
- **AI conversations** are not stored on the server. Statistics are anonymous daily counters (including how often the AI could not answer, never the question). PDFs and screenshots are processed in memory.
- **Escaping.** All visitor text is escaped in the widget, the backoffice and emails. Email subjects cannot carry line breaks.
- **Your privacy policy** should mention the chat:
  - AI processing on your own server, without storage, or in API mode by Anthropic (Claude);
  - team conversations stored for your configured period;
  - Google reCAPTCHA, if used.

## Third-party components

- [Anthropic C# SDK](https://github.com/anthropics/anthropic-sdk-csharp) (MIT) for API mode.
- [PdfPig](https://github.com/UglyToad/PdfPig) (Apache-2.0) reads PDFs on the site's server in API mode.
- [Tabler Icons](https://tabler.io/icons) (MIT), outline set, in the widget and the backoffice.

## Tests

```powershell
dotnet run --project tests/Ligata.AI.Tests -c Release                         # 91 domain/security checks
dotnet run --project tests/Ligata.AI.Tests -c Release -- --database C:/…/.runtime/ai-test.db [--serve --urls http://127.0.0.1:5310]   # + 43 database checks
cd tests/e2e; npm ci; node run.mjs                                             # AI assistant browser suite (Microsoft Edge)
node support.mjs                                                               # team handoff, inbox and email browser suite
node api.mjs                                                                   # API mode against the strict mock Anthropic API (mock-anthropic.mjs)
cd gateway; npm test                                                           # 33 gateway tests
```

See [docs/TESTING.md](docs/TESTING.md).
