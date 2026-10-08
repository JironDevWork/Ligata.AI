import { html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { icon, number } from './ui.js?v=0.7.0';

const categories = { preferences: 'Preferences', statistics: 'Statistics', marketing: 'Marketing' };
const regionName = code => { try { return /^[a-z]{2}$/i.test(code) ? new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) : code; } catch { return code; } };

export const privacyView = {
  async refreshPrivacy() {
    try { this.privacy = await this.request('/privacy'); } catch { /* keep what was loaded with the settings */ }
  },

  async loadPolicy(language = this.policyLanguage || 'de') {
    this.policyLanguage = language;
    this.policyLoading = true;
    try { this.policy = await this.request(`/privacy/policy?language=${language}`, 'POST', this.settings); }
    catch (e) { this.policy = { language, error: e.message }; }
    finally { this.policyLoading = false; }
  },

  async copyPolicy() {
    try { await navigator.clipboard.writeText(this.policy.text); this.message = 'Copied. Paste it into your privacy policy and fill in the parts in [square brackets].'; }
    catch { this.error = 'The browser did not allow copying. Select the text and copy it with Ctrl+C.'; }
  },

  downloadPolicy() {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([this.policy.text], { type: 'text/markdown;charset=utf-8' }));
    link.download = this.policy.language === 'de' ? 'datenschutz-chat.md' : 'privacy-chat.md';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  },

  /** The widget's English default, so editors know what visitors read when the field is empty. */
  defaultConsentText() {
    const provider = this.privacy?.consent?.provider || {};
    const country = provider.country ? ` (${regionName(provider.country)})` : '';
    return provider.kind === 'anthropic'
      ? `This assistant is an AI. To answer, your messages, attached files and the page you are on are sent to ${provider.name}${country}, the provider of the AI model Claude, and processed there on behalf of this website.`
      : `This assistant is an AI. To answer, your messages, attached files and the page you are on are sent to an AI server run by ${provider.name || 'Ligata'}${country} on behalf of this website. Nothing is stored there.`;
  },

  consentCard() {
    const p = this.privacy || {}, sum = p.summary;
    const api = p.engine === 'api';
    const revision = this.settings.privacy?.consentRevision || 1;
    const savedRevision = JSON.parse(this.saved || '{}').privacy?.consentRevision || 1;
    if (!p.required) return html`<section class="card">
      <header><div><h2>Consent</h2><p class="muted">Visitors are not asked before the AI reads their messages.</p></div><span class="pill warn"><i></i>Off</span></header>
      <div class="notice warning">${icon('warn')}<div>Consent is switched off in the site's configuration (<code>LigataAI:Privacy:RequireConsent</code> = false). Only do this with another legal basis confirmed by your data protection adviser, and describe that basis in your privacy policy.</div></div>
    </section>`;
    return html`<section class="card">
      <header><div><h2>Consent before the first question</h2><p class="muted">The AI receives nothing until a visitor agrees. Without consent, the chat with your team and the email form still work.</p></div><span class="pill ok"><i></i>Required</span></header>
      <dl class="facts">
        <dt>Visitors agree</dt><dd>${p.mode === 'cookiebot' ? html`in Cookiebot, category “${categories[p.category] || p.category}” <small class="muted">(in the chat itself when Cookiebot is missing on a page)</small>` : 'with a button in the chat'}</dd>
        <dt>Data goes to</dt><dd>${api ? 'Anthropic (USA), the provider of Claude' : html`${p.gpuOperator || 'the AI server operator'}${p.gpuOperatorCountry ? `, ${regionName(p.gpuOperatorCountry)}` : html` <span class="pill warn"><i></i>Country missing</span>`}`}</dd>
        <dt>Valid for</dt><dd>${number(p.consentDays)} days, then visitors are asked again</dd>
        <dt>Proof of consent</dt><dd>Kept ${number(p.keepDays)} days: a random id, the time and the text version. No IP address, no messages.</dd>
        ${sum ? html`<dt>Last 30 days</dt><dd>${number(sum.given)} agreed · ${number(sum.used)} asked a question · ${number(sum.withdrawn)} withdrew</dd>` : nothing}
      </dl>
      ${!api && !p.gpuOperatorCountry ? html`<div class="notice warning" style="margin-top:14px">${icon('warn')}<div>Visitors are told who runs the AI server. Add its country to the site's configuration, for example <code>"LigataAI": { "Privacy": { "GpuOperatorCountry": "CH" } }</code>.</div></div>` : nothing}
      <div class="section">${this.text('privacy.consentText', 'Text of the consent request', { rows: 3, max: 1500, help: html`Empty uses this default, translated into the visitor's language: “${this.defaultConsentText()}” Name the recipient if you write your own.${this.settings.privacy?.history ? ` With the history on, an unticked, optional box follows: “Keep my conversations (optional): this website may keep my conversations with the assistant for ${this.settings.privacy.historyDays} days after the last message so its team can check and improve the answers. The assistant works without it …”` : ''}` })}</div>
      <div class="row section">
        <button type="button" class="btn" ?disabled=${this.busy} @click=${() => { this.set('privacy.consentRevision', revision + 1); this.message = 'Visitors will be asked again once you save.'; }}>${icon('refresh')}Ask all visitors again</button>
        <small class="muted grow">${revision !== savedRevision ? 'Save to ask everyone again.' : 'Use this after the consent text or your privacy policy changed.'}</small>
      </div>
    </section>`;
  },

  historyCard() {
    const p = this.privacy || {};
    const on = !!this.settings.privacy?.history;
    const days = this.settings.privacy?.historyDays || 30;
    const saved = JSON.parse(this.saved || '{}').privacy || {};
    const changed = on && saved.history && days !== (saved.historyDays || 30);
    const stored = p.history?.stored || 0;
    const custom = this.settings.identity.privacyNotice !== this.defaults?.identity?.privacyNotice;
    return html`<section class="card">
      <header><div><h2>Conversation history</h2><p class="muted">With their permission, keep visitors' conversations with the AI, so your team can read what they ask and how the assistant answers, and improve your website where it did not know.</p></div>
        <span class="pill ${on ? 'ok' : ''}"><i></i>${on ? 'On' : 'Off'}</span></header>
      ${this.toggle('privacy.history', 'Keep a history of AI conversations', 'Off by default. Read them under AI conversations, next to the Inbox.')}
      ${on ? html`<div class="section">${this.text('privacy.historyDays', 'Delete conversations after (days)', { type: 'number', help: 'Counted from the last question, 1 to 365. Keep the period as short as your purpose allows; 30 days is usual. Single conversations can be kept longer from the AI conversations page.' })}</div>
      <dl class="facts">
        <dt>Kept</dt><dd>Questions, answers, what the AI looked up, names of attached files, page, language and times. No IP address, no files.</dd>
        <dt>Who can read them</dt><dd>Team members with access to the Inbox (user groups in <code>LigataAI:AgentGroups</code> and <code>EditorGroups</code>).</dd>
        <dt>Visitors</dt><dd>${p.required ? html`Decide themselves: an unticked, optional box under the consent request, or later under <i>Conversations</i>. The assistant works the same without it. <i>Stop keeping</i> or withdrawing consent deletes what was kept.` : html`Are told under the input and can object under <i>Conversations</i> (<i>Stop keeping</i>), which deletes what was kept.`} Single conversations can be deleted in the chat.</dd>
        <dt>Keeping longer</dt><dd>From the AI conversations page, for a stated reason (a complaint, a legal claim) and at most a year.</dd>
      </dl>` : nothing}
      ${changed && p.required ? html`<div class="notice warning" style="margin-top:14px">${icon('info')}<div>Visitors who agreed to the earlier period are asked again before new conversations are kept. Conversations already kept keep the period they were collected under.</div></div>` : nothing}
      ${on ? html`<div class="notice warning" style="margin-top:14px">${icon('warn')}<div>Update your privacy policy: the text below now describes the history. ${custom ? 'Your own notice under the input must not say that messages are not stored.' : 'The default notice under the input tells visitors how long conversations are kept.'}${p.required ? '' : ' Without consent, add the legal basis for the history to your privacy policy.'}</div></div>` : nothing}
      ${stored ? html`<small class="muted">${number(stored)} conversation${stored === 1 ? '' : 's'} stored${p.history.kept ? `, ${number(p.history.kept)} kept` : ''}${on ? '' : ': they are deleted when their period ends'}. <a href="/umbraco/section/ai-assistant/dashboard/conversations">Open AI conversations</a></small>` : nothing}
    </section>`;
  },

  noticeCard() {
    const url = this.settings.identity.privacyUrl;
    return html`<section class="card">
      <header><div><h2>Privacy notice</h2><p class="muted">Shown under the input and linked from the consent request.</p></div></header>
      ${this.text('identity.privacyNotice', 'Notice under the input', { rows: 2, max: 600, help: this.settings.identity.privacyNotice === this.defaults?.identity?.privacyNotice ? (this.api() ? `While you keep the default, visitors read “${this.connection.defaultPrivacyNotice}” in their language.` : 'While you keep the default, visitors read it in their language (English, German, French or Italian).') : 'Your own text is shown as written, in every language.' })}
      <div class="section">${this.text('identity.privacyUrl', 'Privacy policy link', { placeholder: '/datenschutz/' })}</div>
      ${!url ? html`<div class="notice warning">${icon('warn')}<div>Add the link to your privacy policy. Visitors should be able to read it before they agree.</div></div>` : nothing}
      <small class="muted">${this.settings.privacy?.history ? `Conversations with the AI are kept for ${number(this.settings.privacy.historyDays)} days (Conversation history).` : 'Conversations with the AI are not stored on the server.'} Conversations with your team are stored for the period set under Team &amp; email and then deleted. Visitors' IP addresses are pseudonymised and only used for limits.</small>
    </section>`;
  },

  cookiebotCard() {
    const p = this.privacy || {};
    const l = this.licensedFeatures();
    return html`<section class="card">
      <header><div><h2>Cookies and Cookiebot</h2><p class="muted">The chat sets no cookies. It keeps conversations in the browser's local storage, only once a visitor uses it.</p></div></header>
      ${p.cookiebotIgnore ? html`<div class="notice">${icon('info')}<div>The chat's script tag carries <code>data-cookieconsent="ignore"</code>, so Cookiebot's automatic blocking does not hide the chat bubble. The chat asks for consent itself.</div></div>` : nothing}
      <div class="section">
        <small class="muted">In the Cookiebot cookie declaration, classify these entries as <strong>Necessary</strong>: they only exist once a visitor uses the chat, and the chat needs them.</small>
        <dl class="facts">
          <dt><code>ligata-ai:v2:&lt;domain&gt;</code></dt><dd>Conversations, access keys to team conversations, whether the chat is open. HTML Local Storage, removed after inactivity.</dd>
          ${l.assistant && p.required ? html`<dt><code>ligata-ai:consent:&lt;domain&gt;</code></dt><dd>The visitor's consent to the AI assistant. HTML Local Storage, ${number(p.consentDays)} days or until withdrawn.</dd>` : nothing}
          ${l.assistant && this.settings.privacy?.history ? html`<dt><code>ligata-ai:forget:&lt;domain&gt;</code></dt><dd>Only while a deletion of a kept conversation could not reach the server: its key, sent again on the next page. HTML Local Storage, removed once deleted.</dd>` : nothing}
        </dl>
      </div>
      ${(l.assistant && p.required && p.mode !== 'cookiebot') || p.captcha ? html`<div class="section">
        ${l.assistant && p.required && p.mode !== 'cookiebot' ? html`<small class="muted">To manage the AI consent in Cookiebot instead, set <code>LigataAI:Privacy:ConsentMode</code> to <code>cookiebot</code> and choose the category with <code>CookiebotCategory</code>. Describe the AI assistant in that category's text.</small>` : nothing}
        ${p.captcha ? html`<small class="muted">Google reCAPTCHA (spam check for requests to your team) only loads after consent: ${p.captcha.mode === 'cookiebot' ? html`Cookiebot category “${categories[p.captcha.category] || p.captcha.category}”` : 'a checkbox in the form'}.</small>` : nothing}
      </div>` : nothing}
    </section>`;
  },

  policyCard() {
    const policy = this.policy;
    const language = this.policyLanguage || 'de';
    return html`<section class="card">
      <header><div><h2>Text for your privacy policy</h2><p class="muted">Written for this site's setup, including unsaved changes. A template, not legal advice: have it reviewed before you publish it.</p></div></header>
      <div class="row">
        <div class="segmented" role="group" aria-label="Language">${[['de', 'Deutsch'], ['en', 'English']].map(([value, label]) => html`<button type="button" aria-pressed=${String(language === value)} @click=${() => this.loadPolicy(value)}>${label}</button>`)}</div>
        <span class="grow"></span>
        <button type="button" class="btn small" ?disabled=${this.policyLoading} @click=${() => this.loadPolicy(language)}>${icon('refresh')}Update</button>
        <button type="button" class="btn small" ?disabled=${!policy?.text} @click=${() => this.downloadPolicy()}>${icon('file')}Download</button>
        <button type="button" class="btn small primary" ?disabled=${!policy?.text} @click=${() => this.copyPolicy()}>${icon('copy')}Copy</button>
      </div>
      ${policy?.error ? html`<div class="notice error">${icon('warn')}<div>${policy.error}</div></div>`
        : html`<pre class="code policy" aria-label="Privacy policy text" tabindex="0">${policy?.text || 'Loading…'}</pre>`}
      <ul class="checklist section">
        <li><span class="mark">${icon('edit')}</span><div class="grow"><small>Fill in the parts in [square brackets], for example your email provider and contact details.</small></div></li>
        ${this.effectiveFeatures().assistant ? html`<li><span class="mark">${icon('edit')}</span><div class="grow"><small>${this.api() ? 'Check Anthropic’s current terms (anthropic.com/legal) and keep its Data Processing Addendum with your records.' : 'Sign a data processing agreement (Art. 28 GDPR) with the operator of the AI server.'}</small></div></li>` : nothing}
        <li><span class="mark">${icon('edit')}</span><div class="grow"><small>Add the chat to your record of processing activities. The template also lives in the package under <code>docs/privacy</code>.</small></div></li>
      </ul>
    </section>`;
  },

  privacyView() {
    if (!this.policy && !this.policyLoading) queueMicrotask(() => this.loadPolicy());
    const l = this.licensedFeatures();
    return html`<div class="split">
      <div class="grid">
        ${l.assistant ? this.consentCard() : nothing}
        ${l.assistant ? this.historyCard() : nothing}
        ${this.noticeCard()}
        ${this.cookiebotCard()}
        ${this.policyCard()}
      </div>
      ${this.previewPane()}
    </div>`;
  },
};
