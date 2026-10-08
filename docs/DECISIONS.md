# Decisions and why

The reasoning behind Ligata.AI, so it survives the conversations it was worked out in. Each entry names the decision, why it was taken, and what was tried or rejected on the way. Details and measurements live in the linked documents; this file is the map.

Versions: 0.1 (7 Oct 2026) to 0.7 (9 Oct 2026). Newest topics last within each section.

## Shape of the product

- **One package per website, one shared GPU.** Every Umbraco site installs the NuGet package and keeps its settings, knowledge, API key and conversations in its own database. One gateway on the Ligata mini PC answers for all sites. Why: sites stay independent (a broken site cannot break another), and an RTX 3060 is enough for many small sites when answers queue fairly. See [PLAN.md](PLAN.md).
- **Browsers only talk to their own website.** The site calls the gateway (or Anthropic) server to server. Why: no keys in browsers, no CORS on the gateway, and the site can enforce consent, limits and its own privacy rules before anything leaves it.
- **Feature flags in configuration, switches in the backoffice.** `LigataAI:Features` says what a site is licensed for (AI, live chat, email). Editors can switch licensed features off, never on. Why: the legal setup and licensing must not depend on an editor's click.
- **Two engines, one event stream.** `LigataAI:Mode` = `gpu` (own gateway) or `api` (Claude through Anthropic). Both produce the same server-sent events, so the widget, the history and the statistics do not care which one answered. Why: some customers want no data leaving Switzerland, others want the stronger model without hosting.
- **Everything works without the AI** (live chat and email only, the section is then called *Support*). Why: a site may not license the AI, and an AI outage must never cut visitors off from the team.

## The model and the GPU

- **Gemma 4 12B QAT (Unsloth UD-Q4_K_XL) on llama.cpp, entirely in VRAM.** Weights, the token-embedding table and the KV cache are forced into the 12 GB VRAM; `--cache-ram 0`; no host prompt cache. Why: measured quality close to bf16 at 4 bit, and RAM must stay flat on a mini PC (a silent spill into shared memory made everything slow). See [model/README.md](../model/README.md).
- **Three conversations at once, each with its own slot of about 109k tokens (0.5.1).** A 320k q4 KV cache split into 3 slots. Why: one shared 256k pool let three long chats overflow it and evict each other's cache; split slots give each conversation fixed room, and three at once still write 37 to 38 tokens per second each (54 alone).
- **Thinking gets its own room (0.4.4).** With "Think before answering", 4,096 tokens of thinking come on top of the answer limit. Why: thinking shared the answer's 1,024 tokens, and a question without knowledge made the model think until nothing was left for the answer.

## The gateway

- **One global FIFO queue for every site, three places, one request per visitor.** Visitors see their place in line and a wait estimate. The next in line takes the place that frees first (0.5.2). Why: fairness across sites, and "every IP one request at a time" without sending IP addresses (visitors arrive as an HMAC of their IP with the site's secret).
- **Summaries go through the same line.** A summary of a long conversation is a request like any other: it waits for a place, counts towards the three and the visitor's one request, and keeps the conversation's slot so only the summary costs time. Tested in `tests/e2e/concurrency.mjs`.
- **Each answer gets the slot that holds its conversation, else one warm with its site.** Why: the system prompt (guardrails, page list) is the same for all visitors of a site, so a warm slot only reads the new part.
- **Keys are stored as hashes; the key file is written crash-safe (0.4.3).** A forced logout once left an empty keys.json and every site was refused; the file is now flushed before it replaces the old one and a backup is kept.
- **The public hostname is not indexed** (robots.txt disallows everything, `X-Robots-Tag: noindex`).

## Knowledge: how the assistant knows the website (0.6)

- **The model looks things up instead of reading everything.** Until 0.5 every enabled page went into the prompt, which filled the conversation's memory on big sites and had to be imported by hand. Now the prompt holds the instructions, a list of the pages and the few items marked *always known*, and the model calls `search_website` and `read_pages` while it answers. Why: the prompt no longer grows with the website, pages are always current, and new pages are included without an editor.
- **Keyword search (BM25 over passages), not vectors.** Words match without accents, by prefix and inside compound words (German), passages overlap by a short line so a name and its role stay together. Why: website content is small and literal; an embedding model would cost VRAM the chat needs.
- **Every published page is used, in every language; editors leave pages or sections out.** Each language version is its own page; search returns one version per page, preferring the visitor's language. Nodes without a template (settings, redirects) are never read (0.6.2: Umbraco reports a missing template as null, not 0).
- **Lookups are deterministic and replayed.** The browser keeps only the calls an answer made; the server looks them up again for every later question. Why: the browser cannot change what the model "found", and nothing but the calls needs to be stored on the visitor's device.
- **Lookups are the model's choice, but facts are not (0.6.1).** Greetings, thanks and follow-ups the conversation already answers need no lookup; a lookup is forced only when a question asks for website facts the conversation does not contain. Every fact about the website must come from a lookup, the knowledge or the conversation, otherwise the assistant says it does not know. Why: forcing a lookup for "Hallo" wasted time; letting the model skip lookups freely made it guess.
- **The last round forbids every tool token.** After the last allowed round the model must answer; the gateway bans the special tokens of the tool syntax (`logit_bias`). Why: `tool_choice: none` alone did not stop Gemma from writing a call as text, and banning only the opening token made it start with the closing one.
- **The page list is built once per index version and keeps every language (0.7).** Measured on 2,000 pages in three languages: building the list took 674 ms on every question and kept only the first language when trimmed. It now takes about 30 ms once and lists the first pages of each language in turn.

## Long conversations

- **The widget summarizes before a conversation would no longer fit (0.5).** It reserves room for the longest answer (plus thinking and lookups) and asks for a summary of the earlier messages in time, then continues with the summary and the last exchange. The visitor still sees every message. Why: the alternative, an error when the memory is full, loses the conversation.
- **"Reading…" instead of numbers, memory in percent.** Visitors do not need token counts.

## Team handoff, live chat and email (0.2)

- **The AI offers the team with a marker (`[[team]]`) the widget turns into buttons.** When there is no live chat or email form, the site's contact email or page are offered instead (0.6). Measured: 33 of 33 handoffs correct with a one-line reminder after the knowledge.
- **The visitor's AI conversation travels with the request**, so the team sees what was asked before.
- **Team conversations are reached only with a random 256-bit token** kept in the visitor's browser and stored as a hash; ids alone grant nothing.
- **Team members choose how visitors see them** (name and photo, name, nickname, anonymous), within what the site allows.

## Privacy (GDPR and the Swiss DSG)

- **Consent before the AI reads anything (0.4).** The chat asks first, names the recipient (Anthropic in the USA, or the GPU operator and its country), links the privacy policy and offers the team without AI. The server records each consent (random id, text version, times; no IP, no content) and refuses questions and files without a valid one. Why: the AI is a separate recipient (in API mode in the USA), and a server-side check cannot be bypassed by an old widget or a script.
- **The consent version names the recipient.** A new recipient, switching the conversation history on or changing its period, or *Ask all visitors again* asks everyone again. Without a history the version is the same as before histories existed, so updating the package asks nobody again.
- **Nothing in the browser before use; no cookies.** Local storage is written only once a visitor uses the chat. Cookiebot: the script is exempt from automatic blocking because the chat asks itself; optionally a Cookiebot category gives the AI consent.
- **Privacy policy text generated for the site's setup** (German and English, from templates in `docs/privacy`, embedded in the package). Why: operators otherwise copy a generic text that describes the wrong engine or forgets the team chat.
- **Optional conversation history (0.7).** See the next section.

## The conversation history (0.7)

The request: see what visitors ask the AI, not only the chats handed to the team, with automatic deletion and the option to keep single conversations, and only if it is compliant.

- **Off by default.** Privacy by default (Art. 25(2) GDPR, Art. 7 DSG): storing conversations is not needed to answer them, so a site switches it on deliberately in *Privacy → Conversation history*.
- **Visitors are told before they agree, and agree again.** The consent request and the notice under the input say how long conversations are kept; the consent version changes, so nobody's earlier consent is stretched to cover storage it did not mention. The privacy policy text gains a section with purpose, contents, period, access and deletion.
- **Data minimisation.** Kept: questions, answers, what the AI looked up, the names of attached files, the page, the interface language, times and how each question ended. Not kept: files or their text, IP addresses, the pseudonymous visitor id. Why: enough to understand and improve answers, nothing that identifies the visitor by itself.
- **Deletion the visitor controls.** Each conversation has a random key in the browser; the server stores only its hash. *Delete conversation* in the chat deletes the server copy (retried on the next page if the server was unreachable), and withdrawing consent deletes every conversation asked with it. Why: the visitor can exercise erasure without contacting anyone, and the key proves the request comes from the visitor's browser without identifying them.
- **Retention 1 to 365 days (default 30), counted from the last question; *Keep* exempts single conversations.** An unlimited period would breach storage limitation; keeping single conversations covers complaints and similar reasons, and the visitor's own deletion still removes them.
- **A separate page, same access as the Inbox.** *AI conversations* sits next to the Inbox: unanswered questions (errors, or answers that offered the team because the AI did not know) are the useful signal for missing website content. Deleting everything is reserved to editors.
- **Recorded after the answer, from the same events the visitor saw.** Both engines report the answer, lookups and how it ended into one object; the history never changes what the visitor receives, and a failure to store is logged, not shown.

## Widget and backoffice

- **Vanilla JS in a Shadow DOM, no framework**, so it works on any site, including static exports, without CSS clashes. Bottom right by default (consent banners sit bottom left).
- **Live preview with unsaved settings** in the backoffice answers real questions.
- **Icons from Tabler, one stroke width; every theme passes WCAG AA** for message text.

## Testing

- **Disposable fixtures only.** A fixture Umbraco database under `.runtime`, a generated administrator, synthetic pages and questions, an SMTP pickup folder. Nothing touches a production site. See [TESTING.md](TESTING.md).
- **Mocks that are strict**: the mock Anthropic API checks tool_use/tool_result pairing; the mock llama-server can run three slots, stream slowly and fail on purpose.
- **Real-GPU checks for model behaviour** (`model/*.mjs`): handoff, lookups, summaries, parallel speed, memory soak. Logic is tested with mocks; behaviour of the model only on the real GPU.

## Operating rules learned on the way

- Never restart or kill the production processes (gateway on 1210, llama-server on 1211); the owner restarts them with PM2. Test gateways run on 1220 and 1225.
- Secrets never go into the repository: gateway keys live in `.runtime/keys` and `gateway/data` (ignored), site secrets in environment variables or ignored local settings.
- Each milestone is committed and pushed to `main`.
