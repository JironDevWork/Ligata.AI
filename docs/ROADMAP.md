# Roadmap

What comes next. Each item is planned with the owner before work starts.

## 1. Backoffice content assistant (built in 0.9)

**The request.** A chat agent inside Umbraco, like the assistant on the website but for editors. A bubble at the bottom right of the backoffice. You ask "where is the page with our opening hours?" or "change the phone number on the contact page", and it finds the page, opens it, shows what it is doing and makes the change. It is a tool-using agent, not a text generator, and it only does content management.

**Built in 0.9** as decided below, with permission modes like Claude Code's (Manual, Auto, Bypass, and Read only since 0.10), an activity log and its own settings and limits. See [CONTENT-ASSISTANT.md](CONTENT-ASSISTANT.md) and the decisions in [DECISIONS.md](DECISIONS.md#the-content-assistant-in-the-backoffice-09).

### Does it exist already? (research, 9 October 2026)

| Candidate | What it does | Fits the request? |
| --- | --- | --- |
| **Umbraco.AI + Contextual Copilot** (Umbraco HQ, MIT, free, Umbraco 17, stable since May 2026) | A chat sidebar with tools. It edits the item that is open (also inside blocks, path-addressed) and asks before saving or publishing. Supports Anthropic. | **Partly.** It works only on the item already open: it cannot find a page and take you there. The button shows only inside an editor, not on the Content dashboard or tree. History is kept per node, so "find it, open it, change it" is no single conversation. It needs no extra hosting, but our Gemma gateway would need a custom provider (its OpenAI provider uses the Responses API and only lists `gpt-` models). It also brings a second AI stack (own section, tables and settings) next to Ligata.AI. Culture variance inside blocks was fixed only in 17.1.1 (5 October); the panel hides behind the block editor overlay ([umbraco/Umbraco.AI#188](https://github.com/umbraco/Umbraco.AI/issues/188)). |
| Umbraco.AI Copilot Workspace | A separate "Copilot" section with saved chats; edits across the site with backend tools and approval | No navigation through the Content section. Administrators only by default. First stable release 1 October 2026. |
| Umbraco MCP servers (developer and editor) | Umbraco tools for external clients (Claude Desktop, ChatGPT, Cursor) | Not in the backoffice. The editor server is in beta; the hosted one is Umbraco Cloud only. |
| Third-party packages (Flowcourier agents, AgentRun, SteadyGo, ThtaAi) | Add-ons to Umbraco.AI, workflows, grounded search, field helpers | None is a general chat agent for editors in the backoffice. |

**Verdict: build our own inside Ligata.AI**, as a second assistant next to the website assistant. It would share:
- both engines (GPU and Claude) with their keys, the effort setting and the tool loop;
- the knowledge index and the backoffice look and feel.

Umbraco.AI is MIT-licensed: its path-addressed block editing and its approval flow are worth learning from (not copying wholesale). Before building, it is worth an hour to install its Copilot with the Anthropic key in a scratch copy of Umbraco.BaselineV2, as a benchmark for how the experience should feel.

### Still open

- **On the GPU.** The module is engine-agnostic: only `EditorModel` speaks Claude's API. About 20 fixed editor tasks will be run on Gemma 4 and on Claude Haiku 5.5 to decide whether the GPU is good enough for edits. The tasks cover finding pages, pointing at fields, editing in blocks and per language, and creating drafts. With the GPU, unpublished drafts would stay in Switzerland.
- **One approval for many pages.** "Update the phone number everywhere" works today page by page, each with its own card. *Approve all* helps when several wait at once. One card listing every page would be clearer.
- **More of Umbraco:**
  - adding blocks into Block Grid areas (reading, changing, moving and removing them already works);
  - blocks inside rich text;
  - colour pickers, sliders and the newer date pickers.
- **Reloading the open page** without the console error Umbraco's Block Grid logs during a workspace reload.
- **Other groups than administrators** once it has proven itself. This is a settings change, no code.

### The plan before building (9 October 2026)

- **Where.** One floating bubble, mounted once for the whole backoffice (a `backofficeEntryPoint`), shown in the Content section. Its conversation survives moving between pages, because the element stays mounted and the conversation is kept per user for the session. It always knows where the editor is: the open document, its language and its path.
- **What it can do (tools, all run on the server with the editor's own permissions).**
  - *Find*: search pages and drafts (the existing BM25 index plus drafts), walk the tree (children, ancestors), read a page with all its properties and blocks per language, and read a document type's fields.
  - *Navigate*: open a page in the editor (the backoffice route for the document), or point at a property ("the phone number is in *Footer → Contact block*").
  - *Change*: propose edits to text, rich text and simple properties, including inside Block List and Block Grid by path. Each edit appears as a card with before and after. The editor clicks **Apply**, and the change is saved as a draft under the editor's name (Umbraco's audit log records it).
  - *Publish*: off by default (changes are saved as drafts). A setting in the backoffice lets it publish by itself.
  - Never: delete, move or unpublish content, change document types, settings, users or media. It always works through the editor's own permissions.
- **Shows its work.** Every step is a line in the chat ("Searched for *phone*", "Opened *Contact*", "Read *Footer*"), as the website widget shows *Searching the website…*.
- **Safety.**
  - Every write needs a click.
  - Page text is data, never instructions: the same guardrail as on the website.
  - The feature can be limited to some user groups.
  - A daily cap per user.
  - What was sent to the AI is never kept beyond the session.
- **Engines.**
  - Claude Haiku 5.5 for now: multi-step editing with many tools is where a stronger model matters. The GPU comes later, once the fixed task set shows it is good enough. It would keep unpublished drafts in Switzerland.
  - The effort setting is its own (default Medium for editing, Low for questions).
- **Privacy.** Editors' prompts and draft content go to the chosen engine. Unlike visitors, editors need no consent popup, but the privacy notes for staff and the record of processing need a line. Anthropic's addendum or the GPU operator's agreement covers it.
- **Licensing.** A new feature flag, `LigataAI:Features:ContentAssistant`, works like the others: the configuration licenses it, editors switch it off.

### Phases (each one shippable)

1. **Ask and find (read only).** Covers "Where is …?", "Which pages mention …?" and "What does the contact page say?". It opens pages and points at properties. No writes, so no risk: a good first test of usefulness.
2. **Propose and apply.** Text and rich text edits, also in blocks and per language, with before/after cards and *Apply*, saved as drafts. Then *Publish* on confirmation, when allowed.
3. **Bigger jobs.** "Update the phone number everywhere": one approval card listing every page. Translations between the site's languages, choosing existing media, SEO fields.

### Decisions (owner, 9 October 2026)

1. **Inside Ligata.AI**, as a separate module next to the website assistant. It reuses the engines, keys and tool loop.
2. **Drafts only by default.** A setting in the backoffice lets it publish by itself.
3. **Administrators first.** Other groups follow once it has proven itself.
4. **Claude Haiku 5.5 (API) for now.** The module is built engine-agnostic, as the website assistant is. About 20 fixed editor tasks (finding pages, pointing at properties, proposing edits in blocks and per language) are kept as a test set. They are run on the GPU later, to decide whether it is good enough for edits.
5. **(10 October 2026)** Permission modes like Claude Code's, which editors choose per conversation: Manual, Auto and Bypass. There are settings for who may use which mode, what may be done and where, plus a separate usage limit and an activity log.

## 2. The website assistant takes visitors to the right place (future)

Today the assistant answers and links pages. Next, it should offer to go there: "Shall I take you to the contact page, where the phone number is?" On *Yes*, the page opens and scrolls to the right spot.

- **Always asks first.** The model proposes, the widget shows the proposal with *Yes* / *No*, and only a click navigates. A new tool, `show_page(url, section)`, returns a proposal, never a navigation.
- **Only this website.** Targets must be pages in the knowledge index (same site, published, not left out), never a URL from a page's text.
- **Lands on the spot.** The chat stays open across the page change (it already keeps its state). After loading, it scrolls to the section and highlights it briefly. The section is found by the heading the index stored with the passage, or by its text (a text fragment `#:~:text=` as a fallback). It respects *reduced motion*.
- **Both engines.** It is the same tool syntax as the lookups (`search_website`, `read_pages`), so it works on the GPU and with Claude.
- **Later: guided tours.** For example "Show me how to book a call": a few steps, each confirmed by the visitor.
