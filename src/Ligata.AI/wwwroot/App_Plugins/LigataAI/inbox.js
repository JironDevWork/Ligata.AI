import { LitElement, html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { UmbElementMixin } from '@umbraco-cms/backoffice/element-api';
import { UMB_AUTH_CONTEXT } from '@umbraco-cms/backoffice/auth';
import { aiRequest, bearer, managementBase } from './api.js?v=0.12.3';
import { styles } from './styles.js?v=0.12.3';
import { inboxStyles } from './inbox-styles.js?v=0.12.3';
import { icon } from './ui.js?v=0.12.3';

const views = [['needs', 'Needs reply'], ['active', 'Active'], ['mine', 'Mine'], ['open', 'All open'], ['closed', 'Closed']];
const displays = [
  ['full', 'Name and photo', 'Your Umbraco name and profile picture.'],
  ['name', 'Name only', 'Your Umbraco name with your initials.'],
  ['alias', 'Nickname', 'A name you choose, without a photo.'],
  ['anonymous', 'Anonymous', 'Only the team name; visitors cannot tell team members apart.'],
];
const stored = (key, fallback) => { try { const v = localStorage.getItem('ligata-ai-inbox:' + key); return v === null ? fallback : v === '1'; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem('ligata-ai-inbox:' + key, value ? '1' : '0'); } catch { } };
const initials = name => String(name || '').split(/[\s.@-]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
const visitorName = c => c?.name || c?.email || 'Anonymous visitor';

function ago(value) {
  if (!value) return '';
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 45) return 'now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} d`;
}
function when(value) {
  const date = new Date(value), today = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return time;
  const yesterday = new Date(today.getTime() - 86400000);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

class LigataAIInbox extends UmbElementMixin(LitElement) {
  static properties = Object.fromEntries(['loaded', 'error', 'view', 'kind', 'q', 'items', 'total', 'counts', 'online', 'selected', 'thread', 'mode', 'draft', 'busy', 'me', 'showDetails', 'profileOpen', 'toast', 'features', 'sound', 'notify', 'avatars', 'sending'].map(k => [k, { state: true }]));
  static styles = [styles, inboxStyles];

  constructor() {
    super();
    Object.assign(this, { loaded: false, view: 'needs', kind: '', q: '', items: [], total: 0, counts: {}, online: 0, mode: 'reply', draft: '', busy: false, showDetails: false, profileOpen: false, avatars: {}, sending: false, sound: stored('sound', true), notify: stored('notify', false) });
    this.version = -1; this.seen = new Map(); this.drafts = new Map(); this.typingSent = 0;
    this.consumeContext(UMB_AUTH_CONTEXT, auth => { this.auth = auth; this.start(); });
    this.onResize = () => this.style.setProperty('--top', Math.max(60, this.getBoundingClientRect().top) + 'px');
  }
  connectedCallback() { super.connectedCallback(); window.addEventListener('resize', this.onResize); requestAnimationFrame(this.onResize); this.alive = true; window.__ligataAIInboxOpen = true; if (this.auth && this.started && !this.polling) this.loop(); }
  disconnectedCallback() { this.alive = false; window.__ligataAIInboxOpen = false; window.removeEventListener('resize', this.onResize); this.sendTyping(false); super.disconnectedCallback(); }

  request(path, method, body, options) { return aiRequest(this.auth, '/inbox' + path, method, body, options); }

  async start() {
    if (this.started) return; this.started = true;
    try {
      this.me = await this.request('/me');
      this.features = this.me.features;
      await this.load();
      this.loaded = true;
      const wanted = new URLSearchParams(location.search).get('conversation');
      if (wanted) this.select(wanted);
      this.loop();
    } catch (e) { this.error = e.status === 404 ? 'Live chat and email are not included in this installation (LigataAI:Features).' : e.message; this.loaded = true; }
  }

  // ---------- data ----------
  async load() {
    const params = new URLSearchParams({ view: this.view, take: '60' });
    if (this.kind) params.set('kind', this.kind);
    if (this.q.trim()) params.set('q', this.q.trim());
    const data = await this.request('?' + params);
    this.items = data.items; this.total = data.total; this.counts = data.counts; this.online = data.online; this.features = data.features;
    this.alertNew(data.items);
  }

  /** New requests and visitor messages: sound and (opt-in) desktop notification, never for what is on screen. */
  alertNew(items) {
    const fresh = [];
    for (const item of items) {
      const before = this.seen.get(item.id);
      if (item.unread && item.state !== 'closed' && before !== undefined && item.lastSeq > before && !(item.id === this.selected && !document.hidden)) fresh.push(item);
      if (item.unread && before === undefined && this.primed && item.id !== this.selected) fresh.push(item);
      this.seen.set(item.id, item.lastSeq);
    }
    this.primed = true;
    if (!fresh.length) return;
    if (this.sound) this.chime();
    if (this.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const item = fresh[0];
      const n = new Notification(`${visitorName(item)} · website chat`, { body: item.topic, tag: 'ligata-ai-' + item.id });
      n.onclick = () => { window.focus(); this.select(item.id); n.close(); };
    }
  }

  chime() {
    try {
      this.audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const now = this.audio.currentTime;
      [660, 990].forEach((f, i) => {
        const o = this.audio.createOscillator(), g = this.audio.createGain(), s = now + i * .14;
        o.frequency.value = f; g.gain.setValueAtTime(.0001, s); g.gain.exponentialRampToValueAtTime(.08, s + .02); g.gain.exponentialRampToValueAtTime(.0001, s + .45);
        o.connect(g).connect(this.audio.destination); o.start(s); o.stop(s + .5);
      });
    } catch { }
  }

  /** One long poll keeps the list, counts, the open thread and presence current (it is also the "online" heartbeat). */
  async loop() {
    let delay = 0;
    this.polling = true;
    // Leaving the section ends the loop and coming back starts it again (connectedCallback), so the flag is always cleared.
    try {
      while (this.alive) {
        try {
          const data = await aiRequest(this.auth, '/inbox/updates?version=' + this.version, 'GET', undefined, { timeout: 40000 });
          if (!this.alive) return;
          const changed = data.version !== this.version;
          this.version = data.version; this.counts = data.counts; this.online = data.online;
          if (changed) { await this.load(); if (this.selected) await this.loadThread(this.selected, false); }
          delay = 0;
        } catch (e) {
          if (!this.alive) return;
          delay = Math.min(30000, (delay || 1000) * 2);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    } finally { this.polling = false; }
  }

  async select(id) {
    if (this.selected && this.selected !== id) { this.drafts.set(this.selected, this.draft); this.sendTyping(false); }
    this.selected = id;
    this.thread = null;
    this.draft = this.drafts.get(id) || '';
    const url = new URL(location.href); url.searchParams.set('conversation', id); history.replaceState(history.state, '', url);
    await this.loadThread(id, true);
    const c = this.thread?.conversation;
    if (c) this.mode = c.kind === 'email' ? 'email' : 'reply';
    this.updateComplete.then(() => this.scrollThread(true));
  }

  async loadThread(id, full) {
    const after = full || !this.thread || this.thread.conversation.id !== id ? 0 : this.thread.lastSeq;
    let data;
    try { data = await this.request(`/${id}?after=${after}`); }
    catch (e) { if (e.status === 404) { this.thread = null; this.selected = null; this.showToast('This conversation was deleted.'); } return; }
    if (this.selected !== id) return;
    // The live update and a send can both fetch the same new messages: merge by sequence number.
    const bySeq = new Map((after ? this.thread.messages : []).map(m => [m.seq, m]));
    for (const m of data.messages) bySeq.set(m.seq, m);
    const messages = [...bySeq.values()].sort((x, y) => x.seq - y.seq);
    const nearBottom = this.isNearBottom();
    this.thread = { ...data, messages, agents: { ...(this.thread?.agents || {}), ...data.agents }, lastSeq: Math.max(after, ...messages.map(m => m.seq)) };
    for (const key of Object.keys(data.agents)) this.loadAvatar(key);
    // Reading a thread marks it read for the whole team.
    if (!document.hidden && data.conversation.unread) this.request(`/${id}/read`, 'POST', { seq: data.conversation.lastSeq }).catch(() => {});
    this.updateComplete.then(() => this.scrollThread(nearBottom || full));
  }

  async loadAvatar(key) {
    if (key in this.avatars) return;
    this.avatars = { ...this.avatars, [key]: null };
    try {
      const response = await fetch(`${managementBase}/inbox/agents/${key}/avatar`, { headers: await bearer(this.auth), credentials: 'same-origin' });
      if (response.ok) this.avatars = { ...this.avatars, [key]: URL.createObjectURL(await response.blob()) };
    } catch { }
  }

  isNearBottom() { const box = this.renderRoot?.querySelector('.messages'); return !box || box.scrollHeight - box.scrollTop - box.clientHeight < 140; }
  scrollThread(force) { const box = this.renderRoot.querySelector('.messages'); if (box && (force || this.isNearBottom())) box.scrollTop = box.scrollHeight; }
  showToast(text) { this.toast = text; clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { this.toast = ''; }, 4000); }

  async act(path, method = 'POST', body, success) {
    if (this.busy) return;
    this.busy = true;
    try { const result = await this.request(path, method, body); if (success) this.showToast(success); return result ?? true; }
    catch (e) { this.showToast(e.message); return null; }
    finally { this.busy = false; }
  }

  async join() { if (await this.act(`/${this.selected}/join`)) { await this.loadThread(this.selected, false); this.mode = 'reply'; this.focusComposer(); } }
  async leave() { if (await this.act(`/${this.selected}/leave`, 'POST', undefined, 'You left the conversation. The visitor sees that you left.')) await this.loadThread(this.selected, false); }
  async close() { if (confirm('Close this conversation? The visitor sees that it was closed and can start a new one.') && await this.act(`/${this.selected}/close`, 'POST', undefined, 'Conversation closed.')) { await this.loadThread(this.selected, false); await this.load(); } }
  async reopen() { if (await this.act(`/${this.selected}/reopen`, 'POST', undefined, 'Conversation reopened.')) { await this.loadThread(this.selected, false); await this.load(); } }
  async remove() {
    if (!confirm('Delete this conversation permanently, including all messages? This cannot be undone.')) return;
    if (await this.act(`/${this.selected}`, 'DELETE', undefined, 'Conversation deleted.')) { this.selected = null; this.thread = null; await this.load(); }
  }

  async send() {
    const text = this.draft.trim();
    if (!text || this.sending) return;
    const c = this.thread.conversation;
    this.sending = true;
    try {
      if (this.mode === 'email') await this.request(`/${c.id}/email`, 'POST', { text });
      else await this.request(`/${c.id}/messages`, 'POST', { text, note: this.mode === 'note' });
      this.draft = ''; this.drafts.delete(c.id);
      this.sendTyping(false);
      if (this.mode === 'email') this.showToast('Email queued. It is sent within a few seconds.');
      await this.loadThread(c.id, false);
      this.scrollThread(true);
    } catch (e) { this.showToast(e.message); }
    finally { this.sending = false; this.focusComposer(); }
  }

  typing(value) {
    this.draft = value;
    if (this.mode !== 'reply' || !this.thread?.conversation.joined) return;
    if (!value.trim()) { this.sendTyping(false); return; }
    if (Date.now() - this.typingSent > 3000) { this.typingSent = Date.now(); this.typingOn = true; this.request(`/${this.selected}/typing`, 'POST', { active: true }).catch(() => {}); }
  }
  sendTyping(active) {
    if (!this.typingOn || !this.selected || active) return;
    this.typingOn = false; this.typingSent = 0;
    this.request(`/${this.selected}/typing`, 'POST', { active: false }).catch(() => {});
  }
  focusComposer() { this.updateComplete.then(() => this.renderRoot.querySelector('.composer textarea')?.focus()); }

  async saveProfile(changes) {
    const result = await this.act('/me', 'POST', changes);
    if (result && result !== true) { this.me = result; this.features = result.features; }
  }

  async toggleNotify() {
    if (this.notify) { this.notify = false; store('notify', false); return; }
    if (!('Notification' in window)) { this.showToast('This browser does not support desktop notifications.'); return; }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    this.notify = permission === 'granted'; store('notify', this.notify);
    if (!this.notify) this.showToast('Desktop notifications are blocked in this browser.');
  }

  setView(view) { this.view = view; this.load(); }
  setKind(kind) { this.kind = kind; this.load(); }
  search(value) { this.q = value; clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => this.load(), 300); }

  // ---------- rendering helpers ----------
  agentFace(key, cls = '') {
    const agent = this.thread?.agents?.[key] || {};
    const src = this.avatars[key];
    return html`<span class="face ${cls}" title=${agent.name || ''}>${src ? html`<img src=${src} alt="">` : agent.initials || icon('person')}</span>`;
  }
  visitorFace(c, cls = '') {
    return html`<span class="face-wrap"><span class="face ${cls}">${c.kind === 'email' && !c.name ? icon('mail') : initials(visitorName(c)) || icon('person')}</span>${c.visitorOnline ? html`<span class="online" title="On the website now"></span>` : nothing}</span>`;
  }
  tags(c) {
    const tags = [];
    if (c.kind === 'email') tags.push(html`<span class="tag">${icon('mail')}Email</span>`);
    if (c.state === 'closed') tags.push(html`<span class="tag">${icon('archive')}Closed</span>`);
    else if (c.needsReply) tags.push(html`<span class="tag wait">${icon('clock')}Waiting ${ago(c.updated)}</span>`);
    if (c.state === 'active') tags.push(html`<span class="tag live">${icon('team')}${c.agents.map(a => a.name.split(' ')[0]).join(', ')}</span>`);
    if (c.typing) tags.push(html`<span class="tag hot">typing…</span>`);
    return tags;
  }

  render() {
    if (!this.loaded) return html`<div class="center">${icon('refresh', 'spin')}<p>Loading the inbox…</p></div>`;
    if (this.error) return html`<div class="app"><div class="notice error">${icon('warn')}<div><strong>The inbox is not available</strong><p>${this.error}</p></div></div></div>`;
    const c = this.thread?.conversation;
    const away = this.me?.away;
    return html`<div class="app">
      <div class="bar">
        <div class="grow"><h1>Inbox</h1>
          <div class="sub">${this.counts.needsReply ? html`<span class="pill warn"><i></i>${this.counts.needsReply} need${this.counts.needsReply === 1 ? 's' : ''} a reply</span>` : html`<span class="pill ok"><i></i>All caught up</span>`}
            ${this.counts.active ? html`<span class="pill info"><i></i>${this.counts.active} active</span>` : nothing}
            <span class="pill"><i></i>${this.online} team member${this.online === 1 ? '' : 's'} online</span>
            ${this.features && !this.features.liveChat && !this.features.email ? html`<span class="pill bad"><i></i>Live chat and email are switched off in Settings</span>` : nothing}
            ${this.features?.email && !this.features.emailReady ? html`<span class="pill bad" title="Umbraco:CMS:Global:Smtp is not configured"><i></i>Email not configured</span>` : nothing}</div></div>
        <button class="status-switch ${away ? 'away' : ''}" title="Visitors see the team as online while at least one available member has the backoffice open" @click=${() => this.saveProfile({ away: !away })}><i></i>${away ? 'Away' : 'Available'}</button>
        <button class="icon-btn" title=${this.sound ? 'Sound on' : 'Sound off'} aria-label="Sound" @click=${() => { this.sound = !this.sound; store('sound', this.sound); if (this.sound) this.chime(); }}>${icon(this.sound ? 'volume' : 'mute')}</button>
        <button class="icon-btn" title=${this.notify ? 'Desktop notifications on' : 'Desktop notifications off'} aria-label="Desktop notifications" style=${this.notify ? 'color:var(--accent)' : ''} @click=${() => this.toggleNotify()}>${icon('bell')}</button>
        <button class="btn" @click=${() => { this.profileOpen = true; }}>${this.me?.hasPhoto ? html`<span class="face small"><img src=${this.avatars[this.me.key] || ''} alt=""></span>` : icon('person')}How I appear</button>
      </div>
      <div class="panes ${this.showDetails ? 'show-details' : ''} ${c ? 'has-thread' : ''}">
        ${this.listPane()}
        ${c ? this.threadPane(c) : html`<section class="pane thread"><div class="center">${icon('inbox')}<h2>${this.counts.needsReply ? 'Pick a conversation' : 'Nothing waiting'}</h2><p>${this.counts.needsReply ? 'Conversations that need a reply are listed on the left, newest activity first.' : 'New chat requests and email messages from your website appear here as they arrive.'}</p></div></section>`}
        ${c ? this.detailsPane(c) : html`<section class="pane details">${this.meCard()}</section>`}
      </div>
      ${this.profileOpen ? this.profileDialog() : nothing}
      ${this.toast ? html`<div class="toast" role="status">${this.toast}</div>` : nothing}
    </div>`;
  }

  listPane() {
    const n = key => this.counts[{ needs: 'needsReply', active: 'active', mine: 'mine', open: 'open', closed: 'closed' }[key]] || 0;
    return html`<section class="pane list-pane">
      <div class="filters">
        <div class="views" role="group" aria-label="Show">${views.map(([key, label]) => html`<button type="button" aria-pressed=${String(this.view === key)} @click=${() => this.setView(key)}>${label}${key !== 'closed' && n(key) ? html`<span class="n ${key === 'needs' ? 'hot' : ''}">${n(key)}</span>` : nothing}</button>`)}</div>
        <div class="search"><input type="search" placeholder="Search…" title="Search name, email or topic" .value=${this.q} @input=${e => this.search(e.target.value)} aria-label="Search">
          <div class="kinds" role="group" aria-label="Type">${[['', 'All'], ['chat', 'Chat'], ['email', 'Email']].map(([k, l]) => html`<button type="button" aria-pressed=${String(this.kind === k)} @click=${() => this.setKind(k)}>${l}</button>`)}</div></div>
      </div>
      <div class="items">
        ${this.items.length ? this.items.map(item => html`<button type="button" class="row-item ${item.unread ? 'unread' : ''}" aria-current=${String(item.id === this.selected)} @click=${() => this.select(item.id)}>
            ${item.unread ? html`<span class="dot" aria-label="Unread"></span>` : nothing}
            ${this.visitorFace(item)}
            <span style="min-width:0"><span class="who"><b>${visitorName(item)}</b><time>${ago(item.updated)}</time></span><div class="topic">${item.topic}</div><div class="tags">${this.tags(item)}</div></span>
          </button>`)
        : html`<div class="center" style="padding:40px 16px">${icon(this.q ? 'search' : 'check')}<p>${this.q ? 'No conversations match your search.' : this.view === 'needs' ? 'No one is waiting for a reply.' : 'No conversations here.'}</p>${this.view === 'needs' && this.counts.open ? html`<button class="btn small" @click=${() => this.setView('open')}>Show all open (${this.counts.open})</button>` : nothing}</div>`}
        ${this.total > this.items.length ? html`<div class="more"><small>${this.items.length} of ${this.total} shown. Search to narrow down.</small></div>` : nothing}
      </div>
    </section>`;
  }

  threadPane(c) {
    const t = this.thread;
    const typing = c.typing && c.state !== 'closed';
    let historyShown = false;
    // The request usually repeats the visitor's last question to the AI: show it once.
    const lastAsked = [...t.messages].reverse().find(m => m.kind === 'history' && m.author === 'visitor')?.text?.trim();
    const request = t.messages.find(m => m.kind === 'request');
    const repeated = request && t.messages.find(m => m.seq > request.seq && m.author === 'visitor' && m.kind === 'message');
    const skip = repeated && repeated.text.trim() === lastAsked ? repeated.seq : -1;
    return html`<section class="pane thread">
      <div class="thread-head">
        <button class="icon-btn back-btn" aria-label="Back to the list" @click=${() => { this.selected = null; this.thread = null; }}>${icon('back')}</button>
        ${this.visitorFace(c)}
        <div class="grow"><h2>${visitorName(c)}</h2>
          <div class="meta">${c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : nothing}
            ${c.pagePath ? html`<span title=${c.pageTitle}>${icon('globe')} ${c.pagePath}</span>` : nothing}
            <span class="presence ${c.visitorOnline ? 'on' : ''}"><i></i>${c.kind === 'email' ? 'Email request' : c.visitorOnline ? 'On the website now' : c.visitorSeen ? `Last seen ${ago(c.visitorSeen)} ago` : 'Not on the website'}</span></div></div>
        <div class="row">
          ${c.kind === 'chat' && c.state !== 'closed' ? (c.joined
            ? html`<button class="btn" ?disabled=${this.busy} @click=${() => this.leave()}>${icon('door')}Leave</button>`
            : html`<button class="btn primary" ?disabled=${this.busy || !this.features?.liveChat} @click=${() => this.join()}>${icon('join')}Join conversation</button>`) : nothing}
          ${c.state !== 'closed' ? html`<button class="btn quiet" ?disabled=${this.busy} @click=${() => this.close()} title="Close the conversation">${icon('archive')}Close</button>` : html`<button class="btn" ?disabled=${this.busy} @click=${() => this.reopen()}>${icon('reopen')}Reopen</button>`}
          <button class="icon-btn" title="Details" aria-label="Details" @click=${() => { this.showDetails = !this.showDetails; }}>${icon('panel')}</button>
        </div>
      </div>
      <div class="messages" role="log" aria-live="polite">
        ${t.messages.filter(m => m.seq !== skip).map(m => {
          const parts = [];
          if (m.kind === 'history' && !historyShown) { historyShown = true; parts.push(html`<div class="divider">Before the request · with the AI assistant</div>`); }
          parts.push(this.message(m, c));
          return parts;
        })}
        ${typing ? html`<div class="typing">${this.visitorFace(c, 'small')}<span class="dots"><i></i><i></i><i></i></span>${visitorName(c)} is typing…</div>` : nothing}
        ${t.typing?.length ? html`<div class="typing" style="align-self:flex-end"><span class="dots"><i></i><i></i><i></i></span>${t.typing.join(', ')} ${t.typing.length === 1 ? 'is' : 'are'} typing…</div>` : nothing}
      </div>
      ${this.composer(c)}
    </section>`;
  }

  message(m, c) {
    const agent = m.agent ? this.thread.agents[m.agent] : null;
    const agentLabel = agent ? (agent.shownAs && agent.shownAs !== agent.name ? html`${agent.name} <span title="What the visitor sees">· shown as “${agent.shownAs}”</span>` : agent.mode === 'anonymous' ? html`${agent.name} <span>· anonymous to the visitor</span>` : agent.name) : 'Team member';
    switch (m.kind) {
      case 'history': return html`<div class="line history ${m.author === 'ai' ? 'ai' : 'visitor'}">${m.author === 'ai' ? html`<span class="face small">${icon('sparkle')}</span>` : this.visitorFace(c, 'small')}<div><div class="label">${m.author === 'ai' ? 'AI assistant' : visitorName(c)} · ${when(m.at)}</div><div class="bubble">${m.text}</div></div></div>`;
      case 'request': return html`<div class="divider">${c.kind === 'email' ? 'Email request' : 'Asked for the team'} · ${when(m.at)}</div>`;
      case 'note': return html`<div class="note"><div class="label">${icon('note')}Internal note · ${agent?.name || 'Team member'} · ${when(m.at)}</div>${m.text}</div>`;
      case 'join': return html`<div class="event good">${icon('join')}${agent?.name || 'A team member'} joined · ${when(m.at)}</div>`;
      case 'leave': return html`<div class="event">${icon('door')}${agent?.name || 'A team member'} left${m.text === 'away' ? ' (away for 15 minutes)' : ''} · ${when(m.at)}</div>`;
      case 'close': return html`<div class="event">${icon('archive')}${m.text === 'inactive' ? 'Closed after inactivity' : m.author === 'visitor' ? 'The visitor ended the chat' : `Closed by ${agent?.name || 'the team'}`} · ${when(m.at)}</div>`;
      case 'reopen': return html`<div class="event">${icon('reopen')}Reopened by ${agent?.name || 'the team'} · ${when(m.at)}</div>`;
    }
    if (m.author === 'visitor') return html`<div class="line visitor">${this.visitorFace(c, 'small')}<div><div class="label">${visitorName(c)} · ${when(m.at)}</div><div class="bubble">${m.text}</div></div></div>`;
    return html`<div class="line agent ${m.kind === 'email' ? 'email' : ''}">${this.agentFace(m.agent, 'small')}<div><div class="label">${m.kind === 'email' ? html`${icon('mail')}Sent by email · ` : nothing}${agentLabel} · ${when(m.at)}</div><div class="bubble">${m.text}</div></div></div>`;
  }

  composer(c) {
    if (c.state === 'closed') return html`<div class="composer"><div class="gate"><p>This conversation is closed${c.closedReason === 'inactive' ? ' after inactivity' : ''}. Reopen it to continue, or reply by email.</p><button class="btn" @click=${() => this.reopen()}>${icon('reopen')}Reopen</button></div></div>`;
    const canEmail = !!c.email && this.features?.licensed?.email !== false;
    const modes = [...(c.kind === 'chat' ? [['reply', 'Reply', 'chat']] : []), ...(canEmail ? [['email', 'Email', 'mail']] : []), ['note', 'Internal note', 'note']];
    const mode = modes.some(([k]) => k === this.mode) ? this.mode : modes[0][0];
    const gated = mode === 'reply' && !c.joined;
    const placeholder = mode === 'note' ? 'Only your team sees notes.' : mode === 'email' ? `Your reply is emailed to ${c.email}.` : 'Write to the visitor… (Enter sends, Shift+Enter for a new line)';
    return html`<div class="composer ${mode}">
      <div class="modes" role="group" aria-label="Write">${modes.map(([k, l, i]) => html`<button type="button" class=${k} aria-pressed=${String(mode === k)} @click=${() => { this.mode = k; this.focusComposer(); }}>${icon(i)}${l}</button>`)}</div>
      ${gated ? html`<div class="gate"><p><strong>Join to reply.</strong> The visitor then sees ${this.me?.preview?.[this.me.effective]?.name ? html`<b>${this.me.preview[this.me.effective].name}</b>` : 'the team'} joining the chat.</p><button class="btn primary" ?disabled=${this.busy || !this.features?.liveChat} @click=${() => this.join()}>${icon('join')}Join conversation</button></div>`
      : html`<textarea .value=${this.draft} placeholder=${placeholder} maxlength="8000" @input=${e => this.typing(e.target.value)} @blur=${() => this.sendTyping(false)}
          @keydown=${e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && mode !== 'email') { e.preventDefault(); this.mode = mode; this.send(); } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.mode = mode; this.send(); } }}></textarea>
        <div class="row"><span class="hint grow">${mode === 'email' ? 'Ctrl+Enter sends the email.' : mode === 'note' ? 'Notes are never shown to the visitor.' : c.visitorOnline ? 'The visitor is on the website and sees your reply live.' : 'The visitor is not on the website right now; they see your reply when they come back.'}</span>
          <button class="btn primary" ?disabled=${this.sending || !this.draft.trim()} @click=${() => { this.mode = mode; this.send(); }}>${icon(mode === 'email' ? 'mail' : mode === 'note' ? 'note' : 'send')}${mode === 'email' ? 'Send email' : mode === 'note' ? 'Add note' : 'Send'}</button></div>`}
    </div>`;
  }

  detailsPane(c) {
    const agents = c.agents || [];
    return html`<section class="pane details">
      <div><h3>Visitor</h3>
        <div class="visitor-card">${this.visitorFace(c, 'large')}<div><strong>${visitorName(c)}</strong><br><small class="muted">${c.kind === 'email' ? 'Email request' : 'Live chat'}</small></div></div>
        <dl style="margin-top:12px">
          ${c.name ? html`<dt>Name</dt><dd>${c.name}</dd>` : nothing}
          <dt>Email</dt><dd>${c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : html`<span class="muted">not given</span>`}</dd>
          ${c.pagePath ? html`<dt>Page</dt><dd title=${c.pagePath}>${c.pageTitle || c.pagePath}<br><small class="muted">${c.pagePath}</small></dd>` : nothing}
          ${c.language ? html`<dt>Language</dt><dd>${c.language.toUpperCase()}</dd>` : nothing}
          <dt>Started</dt><dd>${when(c.created)}</dd>
          <dt>Status</dt><dd>${c.state === 'closed' ? `Closed ${when(c.closed)}` : c.state === 'active' ? 'Active' : 'Open'}</dd>
        </dl></div>
      ${c.kind === 'chat' ? html`<div><h3>Team in this chat</h3>${agents.length ? html`<div class="agents">${agents.map(a => html`<div class="agent">${this.agentFace(a.key, 'small')}<div><b>${a.name}</b><small class="muted">${a.mode === 'anonymous' ? 'Anonymous to the visitor' : `Visitor sees “${a.shownAs}”`}</small></div></div>`)}</div>` : html`<p class="muted" style="font-size:13px">Nobody has joined yet.</p>`}</div>` : nothing}
      ${this.meCard()}
      <div><h3>Danger zone</h3><button class="btn quiet danger" ?disabled=${this.busy} @click=${() => this.remove()}>${icon('trash')}Delete conversation</button><p class="muted" style="font-size:12px;margin-top:6px">Closed conversations are deleted automatically after the retention period set in Settings.</p></div>
    </section>`;
  }

  meCard() {
    const me = this.me;
    if (!me) return nothing;
    const card = me.preview?.[me.effective] || {};
    return html`<div><h3>How visitors see you</h3><div class="appear">
      <div class="bubble-preview">${card.name ? html`<span class="face small">${card.photo && this.avatars[me.key] ? html`<img src=${this.avatars[me.key]} alt="">` : card.initials}</span>` : html`<span class="face small">${icon('team')}</span>`}<div><div class="label">${card.name || me.teamName || 'Our team'}</div><div class="bubble">Hi! How can I help?</div></div></div>
      <small class="muted">${displays.find(d => d[0] === me.effective)?.[1]}${me.allowChoose ? '' : ' · set by your administrator'}</small>
      <button class="btn small" @click=${() => { this.profileOpen = true; }}>${icon('edit')}Change</button></div></div>`;
  }

  profileDialog() {
    const me = this.me;
    const current = me.display === 'default' ? me.defaultDisplay : me.display;
    const close = () => { this.profileOpen = false; };
    return html`<div class="scrim" @click=${close}></div><dialog open @close=${close} @keydown=${e => e.key === 'Escape' && close()} style="position:fixed;inset:0;margin:auto;z-index:30">
      <form method="dialog" @submit=${e => e.preventDefault()}>
        <header><h2>How visitors see you</h2><p class="muted">Shown in the chat when you join, and next to each of your messages. Your team always sees your real name.</p></header>
        <div class="body">
          ${me.allowChoose ? nothing : html`<div class="notice">${icon('info')}<div>Your administrator decides how team members appear (Settings → Team &amp; email).</div></div>`}
          <div class="modes-grid">${displays.map(([mode, label, help]) => {
            const card = me.preview?.[mode] || {};
            return html`<button type="button" class="mode-card" aria-pressed=${String(current === mode)} ?disabled=${!me.allowChoose || this.busy} @click=${() => this.saveProfile({ display: mode })}>
              <div class="bubble-preview">${card.name ? html`<span class="face small">${card.photo && this.avatars[me.key] ? html`<img src=${this.avatars[me.key]} alt="">` : card.initials}</span>` : html`<span class="face small">${icon('team')}</span>`}<div><div class="label">${card.name || me.teamName || 'Our team'}</div><div class="bubble">Hi! How can I help?</div></div></div>
              <span><b>${label}</b><small class="muted">${help}${mode === 'full' && !me.hasPhoto ? ' You have no profile picture yet: add one in your Umbraco profile.' : ''}</small></span></button>`;
          })}</div>
          ${current === 'alias' ? html`<label class="control"><span>Nickname</span><input type="text" maxlength="40" .value=${me.alias || ''} placeholder=${me.name.split(' ')[0]} ?disabled=${!me.allowChoose} @change=${e => this.saveProfile({ alias: e.target.value })}><small>Leave empty to use your first name.</small></label>` : nothing}
          <label class="switch small"><input type="checkbox" .checked=${!me.away} @change=${e => this.saveProfile({ away: !e.target.checked })}><span>Available for chats<small class="muted">While available and the backoffice is open, visitors see the team as online.</small></span></label>
        </div>
        <footer><button type="button" class="btn primary" @click=${close}>Done</button></footer>
      </form></dialog>`;
  }

  updated(changed) {
    if (changed.has('me') && this.me?.hasPhoto) this.loadAvatar(this.me.key);
  }
}
customElements.define('ligata-ai-inbox', LigataAIInbox);
export default LigataAIInbox;
