import { LitElement, html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { UmbElementMixin } from '@umbraco-cms/backoffice/element-api';
import { UMB_AUTH_CONTEXT } from '@umbraco-cms/backoffice/auth';
import { aiRequest, bearer } from './api.js?v=0.6.1';
import { styles } from './styles.js?v=0.6.1';
import { icon, controls } from './ui.js?v=0.6.1';
import { themes, colorFields } from './themes.js?v=0.6.1';
import { overviewView } from './view-overview.js?v=0.6.1';
import { appearanceView } from './view-appearance.js?v=0.6.1';
import { behaviourView } from './view-behaviour.js?v=0.6.1';
import { knowledgeView } from './view-knowledge.js?v=0.6.1';
import { connectionView } from './view-connection.js?v=0.6.1';
import { insightsView } from './view-insights.js?v=0.6.1';
import { teamView } from './view-team.js?v=0.6.1';
import { privacyView } from './view-privacy.js?v=0.6.1';

// A tab only appears when its feature is licensed for this installation (LigataAI:Features).
const tabs = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'behaviour', label: 'Behaviour', icon: 'sliders' },
  { id: 'team', label: 'Team & email', icon: 'team', needs: l => l.liveChat || l.email },
  { id: 'knowledge', label: 'Knowledge', icon: 'book', needs: l => l.assistant },
  { id: 'connection', label: 'Connection', icon: 'plug', needs: l => l.assistant },
  { id: 'privacy', label: 'Privacy', icon: 'shield' },
  { id: 'insights', label: 'Insights', icon: 'chart' },
];

class LigataAIDashboard extends UmbElementMixin(LitElement) {
  static properties = Object.fromEntries(['settings', 'version', 'saved', 'connection', 'knowledge', 'status', 'budget', 'stats', 'tab', 'busy', 'message', 'warning', 'error', 'errors', 'dragOver', 'editing', 'pages', 'pageFilter', 'index', 'searchQuery', 'device', 'siteTheme', 'keyInput', 'urlInput', 'loaded', 'statsDays', 'previewHtml', 'platform', 'inbox', 'privacy', 'policy', 'policyLanguage', 'policyLoading']
    .map(k => [k, { state: true }]));
  static styles = styles;

  constructor() {
    super();
    Object.assign(this, { tab: 'overview', busy: false, message: '', warning: '', error: '', errors: {}, knowledge: [], device: 'desktop', siteTheme: 'light', keyInput: '', urlInput: null, loaded: false, statsDays: 30, pageFilter: '', searchQuery: '' });
    this.consumeContext(UMB_AUTH_CONTEXT, auth => { this.auth = auth; this.run(() => this.load()); });
    this.unload = e => { if (this.dirty) { e.preventDefault(); e.returnValue = ''; } };
    // The preview iframe borrows the editor's login and current (unsaved) settings.
    window.__ligataAIPreviewAuth = () => bearer(this.auth);
    window.__ligataAIPreviewSettings = () => this.settings;
  }
  connectedCallback() { super.connectedCallback(); window.addEventListener('beforeunload', this.unload); this.poll = setInterval(() => this.tab === 'overview' && !document.hidden && this.refreshStatus(), 15000); }
  disconnectedCallback() { window.removeEventListener('beforeunload', this.unload); clearInterval(this.poll); super.disconnectedCallback(); }

  /** API mode: Claude via Anthropic, configured in appsettings (no gateway). */
  api() { return this.connection?.mode === 'api'; }
  engineName() { return this.api() ? (this.connection.claude?.modelName || 'Claude') : 'AI gateway'; }

  get dirty() { return this.loaded && JSON.stringify(this.settings) !== this.saved; }
  request(path, method, body, options) { return aiRequest(this.auth, path, method, body, options); }

  async run(callback, success) {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.errors = {};
    try { await callback(); if (success) { this.message = success; this.warning = ''; } }
    catch (e) { this.error = e.message; this.errors = e.errors || {}; }
    finally { this.busy = false; }
  }

  async load() {
    const data = await this.request();
    this.settings = data.settings; this.version = data.version; this.saved = JSON.stringify(data.settings);
    this.connection = data.connection; this.knowledge = data.knowledge; this.defaults = data.defaults; this.platform = data.platform; this.privacy = data.privacy;
    this.urlInput = data.connection.gatewayUrl;
    this.loaded = true;
    this.schedulePreview(true);
    if (this.licensedFeatures().assistant) this.refreshStatus();
    this.refreshBudget(); this.refreshInbox();
  }

  async refreshInbox() {
    const l = this.licensedFeatures();
    if (!l.liveChat && !l.email) return;
    try { this.inbox = await this.request('/inbox/summary'); } catch { this.inbox = null; }
  }

  async refreshStatus() {
    if (!this.licensedFeatures().assistant) return;
    try { this.status = await this.request('/status'); this.connection = this.status.connection; }
    catch (e) { this.status = { ok: false, code: 'error', message: e.message }; }
  }

  refreshBudget() {
    clearTimeout(this.budgetTimer);
    this.budgetTimer = setTimeout(async () => {
      try { this.budget = await this.request('/budget', 'POST', { settings: this.settings }); } catch { }
    }, 500);
  }

  async loadStats() { this.stats = await this.request(`/stats?days=${this.statsDays}`); }

  set(path, value) {
    const keys = path.split('.');
    const next = structuredClone(this.settings);
    let target = next;
    for (const key of keys.slice(0, -1)) target = target[key];
    target[keys.at(-1)] = value;
    if (path.startsWith('appearance.') && colorFields.some(([k]) => path === 'appearance.' + k)) next.appearance.theme = 'custom';
    this.settings = next;
    this.message = '';
    if (/^(behaviour|identity|features|support|knowledge)\./.test(path)) this.refreshBudget();
    if (this.errors[path]) { const { [path]: _, ...rest } = this.errors; this.errors = rest; }
    this.schedulePreview();
  }

  applyTheme(name) {
    const theme = themes[name];
    const { label, ...values } = theme;
    this.settings = { ...this.settings, appearance: { ...this.settings.appearance, ...values, theme: name } };
    this.message = '';
    this.schedulePreview();
  }

  async save() {
    // Empty rows from the list editors are not mistakes worth an error message.
    const clean = structuredClone(this.settings);
    clean.identity.suggestions = clean.identity.suggestions.map(s => s.trim()).filter(Boolean);
    clean.display.paths = clean.display.paths.map(s => s.trim()).filter(Boolean);
    this.settings = clean;
    const result = await this.request('/settings', 'POST', { settings: this.settings, version: this.version });
    this.version = result.version; this.saved = JSON.stringify(this.settings);
    if (this.tab === 'privacy') this.refreshPrivacy();
    this.message = this.settings.enabled ? 'Saved. Visitors see the changes on their next page view.' : 'Saved. The assistant is switched off on the website.';
  }

  async toggleLive(enabled) {
    const e = this.effectiveFeatures();
    if (enabled && !e.assistant && !e.liveChat && !e.email) { this.error = 'Switch on at least one feature under Team & email first.'; this.tab = 'team'; return; }
    if (enabled && e.assistant && (!this.connection?.keySource || this.connection.keySource === 'none')) { this.error = 'Add the API key under Connection before switching the AI assistant on (or switch the AI off under Team & email).'; this.tab = 'connection'; return; }
    this.set('enabled', enabled);
    await this.run(() => this.save(), enabled ? 'The assistant is live on the website.' : 'The assistant is switched off on the website.');
  }

  discard() { if (confirm('Discard unsaved changes?')) { this.settings = JSON.parse(this.saved); this.errors = {}; this.schedulePreview(); this.refreshBudget(); } }

  // ---------- context budget ----------
  get modelContext() { return this.status?.ok ? this.status.status.contextTokens : 0; }
  get budgetParts() {
    const b = this.settings.behaviour;
    const limit = Math.min(b.contextLimit, this.modelContext || b.contextLimit);
    const instructions = this.budget?.instructionTokens ?? 0;
    // Only "always known" items are read with every question; everything else is looked up within the answer's reserve.
    const knowledge = this.knowledge.filter(k => k.enabled && k.pinned).reduce((n, k) => n + k.tokens, 0);
    const answer = b.maxAnswerTokens + (this.budget?.lookupTokens ?? 0);
    const chat = Math.max(0, limit - instructions - knowledge - answer);
    return { limit, instructions, knowledge, answer, chat, over: instructions + knowledge + answer > limit, estimated: this.budget?.estimated || this.knowledge.some(k => k.estimated) };
  }

  // ---------- preview ----------
  // The iframe reloads only when the document changes, debounced while the editor types.
  schedulePreview(now) { clearTimeout(this.previewTimer); this.previewTimer = setTimeout(() => { this.previewHtml = this.previewDocument(); }, now ? 0 : 350); }
  previewDocument() {
    const s = this.settings, i = s.identity, b = s.behaviour;
    const parts = this.budgetParts;
    const f = this.effectiveFeatures(), t = s.support, c = s.contact;
    // Same shape as the public settings; team requests are simulated in the preview (nothing reaches the Inbox).
    const d = this.defaults?.identity || {};
    const publicSettings = { name: i.name, greeting: f.assistant || i.greeting !== d.greeting ? i.greeting : '', suggestions: i.suggestions.filter(x => x.trim()), avatarUrl: i.avatarUrl, language: i.language, inputPlaceholder: i.inputPlaceholder, privacyNotice: i.privacyNotice !== d.privacyNotice ? i.privacyNotice : '', privacyUrl: i.privacyUrl, fallbackMessage: i.fallbackMessage, fallbackEmail: i.fallbackEmail, fallbackUrl: i.fallbackUrl, appearance: s.appearance, allowImages: b.allowImages, allowPdfs: b.allowPdfs, contextLimit: parts.limit, baseTokens: parts.instructions + parts.knowledge, limits: {},
      features: { assistant: f.assistant, liveChat: f.liveChat, email: f.email }, engine: f.assistant ? this.connection?.mode || 'gpu' : null,
      team: f.liveChat || f.email ? { teamName: t.teamName, suggest: t.suggestWhenUnsure && f.assistant, button: t.showTeamButton, nameField: t.nameField, emailField: t.emailField, emailWhenOffline: t.requireEmailWhenOffline, waitingMessage: t.waitingMessage, offlineMessage: t.offlineMessage, privacyNotice: t.privacyNotice, days: t.inactivityDays } : null,
      contact: f.email ? { title: c.title, intro: c.intro, nameField: c.nameField, successMessage: c.successMessage } : null, captcha: null,
      // The consent request as visitors will see it; "Ask all visitors again" changes the version, so the preview asks again too.
      consent: f.assistant && this.privacy?.consent ? { ...this.privacy.consent, text: s.privacy?.consentText || '', version: this.privacy.consent.version.replace(/^(\w+)\.\d+\./, `$1.${s.privacy?.consentRevision || 1}.`) } : null };
    const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const dark = this.siteTheme === 'dark';
    return `<!doctype html><html lang="${i.language === 'auto' ? 'en' : i.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview</title>
      <style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:${dark ? '#0f1115' : '#f7f7f5'};color:${dark ? '#e8e9ee' : '#1c1d22'}}
      .nav{display:flex;align-items:center;gap:28px;padding:18px 32px;border-bottom:1px solid ${dark ? '#23262e' : '#e7e7e3'}}.logo{width:30px;height:30px;border-radius:8px;background:${dark ? '#3a3f4b' : '#d9d9d4'}}.nav span{width:62px;height:9px;border-radius:9px;background:${dark ? '#2b2f39' : '#e1e1dc'}}
      .hero{padding:72px 32px 24px;max-width:760px}.hero h1{font-size:40px;line-height:1.1;letter-spacing:-1px;margin:0 0 16px}.hero p{font-size:18px;line-height:1.6;opacity:.7;margin:0}
      .lines{padding:24px 32px;display:grid;gap:12px;max-width:760px}.lines i{display:block;height:10px;border-radius:10px;background:${dark ? '#22252d' : '#e6e6e1'}}.lines i:nth-child(3n){width:70%}</style></head>
      <body><div class="nav"><div class="logo"></div><span></span><span></span><span></span></div><div class="hero"><h1>${attr(b.siteName || 'Your website')}</h1><p>This is a preview page. The assistant below uses your current settings, including changes you have not saved yet.</p></div><div class="lines">${'<i></i>'.repeat(9)}</div>
      <script src="/assets/ligata-ai/ligata-ai.js?v=0.6.1&p=${Date.now()}" data-ligata-ai data-preview="true" data-open="true" data-api="/umbraco/management/api/v1/ligata-ai" data-settings="${attr(JSON.stringify(publicSettings))}"></script></body></html>`;
  }
  previewPane() {
    return html`<aside class="preview">
      <div class="row"><strong class="grow">Live preview</strong>
        <div class="segmented" role="group" aria-label="Preview size"><button type="button" aria-pressed=${String(this.device === 'desktop')} @click=${() => this.device = 'desktop'} title="Desktop">${icon('monitor')}</button><button type="button" aria-pressed=${String(this.device === 'mobile')} @click=${() => this.device = 'mobile'} title="Mobile">${icon('phone')}</button></div>
        <div class="segmented" role="group" aria-label="Preview page colours"><button type="button" aria-pressed=${String(this.siteTheme === 'light')} @click=${() => { this.siteTheme = 'light'; this.schedulePreview(); }} title="Light page">${icon('sun')}</button><button type="button" aria-pressed=${String(this.siteTheme === 'dark')} @click=${() => { this.siteTheme = 'dark'; this.schedulePreview(); }} title="Dark page">${icon('moon')}</button></div>
        <button type="button" class="icon-btn" title="Clear test conversation" @click=${() => { window.__ligataAIPreviewState = null; this.schedulePreview(true); }}>${icon('refresh')}</button>
      </div>
      <div class="frame ${this.device}"><iframe title="Assistant preview" .srcdoc=${this.previewHtml || ''}></iframe></div>
      <small>Chats in the preview are real answers from ${this.api() ? this.engineName() : 'the AI gateway'}, using your saved knowledge and the settings shown here. They are not counted in Insights${this.api() ? ', but they do count towards the daily question limit' : ''}.</small>
    </aside>`;
  }

  render() {
    if (!this.loaded) return html`<div class="workspace">${this.error ? html`<div class="notice error">${icon('warn')}<div><strong>Could not load the assistant settings</strong><p>${this.error}</p></div></div>` : html`<div class="empty">${icon('refresh', 'spin')}<p>Loading…</p></div>`}</div>`;
    const live = this.settings.enabled;
    const knowledgeCount = this.knowledge.filter(k => k.kind !== 'page').length;
    return html`<div class="workspace">
      <div class="top">
        <div class="title"><span class="eyebrow">Ligata AI</span><h1>${this.licensedFeatures().assistant ? 'Website assistant' : 'Website chat'}</h1>
          <div class="row">${this.statusPill()}<span class="pill ${live ? 'ok' : ''}"><i></i>${live ? 'Live on the website' : 'Not shown on the website'}</span>${this.dirty ? html`<span class="pill warn"><i></i>Unsaved changes</span>` : nothing}</div></div>
        <div class="row">
          <label class="switch"><input type="checkbox" .checked=${live} ?disabled=${this.busy} @change=${e => this.toggleLive(e.target.checked)}><span>Show on website</span></label>
          ${this.dirty ? html`<button class="btn quiet" ?disabled=${this.busy} @click=${this.discard}>Discard</button>` : nothing}
          <button class="btn primary" ?disabled=${this.busy || !this.dirty} @click=${() => this.run(() => this.save())}>${icon('save')}${this.busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
      ${this.message ? html`<div class="notice success" role="status">${icon('check')}<div>${this.message}</div><button class="icon-btn" aria-label="Dismiss" @click=${() => this.message = ''}>${icon('close')}</button></div>` : nothing}
      ${this.warning ? html`<div class="notice warning" role="status">${icon('warn')}<div>${this.warning}</div><button class="icon-btn" aria-label="Dismiss" @click=${() => this.warning = ''}>${icon('close')}</button></div>` : nothing}
      ${this.error ? html`<div class="notice error" role="alert">${icon('warn')}<div><strong>Please check</strong><p>${this.error}</p>${Object.keys(this.errors).length ? html`<ul>${Object.values(this.errors).map(v => html`<li>${v}</li>`)}</ul>` : nothing}</div><button class="icon-btn" aria-label="Dismiss" @click=${() => { this.error = ''; }}>${icon('close')}</button></div>` : nothing}
      <nav class="tabs" aria-label="Assistant settings">${tabs.filter(t => !t.needs || t.needs(this.licensedFeatures())).map(t => html`<button aria-current=${this.tab === t.id ? 'page' : 'false'} @click=${() => { this.tab = t.id; if (t.id === 'insights') this.run(() => this.loadStats()); if (t.id === 'overview' || t.id === 'connection') this.refreshStatus(); if (t.id === 'overview' || t.id === 'team') this.refreshInbox(); if (t.id === 'privacy') { this.refreshPrivacy(); this.loadPolicy(); } if (t.id === 'knowledge') this.loadIndex(); }}>${icon(t.icon)}${t.label}${t.id === 'knowledge' && knowledgeCount ? html`<span class="count">${knowledgeCount}</span>` : nothing}</button>`)}</nav>
      ${this.tab === 'overview' ? this.overviewView() : this.tab === 'appearance' ? this.appearanceView() : this.tab === 'behaviour' ? this.behaviourView() : this.tab === 'team' ? this.teamView() : this.tab === 'knowledge' ? this.knowledgeView() : this.tab === 'connection' ? this.connectionView() : this.tab === 'privacy' ? this.privacyView() : this.insightsView()}
    </div>`;
  }

  statusPill() {
    if (!this.licensedFeatures().assistant) return this.inbox ? html`<span class="pill ${this.inbox.online ? 'ok' : ''}"><i></i>${this.inbox.online} team member${this.inbox.online === 1 ? '' : 's'} online</span>` : nothing;
    if (!this.status) return html`<span class="pill"><i></i>Checking ${this.api() ? 'Claude' : 'AI gateway'}…</span>`;
    if (!this.status.ok) return html`<span class="pill bad" title=${this.status.message || ''}><i></i>${this.status.code === 'not_configured' ? (this.api() ? 'No API key' : 'Not connected') : this.status.code === 'invalid_key' ? 'Key rejected' : this.api() ? 'Claude unreachable' : 'AI gateway offline'}</span>`;
    const s = this.status.status;
    if (s.engine === 'api') return s.state === 'busy' ? html`<span class="pill warn"><i></i>Claude busy</span>` : html`<span class="pill ok"><i></i>AI online · ${s.model}</span>`;
    if (s.state !== 'ready') return html`<span class="pill warn"><i></i>Model ${s.state === 'loading' ? 'starting' : 'offline'}</span>`;
    if (!s.gpuHealthy) return html`<span class="pill warn"><i></i>GPU memory warning</span>`;
    return html`<span class="pill ok"><i></i>AI online${s.queueWaiting ? ` · ${s.queueWaiting} waiting` : ''}</span>`;
  }
}
Object.assign(LigataAIDashboard.prototype, controls, overviewView, appearanceView, behaviourView, knowledgeView, connectionView, insightsView, teamView, privacyView);
customElements.define('ligata-ai-dashboard', LigataAIDashboard);
export default LigataAIDashboard;
