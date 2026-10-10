import { LitElement, html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { aiRequest } from '../api.js?v=0.13.4';
import { panelStyles } from './panel-styles.js?v=0.13.4';
import { glyph, kindIcon, stepIcon, documentPath, openDocument, go, markdown, diff, stream, when, modeInfo, effortInfo } from './shared.js?v=0.13.4';

const store = {
  get(key, fallback) { try { const v = localStorage.getItem('ligata-ai-editor:' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('ligata-ai-editor:' + key, JSON.stringify(value)); } catch { } },
};
const maxImageBytes = 5 * 1024 * 1024;

/**
 * The content assistant: a chat at the bottom right of the backoffice that finds, reads and changes content with tools.
 * Mounted once (backofficeEntryPoint), so a conversation survives moving through the backoffice. Changes appear as cards
 * with before and after; in Manual mode (and for risky changes in Auto) they wait for Approve or Decline.
 */
export class LigataAIEditorPanel extends LitElement {
  static properties = Object.fromEntries(['open', 'expanded', 'session', 'chatId', 'title', 'items', 'busy', 'thinking', 'waiting', 'mode', 'effort', 'images', 'page', 'view', 'error', 'decisions', 'noting', 'collapsed', 'menu', 'contextInfo', 'off', 'privacyNote']
    .map(k => [k, { state: true }]));
  static styles = panelStyles;

  constructor() {
    super();
    Object.assign(this, { open: store.get('open', false), expanded: store.get('expanded', false), items: [], busy: false, thinking: false, waiting: false, images: [], view: 'chat', error: '', decisions: {}, noting: null, collapsed: {}, menu: null });
    this.onKey = e => { if (e.key === 'Escape' && this.menu) { this.menu = null; return; } if (e.key === 'Escape' && this.open && this.matches(':focus-within') && !this.busy) this.toggle(false); };
    // An open menu (mode, effort) closes when clicking anywhere else.
    this.onPointer = e => { if (this.menu && !e.composedPath().some(n => n.classList?.contains('chooser'))) this.menu = null; };
  }

  /** Called by the entry point with the backoffice's contexts. */
  init(auth, events, entityEvents) {
    this.auth = auth; this.events = events; this.entityEvents = entityEvents;
    this.load();
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('pointerdown', this.onPointer, true);
    this.route = setInterval(() => this.watchRoute(), 700);
  }
  disconnectedCallback() { window.removeEventListener('keydown', this.onKey); window.removeEventListener('pointerdown', this.onPointer, true); clearInterval(this.route); this.controller?.abort(); super.disconnectedCallback(); }

  request(path, method, body) { return aiRequest(this.auth, '/editor' + path, method, body, { timeout: 30000 }); }

  async load() {
    try { this.session = await this.request('/session'); }
    catch (e) { this.session = null; return; }
    this.off = !this.session.available && !(this.session.admin && this.session.reason === 'not_configured');
    if (this.off) return;
    this.mode = this.session.mode;
    this.effort = store.get('effort', this.session.effort);
    if (!this.session.efforts?.includes(this.effort)) this.effort = this.session.effort;
    const last = store.get('chat', null);
    if (last && this.session.chats?.some(c => c.id === last)) await this.openChat(last, true);
    this.watchRoute(true);
  }

  // ---------- where the editor is ----------
  async watchRoute(force) {
    const doc = openDocument();
    const id = doc ? doc.key + '|' + (doc.culture || '') : '';
    if (!force && id === this.routeId) return;
    this.routeId = id;
    if (!doc) { this.page = null; return; }
    try { this.page = { ...doc, ...(await this.request(`/page?key=${doc.key}${doc.culture ? '&culture=' + encodeURIComponent(doc.culture) : ''}`)) }; }
    catch { this.page = { ...doc, name: '' }; }
  }

  // ---------- conversations ----------
  async openChat(id, quiet) {
    try {
      const chat = await this.request('/chats/' + id);
      Object.assign(this, { chatId: chat.id, title: chat.title, items: chat.items || [], mode: this.session.modes.includes(chat.mode) ? chat.mode : this.mode, waiting: chat.waiting, contextInfo: chat.context, view: 'chat', decisions: {}, error: '' });
      store.set('chat', chat.id);
      this.scrollDown(true);
    } catch (e) { if (!quiet) this.error = e.message; store.set('chat', null); }
  }

  newChat() {
    if (this.busy) return;
    Object.assign(this, { chatId: null, title: '', items: [], waiting: false, decisions: {}, error: '', view: 'chat', contextInfo: null });
    store.set('chat', null);
    requestAnimationFrame(() => this.renderRoot.querySelector('textarea')?.focus());
  }

  async deleteChat(id) {
    if (!confirm('Delete this conversation? The activity log keeps what the assistant changed.')) return;
    try { await this.request('/chats/' + id, 'DELETE'); } catch { }
    if (id === this.chatId) this.newChat();
    await this.refreshSession();
  }

  async refreshSession() { try { this.session = { ...this.session, ...(await this.request('/session')) }; } catch { } }

  toggle(value = !this.open) {
    this.open = value; store.set('open', value);
    if (value) { this.watchRoute(true); requestAnimationFrame(() => { this.renderRoot.querySelector('textarea')?.focus(); this.scrollDown(true); }); }
  }
  toggleExpanded() { this.expanded = !this.expanded; store.set('expanded', this.expanded); this.scrollDown(true); }

  setMode(mode) { this.mode = mode; this.menu = null; }
  setEffort(effort) { this.effort = effort; store.set('effort', effort); this.menu = null; }

  // ---------- sending ----------
  async send(text) {
    text = (text ?? this.renderRoot.querySelector('textarea')?.value ?? '').trim();
    if ((!text && !this.images.length) || this.busy) return;
    if (this.waiting && !confirm('Changes are waiting for your approval. Send anyway? They will be declined.')) return;
    const textarea = this.renderRoot.querySelector('textarea');
    if (textarea) { textarea.value = ''; this.autosize(textarea); }
    const images = this.images; this.images = [];
    const body = { chatId: this.chatId, message: text, mode: this.mode, effort: this.effort, page: this.page ? { key: this.page.key, culture: this.page.culture } : null, images: images.map(i => ({ name: i.name, data: i.data })) };
    this.view = 'chat';
    await this.run('/editor/message', body, () => { this.images = images; if (textarea && !textarea.value) textarea.value = text; });
  }

  async decide(decisions) {
    if (this.busy || !this.chatId) return;
    this.decisions = {}; this.noting = null;
    await this.run('/editor/decide', { chatId: this.chatId, decisions, mode: this.mode, page: this.page ? { key: this.page.key, culture: this.page.culture } : null });
  }

  async run(path, body, restore) {
    this.busy = true; this.thinking = true; this.error = ''; this.waiting = false;
    this.controller = new AbortController();
    try {
      await stream(this.auth, path, body, (name, data) => this.event(name, data), this.controller.signal);
    } catch (e) {
      if (e.name !== 'AbortError') { this.error = e.message; restore?.(); }
    } finally {
      this.busy = false; this.thinking = false; this.controller = null;
      this.items = this.items.map(i => i.type === 'step' && i.state === 'running' ? { ...i, state: 'stopped' } : i);
      this.refreshSession();
    }
  }

  stop() { this.controller?.abort(); }

  event(name, data) {
    switch (name) {
      case 'chat':
        this.chatId = data.id; this.title = data.title; store.set('chat', data.id);
        if (data.mode && data.mode !== this.mode) this.mode = data.mode;
        break;
      case 'item': {
        const at = this.items.findIndex(i => i.id === data.id);
        // A streamed answer keeps the text it already shows until the final item arrives.
        this.items = at >= 0 ? this.items.map((i, j) => j === at ? data : i) : [...this.items, data];
        if (data.type !== 'user') this.thinking = false;
        break;
      }
      case 'delta':
        this.thinking = false;
        this.items = this.items.map(i => i.id === data.id ? { ...i, text: (i.text || '') + data.text } : i);
        break;
      case 'thinking': this.thinking = true; break;
      case 'navigate': go(documentPath(data.key, data.culture)); break;
      case 'refresh': this.refreshEntity(data); break;
      case 'waiting': this.waiting = true; this.thinking = false; break;
      case 'done': this.thinking = false; if (data.context) this.contextInfo = data.context; break;
      case 'error': this.thinking = false; break;
    }
    // A change that waits for approval is always brought into view.
    this.scrollDown(name === 'waiting');
  }

  /** Tell the backoffice what changed: the open editor reloads the page, the tree its branch. */
  refreshEntity({ key, parent, entity }) {
    if (!this.events || !this.entityEvents) return;
    const { UmbEntityUpdatedEvent, UmbRequestReloadStructureForEntityEvent, UmbRequestReloadChildrenOfEntityEvent } = this.entityEvents;
    const type = entity === 'media' ? 'media' : 'document';
    try {
      if (key) {
        this.events.dispatchEvent(new UmbEntityUpdatedEvent({ unique: key, entityType: type, eventUnique: 'ligata-ai-editor' }));
        this.events.dispatchEvent(new UmbRequestReloadStructureForEntityEvent({ unique: key, entityType: type }));
      }
      this.events.dispatchEvent(new UmbRequestReloadChildrenOfEntityEvent({ unique: parent || null, entityType: parent ? type : type + '-root' }));
    } catch (e) { console.warn('Ligata AI: could not refresh the backoffice', e); }
  }

  scrollDown(force) {
    const log = this.renderRoot.querySelector('.log');
    // Measured before the new content renders: following the conversation only when the editor was at its end.
    const near = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 160;
    if (!force && !near) return;
    // Again once cards have rendered (they grow while their content arrives).
    const down = () => { const l = this.renderRoot.querySelector('.log'); if (l) l.scrollTop = l.scrollHeight; };
    requestAnimationFrame(down);
    setTimeout(down, 120);
  }

  // ---------- approvals ----------
  get pending() { return this.items.filter(i => i.type === 'change' && i.state === 'pending'); }

  choose(item, approve) {
    const decisions = { ...this.decisions, [item.id]: { id: item.id, approve, note: approve ? null : (this.decisions[item.id]?.note || null) } };
    this.decisions = decisions;
    if (!approve) this.noting = null;
    const pending = this.pending;
    // Once every waiting change has an answer, the assistant continues.
    if (pending.every(p => decisions[p.id])) this.decide(pending.map(p => decisions[p.id]));
  }

  async undo(item) {
    const id = item.change?.actionId;
    if (!id || !confirm('Undo this change? The values from before are put back as a draft.')) return;
    try {
      await this.request(`/activity/${id}/undo`, 'POST');
      this.items = this.items.map(i => i.id === item.id ? { ...i, state: 'undone' } : i);
      this.refreshEntity({ key: item.change.documentKey, entity: item.change.kind === 'media' ? 'media' : 'document' });
    } catch (e) { this.error = e.message; }
  }

  // ---------- composer ----------
  autosize(textarea) { textarea.style.height = 'auto'; textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px'; }

  keydown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
  }

  async addFiles(files) {
    for (const file of [...files]) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { this.error = 'Only PNG, JPEG, WebP and GIF images can be attached.'; continue; }
      if (file.size > maxImageBytes) { this.error = `${file.name} is larger than 5 MB.`; continue; }
      if (this.images.length >= 4) { this.error = 'At most four images per message.'; break; }
      const data = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(file); });
      this.images = [...this.images, { name: file.name || 'image.png', data }];
    }
  }

  paste(e) {
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); this.addFiles(files); }
  }

  openPage(key, culture) { go(documentPath(key, culture || (this.page?.key === key ? this.page.culture : null))); }

  // ---------- rendering ----------
  render() {
    if (this.off || !this.session) return nothing;
    const available = this.session.available;
    return html`
      ${!this.open ? html`<button class="launcher" @click=${() => this.toggle(true)} aria-label="Open the content assistant" title="Content assistant">
        ${glyph('sparkle')}${this.pending.length ? html`<span class="badge">${this.pending.length}</span>` : nothing}</button>` : nothing}
      <section class="panel ${this.open ? 'open' : ''} ${this.expanded ? 'docked' : ''}" role="dialog" aria-label="Content assistant" aria-hidden=${String(!this.open)}>
        ${this.header()}
        ${!available ? this.unavailable() : this.view === 'history' ? this.history() : this.view === 'privacy' ? this.privacy() : this.conversation()}
      </section>`;
  }

  header() {
    const s = this.session;
    return html`<header>
      <span class="mark">${glyph('sparkle')}</span>
      <div class="title">
        <strong>${this.view === 'history' ? 'Conversations' : this.view === 'privacy' ? 'Privacy note' : this.title || 'Content assistant'}</strong>
        <span class="sub">${s.model}${this.busy ? html` · <span class="live">working</span>` : this.waiting ? html` · <span class="wait">waiting for you</span>` : nothing}</span>
      </div>
      <button class="icon" title="Conversations" aria-label="Conversations" aria-pressed=${String(this.view === 'history')} @click=${() => { this.view = this.view === 'history' ? 'chat' : 'history'; if (this.view === 'history') this.refreshSession(); }}>${glyph('history')}</button>
      <button class="icon" title="New conversation" aria-label="New conversation" ?disabled=${this.busy} @click=${() => this.newChat()}>${glyph('plus')}</button>
      <button class="icon" title=${this.expanded ? 'Smaller' : 'Larger'} aria-label=${this.expanded ? 'Smaller' : 'Larger'} @click=${() => this.toggleExpanded()}>${glyph(this.expanded ? 'collapse' : 'expand')}</button>
      <button class="icon" title="Close" aria-label="Close" @click=${() => this.toggle(false)}>${glyph('close')}</button>
    </header>`;
  }

  unavailable() {
    return html`<div class="empty"><span class="hero">${glyph('warn')}</span><h3>Almost ready</h3>
      <p>The content assistant needs an Anthropic API key. Add it under <a href="/umbraco/section/ai-assistant/dashboard/settings?tab=connection" @click=${e => { e.preventDefault(); go('/umbraco/section/ai-assistant/dashboard/settings?tab=connection'); }}>AI Assistant → Settings → Connection</a>.</p></div>`;
  }

  history() {
    const chats = this.session.chats || [];
    return html`<div class="list">
      ${chats.length === 0 ? html`<div class="empty small"><p>No conversations yet.</p></div>` : chats.map(c => html`
        <div class="chat-row ${c.id === this.chatId ? 'current' : ''}">
          <button class="chat-open" @click=${() => this.openChat(c.id)}><span class="chat-title">${c.title || 'Conversation'}</span><span class="chat-meta">${when(c.updated)} · ${modeInfo[c.mode]?.label || c.mode}</span></button>
          <button class="icon small" title="Delete" aria-label="Delete conversation" @click=${() => this.deleteChat(c.id)}>${glyph('trash')}</button>
        </div>`)}
      <p class="list-note">Conversations are kept for ${this.session.keepDays || 'a limited number of'} days. Only you see yours; what the assistant changed is in the activity log. <button class="link" @click=${() => this.showPrivacy()}>Privacy note</button></p>
    </div>`;
  }

  /** The privacy note for staff (what goes to Anthropic, who sees what, how long), in the editor's backoffice language. */
  async showPrivacy() {
    this.view = 'privacy';
    this.privacyNote = await this.request('/privacy').catch(e => ({ error: e.message }));
  }

  privacy() {
    const note = this.privacyNote;
    return html`<div class="list"><div class="msg ai note">
      ${!note ? html`<p class="muted">Loading…</p>` : note.error ? html`<p class="problem">${glyph('warn')}<span>${note.error}</span></p>` : html`<div class="text">${markdown(note.text)}</div>`}
      <p><button class="btn quiet" @click=${() => this.view = 'chat'}>${glyph('back')}Back to the chat</button></p>
    </div></div>`;
  }

  conversation() {
    return html`
      <div class="log" @scroll=${() => { }}>
        ${this.items.length === 0 ? this.welcome() : this.groups().map(g => g.steps ? this.steps(g) : this.item(g.item))}
        ${this.thinking ? html`<div class="thinking" aria-live="polite"><span></span><span></span><span></span><em>${this.items.some(i => i.type === 'step' && i.state === 'running') ? 'Working' : 'Thinking'}</em></div>` : nothing}
        ${this.error ? html`<div class="problem" role="alert">${glyph('warn')}<span>${this.error}</span><button class="icon small" aria-label="Dismiss" @click=${() => this.error = ''}>${glyph('close')}</button></div>` : nothing}
      </div>
      ${this.pending.length > 1 && !this.busy ? html`<div class="approve-bar">${glyph('hand')}<span>${this.pending.length} changes wait for you</span>
        <button class="btn quiet" @click=${() => this.decide(this.pending.map(p => ({ id: p.id, approve: false })))}>Decline all</button>
        <button class="btn primary" ?disabled=${this.mode === 'readonly'} title=${this.mode === 'readonly' ? 'Read only changes nothing: switch the mode to approve.' : ''} @click=${() => this.decide(this.pending.map(p => ({ id: p.id, approve: true })))}>Approve all</button></div>` : nothing}
      ${this.composer()}`;
  }

  /** Consecutive steps are shown as one group (collapsed when there are many). */
  groups() {
    const groups = [];
    for (const item of this.items) {
      if (item.type === 'step') {
        const last = groups.at(-1);
        if (last?.steps) last.steps.push(item); else groups.push({ id: item.id, steps: [item] });
      } else groups.push({ item });
    }
    return groups;
  }

  welcome() {
    const page = this.page?.name;
    const ideas = page
      ? [`What is on “${page}”?`, `Check “${page}” for spelling and grammar mistakes`, `Make the introduction of “${page}” shorter`, 'Which pages are not published yet?']
      : ['Where is the page with our opening hours?', 'Which pages mention our phone number?', 'Which pages are not published yet?', this.mode === 'readonly' ? 'Where do we write about …' : 'Create a news article draft about …'];
    return html`<div class="empty">
      <span class="hero">${glyph('sparkle')}</span>
      <h3>How can I help with the content?</h3>
      <p>${this.mode === 'readonly' ? 'I find pages, read them and answer questions about the content. Read only: nothing is changed.' : html`I find pages, read them and make changes${this.session.actions?.includes('publish') ? '' : ' as drafts'}. ${modeInfo[this.mode]?.text || ''}`}</p>
      <div class="ideas">${ideas.map(i => html`<button @click=${() => i.endsWith('…') ? this.prefill(i.replace(' …', ' ')) : this.send(i)}>${i}</button>`)}</div>
      <p class="fine">What you write and the content it reads are sent to Anthropic (USA). <button class="link" @click=${() => this.showPrivacy()}>Privacy note</button></p>
    </div>`;
  }

  prefill(text) { const t = this.renderRoot.querySelector('textarea'); if (t) { t.value = text; t.focus(); this.autosize(t); } }

  item(item) {
    switch (item.type) {
      case 'user': return html`<div class="msg user">
          ${item.page ? html`<span class="on">${glyph('page')}${item.page.name}${item.page.culture ? html` · ${item.page.culture}` : nothing}</span>` : nothing}
          <div class="bubble">${item.text}${item.images?.length ? html`<div class="files">${item.images.map(n => html`<span class="file">${glyph('photo')}${n}</span>`)}</div>` : nothing}</div></div>`;
      case 'assistant': return item.text?.trim() || item.state === 'stopped' ? html`<div class="msg ai ${item.state === 'stopped' ? 'stopped' : ''}">
          <div class="text">${markdown(item.text, key => this.openPage(key))}${item.state === 'stopped' ? html`<span class="muted"> (stopped)</span>` : nothing}</div></div>` : nothing;
      case 'change': return this.card(item);
      case 'notice': return html`<div class="notice ${item.state || ''}">${glyph(item.state === 'running' ? 'sparkle' : 'info', item.state === 'running' ? 'spin' : '')}<span>${item.text}</span></div>`;
      case 'error': return html`<div class="problem">${glyph('warn')}<span>${item.text}</span></div>`;
      default: return nothing;
    }
  }

  steps(group) {
    const steps = group.steps;
    const running = steps.some(s => s.state === 'running');
    const long = steps.length > 3 && !running;
    const open = this.collapsed[group.id] ?? !long;
    const shown = open ? steps : [];
    return html`<div class="steps">
      ${long ? html`<button class="steps-toggle" aria-expanded=${String(open)} @click=${() => this.collapsed = { ...this.collapsed, [group.id]: !open }}>${glyph('chevron', open ? 'turned' : '')}${steps.length} steps · ${[...new Set(steps.map(s => s.text?.split(' ')[0]))].slice(0, 3).join(', ')}</button>` : nothing}
      ${shown.map(s => html`<div class="step ${s.state}">
        <span class="step-icon">${s.state === 'running' ? html`<i class="spinner"></i>` : glyph(s.state === 'failed' ? 'warn' : stepIcon(s.tool))}</span>
        <span class="step-text">${s.page ? html`<a href=${documentPath(s.page.key, s.page.culture)} @click=${e => { e.preventDefault(); this.openPage(s.page.key, s.page.culture); }}>${s.text}</a>` : s.text}${s.detail ? html`<span class="step-detail"> · ${s.detail}</span>` : nothing}</span>
      </div>`)}
    </div>`;
  }

  card(item) {
    const c = item.change || {};
    const state = item.state;
    const badge = {
      pending: html`<span class="badge wait">${glyph('hand')}Needs your approval</span>`,
      queued: html`<span class="badge">Waits for the change above</span>`,
      running: html`<span class="badge live"><i class="spinner"></i>Saving</span>`,
      done: html`<span class="badge ok">${glyph('check')}${c.kind === 'publish' ? 'Published' : c.kind === 'unpublish' ? 'Unpublished' : c.kind === 'delete' ? 'In the recycle bin' : c.kind === 'create' ? 'Created as draft' : c.kind === 'media' ? 'Uploaded' : c.kind === 'move' ? 'Moved' : 'Saved as draft'}${c.approval === 'auto' ? ' · auto' : c.approval === 'bypass' ? ' · bypass' : c.approval === 'manual' ? ' · approved' : ''}</span>`,
      failed: html`<span class="badge bad">${glyph('warn')}Not done</span>`,
      declined: html`<span class="badge">${glyph('xCircle')}Declined</span>`,
      undone: html`<span class="badge">${glyph('undo')}Undone</span>`,
    }[state] || nothing;
    const decided = this.decisions[item.id];
    return html`<article class="card ${state} kind-${c.kind}">
      <div class="card-head">
        <span class="card-icon">${glyph(kindIcon(c.kind))}</span>
        <div class="card-title"><strong>${c.title}</strong>${badge}</div>
      </div>
      ${c.changes?.length ? html`<div class="changes">${c.changes.map(ch => this.change(ch, c))}</div>` : nothing}
      ${c.notes?.length ? html`<ul class="notes">${c.notes.map(n => html`<li>${glyph('info')}${n}</li>`)}</ul>` : nothing}
      ${(state === 'pending' || state === 'declined') && c.reason ? html`<p class="reason">${c.reason}</p>` : nothing}
      ${state === 'failed' && item.detail ? html`<p class="reason bad">${item.detail}</p>` : nothing}
      ${state === 'declined' && item.detail ? html`<p class="reason">Your note: ${item.detail}</p>` : nothing}
      ${state === 'pending' && !this.busy ? html`<div class="card-actions">
          ${this.noting === item.id ? html`<input class="note" placeholder="What should it do instead? (optional)" .value=${decided?.note || ''} @input=${e => this.decisions = { ...this.decisions, [item.id]: { id: item.id, approve: false, note: e.target.value, draft: true } }} @keydown=${e => { if (e.key === 'Enter') this.choose(item, false); if (e.key === 'Escape') this.noting = null; }}>
              <button class="btn quiet" @click=${() => this.choose(item, false)}>Decline</button>`
            : html`<button class="btn quiet" @click=${() => { this.noting = item.id; requestAnimationFrame(() => this.renderRoot.querySelector('input.note')?.focus()); }}>Decline…</button>`}
          <button class="btn primary" ?disabled=${this.mode === 'readonly'} title=${this.mode === 'readonly' ? 'Read only changes nothing: switch the mode to approve.' : ''} @click=${() => this.choose(item, true)}>${glyph('check')}Approve</button>
        </div>` : nothing}
      ${state === 'done' || (state === 'undone' && c.documentKey) ? html`<div class="card-actions subtle">
          ${c.documentKey && c.kind !== 'media' && c.kind !== 'delete' ? html`<button class="btn link" @click=${() => this.openPage(c.documentKey, c.culture)}>${glyph('open')}Open page</button>` : nothing}
          ${state === 'done' && c.actionId && ['edit', 'create', 'delete', 'move', 'media'].includes(c.kind) ? html`<button class="btn link" @click=${() => this.undo(item)}>${glyph('undo')}Undo</button>` : nothing}
        </div>` : nothing}
    </article>`;
  }

  change(ch, card) {
    const label = html`<div class="field">${ch.label}${ch.culture ? html` <span class="lang">${ch.culture}</span>` : nothing}</div>`;
    const before = ch.beforeText ?? '', after = ch.afterText ?? '';
    if (card.kind === 'publish' && ch.path === '(status)') return html`<div class="change">${label}<div class="value">${after}</div></div>`;
    if (!before && after) return html`<div class="change">${label}<div class="value added">${after}</div></div>`;
    if (before && !after) return html`<div class="change">${label}<div class="value removed">${before}</div></div>`;
    const parts = diff(before, after);
    const changedShare = parts.filter(p => p.op !== 'same').reduce((n, p) => n + p.text.length, 0) / Math.max(1, before.length + after.length);
    // Mostly rewritten: before and after one below the other reads better than a patchwork.
    if (changedShare > 0.6 || before.length + after.length > 4000) return html`<div class="change">${label}<div class="value removed">${before}</div><div class="value added">${after}</div></div>`;
    return html`<div class="change">${label}<div class="value">${parts.map(p => p.op === 'same' ? p.text : p.op === 'del' ? html`<del>${p.text}</del>` : html`<ins>${p.text}</ins>`)}</div></div>`;
  }

  composer() {
    const s = this.session;
    const modes = s.modes || [];
    return html`<div class="composer">
      ${this.page ? html`<div class="context" title="The assistant knows which page you have open">${glyph('page')}<span>${this.page.name || 'Open page'}</span>${this.page.culture ? html`<span class="lang">${this.page.culture}</span>` : nothing}</div>` : nothing}
      ${this.images.length ? html`<div class="attachments">${this.images.map((img, i) => html`<span class="thumb"><img src=${img.data} alt=""><button aria-label="Remove image" @click=${() => this.images = this.images.filter((_, j) => j !== i)}>${glyph('close')}</button></span>`)}</div>` : nothing}
      <div class="input">
        <textarea rows="1" placeholder=${this.waiting ? 'Approve or decline above, or write to change course…' : 'Ask about content or tell me what to change…'} aria-label="Message"
          @input=${e => this.autosize(e.target)} @keydown=${e => this.keydown(e)} @paste=${e => this.paste(e)}></textarea>
        <div class="row">
          <div class="chooser">
            <button class="pill mode-${this.mode}" aria-haspopup="menu" aria-expanded=${String(this.menu === 'mode')} title=${modeInfo[this.mode]?.text || ''} @click=${() => this.menu = this.menu === 'mode' ? null : 'mode'}>${glyph(modeInfo[this.mode]?.icon || 'hand')}${modeInfo[this.mode]?.label || this.mode}</button>
            ${this.menu === 'mode' ? html`<div class="menu" role="menu">${modes.map(m => html`<button role="menuitemradio" aria-checked=${String(m === this.mode)} class="mode-${m}" @click=${() => this.setMode(m)}>
              ${glyph(modeInfo[m].icon)}<span><b>${modeInfo[m].label}</b><small>${modeInfo[m].text}</small></span>${m === this.mode ? glyph('check', 'tick') : nothing}</button>`)}</div>` : nothing}
          </div>
          ${s.efforts?.length ? html`<div class="chooser">
            <button class="pill" aria-haspopup="menu" aria-expanded=${String(this.menu === 'effort')} title="How much the assistant thinks before acting" @click=${() => this.menu = this.menu === 'effort' ? null : 'effort'}>${effortInfo[this.effort] || this.effort} effort</button>
            ${this.menu === 'effort' ? html`<div class="menu" role="menu">${s.efforts.map(e => html`<button role="menuitemradio" aria-checked=${String(e === this.effort)} @click=${() => this.setEffort(e)}>
              <span><b>${effortInfo[e]}</b><small>${e === 'low' ? 'Fastest, for simple lookups and edits.' : e === 'medium' ? 'Balanced, for most tasks.' : 'Thinks more, for bigger or trickier changes.'}</small></span>${e === this.effort ? glyph('check', 'tick') : nothing}</button>`)}</div>` : nothing}
          </div>` : nothing}
          <span class="grow"></span>
          ${s.actions?.includes('media') ? html`<label class="icon" title="Attach an image" aria-label="Attach an image">${glyph('clip')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden @change=${e => { this.addFiles(e.target.files); e.target.value = ''; }}></label>` : nothing}
          ${this.busy ? html`<button class="send stop" aria-label="Stop" title="Stop" @click=${() => this.stop()}>${glyph('stop')}</button>`
            : html`<button class="send" aria-label="Send" title="Send (Enter)" @click=${() => this.send()}>${glyph('send')}</button>`}
        </div>
      </div>
      ${s.messagesLeft != null && s.messagesLeft < 10 ? html`<p class="quota">${s.messagesLeft} message${s.messagesLeft === 1 ? '' : 's'} left today</p>` : nothing}
    </div>`;
  }
}
customElements.define('ligata-ai-editor-panel', LigataAIEditorPanel);
