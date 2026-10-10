import { html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { icon } from './ui.js?v=0.13.2';

const fieldModes = [['hidden', 'Hidden'], ['optional', 'Optional'], ['required', 'Required']];
const displayModes = [
  ['full', 'Name and photo', 'Umbraco name and profile picture'],
  ['name', 'Name only', 'Umbraco name with initials'],
  ['alias', 'Nickname', 'A name each person chooses'],
  ['anonymous', 'Anonymous', 'Only the team name'],
];

export const teamView = {
  // Methods, not getters: the views are mixed into the dashboard with Object.assign.
  licensedFeatures() { return this.platform?.licensed || { assistant: true, liveChat: true, email: true }; },
  effectiveFeatures() { const l = this.licensedFeatures(), f = this.settings.features; return { assistant: l.assistant && f.assistant, liveChat: l.liveChat && f.liveChat, email: l.email && f.email }; },

  featureRow(path, title, description, iconName, licensed, setting) {
    const on = !!this.value(path);
    return html`<div class="feature ${on && licensed ? 'on' : ''}">
      <span class="k-kind">${icon(iconName)}</span>
      <div class="grow"><strong>${title}</strong><p class="muted" style="font-size:13px">${description}</p>
        ${licensed ? nothing : html`<small class="muted">${icon('shield')} Not included in this installation. A developer enables it with <code>${setting}</code>.</small>`}</div>
      <label class="switch"><input type="checkbox" .checked=${on && licensed} ?disabled=${!licensed} @change=${e => this.set(path, e.target.checked)} aria-label=${title}></label>
    </div>`;
  },

  async testEmail() {
    await this.run(async () => {
      const result = await this.request('/test-email', 'POST', { recipients: this.settings.notifications.recipients.map(s => s.trim()).filter(Boolean), settings: this.settings });
      if (result.state === 'sent') this.message = `Test email sent to ${result.to.join(', ')}. Check the inbox (and the spam folder).`;
      else this.warning = `The test email is queued but could not be sent yet${result.error ? `: ${result.error}` : ''}.`;
    });
  },

  teamView() {
    const s = this.settings, l = this.licensedFeatures(), e = this.effectiveFeatures(), p = this.platform || {};
    const captcha = p.captcha || {};
    const t = s.support, c = s.contact, n = s.notifications;
    return html`<div class="split">
      <div class="grid">
        <section class="card">
          <header><div><h2>Features</h2><p class="muted">Choose what the chat bubble offers. Each feature works on its own: without the AI, the bubble becomes a contact point for your team.</p></div></header>
          <div class="features">
            ${this.featureRow('features.assistant', 'AI answers', 'The assistant answers from your knowledge, around the clock.', 'sparkle', l.assistant, 'LigataAI:Features:Assistant')}
            ${this.featureRow('features.liveChat', 'Live chat with your team', 'Visitors can ask for a person. Your team answers in the Inbox, live.', 'team', l.liveChat, 'LigataAI:Features:LiveChat')}
            ${this.featureRow('features.email', 'Email form', 'Visitors can send a message by email instead, with name (optional), email and text.', 'mail', l.email, 'LigataAI:Features:Email')}
          </div>
          ${!e.assistant && !e.liveChat && !e.email ? html`<div class="notice warning">${icon('warn')}<div>With every feature off, the chat bubble is not shown on the website.</div></div>` : nothing}
        </section>

        ${l.liveChat ? html`<section class="card ${e.liveChat ? '' : 'muted-card'}">
          <header><div><h2>Live chat</h2><p class="muted">${e.liveChat ? `${p.online || 0} team member${p.online === 1 ? '' : 's'} online right now. Visitors see the team as online while someone available has Umbraco open.` : 'Switched off. The settings below apply when you switch it on.'}</p></div></header>
          <div class="grid two">
            ${this.text('support.teamName', 'Team name', { max: 60, placeholder: 'e.g. Ligata Support', help: 'Shown as the chat title, e.g. “Chat with Ligata Support”. Empty: “our team” in the visitor’s language.' })}
            <div class="section" style="margin:0;padding:0;border:0">
              ${l.assistant ? this.toggle('support.suggestWhenUnsure', 'AI offers the team when it cannot answer', 'Questions outside your knowledge, or a visitor asking for a person, show a “talk to our team” card.') : nothing}
              ${this.toggle('support.showTeamButton', 'Show a “Talk to a person” button', 'A person icon in the chat header, always available.')}
            </div>
          </div>
          <div class="grid two section">
            ${this.segmented('support.nameField', 'Ask for the name', fieldModes)}
            ${this.segmented('support.emailField', 'Ask for the email address', fieldModes)}
          </div>
          <div class="section">${this.toggle('support.requireEmailWhenOffline', 'Require an email address when nobody is online', 'So your team can answer later by email. Visitors who come back still see the answer in the chat.')}</div>
          <div class="grid two section">
            ${this.text('support.waitingMessage', 'After the request (team online)', { rows: 2, max: 400, placeholder: 'Thanks! We let the team know. Someone will join you here shortly.', help: 'Empty: a translated default.' })}
            ${this.text('support.offlineMessage', 'When nobody is online', { rows: 2, max: 400, placeholder: 'Nobody is online right now. We will reply by email.', help: 'Empty: a translated default.' })}
          </div>
          <div class="section">${this.text('support.privacyNotice', 'Storage notice in the request form', { rows: 2, max: 400, placeholder: `Our team sees this conversation. It is stored for up to ${t.inactivityDays} days after the last message.`, help: 'Shown when visitors ask for the team and below team chats. Empty: a translated default with the days below.' })}</div>
        </section>` : nothing}

        ${l.liveChat ? html`<section class="card">
          <header><div><h2>How team members appear</h2><p class="muted">What visitors see when someone joins a chat. Team members always see each other’s real names.</p></div></header>
          <div class="display-modes">${displayModes.map(([mode, label, help]) => html`<button type="button" class="swatch display" aria-pressed=${String(t.agentDisplay === mode)} @click=${() => this.set('support.agentDisplay', mode)}>
            <span class="mini">${mode === 'anonymous' ? html`<i class="face">${icon('team')}</i>` : html`<i class="face">${mode === 'full' ? icon('avatar') : 'AM'}</i>`}<span><b>${mode === 'full' || mode === 'name' ? 'Anna Muster' : mode === 'alias' ? 'Anna' : t.teamName || 'Our team'}</b><span class="mini-bubble">Hi! How can I help?</span></span></span>
            <b>${label}</b><small class="muted">${help}</small></button>`)}</div>
          <div class="section">${this.toggle('support.agentsChoose', 'Let team members choose for themselves', 'Each person can pick their own display in the Inbox (“How I appear”). Off: everyone uses the choice above.')}</div>
        </section>` : nothing}

        ${l.email ? html`<section class="card ${e.email ? '' : 'muted-card'}">
          <header><div><h2>Email form</h2><p class="muted">${e.email ? 'Visitors can send a message that arrives in your mailbox and in the Inbox.' : 'Switched off. Notification emails below still work for live chat.'}</p></div></header>
          <div class="grid two">
            ${this.text('contact.title', 'Form title', { max: 80, placeholder: 'Send us an email' })}
            ${this.segmented('contact.nameField', 'Ask for the name', fieldModes)}
          </div>
          <div class="section">${this.text('contact.intro', 'Introduction', { rows: 2, max: 400, placeholder: 'Leave your message and we will answer by email.' })}</div>
          <div class="section">
            ${this.toggle('contact.sendConfirmation', 'Send the visitor a confirmation', 'A copy of their message, in their language, with your reply-to address.')}
            ${c.sendConfirmation ? html`<div class="grid">
              ${this.text('contact.confirmationSubject', 'Subject', { max: 150, placeholder: 'Your message to {site}' })}
              ${this.text('contact.confirmationText', 'Text', { rows: 4, max: 4000, placeholder: 'Hi {name}\n\nThanks for your message. We will get back to you as soon as possible.', help: 'Placeholders: {name}, {site}. Empty: a translated default.' })}
            </div>` : nothing}
          </div>
        </section>` : nothing}

        ${l.email ? html`<section class="card">
          <header><div><h2>Notifications</h2><p class="muted">Your team is emailed about new requests, so nobody has to watch the Inbox.</p></div>
            <span class="pill ${p.email?.ready ? 'ok' : 'bad'}" title=${p.email?.ready ? 'Umbraco:CMS:Global:Smtp' : 'Set Umbraco:CMS:Global:Smtp (From, Host) on the server'}><i></i>${p.email?.ready ? 'Email sending ready' : 'SMTP not configured'}</span></header>
          ${this.list('notifications.recipients', 'Team email addresses', { max: 10, placeholder: 'team@example.ch', help: 'Up to ten. Each receives new chat requests and email messages.' })}
          <div class="section">
            ${this.toggle('notifications.newChat', 'Email the team about every new chat request', 'Includes the conversation with the AI before the request and a link to the Inbox.')}
            ${this.toggle('notifications.visitorMessages', 'Email when a visitor writes and nobody is in the chat', 'At most every 15 minutes per conversation.')}
          </div>
          <div class="grid two section">
            ${this.text('notifications.replyTo', 'Reply-to for your answers', { type: 'email', placeholder: n.recipients[0] || 'support@example.ch', help: 'Where visitors’ replies to your emails go. Empty: the first team address.' })}
            ${this.text('notifications.subjectPrefix', 'Subject prefix', { max: 40, placeholder: `[${s.behaviour.siteName || s.identity.name}]` })}
          </div>
          <div class="row section"><button class="btn" ?disabled=${this.busy || !n.recipients.some(x => x.trim())} @click=${() => this.testEmail()}>${icon('mail')}Send a test email</button>
            <small class="muted grow">${p.email?.ready ? 'Uses the SMTP settings of this Umbraco site.' : 'Emails wait in a queue until a developer configures Umbraco:CMS:Global:Smtp.'}${p.email?.backofficeUrl ? '' : ' Links to the Inbox need LigataAI:BackofficeUrl (or an absolute PublicApiBase).'}</small></div>
        </section>` : nothing}

        <section class="card">
          <header><div><h2>Conversation lifetime</h2><p class="muted">Conversations with your team are stored so you can answer them. They are removed automatically.</p></div></header>
          <div class="grid two">
            ${this.range('support.inactivityDays', 'Close after no messages for', 1, 30, 1, v => `${v} day${v === 1 ? '' : 's'}`, 'Open conversations close by themselves. Visitors’ devices forget conversations after the same time.')}
            ${this.range('support.retentionDays', 'Delete closed conversations after', 1, 365, 1, v => `${v} day${v === 1 ? '' : 's'}`, 'Messages, names and email addresses are deleted for good.')}
          </div>
          <small class="muted">Limits per visitor (from appsettings): ${p.limits?.openConversationsPerVisitor ?? 3} open chats, ${p.limits?.conversationsPerVisitorPerDay ?? 6} requests per day, ${p.limits?.emailsPerVisitorPerHour ?? 3} emails per hour, ${p.limits?.visitorMessagesPerMinute ?? 12} messages per minute; ${p.limits?.maxOpenConversations ?? 500} open conversations site-wide.</small>
        </section>

        <section class="card">
          <header><div><h2>Spam protection</h2><p class="muted">Google reCAPTCHA v3 checks every new request and email invisibly. Google loads only when a visitor sends, after consent.</p></div>
            <span class="pill ${captcha.ready ? 'ok' : ''}"><i></i>${captcha.ready ? `From ${captcha.source === 'LigataForms' ? 'Ligata Forms settings' : 'LigataAI:Recaptcha'}` : 'Not configured'}</span></header>
          ${captcha.ready ? html`<dl class="facts"><dt>Site key</dt><dd>${captcha.siteKey}</dd><dt>Consent</dt><dd>${captcha.consentMode === 'cookiebot' ? `Cookiebot category “${captcha.cookiebotCategory}”` : 'Checkbox in the form'}</dd><dt>Hostnames</dt><dd>${(captcha.hostnames || []).join(', ')}</dd><dt>Minimum score</dt><dd>${captcha.minimumScore}</dd></dl>
            <div class="section">${this.toggle('support.useRecaptcha', 'Protect requests and emails with reCAPTCHA', 'Recommended. Rate limits apply either way.')}</div>`
          : html`<p class="muted" style="font-size:13px">The chat uses the same keys as Ligata Forms (<code>LigataForms:Recaptcha</code>), or <code>LigataAI:Recaptcha</code> if set. Without keys, requests are protected by rate limits only.</p>`}
        </section>

        <section class="card">
          <header><div><h2>Who answers</h2></div></header>
          <dl class="facts"><dt>Inbox</dt><dd>${[...new Set([...(p.agentGroups || []), ...(p.editorGroups || [])])].join(', ') || '-'}</dd><dt>Settings</dt><dd>${(p.editorGroups || []).join(', ')}</dd></dl>
          <small class="muted">User groups come from <code>LigataAI:AgentGroups</code> and <code>LigataAI:EditorGroups</code>. Each member’s name and profile picture come from their Umbraco profile.</small>
        </section>
      </div>
      ${this.previewPane()}
    </div>`;
  },
};
