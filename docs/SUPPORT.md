# Ligata.AI 0.2 — team handoff, live chat and email

The chat bubble becomes a complete contact point. The AI answers what it can. When it cannot answer, or the visitor asks for a person, it offers the team. The team handles requests in an **Inbox** inside Umbraco, with live chat, join/leave and their Umbraco profile. Visitors can also send an email through a short form. Each of the three features can be licensed on its own through appsettings, so a site can run live chat and email **without any AI**.

## 1. Feature flags (host configuration)

```json
"LigataAI": {
  "Features": { "Assistant": true, "LiveChat": true, "Email": true },
  "AgentGroups": ["admin", "editor"]
}
```

| Flag | Off means |
| --- | --- |
| `Assistant` | No AI and no gateway connection. Knowledge and Connection disappear from the backoffice, and the bubble opens a contact home instead of an AI chat. |
| `LiveChat` | No inbox live chat, and handoff offers only email. Stored chat conversations are not created. |
| `Email` | No email form and no notification emails. |

Inside the licensed features, editors switch each feature on or off in the backoffice (**Team & email**). If nothing is enabled, the bubble is not rendered. The backoffice manifest is generated on the server (`IPackageManifestReader`). Unlicensed dashboards never load, the section is named *AI Assistant* or *Support* depending on the features, and the Settings dashboard shows only to `EditorGroups`.

## 2. Visitor experience

- **AI cannot answer → handoff card.** The guardrails tell the model to end such answers with a hidden marker (`[[team]]`). The widget strips it and shows a card: *Chat with our team*, *Send us an email*, or *No thanks*. Only enabled channels appear. A *Talk to a person* button in the header is always available (configurable).
- **Request sheet.** It slides over the chat and contains:
  - optional or required **name**, optional or required **email** (required when the team is offline, configurable), and a **message** prefilled with the last question;
  - a reCAPTCHA consent line, when needed;
  - the storage note (*kept for up to N days*);
  - a live team status line: *2 team members online — usually replies within minutes*, or *offline — we reply by email*.
- **Live chat in the same thread.**
  - The AI part of the conversation stays above, and the team sees it as context.
  - When the request is sent, a status line says the team was notified.
  - When an agent joins, the header switches to the agent's identity (photo + name, name only, nickname or anonymous team) and a system line reads *Anna joined the conversation*. A typing indicator appears while the agent writes. *Anna left the conversation* resets the header.
  - When the agent closes the conversation, a *Start a new conversation* button appears.
- **Email form.** It has name (optional), email and message fields. On success it shows *✓ Sent — we'll reply to x@y*. An optional confirmation email goes to the visitor.
- **Several conversations.** A *Conversations* view lists every thread on this device (AI, team, email) with a preview, time, status (*Waiting*, *Team replied*, *Closed*) and an unread dot. Visitors can start a new thread, switch between threads, or remove one from the device.
  - The list is kept in `localStorage` for the configured lifetime. AI conversations stay on the visitor's device only (attachments are never kept). Team conversations live on the server, and the browser keeps only `{ id, token }`.
- **While browsing.**
  - An open team conversation keeps listening while the page is visible (long-poll).
  - Agent replies raise the unread badge and a teaser on the closed bubble, with an optional sound.
  - After navigating to another page, the thread resumes where it was.
- **No-AI mode.** The panel opens a contact home with a greeting, *Chat with our team* (with online status) and *Send us an email*.
- **AI offline.** The offline notice offers the team channels instead of only a mailto link.
- **Privacy link.** The arrow next to the privacy notice is replaced by a clean shield icon with the label *Privacy* / *Datenschutz*.

## 3. Team experience (Umbraco)

### Inbox dashboard
- **Layout.** Three panes: conversation list, thread, visitor details. It collapses to list ↔ thread on narrow screens.
- **Filters.** *Needs reply* (default), *Active*, *All open*, *Closed*, with Chat/Email chips, search over name, email and topic, and paging.
- **List rows.** Each row shows an avatar with initials, name or email, a preview, relative time, state pills (*Waiting 4 min*, *Active · Anna*, *Email*, *Closed*) and an unread dot.
- **Thread.**
  - The AI history is shown muted under *Before the handoff*.
  - Visitor, agent and system lines appear, plus internal notes (yellow, never shown to the visitor).
  - The composer is locked until **Join conversation**. **Leave** and **Close** sit in the header, with **Reopen** and **Delete** (permanent) for closed threads.
  - Agents can reply by email to email requests, or to chats that include an email address.
- **Live updates.** The inbox long-polls. It shows the visitor's typing, the visitor's online/away state, new conversations with sound, and browser notifications (opt-in per agent).
- **My status** (*Available* / *Away*) controls whether the widget shows the team as online. Presence = inbox open in the last 60 s and not away.
- **My profile in chats.** Display: *Name and photo*, *Name only*, *Nickname*, *Anonymous (team name)*. A preview shows exactly what visitors see. Admins set the default and whether agents may choose.
- Agents who closed the backoffice are removed automatically after 15 min, so visitors never wait for a ghost.

### Header bar badge
A chat icon in the Umbraco header shows how many conversations need a reply, from anywhere in the backoffice. Clicking it opens the Inbox.

### Settings → new “Team & email” tab
- **Features:** AI answers, live chat and email form toggles (locked ones show which appsetting enables them).
- **Live chat:**
  - when to offer the team (AI unsure / always-visible button), team name, waiting and offline texts;
  - name and email fields (hidden, optional or required), email required when offline;
  - default agent display and whether agents may choose.
- **Email form:** title, intro, name field, success text, optional visitor confirmation (subject + text).
- **Notifications:** team recipient addresses, new chat request, visitor message while no agent is present (throttled to one per 15 min per conversation), and a test email button.
- **Lifecycle:**
  - Conversations close after *N* days without activity (default 3).
  - Closed conversations are deleted after *M* days (default 30).
  - The visitor device forgets threads after the same inactivity period.
- **Spam protection:** reCAPTCHA v3 status. It reuses `LigataForms:Recaptcha` (site key, secret, hostnames, score, consent mode), so nothing is configured twice; `LigataAI:Recaptcha` can override it. A toggle protects requests and emails.

Insights gains: chat requests, emails, AI handoff suggestions (questions the AI could not answer), agent replies and average first response time.

## 4. Data (host CMS database, migration `ai-v2`)

| Table | Content |
| --- | --- |
| `LigataAIConversation` | id, SHA-256 of the visitor token, kind (chat/email), state (open/active/closed), name, email, topic, page, language, visitor pseudonym (HMAC of IP), joined agents, sequence counters (last, team read, last visitor), created/updated/first response/closed timestamps, close reason, last notification time |
| `LigataAIMessage` | conversation, sequence, author (visitor/agent/ai/system), agent key, kind (message/note/history/join/leave/close/reopen/request/email), text, client id (deduplication), created |
| `LigataAIAgent` | Umbraco user key, public id, display mode, nickname, away |
| `LigataAIEmail` | outgoing mail queue: kind, to, reply-to, subject, HTML body, conversation, state, attempts, next attempt, error |
| `LigataAIStat` | + ChatRequests, EmailRequests, Suggested, AgentReplies, FirstResponseMs, Responses |

A background worker (every 30 s):
- closes inactive conversations and purges closed ones after the retention period;
- auto-leaves absent agents;
- sends queued emails through Umbraco's SMTP (`Umbraco:CMS:Global:Smtp`, like Ligata.Forms), with retries;
- purges sent mail after 7 days.

## 5. API

Public (`/api/ligata-ai`, same origin rules as the chat):

| Route | Purpose |
| --- | --- |
| `GET config` | + `features`, team `online` / `available` |
| `POST conversations` | Create a team chat or email request: `{ kind, name, email, message, history[], page, language, recaptchaToken }` → `{ id, token }` |
| `POST conversations/{id}/messages` | Visitor message `{ token, text, clientId }` (idempotent) |
| `POST conversations/{id}/poll` | Long-poll ≤ 25 s: `{ token, after }` → events, state, agents, typing, team online |
| `POST conversations/{id}/typing` / `close` | Ephemeral typing signal / visitor ends the chat |
| `GET agents/{publicId}/avatar` | Agent photo, only while that agent shows a photo |

Management (`/umbraco/management/api/v1/ligata-ai/inbox…`, `AgentGroups` ∪ `EditorGroups`): list, summary, updates (long-poll + presence heartbeat), thread, join, leave, message/note, email reply, typing, read, close, reopen, delete, me (profile and status).

## 6. Security and limits

- **Visitor tokens.** 256-bit random, stored as SHA-256 and compared in constant time, sent in the request body (never in URLs). Conversation ids alone grant nothing.
- **reCAPTCHA v3.** Required on every new request and email when configured and enabled: action `ligata_ai_contact`, score, hostname and age checks like Forms. Google loads only on submit, after explicit or Cookiebot consent; without consent the visitor gets a mailto fallback.
- **Limits.** Hard caps live in appsettings (`LigataAI:Support`):

  | Limit | Default |
  | --- | --- |
  | Open conversations per visitor | 3 |
  | New conversations per visitor per day | 6 |
  | Emails per visitor per hour | 3 |
  | Visitor messages per minute | 12 |
  | Messages per conversation | 400 |
  | Characters per visitor message | 4,000 |
  | Open conversations site-wide | 500 |
  | Concurrent polls per IP | 4 |
  | Stored conversations (oldest closed are purged first) | 20,000 |

- **Escaping.** All text is escaped in the widget, the backoffice (Lit) and emails (HTML encoded). Subjects are stripped of line breaks.
- **Links in team emails.** These use only trusted configuration (`LigataAI:BackofficeUrl`, the absolute `PublicApiBase` origin, or `WebRouting:UmbracoApplicationUrl`), never the request Host header.
- **What is stored.** Team chats and email requests are stored (that is their purpose) and deleted by the retention job. Pure AI chats are still never stored on the server.

## 7. Milestones (each committed and pushed to `main`)

1. Concept and privacy icon fix.
2. Backend: options/feature flags, migration, stores, hub (long-poll, typing, presence), public and inbox APIs, reCAPTCHA, email queue and worker, dynamic manifest, domain and database tests.
3. Widget: conversation list, handoff marker/card, request and email sheets, live chat, agent identity, unread and teaser, no-AI mode, i18n.
4. Backoffice: Inbox, header badge, Team & email settings, agent profile, insights, overview checklist per feature.
5. Qualification: browser end-to-end tests (visitor ↔ agent with two browsers, email via SMTP pickup folder, reCAPTCHA stub, every feature-flag combination, limits), a real-model handoff check, visual review, docs and the 0.2.0 package.
