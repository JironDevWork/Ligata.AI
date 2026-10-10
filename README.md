# Ligata.AI

A website chat for **Umbraco 17.6 / .NET 10** with three features that work together or on their own, and a content assistant for editors:

- **AI assistant** answered by a self-hosted **Gemma 4 12B** on the Ligata mini PC, or by **Claude Haiku 5.5** through Anthropic's API (no extra server; see [AI engine](#ai-engine-own-gpu-or-claude-api)).
- **Live chat with your team**: when the AI cannot help, or a visitor asks for a person, the team answers in an **Inbox** inside Umbraco.
- **Email form**: visitors leave a message that arrives in your mailbox and in the Inbox.
- **Content assistant** (0.9): a chat in the Umbraco backoffice that finds, reads and changes content with tools. Changes wait for approval or run by permission mode (Manual, Auto, Bypass), are saved as drafts, checked after saving, logged with the person who asked and can be undone. See [docs/CONTENT-ASSISTANT.md](docs/CONTENT-ASSISTANT.md).

Built for the GDPR (DSGVO): the AI reads nothing before a visitor agrees, every consent is recorded and can be withdrawn, Cookiebot is supported, and the backoffice writes the matching privacy policy text. See [Privacy](#privacy-gdpr--dsgvo).

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
| Privacy guide and policy texts | `docs/` | [docs/PRIVACY.md](docs/PRIVACY.md), [docs/privacy/](docs/privacy/) (German and English) |
| Content assistant (backoffice) | `src/Ligata.AI/Editor` | [docs/CONTENT-ASSISTANT.md](docs/CONTENT-ASSISTANT.md) |
| Roadmap | `docs/` | [docs/ROADMAP.md](docs/ROADMAP.md) (the website assistant taking visitors to the right place; the content assistant on the GPU) |

## What editors get

A new top-level section, **AI Assistant** (or **Support** when no AI is licensed: neither the website assistant nor the content assistant). Administrators get it on install; editors get the Inbox.

- **Inbox** (live):
  - conversations that need a reply, active chats, mine, all open and closed, with search and chat/email filters;
  - the visitor's conversation with the AI before the request;
  - join and leave, replies, internal notes, email replies, close/reopen/delete;
  - the visitor's typing and whether they are on the website now;
  - sound and desktop notifications, and an Available/Away switch.
  - **How I appear** lets each team member choose what visitors see: name and photo from their Umbraco profile, name only, a nickname, or anonymous (team name only).
- **AI conversations** (0.7, optional): while the site keeps a history (*Settings → Privacy → Conversation history*, off by default), what visitors asked the AI, what it looked up on the website and what it answered, newest first. Views for unanswered questions (errors, or answers that offered the team), conversations handed to the team (with a link to the Inbox) and kept ones; search over questions and answers; *Keep* exempts a conversation from automatic deletion; delete one or all. Same access as the Inbox.
- **Header badge**: a chat icon in the Umbraco header counts conversations that need a reply, from anywhere in the backoffice.
- **Content assistant** (0.9): a bubble at the bottom right of the backoffice for the groups you choose (administrators by default). It finds pages by their text (drafts too, inside blocks), reads them with every field, and changes text, rich text, pickers and blocks per language, creates pages and uploads images. Publishing, moving and deleting are possible when allowed. Each change shows as a card with before and after; **Manual** asks every time, **Auto** makes the safe drafts on its own and asks before risky changes (clearing a field, removing a block, changing what all languages share) and the kinds you did not approve, **Bypass** asks never. Its page under *AI Assistant → Content assistant* has the **Activity** log (who asked, what changed, how it was approved, Undo), the **Settings** (who, modes, what it may do, where, effort, house rules, limits) and **Usage**.
- **Settings**, organised in tabs:
  - **Overview**: getting-started checklist per feature, team inbox numbers, AI server status and the **context budget**.
  - **Appearance**:
    - six themes and ten editable colours, light/dark/automatic mode, position; every preset passes WCAG AA, and a live check flags colour pairs that are hard to read;
    - bubble icon, size and label, teaser, window size, corners, font;
    - memory bar (off by default), queue position, animations, a chime for team replies and branding.
    - A **live preview** uses unsaved settings, answers real AI questions and simulates team requests.
  - **Behaviour**:
    - name, avatar, greeting, suggested questions, language;
    - AI instructions, tone, answer length and limits;
    - uploads, fallback contacts, and where the bubble appears.
  - **Team & email**:
    - feature switches for AI, live chat and the email form;
    - team name, when the AI offers the team, a permanent "Talk to a person" button, which visitor details to ask for (hidden/optional/required), email required when nobody is online;
    - waiting/offline texts, how team members appear and whether they may choose;
    - email form texts and an optional visitor confirmation;
    - team notification addresses, reply-to and subject prefix, with a test email;
    - conversation lifetime (close after N days without messages, delete closed conversations after M days), spam protection and who answers.
  - **Knowledge** (see [How the assistant knows your website](#how-the-assistant-knows-your-website)):
    - every published page is used automatically, in every language, including pages added later; leave out single pages or whole sections (`/shop/`);
    - upload PDF, Word, text, Markdown, CSV, JSON or HTML, or write text; mark short essentials as *always known*;
    - a test search, and the list of pages the assistant gets with every question.
  - **Connection**: the keys for the Ligata GPU (gateway address and `lai_…` key) and for Claude (an Anthropic key), each stored encrypted (or set in the configuration) and never sent to browsers; a live test and the status of each engine (Claude: today's usage against the limits). With both set up, **AI engine** chooses which one answers visitors; with one, that one answers and no switch is shown (the other can be added under *Add another AI engine*).
  - **Privacy**: consent status (who receives the data, how long a consent lasts, how many visitors agreed, asked and withdrew), the wording of the consent request, *Ask all visitors again*, the **conversation history** (on/off, days to keep, 1 to 365), the notice under the input and the privacy policy link, what to declare in Cookiebot, and the **privacy policy text** for this site's setup in German or English (copy or download).
  - **Insights**: anonymous daily counters for the AI (questions, answer time, busy/offline, failures) and the team (chat requests, emails, replies, average first response, questions the AI could not answer).

## What visitors get

A chat bubble (bottom right by default, clear of Cookiebot's button bottom left). Styles are isolated in Shadow DOM, and it is keyboard and screen-reader friendly, full screen on phones and available in English, German, French and Italian.

- **Consent first**: before the first question the chat says that the assistant is an AI, which data goes where (Anthropic in the USA, or the operator of the AI server) and links the privacy policy. Nothing reaches the AI until the visitor agrees; withdrawing takes two clicks (*Conversations → Withdraw consent*). The team can be reached without agreeing.
- **AI answers**:
  - streamed, with safe Markdown;
  - **looked up on the website**: the assistant searches the site's pages and documents while it answers (*Searching the website…*) and links to the page in the visitor's language;
  - suggested questions;
  - screenshot and PDF attachments;
  - a **memory bar** (off by default, *Appearance*) that shows how full the assistant’s memory is, in percent rather than tokens (the backoffice preview also shows the tokens); long conversations are counted and summarized either way;
  - **long conversations keep going**: before a question would no longer fit, the earlier messages are summarized automatically (with a progress bar) and the conversation continues with the summary and the latest exchange. The visitor still sees every message;
  - their **place in line** while the shared GPU is busy, and *Reading…* while a long conversation or document is read (GPU mode).
- **Talk to a person**: when the AI cannot answer, a card offers *Chat with our team* or *Send us an email*; without live chat and the email form, it offers the contact email and contact page from the settings. A person icon in the header does the same at any time.
  - **The form**: name and email per the settings, the message prefilled with their question, and a storage notice. Spam protection only after consent.
  - **The live chat**: it continues in the same thread. The visitor sees who joins (name/photo as the team member chose), typing indicators, replies live, and when someone leaves or closes.
  - **When they're away**: a reply that arrives while the chat is closed shows an unread badge and a teaser with the reply, plus an optional chime.
- **Email form**: name (optional), email and message, with a confirmation in the thread (and by email if enabled).
- **Several conversations**: a list of AI, team and email threads on this device, with status, unread markers and the option to remove or end them. Threads survive page changes and reloads, and are forgotten after the configured inactivity period. Attachments are never kept.
- **Without AI**: the bubble opens a contact page with *Chat with our team* (showing whether someone is online) and *Send us an email*.

## Install

```powershell
dotnet pack src/Ligata.AI -c Release -o artifacts
# copy artifacts/Ligata.AI.0.9.1.nupkg into the site's local feed (e.g. the Ligata site's packages/ folder)
dotnet add package Ligata.AI --version 0.8.0 --source C:/path/to/feed
```

Normal `.AddComposers()` discovers everything.
- **Database**: the migrations create eight tables in the CMS database: settings, knowledge, counters, conversations, messages, team members, the email queue and consent records.
- **Access**: the section is granted to the `admin` group, and to the agent groups for the Inbox.
- **Files**: the backoffice files (`/App_Plugins/LigataAI`) and the widget (`/assets/ligata-ai/ligata-ai.js`) are static web assets: `dotnet run` serves them from the package, and publishing copies them into `wwwroot`.

Then, in the backoffice:
- **For the AI on the Ligata GPU**: **Settings → Connection** → gateway address and the key from `node cli.mjs keys create "Site name"` on the gateway machine. Your pages are used at once; leave out what the assistant should not use, add documents under **Knowledge**.
- **For the AI through Claude**: paste an Anthropic API key under **Settings → Connection** (or set `LigataAI__Claude__ApiKey` in the site's configuration, below). Pages are used at once, as with the GPU. With both engines set up, choose under **Connection → AI engine** which one answers.
- **For the team**: **Settings → Team & email** → switch on live chat and/or the email form, then add team email addresses.
- Check the preview, then use **Show on website**.

## How the assistant knows your website

The assistant does not read the whole website with every question. It gets its instructions, the knowledge marked *always known* and a list of the pages (titles and urls, without their text), and looks up what a question needs while it answers:

- **`search_website`** searches every page and document and returns the best passages with their page url. It is a keyword index on the website's own server (BM25 over passages of about a paragraph): words match without accents and by prefix, so *kontakt* finds *Kontaktformular* and *preise* finds *Preis*.
- **`read_pages`** reads up to three pages (by url) or documents (by title) in full.

The model may search several topics at once, in up to three rounds per answer (about 7,000 tokens of results); then it answers with what it found. The visitor sees *Searching the website…* meanwhile. Looking things up is the model's choice: greetings, small talk and follow-ups the conversation already answers are answered at once, but every fact about the website must come from a lookup, the knowledge or the conversation, never from memory. On the GPU, a question that asks for website facts the conversation does not contain yet must be looked up first: a 12B model otherwise too often answers from the prompt alone.

- **Big websites fit**: knowledge no longer grows with the website. The list of pages takes at most about 3,000 tokens; a bigger website lists its upper levels and is found by search.
- **Always current**: pages are read live from Umbraco's published content. Publishing, unpublishing or moving a page updates what the assistant finds at once (on every server of a load-balanced site). New pages are included automatically; editors leave out single pages or whole sections under **Knowledge**.
- **Multilingual websites**: every language of a page is searched on its own, with its own name, url and text. The list of pages is grouped by language, results name the language, the language of the page the visitor is on wins a tie, and answers link to the page in the visitor's language.
- **Earlier lookups stay in the conversation**: the browser keeps only what was looked up (for example `search_website("opening hours")`); the website looks it up again for every follow-up question. The model sees the same results, the browser cannot change them, and on the GPU the cached conversation stays valid.
- **When nothing is found**, the assistant says so and offers the team (or the contact email and page). It never invents prices, dates or contact details.
- **Always known**: short essentials (opening hours, key facts) can be read with every question instead of being looked up; they count against the knowledge budget.
- **An AI server without lookups** (a gateway older than 0.6) still works: pages and documents then go into the prompt, in order, as far as the knowledge budget allows.

Until 0.6, pages were imported as copies. On upgrade, the copies are replaced by the live pages; a copy that was switched off becomes a left-out page.

## AI engine: own GPU or Claude API

Answers come from the Ligata GPU or from Claude. Everything else (settings, knowledge, Inbox, limits, widget) is identical.

- **An engine is set up when its key is there**: the `lai_…` key for the Ligata AI gateway, an Anthropic key for Claude. Each key is entered under **Settings → Connection** (stored encrypted with the server's Data Protection keys) or set in the configuration (`LigataAI__ApiKey`, `LigataAI__Claude__ApiKey`), which wins.
- **One engine set up**: it answers, and the backoffice shows no switch.
- **Both set up**: editors choose under **Connection → AI engine**. `LigataAI:Mode` (`gpu` or `api`) is the default until they do. Adding a key never changes who answers; removing the key of the engine in use hands visitors to the other one.
- **Switching asks visitors again**: the consent names who answers (Anthropic in the USA, or the GPU operator and its country), so every visitor agrees again, and the text for the privacy policy under **Privacy** changes with the engine.
- **How much the AI thinks** is set under **Behaviour**: the GPU (Gemma) thinks or does not (*Think before answering*); Claude has an effort level: *Off* (no thinking, fastest), *Low* (default: thinks only when a question needs it), *Medium*, *High*, *Extra high* and *Max* (much slower and more expensive, rarely better for website questions). With both engines set up, the other engine's setting is under *When … answers*.

| | Ligata GPU (`"gpu"`, default) | Claude API (`"api"`) |
| --- | --- | --- |
| Model | Gemma 4 12B on the Ligata GPU | Claude Haiku 5.5 (`LigataAI:Claude:Model`) |
| Needs | the Ligata AI gateway (`gateway/`) and a `lai_…` key | an Anthropic API key, nothing else |
| Requests | site → gateway → GPU, three answers at once, then a queue | site → Anthropic directly, several answers at once |
| PDFs | read by the gateway | read on the site's own server |
| Data | stays on your hardware | processed by Anthropic |

```json
{
  "LigataAI": {
    "Mode": "api",
    "Claude": {
      "Model": "claude-haiku-5-5",
      "QuestionsPerDay": 1500,
      "MaxConcurrent": 8,
      "MaxContextTokens": 100000,
      "TimeoutSeconds": 90
    }
  }
}
```

- **The key** goes under **Connection** (stored encrypted) or into `LigataAI:Claude:ApiKey`, preferably as the environment variable or secret `LigataAI__Claude__ApiKey`. It is sent only to Anthropic, never to browsers; the backoffice sees only its first and last characters. `ANTHROPIC_*` environment variables are ignored, so nothing else on the server can redirect visitor messages.
- **Limits still apply**:
  - the per-IP and per-visitor limits and one question at a time per visitor;
  - `QuestionsPerDay` (site-wide, UTC; 0 = unlimited);
  - `MaxConcurrent` answers at once (further visitors wait up to 15 s, then see "busy");
  - `MaxContextTokens` per question (Haiku 5.5 costs five times more above 100,000 prompt tokens);
  - the editor's answer and conversation limits.

  Also set a monthly spend limit in the Anthropic Console as the final ceiling.
- **Cost**: the tools, instructions, always-known knowledge and the list of pages are sent as one cached block (prompt caching), so follow-up questions read them at a tenth of the input price. The date and page come after the cache breakpoint. Lookups run on the website's server; their results count as input tokens.
- **Thinking**: the effort level under **Behaviour** (default *Low*: fast, thinks only when a question needs it). Thinking gets room on top of the answer limit (2k tokens at Low up to 64k at Max). Until 0.8 it was `LigataAI:Claude:Effort`, raised one level by *Think before answering*; that setting is gone. Claude Haiku 5.5 takes no temperature, so the *Creativity* slider is hidden for Claude. Measured on the test site with the real API (October 2026): Off about 1 s, Low about 2 s with a lookup, Medium and High 3.5 to 4 s, Extra high about 6 s.
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
    "Support": { "OpenConversationsPerVisitor": 3, "ConversationsPerVisitorPerDay": 6, "EmailsPerVisitorPerHour": 3, "MaxOpenConversations": 500 },
    "Privacy": { "RequireConsent": true, "ConsentMode": "explicit", "GpuOperator": "Ligata", "GpuOperatorCountry": "CH" },
    "ContentAssistant": { "CompactAtTokens": 60000 }
  }
}
```

- **Features** decide what this installation includes, for example when a customer only books live chat. Editors can switch included features off, never on. Without `Assistant` there is no AI, no gateway connection and no Knowledge/Connection tabs; the bubble is a contact point for the team. `ContentAssistant` (default `true`) includes the content assistant in the backoffice; it needs the Anthropic key (`LigataAI__Claude__ApiKey` or *Connection*) and is set up under *AI Assistant → Content assistant*. `ContentAssistant:CompactAtTokens` is where its conversations are summarized, and `ContentAssistant:Effort` (off, low, medium, high, xhigh) sets its default thinking effort, winning over the backoffice setting.
- **Email** uses the site's normal Umbraco SMTP settings (`Umbraco:CMS:Global:Smtp`, like Ligata.Forms). Emails wait in a queue (5 retries) until SMTP works. Links to the Inbox in team emails use `BackofficeUrl`, an absolute `PublicApiBase` or `Umbraco:CMS:WebRouting:UmbracoApplicationUrl`, never the request's host name.
- **Spam protection** reuses the Ligata.Forms reCAPTCHA v3 settings (`LigataForms:Recaptcha`: site key, secret, hostnames, minimum score, consent mode explicit/Cookiebot), so nothing is configured twice; `LigataAI:Recaptcha` (same shape) overrides them. The chat uses its own action (`ligata_ai_contact`), so a Forms token cannot be replayed against it.
- **Pages rendered by this Umbraco** need no configuration: the bubble is added before `</body>` automatically, and same-host requests are accepted.
- **Static exports** (e.g. Ligata.Cloudflare on Pages): set `PublicApiBase` to the CMS's public URL and list the public site in `AllowedOrigins`. Add `/assets/ligata-ai/ligata-ai.js` to the exporter's additional assets, and allow the widget's `data-api` CMS endpoint in its origin-leak check.
- `LigataAI:GatewayUrl` / `LigataAI:ApiKey` (better: environment variable `LigataAI__ApiKey`) override the backoffice values (GPU mode).
- **Manual placement**: set *Where it appears* to **Manual** and add `@await Component.InvokeAsync("LigataAssistant")` to a template.
- **Privacy** decides how visitors agree before the AI reads their messages; see [Privacy](#privacy-gdpr--dsgvo) and [docs/PRIVACY.md](docs/PRIVACY.md).
- **JavaScript API**: `LigataAI.open()`, `close()`, `ask("…")` (waits in the input until the visitor agreed), `reset()`, `contact("chat" | "email")`.

## Security and privacy

- **Traffic and keys.** Browsers only talk to their own Umbraco site. The site calls the gateway server-to-server with its API key (Data Protection-encrypted, or from configuration), or in API mode Anthropic with the key from its configuration.
- **Public endpoints.** Exact-origin CORS allowlist (plus same host), per-IP and per-visitor limits, one AI question at a time per visitor, size limits, no cookies. Visitor IPs are HMAC-pseudonymised with a per-site secret. Questions and files need a recorded consent (`403 consent_required` otherwise).
- **Team conversations.**
  - Reached only with a random 256-bit token, kept by the visitor's browser and stored as a SHA-256 hash; ids alone grant nothing.
  - Limits: open chats and requests per visitor, emails per hour, messages per minute and per conversation, open conversations site-wide, concurrent connections.
  - Closed after N days without messages and deleted M days later.
  - Internal notes are never sent to visitors.
- **Team members.** They are identified to visitors only as they choose. The Umbraco user key is never exposed, and photos are served only while a team member shows them.
- **AI conversations** are not stored on the server unless the site keeps a history (off by default); the consent request then states the period and the right to object. Then: questions, answers, lookups and file names (never files, IP addresses or visitor ids), deleted after the period they were collected under unless kept for a reason (at most a year); visitors object (*Stop keeping*), delete single conversations or withdraw consent in the chat, which deletes the server copies. Statistics are anonymous daily counters. PDFs and screenshots are processed in memory.
- **Escaping.** All visitor text is escaped in the widget, the backoffice and emails. Email subjects cannot carry line breaks.
- **Your privacy policy** must mention the chat: copy the text from the Privacy tab (see below).
- **Content assistant.** Every tool runs with the signed-in editor's own Umbraco permissions, inside the scope set in its settings; page text is treated as data, never as instructions; rich text it writes is sanitized; changes are logged and can be undone. Editors' messages and the content it reads go to Anthropic: mention it in your staff privacy notes (see [docs/CONTENT-ASSISTANT.md](docs/CONTENT-ASSISTANT.md#security)).

## Privacy (GDPR / DSGVO)

- **Consent before the AI.**
  - The chat asks before the first question, names the recipient and links your privacy policy.
  - The server records each consent (random id, text version, times; no IP, no content) and refuses questions and files without a valid one.
  - Visitors withdraw in the chat; a new recipient or *Ask all visitors again* asks everyone again; consents expire after a year.
- **Conversation history.** Off by default. When on, the consent request states how long conversations are kept and, on its own line, that visitors can object (*Stop keeping* under *Conversations*; the assistant works the same afterwards). There is no checkbox: the legal basis is the site's legitimate interest (Art. 6(1)(f) GDPR), because a consent the assistant depended on would not be freely given. Another period asks every visitor again before their next question. The notice under the input states the period, the privacy policy text gains the section, and *Stop keeping*, *Delete conversation* and a withdrawal delete the server copies.
- **Cookiebot.**
  - The script tag is exempt from automatic blocking (`data-cookieconsent="ignore"`): the chat sets no cookies and asks itself.
  - Declare its local storage entries as *Necessary*.
  - Optionally let a Cookiebot category give the AI consent (`"ConsentMode": "cookiebot"`).
- **Privacy policy text.** The Privacy tab writes the sections for your setup in German or English (engine, features, periods, reCAPTCHA, Cookiebot). The templates are in [docs/privacy](docs/privacy/) and in the package.
- **Your part.**
  - Have the text reviewed.
  - Sign a data processing agreement with the GPU server's operator, or keep Anthropic's DPA (API mode).
  - Add the chat to your record of processing activities.

  [docs/PRIVACY.md](docs/PRIVACY.md) has the details, a record template and the technical measures.

## Third-party components

- [Anthropic C# SDK](https://github.com/anthropics/anthropic-sdk-csharp) (MIT) for API mode.
- [PdfPig](https://github.com/UglyToad/PdfPig) (Apache-2.0) reads PDFs on the site's server in API mode.
- [Tabler Icons](https://tabler.io/icons) (MIT), outline set, in the widget and the backoffice.

## Tests

```powershell
dotnet run --project tests/Ligata.AI.Tests -c Release                         # 227 domain/security checks
dotnet run --project tests/Ligata.AI.Tests -c Release -- --bench              # a big website: 2,000 pages in three languages
dotnet run --project tests/Ligata.AI.Tests -c Release -- --database C:/…/.runtime/ai-test.db [--serve --urls http://127.0.0.1:5310]   # 376 checks with the database
cd tests/e2e; npm ci; node run.mjs                                             # AI assistant browser suite (Microsoft Edge)
node support.mjs                                                               # team handoff, inbox and email browser suite
node api.mjs                                                                   # API mode against the strict mock Anthropic API (mock-anthropic.mjs)
node privacy.mjs                                                               # consent, withdrawal, Cookiebot, privacy policy text
node history.mjs                                                               # the conversation history: stated in the consent request, objection, a new period asks again
node concurrency.mjs                                                           # several visitors at once, summaries in line, settings changed mid-answer
node memory.mjs                                                                # long conversations and summaries (no host needed)
node editor.mjs                                                                # the content assistant: modes, approvals, blocks, Undo, activity, settings (mock Anthropic)
cd gateway; npm test                                                           # 62 gateway tests
```

See [docs/TESTING.md](docs/TESTING.md). Why things are built the way they are, and what is still open: [docs/DECISIONS.md](docs/DECISIONS.md).
