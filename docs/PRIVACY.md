# Privacy (GDPR / DSGVO): guide for website operators

This guide explains what Ligata.AI does to protect visitors' data, what you configure, and what you still need to do yourself (privacy policy, contracts, records). It is technical guidance, **not legal advice**. Have your setup and texts reviewed by your data protection adviser.

**Copy-ready texts:**
- [docs/privacy/datenschutz-de.md](privacy/datenschutz-de.md): German privacy policy sections (Datenschutzerklärung).
- [docs/privacy/privacy-policy-en.md](privacy/privacy-policy-en.md): the English version.

Both are also in the package, and the backoffice fills them in for your setup: **AI Assistant → Settings → Privacy → Text for your privacy policy** (copy or download).

## What the package does

| Topic | Behaviour |
| --- | --- |
| Consent before the AI | The AI receives nothing until the visitor agrees in the chat (or through Cookiebot, see below). The request says that the assistant is an AI, which data is sent, to whom (Anthropic in the USA, or the operator of the GPU server) and links your privacy policy. |
| Server-side enforcement | Every consent is recorded. `/api/ligata-ai/chat` and `/api/ligata-ai/attachments` refuse requests without a valid, current, not withdrawn consent (`403 consent_required`). An outdated widget or a script cannot bypass it. |
| Proof of consent (Art. 7(1)) | Per consent: random id, time, text version, engine, language, source (chat or Cookiebot), time of the first question and of a withdrawal. No IP address, no content. |
| Withdrawal (Art. 7(3)) | In the chat: *Conversations → Withdraw consent* (two clicks, like agreeing). The server records the withdrawal, the browser forgets the consent and the AI conversations. In Cookiebot mode, declining the category in Cookiebot withdraws at once. |
| New consent when things change | A new recipient (switching between GPU and API mode, another GPU operator or country) asks everyone again. Editors can do the same with *Ask all visitors again* (Privacy tab), for example after the privacy policy changed. Consents expire after `ConsentDays` (365). |
| Without consent | Live chat with the team and the email form still work; they do not involve the AI provider. |
| Nothing before use | The chat sets no cookies and writes nothing to the browser until the visitor actually uses it. Opening the chat stores nothing. |
| AI conversations | Not stored on the website's server by default. Anonymous daily counters only (number of questions, answer times, tokens). |
| Conversation history (0.7, revised in 0.7.2) | Off by default (privacy by default, Art. 25(2) GDPR, Art. 7 DSG). When an editor switches it on (*Privacy → Conversation history*), the **consent request states it** ("This website keeps your conversations with the assistant for N days after the last message, without your name or IP address, so its team can check and improve the answers.") and, in a paragraph of its own, the right to object ("You can object at any time under Conversations with "Stop keeping" …", Art. 21(4) GDPR). There is no checkbox: the legal basis is the site's legitimate interest in checking and improving the answers (Art. 6(1)(f) GDPR), not consent, because a consent the assistant depended on would not be freely given (Art. 7(4), Recital 43). Record the balance in your records of processing: a limited purpose, no name or IP address, a short period, access for the team only, told before the first question, objection in one click. The period is part of the consent version (`….h30`): switching the history on or changing the period asks every visitor again before their next question; switching it off asks nobody. The consent record keeps the period the request stated (history version = period and revision) and the time of an objection; a conversation is kept only while the consent is valid and not objected to, checked when the answer starts and again when it ends. Kept: questions, answers (which may reproduce attached files), what the AI looked up and its search terms, names of attached files, page, interface language, times, how each question ended, and the link to a team request started from it. Never files, IP addresses or the pseudonymous visitor id. Each conversation keeps the period it was collected under (1 to 365 days after the last question, default 30): a longer period set later never extends it, a shorter one applies at once. *Stop keeping* (the objection; it carries over to later consents), withdrawing consent and *Delete conversation* delete the server copies (the browser keeps the key of every kept conversation until it is deleted, also when the conversation has left the list); a conversation deleted while its answer was still running is not stored again. The team reads them under *AI conversations* (same user groups as the Inbox) and can keep single ones beyond the period only with a reason (a complaint, a legal claim) and for at most a year; a visitor's deletion still removes them. Deletion runs hourly; at most 50,000 conversations are stored (the oldest go first). In Cookiebot mode the category covers the AI and the chat states the period once per period (*Continue*). Without consent (`RequireConsent: false`) conversations are kept unless the visitor objects with *Stop keeping*; the notice under the input states the period. |
| GPU mode | The gateway processes messages in GPU memory only: no disk storage, no content in logs, no host-RAM prompt cache, no use for training, nothing sent to third parties. The context stays in GPU memory for follow-up questions until overwritten. |
| API mode | The website's server calls Anthropic directly; browsers never contact Anthropic. Only a pseudonymous visitor id is sent as `metadata.user_id`, never the IP address. |
| IP addresses | Used for the connection and rate limits only. A pseudonymous id (HMAC with a per-site secret) is kept in memory; for team conversations it is stored with the conversation to enforce per-visitor limits. |
| Team conversations | Stored in the CMS database, closed after the inactivity period and deleted after the retention period (Team & email tab). Notification emails in the outgoing queue are deleted 7 days after sending. |
| reCAPTCHA | Loaded only when a visitor sends a request to the team, and only after consent (checkbox or Cookiebot category). |
| AI disclosure (EU AI Act, Art. 50) | The consent request starts with "This assistant is an AI". The notice under the input says that answers are AI-generated. |

## Configuration

Everything that decides the legal setup lives in the site's configuration, so editors cannot switch it off by accident:

```json
{
  "LigataAI": {
    "Privacy": {
      "RequireConsent": true,
      "ConsentMode": "explicit",
      "CookiebotCategory": "preferences",
      "ConsentDays": 365,
      "KeepConsentRecordsDays": 1095,
      "GpuOperator": "Ligata",
      "GpuOperatorCountry": "CH",
      "CookiebotIgnore": true
    }
  }
}
```

| Setting | Meaning |
| --- | --- |
| `RequireConsent` | `true` (default): consent before the first question. Only set `false` if your adviser confirmed another legal basis; the generated privacy policy then leaves the legal basis for you to fill in. |
| `ConsentMode` | `explicit` (default): the chat asks with its own button. `cookiebot`: the chat unlocks when the visitor allows `CookiebotCategory` in Cookiebot. Without Cookiebot on a page, the chat asks itself. |
| `CookiebotCategory` | `preferences`, `statistics` or `marketing`. |
| `ConsentDays` | How long a consent is valid (1 to 400). |
| `KeepConsentRecordsDays` | How long consent records are kept as proof. Records never followed by a question are deleted after one day. |
| `GpuOperator`, `GpuOperatorCountry` | GPU mode: who runs the AI server and where, as an ISO code. Defaults: `Ligata` and `CH` (the Ligata GPU in Switzerland). Shown to visitors before they agree and used in the privacy policy text. In API mode the recipient is always Anthropic in the USA. |
| `CookiebotIgnore` | Adds `data-cookieconsent="ignore"` to the chat's script tag (see Cookiebot). |

In the backoffice (**Privacy** tab) editors can change the wording of the consent request (empty uses the translated default that names the recipient), the notice under the input, the privacy policy link, and ask everyone again. The tab also shows how many visitors agreed, asked and withdrew in the last 30 days.

## Cookiebot

The chat works with Cookiebot in both consent modes.

1. **Automatic blocking.** The chat's script tag carries `data-cookieconsent="ignore"`, so Cookiebot's automatic blocking does not hide the chat bubble. This is correct because the chat sets no cookies and asks for consent itself before any data goes to the AI. Live chat and the email form need to work without AI consent anyway.
2. **Cookie declaration.** Cookiebot's scanner may find these local storage entries. Classify them as **Necessary**: they only exist once a visitor uses the chat, and the chat needs them.

   | Name | Type | Purpose | Expiry |
   | --- | --- | --- | --- |
   | `ligata-ai:v2:<domain>` | HTML Local Storage | Conversations in the chat (texts; of attachments only file names), access keys to conversations with the team, whether the chat is open | Persistent; conversations are removed after the inactivity period |
   | `ligata-ai:consent:<domain>` | HTML Local Storage | The visitor's consent to the AI assistant (random id, version, time) | `ConsentDays` or until withdrawn |
   | `ligata-ai:forget:<domain>` | HTML Local Storage | Only with the conversation history: keys of conversations the visitor deleted while the server could not be reached, so the deletion is sent again | Until the server confirmed the deletion |

3. **Optional: AI consent in Cookiebot.** With `"ConsentMode": "cookiebot"`, the chat shows the same information but sends visitors to the cookie settings (`Cookiebot.renew()`) instead of offering its own button. It unlocks as soon as the configured category is allowed. Accepting cookies alone sends nothing: the consent is recorded on the server with the first question, with source `cookiebot`. Declining the category later withdraws it at once and removes the AI conversations from the device. Describe the AI assistant in that category's description in Cookiebot. For example, in German:

   > KI-Chat-Assistent: Ihre Nachrichten im Chat werden zur Beantwortung an [Anthropic (USA) / den KI-Server von Ligata (Schweiz)] übermittelt. Bewahren wir Gespräche für unser Team auf, nennen wir die Frist im Chat; Sie können jederzeit widersprechen.

   Choose the category that fits your banner. `preferences` is the usual choice for a functional third-party service. Keep in mind that a visitor who allows the category also allows every other service in it.
4. **Position.** The chat bubble sits bottom right by default, so it never covers Cookiebot's consent button bottom left (*Appearance → Position*).
5. **reCAPTCHA** follows its own setting (`LigataForms:Recaptcha:ConsentMode` = `cookiebot` and `CookiebotCategory`, usually `marketing`).

## Contracts and records

**GPU mode (own AI server).**
- The operator of the GPU server processes visitors' messages on the website owner's behalf.
- Conclude a data processing agreement (Art. 28 GDPR; in Switzerland a contract under Art. 9 DSG) between the website owner (controller) and the operator (processor).
- The technical measures below can serve as its annex.
- `GpuOperatorCountry` is `CH` by default. Switzerland has an EU adequacy decision, so no transfer clause is needed. If the server is ever moved outside the EU/EEA and Switzerland, add the transfer basis to the privacy policy (the generated text marks the spot).

**API mode (Claude).**
- Anthropic's Data Processing Addendum, including the EU Standard Contractual Clauses, is part of Anthropic's Commercial Terms for the API.
- Keep a copy with your records and note which Anthropic entity your contract is with.
- Check the current terms at https://www.anthropic.com/legal (data retention, sub-processors, transfer mechanism).
- If you need it, ask Anthropic about zero data retention.
- Use an API key of an organisation under the commercial terms, never a personal account.

**Both engines set up (0.8).** Editors switch between the Ligata GPU and Claude under *Connection → AI engine*. The consent names who answers, so a switch asks every visitor again before their next question, and the privacy policy text under *Privacy* changes with the engine: copy it into the privacy policy when switching. Keep both agreements on file while both engines can answer (the GPU operator's data processing agreement and Anthropic's addendum).

**Record of processing activities (Art. 30 GDPR).** Add an entry for the chat:

| Field | Example |
| --- | --- |
| Purpose | Answering visitors' questions (AI assistant), enquiries to the team (live chat, email form) |
| Data subjects | Website visitors |
| Data | Chat messages, attachments, page title and path; for team requests also name, email address and messages; pseudonymous visitor id; consent records |
| Recipients | AI: [Anthropic PBC, USA / GPU operator]; team: own staff; email: [email provider] |
| Third countries | API mode: USA (SCCs); GPU mode: [country of the server] |
| Erasure | AI: not stored on the server, or with the conversation history N days after the last question (kept ones when no longer needed); team conversations: N days after closing; consent records: `KeepConsentRecordsDays` |
| Measures | See below |

**Requests from visitors (Art. 15 to 21).**
- AI conversations are not stored, so there is nothing to disclose or delete on the server. With the conversation history on, they are kept without name, IP address or visitor id: find a visitor's conversation by searching for what they wrote (*AI conversations → Search*), read it, and delete it. Visitors can also delete it themselves in the chat. If a visitor cannot tell you what they wrote, the conversation cannot be attributed to them (Art. 11 GDPR).
- Team conversations and email requests can be found in the Inbox by name, email address or topic, read in full and deleted (*Delete* in the conversation).
- Visitors can delete their own copy in the chat (*Remove from this device*).

## Technical and organisational measures (software)

Measures the software provides. Add your organisational ones (access rights, backups, staff training) for a complete list.

- **Transport.** Browsers talk only to the website. The website talks to the gateway or Anthropic server-to-server; use HTTPS for any connection that leaves the machine.
- **Access control.**
  - Public endpoints accept only listed origins.
  - Gateway keys are stored hashed and compared in constant time; they can be revoked without a restart.
  - Backoffice access is limited to configured user groups.
  - Visitor access to team conversations requires a random 256-bit token, stored as a SHA-256 hash.
- **Pseudonymisation.** Visitor IPs become an HMAC with a per-site secret before they are used or passed on.
- **Data minimisation.** No cookies. No content in logs. AI conversations are not stored. Attachments are processed in memory. Consent records hold no IP address and no content.
- **Storage limitation.** Automatic deletion of closed conversations, sent emails, unused and old consent records, and (when kept at all) AI conversations after the history period. Browser data is removed after inactivity.
- **Abuse limits.** Rate limits per IP, per visitor and site-wide; one AI question at a time per visitor; a daily ceiling in API mode; size limits on all inputs.
- **GPU server.**
  - The model server and the gateway listen on `127.0.0.1` only; websites reach the gateway through a tunnel or reverse proxy with HTTPS.
  - KV cache in GPU memory only (`--cache-ram 0`); slot files are never saved.
  - Logs contain key ids, token counts and durations, never content.
- **Secrets.** The gateway key is stored encrypted with ASP.NET Data Protection or read from configuration. The Anthropic key is read from configuration only and never sent to browsers or the backoffice.

## Content assistant (0.9)

The content assistant in the backoffice is for the site's own staff, not for visitors, so no visitor consent is involved.

- **What leaves the site.** Editors' messages and attached images, together with the content the assistant reads to answer them (drafts too), go to Anthropic (USA). Each request carries only a pseudonymous id of the backoffice user (`metadata.user_id`).
- **Legal basis and records.** The processing serves the operator's work on its own website: its legitimate interest, or the employment relationship. Add it to the record of processing activities ("content editing with an AI assistant; recipient Anthropic; staff messages and website content"). Anthropic's data processing addendum covers the transfer.
- **Tell your editors.** Say in the staff privacy notes or the internal guidelines that the assistant sends what they write and the content it reads to Anthropic, and that personal data of third parties (customers in a form text, for example) should not be pasted into the chat.
- **What the site keeps.**
  - Conversations, per user and visible only to that user, deleted after the set period (30 days by default).
  - The activity log: who asked, their message (shortened), what changed with values before and after, and how it was approved. It is kept for its own period (365 days by default) and is visible to the editor groups.
  - Daily usage counters per person: name, number of messages, steps and changes, and tokens. They hold no content.
- **Limits.** Who may use it and what it may change are set per user group; every change runs with the editor's own Umbraco permissions.

## Not covered by the package

- Your web server, CDN or reverse proxy logs (for example IIS, Cloudflare): they record IP addresses for every request, including the chat's.
- Your email provider and the mailboxes of your team.
- Hosting, backups and database access.
- Analytics or other tools on your site.

## Switzerland (DSG)

The generated text uses GDPR articles because most Swiss sites with EU visitors fall under the GDPR as well.

Under the revised DSG alone:
- consent is not generally required for this processing;
- the duty to inform (Art. 19 DSG) is met by naming the recipients and their countries, which the text does.

The consent request does no harm either way.

What the generated text covers for Switzerland: the purpose, the recipients and their countries (Art. 19 DSG), the safeguard for disclosure to the USA in API mode (the Standard Contractual Clauses in the version adapted to Swiss law, Art. 16 Abs. 2 lit. d DSG) and the Federal Data Protection and Information Commissioner (EDÖB) for complaints. Add your identity and contact details. If your site targets EU visitors and you have no establishment in the EU, check whether you need an EU representative (Art. 27 GDPR); the text has a placeholder for it.
