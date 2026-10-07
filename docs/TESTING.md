# Testing

All checks use disposable data: a fixture Umbraco database under `.runtime/`, a generated fixture administrator (`.runtime/ai-test-admin.json`, never committed), synthetic pages and synthetic questions. Nothing touches a production site or database.

## Repeatable checks

```powershell
# Gateway: 33 tests against a mock llama-server (no GPU needed)
cd gateway; npm test

# Package domain and security checks (no database): 114 assertions
dotnet run --project tests/Ligata.AI.Tests -c Release

# Real Umbraco 17 host: unattended install or 0.1 → 0.2 upgrade on SQLite, migrations, section grants, store, knowledge,
# counters, team conversations, limits, spam check, lifecycle, SMTP delivery, backoffice manifest, API-mode ceiling, consent records: 164 assertions in total
dotnet run --project tests/Ligata.AI.Tests -c Release -- --database C:/Code/Ligata.AI/.runtime/ai-test.db --serve --urls http://127.0.0.1:5310

# Browser suite in Microsoft Edge (headless): 23 checks, needs the host above and a gateway
node gateway/test/mock-server.mjs 1298                                    # or a real llama-server
$env:LIGATA_AI_DATA='C:/Code/Ligata.AI/.runtime/gateway-dev'; $env:LIGATA_AI_UPSTREAM='http://127.0.0.1:1298'; $env:LIGATA_AI_PORT=1220; $env:LIGATA_AI_ADMIN_PORT=1222; $env:LIGATA_AI_MEMORY_PROBE=0; node gateway/src/main.mjs
node gateway/cli.mjs keys create "Test host" > .runtime/gateway-dev/created.txt    # with the same LIGATA_AI_DATA
cd tests/e2e; npm ci; node run.mjs
```

The database mode refuses any path outside a `.runtime` folder or not named `ai-test.db`. Email goes to an SMTP pickup folder next to the database (`.runtime/mail/*.eml`), never to a real mail server.

### Privacy: consent, withdrawal, Cookiebot (browser)

`tests/e2e/privacy.mjs` runs against the host above with any AI engine (mock gateway or mock Anthropic API). It reads the consent mode from the public config, so the same file covers both modes:

```bash
cd tests/e2e && node privacy.mjs                                            # default: consent in the chat (7 checks)
LigataAI__Privacy__ConsentMode=cookiebot LigataAI__Privacy__CookiebotCategory=marketing bash restart-host.sh
node privacy.mjs                                                            # Cookiebot mode (6 checks), Cookiebot replaced by a stub of its API
```

| Check | What is verified |
| --- | --- |
| Server | Questions and PDFs without a consent, with a malformed or unknown id are refused (`403 consent_required`); a consent to an old text is refused with the current version; the script tag carries `data-cookieconsent="ignore"` |
| Consent request | Names the AI and the recipient (Anthropic, United States / the GPU operator), links the privacy policy, offers the team; no input or suggested questions before agreeing; `LigataAI.ask()` waits in the input; nothing is stored in the browser before use |
| Without consent | Live chat and the email form open without recording a consent |
| Agree and withdraw | German request on a German page; consent recorded (id, version, about a year); the answer arrives; the conversation list shows the consent; withdrawal forgets it in the browser, removes AI conversations and is refused by the server afterwards |
| Stale consent | A consent the server does not know leads back to the request with an explanation, and the question waits in the input |
| Backoffice | Consent counts, the German and English privacy policy text without template markup naming this setup's recipient, the preview asks too, *Ask all visitors again* changes the version |
| Cookiebot | The request names the category and opens Cookiebot's dialog; accepting unlocks the chat without recording anything until the first question (source `cookiebot`); declining withdraws at once; without Cookiebot on a page the chat asks itself |

Results (8 October 2026, version 0.4.0):
- Privacy suite: 7/7 with the mock gateway, 7/7 in API mode, 6/6 in Cookiebot mode, and 7/7 on the installed-package host (`.nupkg`, existing 0.3 database upgraded to the consent table).
- Regression with consent: AI suite 23/23, team suite 16/16 (also on the installed-package host), API suite 13/13, no-AI suite 5/5 (no consent asked without the AI).
- Package checks: 114 domain and 164 total with the database.
- 0.4.1: the GPU server's country defaults to Switzerland (`CH`); package checks 116 domain and 166 total.

### API mode: Claude through Anthropic (browser)

No key and no cost: `tests/e2e/mock-anthropic.mjs` stands in for the Anthropic Messages API and is strict where the real API is. It refuses:
- a wrong key or a missing `anthropic-version` header;
- sampling parameters or a thinking budget, which Claude Haiku 5.5 rejects;
- prefill or empty text blocks;
- malformed image or document blocks.

It simulates prompt caching from the first `cache_control` breakpoint, streams like the real API (`message_start`, `ping`, thinking and text blocks, `message_delta`) and has switchable failure modes: `overloaded` (529), `ratelimit`, `unauthorized`, `slow`.

```bash
node tests/e2e/mock-anthropic.mjs &      # :1230
CONFIG_KEY=0 LigataAI__Mode=api LigataAI__Claude__ApiKey=sk-ant-mock-0000000000000000 LigataAI__Claude__BaseUrl=http://127.0.0.1:1230 bash tests/e2e/restart-host.sh
cd tests/e2e && node api.mjs             # 13 checks, screenshots in .runtime/e2e/api
node support.mjs                         # the team suite also passes in API mode (the mock hands off like the GPU mock)
```

| Check | What is verified |
| --- | --- |
| Config | `engine: "api"`, the Claude privacy notice, Claude's image cost; the key is in no page, config or script |
| Answer | Streamed through the same widget, "AI by Ligata" branding, memory meter from the real prompt size |
| Request shape | `claude-haiku-5-5`, streaming, effort `low`, no temperature, cache breakpoint after guardrails and knowledge, date and page after it, pseudonymous `metadata.user_id`, room for thinking in `max_tokens` |
| Caching | A follow-up question reports cached tokens |
| Handoff | The `[[team]]` marker becomes the team card |
| Attachments | Screenshot as a JPEG image block; PDF read on the site's server (PdfPig) and sent as a text document block |
| Failures | Overload shows "busy" with a working retry; a refusal has no retry; a rejected key turns the widget offline, *Test connection* explains it and recovers |
| Backoffice | Claude card instead of gateway fields, no part of the key anywhere, overview/behaviour/appearance wording, the colour contrast warning, PDF knowledge counted by the token counting endpoint |

Results (7 October 2026, version 0.3.0):
- API suite: 13/13 on the project host, twice in a row, and on the installed-package host (`.nupkg` with the Anthropic SDK and PdfPig, existing 0.2 database).
- Team suite in API mode: 16/16.
- Regression in GPU mode: AI suite 23/23 (twice), team suite 16/16, no-AI suite 5/5.
- Package checks: 91 domain and 134 total with the database. Gateway: 33.

Bug found by these runs and fixed: pressing Enter while a screenshot was still being prepared silently dropped the message (now it is sent as soon as the file is ready).

### Team handoff, live chat and email (browser)

```bash
bash tests/e2e/restart-host.sh          # host on :5310 with --support-fixture (all features on, team address) and --fake-captcha
node gateway/test/mock-server.mjs 1298   # plus the dev gateway on :1220 as above
cd tests/e2e && node support.mjs         # visitor and team member side by side, 16 checks, screenshots in .runtime/e2e/support
bash restart-host.sh --LigataAI:Features:Assistant=false && node support-noai.mjs   # live chat and email without AI
```

`--fake-captcha` adds reCAPTCHA settings shaped like a Ligata.Forms configuration and a verifier that accepts tokens starting with `pass`; the browser suite replaces Google's script with a stub, so no request leaves the machine. `--support-fixture` raises the per-visitor limits because every test browser shares 127.0.0.1 (the limits themselves are covered by the database checks). The mock model answers questions about a "person" or something "unknown" with the handoff marker, split across stream chunks.

| Check | What is verified |
| --- | --- |
| Handoff | An AI answer it cannot give shows the *talk to our team* card; the `[[team]]` marker is never visible, even while streaming |
| Request form | Message prefilled with the question; email required while nobody is online; reCAPTCHA only after consent; validation messages |
| Notification | The team email arrives through Umbraco SMTP with the visitor as reply-to and an Inbox link from trusted configuration |
| Conversations | Waiting team chat and a new AI chat side by side in the list |
| Email form | German interface, confirmation in the thread |
| Inbox | Header badge count, search, AI history above the request, visitor presence |
| Live chat | Join shows the member's name to the visitor; typing indicators both ways; messages both ways without reloading; internal notes stay internal; *anonymous* display shows only the team name |
| Resilience | Reload keeps the conversation and its live connection; a reply while the chat is closed shows a badge and a teaser |
| Leave/close | The visitor sees both and gets *New conversation* |
| Phone | Full-screen panel without horizontal scrolling; team online makes email optional; a failed spam check is shown and can be retried; the visitor ends the chat and the team sees it |
| Email reply | Answering an email request from the Inbox sends `Re: …` to the visitor |
| Settings | Team & email tab with three features, display choice saved, test email sent |

### Against the real GPU

Set `REAL=1` to run the browser suite against the real model (answers vary, so arrival, shape and the screenshot/knowledge content are checked and printed). `tests/e2e/edge.mjs` covers the failure and load cases on the real stack with two sites (A on 5310, B on 5320):

| Case | Checked |
| --- | --- |
| Two websites at once | Visitor B sees "You are next · about N s", both get answers |
| A 32-page, 38k-token PDF | Text extracted in memory, visible reading progress bar, correct answer from page 21, memory meter drops to 26.5k free |
| llama-server killed mid-answer | Visitor sees "Something went wrong… Try again", the launcher restarts the model, retry answers |
| Gateway process stopped | Status offline, offline message with e-mail/contact options, input disabled; after restart the widget reconnects by itself and answers |

```powershell
$env:REAL=1; $env:GATEWAY='http://127.0.0.1:1210'; $env:KEY_FILE='../../.runtime/key-a.txt'; node tests/e2e/run.mjs
node tests/e2e/edge.mjs
node tests/e2e/gallery.mjs     # screenshots of themes, dark mode, mobile and the teaser for visual review
```

Team features (7 October 2026): `support.mjs` 16/16 on the project-reference host in three consecutive runs, 16/16 with the **real Gemma 4 12B** behind the production gateway, and 16/16 on a host that installs the packed `.nupkg` (upgrading a 0.1 database); `support-noai.mjs` 5/5 with `Features:Assistant=false`; the AI suite `run.mjs` still 23/23. `model/handoff-check.mjs` against the real model with the package's own system prompt: **33/33** (offers the team for unknown business questions and requests for a person, answers known questions without it, declines off-topic requests, never mentions or leaks the marker).

Bugs found by the team-feature runs and fixed: a sequence race could show a team message twice (the server now reports the highest sequence it sent, the widget ignores known ones); throttled status checks made the AI look offline (now the last known state is kept, and the per-IP read limit is configurable); email requests counted as open chats; the inbox could merge a message twice; the request repeated the visitor's question; the closed bar wrapped; untouched AI default texts appeared without AI.

Real-model results (7 October 2026): 23/23 browser checks on both the project-reference host and the installed-package host, 4/4 edge cases, and the 60-question soak (4 concurrent visitors, 2 sites, knowledge prompts, screenshots, PDFs): 60 answered, 0 failed, RAM 1.52–1.80 GB without upward trend, VRAM constant at 10,784 MB, no spill.

Bugs found by these runs and fixed: the availability check re-rendered the conversation while an answer was streaming (the progress indicator vanished); the progress bar was an inline element with a width (invisible); prompt progress double-counted cached tokens; an outage replaced the error notice and with it the *Try again* button.

### Installed-package check

A project reference does not prove that NuGet assets work (the Forms package learned this the hard way). Pack a unique pre-release version, publish a copy of the test host that references the `.nupkg`, run it from the publish folder and point the browser suite at it:

```powershell
$v = "0.1.0-dev.$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
dotnet pack src/Ligata.AI -c Release -o artifacts -p:Version=$v
# copy tests/Ligata.AI.Tests (without wwwroot) to .runtime/package-src, add a NuGet.Config pointing at artifacts/
dotnet publish .runtime/package-src/Ligata.AI.Tests.csproj -c Release -p:UsePackage=true -p:LigataAIVersion=$v -o .runtime/package-host
cd .runtime/package-host; dotnet Ligata.AI.Tests.dll --database C:/Code/Ligata.AI/.runtime/package/ai-test.db --serve --urls http://127.0.0.1:5320
$env:HOST='http://127.0.0.1:5320'; $env:CREDENTIALS='C:/Code/Ligata.AI/.runtime/package/ai-test-admin.json'; node tests/e2e/run.mjs
```

### Model, memory and load

```powershell
node model/sweep.mjs --profiles q4xl-256k-mtp-q4kv --depths 1000,32000,120000,250000   # needle, linked facts, speed, memory
node model/perplexity.mjs --chunks 40                                                 # quality per quantization / KV type
node model/cache-test.mjs --url http://127.0.0.1:1211                                 # prefix reuse between visitors and sites
node model/soak.mjs --gateway http://127.0.0.1:1210 --keys <keyA>,<keyB> --requests 60 --concurrency 4 --image .runtime/screenshot-test.png
```

Results are appended to `model/results.jsonl`, `model/perplexity.jsonl` and `model/soak.jsonl` and summarised in [model/README.md](../model/README.md).

## What the suites cover

**Gateway**: hashed keys and constant-time checks, revocation without restart, strict one-at-a-time FIFO across sites, queue positions and estimates, one question per visitor, per-site and global caps with `Retry-After`, queue timeouts, model offline/starting answers without queueing, streams breaking mid-answer (error event, queue continues), visitors leaving while queued or while answering (GPU work cancelled), answer time limit, context pre-check, message/role validation, image signature/size/count checks, llama-server message format, PDF text extraction (valid, not a PDF, no text), token counting, body size limits, daily quotas.

**Package**: consent versions (engine, revision, recipient), consent checks (unknown, withdrawn, expired, outdated), consent records (use, withdrawal without a stale cache, purge of unused and old records, no IP or content), the privacy policy templates (blocks, values, every setup), the Cookiebot exemption on the script tag, settings validation (colours, URLs, e-mail, budgets, display rules), the cacheable prompt order, guardrails, sanitised page context, HTML/Word/text extraction (scripts stripped, DTD/XXE refused), conversation validation (roles, injected system messages, lengths, attachment types/counts, switched-off uploads), encrypted key round trip and tamper rejection, pseudonymous visitor ids, one question per visitor, origin allowlist, untrusted Cloudflare header; database versioning conflicts, knowledge previews and cache invalidation, counters, section grant.

**Browser**: login, section, connection (bad key format explained, key stored and only hinted), behaviour save and validation, website-page import, file upload with token counts, written knowledge and switching sources off, themes and the live preview using unsaved settings, a real preview chat, going live, automatic injection without secrets in the HTML, status dot, suggested question with streamed and safely rendered Markdown, the memory meter, conversation surviving page changes, screenshot attachment, unsupported files, same-visitor double submit refused, full-screen mobile layout without overflow, a static page on another origin through CORS (German interface), disallowed origins refused, offline state with contact options (with `STOP_GATEWAY_CMD`), and no script errors.

## Notes from qualification

- The Claude desktop app's embedded browser (Chromium 152) does not mount Umbraco 17.6.2 backoffice dashboards at all (also Umbraco's own); Microsoft Edge 154 renders everything. The browser suite therefore drives Edge through `playwright-core` (no browser download).
- `fetch()` in Node gives up after 300 s without response headers; a 250k-token prompt takes about 10 minutes to process on the RTX 3060, so all streaming calls to llama-server use `node:http` without timeouts.
- Reusing a keep-alive socket that llama-server already closed raised `ECONNRESET` after a successful answer; streaming requests use one connection each.
- GPU-shared RAM is not a reliable spill signal on its own: llama.cpp pins 0.2–0.8 GB of host memory depending on the profile (MTP drafter, batch size). The monitor compares against the level right after load.
