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
| AI conversations | Not stored on the website's server. Anonymous daily counters only (number of questions, answer times, tokens). |
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
| `GpuOperator`, `GpuOperatorCountry` | GPU mode: who runs the AI server and where (ISO code such as `CH` or `DE`). Shown to visitors before they agree and used in the privacy policy text. |
| `CookiebotIgnore` | Adds `data-cookieconsent="ignore"` to the chat's script tag (see Cookiebot). |

In the backoffice (**Privacy** tab) editors can change the wording of the consent request (empty uses the translated default that names the recipient), the notice under the input, the privacy policy link, and ask everyone again. The tab also shows how many visitors agreed, asked and withdrew in the last 30 days.

## Cookiebot

The chat works with Cookiebot in both consent modes.

1. **Automatic blocking.** The chat's script tag carries `data-cookieconsent="ignore"`, so Cookiebot's automatic blocking does not hide the chat bubble. This is correct because the chat sets no cookies and asks for consent itself before any data goes to the AI. Live chat and the email form need to work without AI consent anyway.
2. **Cookie declaration.** Cookiebot's scanner may find two local storage entries. Classify them as **Necessary**: they only exist once a visitor uses the chat, and the chat needs them.

   | Name | Type | Purpose | Expiry |
   | --- | --- | --- | --- |
   | `ligata-ai:v2:<domain>` | HTML Local Storage | Conversations in the chat (texts; of attachments only file names), access keys to conversations with the team, whether the chat is open | Persistent; conversations are removed after the inactivity period |
   | `ligata-ai:consent:<domain>` | HTML Local Storage | The visitor's consent to the AI assistant (random id, version, time) | `ConsentDays` or until withdrawn |

3. **Optional: AI consent in Cookiebot.** With `"ConsentMode": "cookiebot"`, the chat shows the same information but sends visitors to the cookie settings (`Cookiebot.renew()`) instead of offering its own button. It unlocks as soon as the configured category is allowed. Accepting cookies alone sends nothing: the consent is recorded on the server with the first question, with source `cookiebot`. Declining the category later withdraws it at once and removes the AI conversations from the device. Describe the AI assistant in that category's description in Cookiebot. For example, in German:

   > KI-Chat-Assistent: Ihre Nachrichten im Chat werden zur Beantwortung an [Anthropic (USA) / den KI-Server von Ligata] übermittelt.

   Choose the category that fits your banner. `preferences` is the usual choice for a functional third-party service. Keep in mind that a visitor who allows the category also allows every other service in it.
4. **reCAPTCHA** follows its own setting (`LigataForms:Recaptcha:ConsentMode` = `cookiebot` and `CookiebotCategory`, usually `marketing`).

## Contracts and records

**GPU mode (own AI server).**
- The operator of the GPU server processes visitors' messages on the website owner's behalf.
- Conclude a data processing agreement (Art. 28 GDPR; in Switzerland a contract under Art. 9 DSG) between the website owner (controller) and the operator (processor).
- The technical measures below can serve as its annex.
- Set `GpuOperatorCountry`. If the server is outside the EU/EEA and Switzerland, add the transfer basis to the privacy policy (the generated text marks the spot).

**API mode (Claude).**
- Anthropic's Data Processing Addendum, including the EU Standard Contractual Clauses, is part of Anthropic's Commercial Terms for the API.
- Keep a copy with your records and note which Anthropic entity your contract is with.
- Check the current terms at https://www.anthropic.com/legal (data retention, sub-processors, transfer mechanism).
- If you need it, ask Anthropic about zero data retention.
- Use an API key of an organisation under the commercial terms, never a personal account.

**Record of processing activities (Art. 30 GDPR).** Add an entry for the chat:

| Field | Example |
| --- | --- |
| Purpose | Answering visitors' questions (AI assistant), enquiries to the team (live chat, email form) |
| Data subjects | Website visitors |
| Data | Chat messages, attachments, page title and path; for team requests also name, email address and messages; pseudonymous visitor id; consent records |
| Recipients | AI: [Anthropic PBC, USA / GPU operator]; team: own staff; email: [email provider] |
| Third countries | API mode: USA (SCCs); GPU mode: [country of the server] |
| Erasure | AI: not stored on the server; team conversations: N days after closing; consent records: `KeepConsentRecordsDays` |
| Measures | See below |

**Requests from visitors (Art. 15 to 21).**
- AI conversations are not stored, so there is nothing to disclose or delete on the server.
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
- **Storage limitation.** Automatic deletion of closed conversations, sent emails, unused and old consent records. Browser data is removed after inactivity.
- **Abuse limits.** Rate limits per IP, per visitor and site-wide; one AI question at a time per visitor; a daily ceiling in API mode; size limits on all inputs.
- **GPU server.**
  - The model server and the gateway listen on `127.0.0.1` only; websites reach the gateway through a tunnel or reverse proxy with HTTPS.
  - KV cache in GPU memory only (`--cache-ram 0`); slot files are never saved.
  - Logs contain key ids, token counts and durations, never content.
- **Secrets.** The gateway key is stored encrypted with ASP.NET Data Protection or read from configuration. The Anthropic key is read from configuration only and never sent to browsers or the backoffice.

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
