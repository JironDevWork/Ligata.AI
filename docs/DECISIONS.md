# Decisions and why

The reasoning behind Ligata.AI, so it survives the conversations it was worked out in. Each entry names the decision, why it was taken, and what was tried or rejected on the way. Details and measurements live in the linked documents; this file is the map.

Versions: 0.1 (7 Oct 2026) to 0.7.1 (9 Oct 2026). Newest topics last within each section.

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
- **Summaries go through the same line.** A summary of a long conversation is a request like any other: it waits for a place (and shows its place in line, 0.7.1), counts towards the three and the visitor's one request, and keeps the conversation's slot so only the summary costs time. The question after it queues again at the end of the line; letting it jump ahead was considered and left out, because it would make the line unfair under load. Tested in `tests/e2e/concurrency.mjs`.
- **llama-server needs HTTP workers for more than the answers (0.7.1).** Each streaming answer holds one worker for its whole duration; with 4 workers and three answers, health checks and token counts queued and the model looked offline at peak load. The launcher now starts it with slots + 6.
- **Slot bookkeeping survives llama-server coming back.** A reset forgets what the caches held, never which slots are answering (a running answer once got a second answer sent to its slot).
- **A visitor who leaves is noticed from the first moment**, also while the prompt is still counted; otherwise an answer ran for nobody and the visitor was told to wait for it.
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
- **Big websites are read from the top (0.7.1).** At most 2,000 web pages (each language counts once per page) and 20,000 nodes are read. Pages closest to the top win, level by level, so a deep archive never crowds out the contact page or a second language; folders and data nodes do not count; a cut is logged and shown under Knowledge.
- **Repeating earlier lookups has a ceiling (0.7.1).** A request repeats at most 60 earlier lookups (later ones get a fixed note, the same every time, so the prompt and the cache stay the same), results are remembered per snapshot, and word forms come from the sorted vocabulary. A crafted request once cost tens of seconds of CPU; now at most about 0.2 s on 6,000 documents.
- **A question in other words than the website is looked up (0.7.1).** The rule "look up when the question's words are on the website" missed questions in another language: asked in German on the English test site, the model said opening hours "differ by location" instead of looking. A question with a new word of four letters or more now needs a lookup too; greetings, thanks and small talk stay free (measured 6/6 and 8/8 on the GPU).
- **Looked-up text is information, not instructions.** Pages can contain text the owner did not write (imports, reviews, third-party PDFs); the guardrails say so.
- **Unsaved settings never replace what visitors use.** The budget meter and the test chat build their own snapshot.

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
- **The consent version names the recipient.** A new recipient (engine, GPU operator or its country) or *Ask all visitors again* asks everyone again. The conversation history has its own version (period and revision), so changing it never asks for the AI consent again.
- **Nothing in the browser before use; no cookies.** Local storage is written only once a visitor uses the chat. Cookiebot: the script is exempt from automatic blocking because the chat asks itself; optionally a Cookiebot category gives the AI consent.
- **Privacy policy text generated for the site's setup** (German and English, from templates in `docs/privacy`, embedded in the package). Why: operators otherwise copy a generic text that describes the wrong engine or forgets the team chat.
- **Optional conversation history (0.7).** A separate, optional consent; see the next section.

## The conversation history (0.7, revised in 0.7.1)

The request: see what visitors ask the AI, not only the chats handed to the team, with automatic deletion and the option to keep single conversations, and only if it is compliant (Switzerland and the EU).

- **Off by default.** Privacy by default (Art. 25(2) GDPR, Art. 7 DSG): storing conversations is not needed to answer them, so a site switches it on deliberately in *Privacy → Conversation history*.
- **A separate, optional consent (0.7.1).** 0.7.0 folded the history into the one AI consent. The privacy review found that EU visitors then could not use the assistant without agreeing to their conversations being kept, which makes that consent not freely given (Art. 7(4), Recital 43, EDPB 05/2020 on granularity). Now the consent request has an unticked box ("Keep my conversations (optional) … The assistant works without it"), and *Conversations* has *Keep them* / *Stop keeping*. The AI consent does not depend on it; the consent record proves the second choice (period and revision, times). Cookiebot never implies it: in Cookiebot mode visitors opt in under *Conversations*. A site that asks no consent at all keeps conversations unless the visitor objects (*Stop keeping*), with the legal basis left to the operator's privacy policy. Legitimate interest with an objection was considered for all sites; consent was kept because it is the safer basis for EU visitors and the package already asks for consent.
- **A changed period needs a new agreement; what is kept keeps its period.** Each conversation stores the end of the period it was collected under: a longer period set later never stretches it, a shorter one applies at once. When the history is switched off, what is kept stays until its period ends, and the privacy text says so ("historyending") instead of "not stored".
- **Data minimisation.** Kept: questions, answers, what the AI looked up, the names of attached files, the page, the interface language, times and how each question ended. Not kept: files or their text, IP addresses, the pseudonymous visitor id. Why: enough to understand and improve answers, nothing that identifies the visitor by itself.
- **Deletion the visitor controls.** Each conversation has a random key in the browser; the server stores only its hash. *Delete conversation*, *Stop keeping* and withdrawing consent delete the server copies (retried on the next page if the server was unreachable). The browser keeps the key of every kept conversation until the server can no longer hold it, also when the conversation has left the chat's list (after the inactivity period or beyond 12 conversations). A conversation deleted while its answer was still running is not stored again (the server remembers deleted keys and withdrawn consents, and checks the consent again when the answer ends). Why: the visitor can exercise erasure without contacting anyone, and the key proves the request comes from the visitor's browser without identifying them.
- **Retention 1 to 365 days (default 30), counted from the last question; *Keep* for a reason and at most a year.** An unlimited period would breach storage limitation. *Keep* (for a complaint or a legal claim) needs a stated reason, records who kept it and ends after 90 days unless kept again; the visitor's own deletion still removes it. The privacy text names legitimate interest as the basis for that exception.
- **Access requests.** Conversations are kept without name or IP address. One started a team request is found through that request (the search also matches the team request's name and email); others only by what the visitor wrote and when (Art. 11 GDPR). A "conversation code" the visitor could quote was considered and left as an open point.
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

## The review of 0.7.1

After the history was built, four reviewers each took one part: the gateway (queue and concurrency), the website's server code (changes during a question, big sites, parallel questions, the history), the chat widget, and privacy law (Swiss DSG, GDPR, TDDDG, AI Act) with security. Each reviewer's findings went to a second agent whose only job was to disprove them. Of 43 findings none was rejected (some were rated lower). All were fixed except the open points below, each in its own commit with tests. Real use was tested on the GPU and on a local copy of the demo after the reviews (see [TESTING.md](TESTING.md)). Only measured changes were kept: a stricter "say only what the results state" instruction was tried for invented opening-hour details, did not change the answers, and turned out to be unnecessary (the detail was in a knowledge item of the test site); it was reverted.

## Open points

- **The language of replayed lookups.** Earlier lookups are repeated with the language of the page the visitor is on now. A visitor who switches the site's language in the middle of a conversation gets the earlier results ranked for the new language (the model sees slightly different results than when it answered, and the GPU cache is lost once). Storing the language with each answer's lookups would fix it; it is rare and harmless, so it waits.
- **The question after a summary queues at the end of the line** (see the gateway section): under heavy load a visitor waits twice. A fair alternative would need a short reservation of the place; not built.
- **A conversation code for access requests.** Visitors could quote a code from the chat so the operator finds their conversation without searching by content (Art. 11(2) GDPR). The privacy text describes the current way honestly instead.
- **The operator's part of the privacy text**: controller details, an EU representative where required (Art. 27 GDPR), which Anthropic entity the contract is with (API mode), and a Data Privacy Framework sentence only if Anthropic is certified. The generated text marks these in [square brackets].
- **The production gateway and llama-server** run the 0.7.1 gateway code only after they are restarted (`pm2 restart ligata-ai-llm`, then `pm2 restart ligata-ai`); the website package works with the old gateway in the meantime.
- **SixLabors.ImageSharp 3.1.12**, which Umbraco 17.6.2 brings along, has known advisories (NuGet warns NU1902/NU1903). It belongs to the host site, not to this package; update when Umbraco ships a fixed version.

## Operating rules learned on the way

- Never restart or kill the production processes (gateway on 1210, llama-server on 1211); the owner restarts them with PM2. Test gateways run on 1220 and 1225.
- Secrets never go into the repository: gateway keys live in `.runtime/keys` and `gateway/data` (ignored), site secrets in environment variables or ignored local settings.
- Each milestone is committed and pushed to `main`.
