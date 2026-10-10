<!-- if docs -->
# Privacy notice for staff: the content assistant in the backoffice (Ligata AI)

> **For employers and site operators, please read before passing it on.**
>
> - This notice informs the people who work with the content assistant in the Umbraco backoffice (Art. 13 GDPR, Art. 19 DSG). It is a template and **not legal advice**. Have it reviewed by your data protection adviser.
> - **Easier in the backoffice:** under *AI Assistant → Content assistant → Privacy* the package fills in this text with your settings (periods, user groups, model, who is responsible). Staff also see it in the chat under *Privacy note*, in the language of their backoffice.
> - Here in the repository you see every variant. HTML comments in the source mark what a section is for: `responsible` = the responsible party is entered in the backoffice, `media` = the assistant may upload attached images to the media library, `nomonitoring` = the backoffice confirms that the log and the usage figures are not used to monitor performance or behaviour (only switch it on when that holds, for example under a works agreement). The backoffice fills in values in double curly braces; fill in the parts in [square brackets] yourself.
> - **Works councils.** The activity log and the usage per person show who did what with the assistant, and when. In Germany a technical system suited to monitor behaviour or performance needs the works council's agreement (§ 87(1) no. 6 BetrVG): involve an existing works council before you introduce it. In Austria a works agreement may be needed (§§ 96, 96a ArbVG). In Switzerland, Art. 26 ArGV 3 forbids systems meant to monitor behaviour at the workplace; a log that makes changes traceable and reversible is allowed when it is proportionate and staff are informed.
> - **Legal basis.** The text names Art. 6(1)(b) and (f) GDPR. § 26 BDSG is not named: since the CJEU's judgment of 30 March 2023 (C-34/21) it is disputed as the sole basis.
> - The statements about Anthropic match those in the privacy policy text for the website chat (as of October 2026: API data deleted within 30 days, Data Processing Addendum with the EU Standard Contractual Clauses, no training on API data). Check the current state at anthropic.com/legal.

---
<!-- endif -->
## Privacy notice: the AI assistant in the backoffice

The backoffice of our website (Umbraco) has an AI assistant. It finds and reads pages and changes content when you ask it to. This notice explains which data that involves.

### Responsible

<!-- if responsible -->
{{responsible}}
<!-- endif -->
<!-- if !responsible -->
[Name and address of the employer or site operator; contact for privacy questions, or the data protection officer if there is one]
<!-- endif -->

### Which data is processed

- **What you write:** your messages to the assistant and images you attach.
- **Website content:** the pages and fields the assistant reads to handle your request, drafts included. They may contain personal data, for example names and contact details on a team or contact page.
- **About you:** your name in the backoffice, the page you have open, the date and time.
- **Changes:** what the assistant changed (before and after), who asked for it, when, with which request, and whether the change was approved by hand, made automatically, declined or undone.
- **Usage:** per person and day, the number of messages, steps and changes and the tokens used, without content.

### Purpose and legal basis

We use the assistant so that you can find and maintain our website's content faster. The legal basis is Art. 6(1)(b) GDPR (the employment relationship) and our legitimate interest in maintaining our website efficiently and traceably (Art. 6(1)(f) GDPR). The activity log serves to trace changes, undo them and detect errors or misuse.<!-- if nomonitoring --> We do not use the activity log or the usage figures to monitor performance or behaviour.<!-- endif -->

### Recipient: Anthropic (USA)

The answers come from the AI model {{model}} of Anthropic, PBC, San Francisco, USA ("Anthropic"). Our website server sends your messages, attached images, the content read and your name in the backoffice directly to Anthropic, with a pseudonymous id of your user account so that Anthropic can detect misuse. Your email address is not sent. Your browser does not connect to Anthropic.

Anthropic processes the data on our behalf (Art. 28 GDPR, under Anthropic's Data Processing Addendum) and, under its commercial terms, does not use it to train AI models. According to Anthropic, inputs and outputs are deleted within 30 days. Content that Anthropic classifies as violating its usage policies may be kept for up to 2 years. The transfer to the USA is based on the European Commission's Standard Contractual Clauses (Art. 46(2)(c) GDPR), for transfers from Switzerland in the version adapted to Swiss law (Art. 16(2)(d) DSG).

### Who sees what, and for how long

- **Your conversations** with the assistant are visible in the backoffice to you only. They are deleted {{chatDays}} days after the last message; you can delete them yourself at any time.
- **The activity log** (each change with your name, your request in shortened form, before and after) is visible to members of the user groups {{viewers}}. Entries are deleted after {{activityDays}} days.
- **The usage figures** per person are visible to the same groups. They are deleted after {{usageDays}} days.
<!-- if media -->
- **Images** the assistant uploads to the media library with your approval are visible there like other media to everyone with access to the media library, until someone deletes them.
<!-- endif -->
- Members of the user groups {{users}} can use the assistant. It always works with your own permissions in the backoffice.

### Please note

Do not enter personal data of others in the chat that the task does not need (for example customer details from emails), and no passwords or other credentials.

### Your rights

You have the right of access (Art. 15 GDPR), rectification (Art. 16), erasure (Art. 17), restriction of processing (Art. 18) and to object to processing based on legitimate interests (Art. 21). You can lodge a complaint with a data protection supervisory authority, in Switzerland with the Federal Data Protection and Information Commissioner (FDPIC). Please send questions to the responsible party named above.
