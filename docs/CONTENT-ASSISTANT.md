# Content assistant (backoffice)

Since 0.9, Ligata.AI has a second assistant, for editors rather than visitors. A chat bubble at the bottom right of the Umbraco backoffice finds, reads and changes content with tools.

The editor says what they want, for example:
- "Where is our phone number?"
- "Add Saturday opening to the contact page"
- "Translate this article into English"

The assistant then:
- searches the site and opens the right page;
- shows each change as a card with the value before and after;
- saves the changes as drafts and checks them after saving;
- logs who asked for what.

It is a separate part of the package (`src/Ligata.AI/Editor`, `App_Plugins/LigataAI/editor`), with its own settings, tables and limits. It shares two things with the website assistant: the Anthropic key under *Connection* and the Claude client.

## Contents

- [Setting it up](#setting-it-up)
- [Permission modes](#permission-modes)
- [Settings](#settings)
- [Tools](#tools)
- [How a change is made](#how-a-change-is-made)
- [The chat](#the-chat)
- [Activity log](#activity-log)
- [Long conversations, effort and cost](#long-conversations-effort-and-cost)
- [Security](#security)
- [Privacy](#privacy)
- [Limits of this version](#limits-of-this-version)
- [Tests](#tests)

## Setting it up

1. **Anthropic API key.** Add it under *AI Assistant → Settings → Connection* (stored encrypted), or as `LigataAI__Claude__ApiKey`. The content assistant always uses Claude (`LigataAI:Claude:Model`, default Claude Haiku 5.5), whichever engine answers visitors.
2. **Licence.** `LigataAI:Features:ContentAssistant` is `true` by default. Set it to `false` and neither the bubble nor its settings page loads.
3. **Who.** Out of the box, **administrators only** (all three modes), **Manual** mode, and **drafts only**: no publishing, moving or deleting. Change this under *AI Assistant → Content assistant → Settings*.

Without a key, only administrators see the bubble. It explains that the key is missing and links to *Connection*.

## Permission modes

The modes copy Claude Code's permission modes. Each person chooses in the chat (the pill under the input) among the modes their user groups allow.

| Mode | What happens to a change |
| --- | --- |
| **Manual** | Every change waits for *Approve* or *Decline*. Declining can carry a note ("shorter, calmer"), which the assistant reads. |
| **Auto** | Safe changes run at once; risky ones ask. A change is safe when two things hold. First, its kind is ticked under *Auto approves* (by default content edits, new pages and image uploads, all saved as drafts). Second, it carries no risk: it does not clear a field, remove most of a text or remove a block, and it changes nothing that all languages share. Everything else asks first, for example publishing, deleting, or removing a card that every language shows. The card says why. After *Ask again after N changes* (default 10) for one message, the next change asks again: a safety net against long runs. |
| **Bypass** | Every allowed change runs without asking. Reserve it for groups you trust. |

A mode never widens what is allowed: *What it may do* and the person's own Umbraco permissions still apply.

When several changes come from one step, they run in order. Once one waits, the later ones wait behind it and run after the decision. If the editor writes a new message instead of deciding, the waiting changes are declined, and the assistant is told so.

## Settings

All of these are under *AI Assistant → Content assistant → Settings*, on one page.

- **On/off** for the whole site.
- **Who can use it.** A table of user groups with the modes each may choose, plus the mode a new conversation starts in.
- **What it may do.** Each kind of change can be allowed or not, and for Auto mode marked as approved automatically:
  - change content (fields and blocks, as drafts);
  - create pages (drafts);
  - publish;
  - unpublish;
  - move and sort;
  - delete (recycle bin only);
  - upload images attached in the chat.

  Kinds that are not allowed are not even offered to the model. Its instructions say what it cannot do, and why the editor must do it themselves.
- **Where it may work:**
  - *Parts of the site*: start points; it reads and changes only these pages and those below them;
  - *Read-only page and block types*: for example website settings or a form block;
  - *Protected fields*: property aliases it never changes, on any page or block;
  - *Languages it may change*: it reads every language but writes only these.

  All of this applies within each person's own Umbraco start nodes, permissions and languages.
- **How it works:**
  - the default thinking effort (Off, Low, Medium, High, Extra high; Medium by default). `LigataAI:ContentAssistant:Effort` in the site's configuration wins over it, and the page then shows it locked;
  - whether editors may choose Low, Medium or High in the chat;
  - *Editorial guidelines*, followed whenever it writes ("Swiss spelling: ss instead of ß", "address readers as Sie").
- **Limits and records:**
  - messages per person per day (100) and for the whole site (500), separate from the website assistant's limits;
  - tool steps per message (24) before it must answer;
  - how long conversations (30 days) and the activity log (365 days) are kept.

## Tools

Everything runs on the site's server with the signed-in user's permissions. Reading tools run at once. Changes go through planning and approval (see [How a change is made](#how-a-change-is-made)).

| Tool | What it does |
| --- | --- |
| `search_content` | Searches the **draft** text of every page in every language. This includes field labels and the fields inside blocks, so "Telefon" finds the block field labelled *Telefon*. Results show the key, type, location, status and a snippet. The text is kept in memory and read again only for pages that changed. |
| `list_children` | The pages below a page, or the top of the tree, with their status. |
| `read_content` | A page in one language: name, status, URL, other languages, and every field with its **path**, kind and draft value. Fields inside blocks are included (`modules/3f2a91c0/heading`, settings as `modules/3f2a91c0:settings/background`, nested blocks further down). Long values are shortened and can be read in full by path. Very large pages are capped at 40,000 characters. |
| `describe_type` | A page or block type: fields, required, shared by all languages, allowed values, limits, accepted block types, allowed child types. |
| `search_media` | Images and files by name, with their keys for media pickers. |
| `open_page` | Opens a page in the editor's backoffice. Nothing changes. |
| `update_content` | Changes fields of one page and saves a draft. Supported kinds: text, text area, Markdown, email, rich text (HTML, sanitized), whole and decimal numbers, true/false, dropdown, radio and checkbox values (checked against the allowed ones), tags, page pickers, media pickers, links and dates. It also renames the page in a language, which also creates that language version. |
| `edit_blocks` | Adds a block (type, position, values), removes it or moves it in a Block List or Block Grid. Nested blocks inside blocks work too. A new block shows only in the language it was written in (block-level variance). A block removed from a field shared by all languages disappears in every language, and the card says so. |
| `create_content` | A new page as a draft, below a parent that allows its type, with first values. |
| `publish_content` / `unpublish_content` | Publishes the draft in the given languages, or takes the page offline. Umbraco's refusals are explained, for example a required field that is empty or a parent that is not published. |
| `move_content` | Moves the page to a new parent and/or position (start, end, before or after a sibling). |
| `delete_content` | Moves the page and its subpages to the recycle bin. Never deletes for good. |
| `upload_media` | Saves an image attached in the chat (PNG, JPEG, WebP, GIF, up to 5 MB) as an *Image* in the media library. |

Values inside blocks are written in the form the block already uses: a JSON string or an object, as Umbraco and seeders store them. Untouched fields stay exactly as they were.

## How a change is made

1. **Planned.** The tool resolves the paths, checks the value and computes before and after, without saving anything. If something is invalid (unknown path, value not allowed, protected field, no permission), the model is told at once and the editor is not asked.
2. **Approved or not** by mode. The card shows each field with a word-level diff, notes (for example "shared by all languages", or "required fields still empty") and, when it waits, why.
3. **Committed.** The change is planned again from the current content. If the values before have changed since the card was shown, it is refused ("The content changed after this change was proposed"). Otherwise it is saved: `IContentService.Save` under the user's own name, so Umbraco's history shows them.
4. **Checked.** The page is read again and every changed path is compared with what was meant. The model gets the result ("Checked after saving: all changes are in place", or which ones did not take) and reminds the editor that drafts go live only when published.
5. **Logged** with the user, their message, the mode or approval and the full before and after.
6. **The backoffice refreshes.** If the page is open, the editor reloads it, and the tree reloads its branch.

**Undo**, from the chat card or the activity log, puts the values from before back as a draft, but only if nothing changed them since. For new pages and uploads, Undo moves them to the recycle bin. A deleted page is restored where it was, and a moved page goes back. A publish cannot be undone: unpublish it, or roll back in Umbraco.

## The chat

- A bubble at the bottom right of every section, just above the workspace's *Save and publish* bar.
- It stays mounted while the editor moves through the backoffice, so a conversation carries on. Closing the panel does not stop a running answer.
- **Context.** The panel knows the open page and its language (shown as a chip), and the assistant gets it with each message: "this page" means the open one.
- **What you see:**
  - the steps as short lines, for example "Searched for “Telefon” · 2 pages found" and "Read “Kontakt” · 27 fields";
  - change cards (pending, done with how it was approved, declined, failed, undone) with *Open page* and *Undo*;
  - a bar to approve or decline all when several changes wait;
  - a badge on the bubble while changes wait.
- **Controls:**
  - mode and effort pills under the input;
  - images attached with the paperclip or by pasting;
  - Stop, a new conversation, the list of conversations, and a larger size.
- **Links.** The assistant links pages as `[Name](umb://document/<key>)`, which open in the backoffice.
- **Theme.** It uses Umbraco's own colours, so it follows the light, dark and high-contrast themes. With reduced motion it does not animate.

Conversations are stored on the server per user (`LigataAIEditorChat`): what the model sees, and the lines the chat shows. Only their owner can open them. They are deleted after the set number of days.

## Activity log

*AI Assistant → Content assistant → Activity* lists everything the assistant did or proposed, newest first. Each entry shows:
- the person who steered it, their message ("Fixture Admin asked …"), and the time;
- the page and language;
- how it was approved: by hand, Auto mode, Bypass mode, or Undo;
- the outcome: done, not done (with Umbraco's reason), declined (with the note), or undone (by whom and when);
- the full before and after.

It can be filtered by kind, person and words, and offers *Open page* and *Undo*.

*Usage* shows messages, changes, tool steps and tokens (in, out, from the cache) for the last 30 days. It also gives a cost estimate at Claude Haiku 5.5 list prices and a per-person table with today's count.

## Long conversations, effort and cost

- **Lean context.** The system prompt holds only the instructions, the site's languages, what may be done and the guidelines. Nothing is preloaded: pages, types and media come through tools. Each message carries the date, the editor's name and the open page.
- **Caching.** The tools and system prompt are one cached block, and the conversation so far is cached at its last block. Every further step of a task therefore reads almost everything from the cache. In the live tests, 87% of prompt tokens came from the cache.
- **Summaries.** Before a conversation would grow beyond `LigataAI:ContentAssistant:CompactAtTokens` (default 60,000, at most 80% of `LigataAI:Claude:MaxContextTokens`), the assistant writes a summary for itself. The summary covers what the editor wants, the pages with their keys and languages, what was changed or declined, and open questions. The conversation continues from it, and the chat notes this.
- **Effort.** Medium by default (adaptive thinking). Thinking blocks are sent back unchanged with their signatures through the tool loop, as the API requires.
- **Cost, measured.** In the live tests, 13 messages with 38 tool steps and 7 changes took 247k prompt tokens (214k of them cached) and 10k output tokens with Claude Haiku 5.5. That is about one cent.

## Security

- **Every tool runs with the signed-in user's Umbraco permissions** (`IContentPermissionService`): start nodes, browse, update, create, publish, unpublish, move, delete and sort, plus their languages. The settings can only narrow this.
- **Page content is data, never instructions.** The system prompt says so, and in the tests the assistant ignored an instruction planted in a page, even in Bypass mode, and pointed it out.
- **Rich text written by the assistant is sanitized.** It keeps the editor's formatting (paragraphs, headings, emphasis, links, lists, quotes, tables, images, Umbraco's local links and RTE blocks). It drops scripts, styles, iframes, event handlers and `javascript:` links.
- **Access:**
  - the chat's endpoints serve users the settings allow;
  - settings, the activity log and usage are for `LigataAI:EditorGroups`;
  - people may see and undo their own actions;
  - the API key never reaches the browser.
- **Limits:**
  - messages per person and per site per day;
  - steps per message;
  - one running answer per conversation;
  - images: four per message, 5 MB each;
  - messages: 8,000 characters each.

## Privacy

Editors' messages, the content the assistant reads and attached images go to Anthropic (USA), as for the website assistant in API mode. The website's visitors are not involved and need no consent.

What to do:
- Mention it in the privacy notes for staff and in the record of processing activities.
- Anthropic's data processing addendum covers it.

Conversations are kept for the set period (30 days by default), and the activity log for its own period. Usage counters hold names and numbers, no content. See [PRIVACY.md](PRIVACY.md#content-assistant-09).

## Limits of this version

- **Engine.** Claude only. The design is engine-agnostic: the tools and the loop do not depend on Claude's API shape beyond `EditorModel`. The GPU follows once a fixed set of editor tasks shows it is good enough.
- **Not editable.** Property editors the assistant does not know are shown and left alone: colour pickers, sliders, the newer date pickers, custom editors and the Forms picker's own format. It does not edit blocks inside rich text or add blocks into Block Grid *areas*, though it can read, change, move and remove blocks that are in areas. It cannot change document types, users or settings.
- **Open page reload.** When the assistant changes the page that is open, the backoffice reloads it. That is Umbraco's own reload, used when an entity changes elsewhere. Unsaved edits in that page are replaced, so approve changes to the open page after saving your own. On pages with a Block Grid, Umbraco 17.6/17.7 logs "Maximum call stack size exceeded" in the browser console while reloading. The page shows the new content correctly.
- **Pending changes.** Publishing one language of a page whose Block List or Block Grid is shared by all languages can leave Umbraco reporting "pending changes" right afterwards. Umbraco merges the block values per language and stores them in another order. Nothing differs.

## Tests

- **Domain checks.** 30 checks of the content assistant are among the 227 domain checks (`dotnet run --project tests/Ligata.AI.Tests -c Release`). They cover:
  - settings validation, effort choice (also from the configuration) and the tools offered, including tools a conversation already used;
  - when each mode asks: Manual always, Bypass never, Auto for kinds not approved, for risky changes and after N changes;
  - HTML sanitizing and plain text, UDIs, editor kinds;
  - Block Grid parsing (areas, values per language, expose), JSON values stored as strings;
  - the instructions;
  - the conversation sent back with thinking signatures and one cache breakpoint.
- **Database checks.** 43 database checks (373 assertions with the domain checks), against a fresh multilingual fixture (rich text, a Block List of cards with values per language). They cover:
  - modes by group;
  - search by name, text, numbers and labels; tree, read, describe;
  - planning versus saving, drafts versus live, edits inside blocks per language;
  - refusals: unknown path, unchanged value, protected field, read-only type, outside the scope, language, invalid value;
  - risks recognised on real plans (clearing a field, a field all languages share, removing a block) and not on ordinary edits;
  - rich text sanitizing; block add, move and remove (expose, nothing left behind); create, publish (and Umbraco's refusal), sort, recycle bin;
  - Undo and its conflict, deletion restored;
  - activity filters, usage, conversations and retention, settings conflicts, the manifest by licence.
- **Browser suite.** `tests/e2e/editor.mjs` has 23 checks against the strict mock Anthropic API, which plays a scripted assistant: `do: tool {json}; tool {json} then: text`. It covers every mode (including Auto asking before a risky block removal), blocks, Undo, and the activity log, which records for each change who steered it, when, what they asked, before and after, and by hand, Auto or Bypass. It also covers settings, the effort from the configuration and from the chat, open_page, image upload, summaries, Stop, the daily limit, access by group, and that no key reaches the browser. See [TESTING.md](TESTING.md#content-assistant-09).
- **Live.** 40 requests to the real Claude Haiku 5.5 on Umbraco.BaselineV2, through a budget proxy. The results are in [TESTING.md](TESTING.md#content-assistant-09).
