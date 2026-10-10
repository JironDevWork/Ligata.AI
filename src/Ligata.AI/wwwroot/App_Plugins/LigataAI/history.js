import { LitElement, html, css, nothing } from '@umbraco-cms/backoffice/external/lit';
import { UmbElementMixin } from '@umbraco-cms/backoffice/element-api';
import { UMB_AUTH_CONTEXT } from '@umbraco-cms/backoffice/auth';
import { aiRequest } from './api.js?v=0.11.0';
import { styles } from './styles.js?v=0.11.0';
import { inboxStyles } from './inbox-styles.js?v=0.11.0';
import { icon, number } from './ui.js?v=0.11.0';

const views = [['all', 'All'], ['unanswered', 'Unanswered'], ['team', 'Handed to the team'], ['kept', 'Kept']];
const settingsPath = '/umbraco/section/ai-assistant/dashboard/settings?tab=privacy';
const inboxPath = id => `/umbraco/section/ai-assistant/dashboard/inbox?conversation=${id}`;
const languages = { en: 'English', de: 'German', fr: 'French', it: 'Italian' };

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
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} ${time}`;
}
const seconds = ms => ms >= 10000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`;

/** Answers are Markdown: shown readable (bold, italics, lists, headings, links), never as HTML. */
const inlinePattern = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/;
function inline(line) {
  const out = [];
  let rest = line, m;
  while ((m = inlinePattern.exec(rest))) {
    if (m.index) out.push(rest.slice(0, m.index));
    if (m[1] !== undefined) out.push(html`<b>${m[1]}</b>`);
    else if (m[2] !== undefined) out.push(html`<i>${m[2]}</i>`);
    else if (m[3] !== undefined) out.push(/^(https?:\/\/|\/(?!\/))/i.test(m[4]) ? html`<a href=${m[4]} target="_blank" rel="noopener">${m[3]}</a>` : `${m[3]} (${m[4]})`);
    else out.push(html`<code>${m[5]}</code>`);
    rest = rest.slice(m.index + m[0].length);
  }
  out.push(rest);
  return out;
}
const rich = text => String(text).split('\n').map((line, i, all) => {
  const end = i < all.length - 1 ? '\n' : '';
  const heading = /^#{1,6}\s+(.*)/.exec(line);
  if (heading) return html`<b>${inline(heading[1])}</b>${end}`;
  const item = /^\s*[-*]\s+(.*)/.exec(line);
  if (item) return html`• ${inline(item[1])}${end}`;
  return html`${inline(line)}${end}`;
});

/** Why a question got no answer, as the team should read it. */
function outcomeText(code) {
  if (['queue_full', 'site_busy', 'visitor_busy', 'queue_timeout', 'rate_limited'].includes(code)) return 'Not answered: the assistant was busy';
  if (['gateway_unavailable', 'model_unavailable', 'model_loading', 'not_configured', 'invalid_key', 'network'].includes(code)) return 'Not answered: the assistant was offline';
  return {
    daily_quota: 'Not answered: the daily question limit was reached',
    context_full: 'Not answered: the conversation no longer fit into the assistant’s memory',
    thinking_limit: 'Not answered: the assistant thought for too long',
    refused: 'The assistant declined to answer',
    model_failed: 'Not answered: the assistant stopped with an error',
  }[code] || `Not answered (${code})`;
}

/**
 * The history of conversations with the AI, kept while the site keeps one (Settings → Privacy). Read-only: the team reads what
 * visitors asked, what the AI looked up and answered, and keeps or deletes conversations.
 */
class LigataAIHistory extends UmbElementMixin(LitElement) {
  static properties = Object.fromEntries(['loaded', 'error', 'view', 'q', 'items', 'total', 'counts', 'setup', 'selected', 'thread', 'busy', 'toast', 'showDetails'].map(k => [k, { state: true }]));
  static styles = [styles, inboxStyles, css`
    .turn-tools{align-self:flex-start;display:flex;gap:6px;flex-wrap:wrap;margin:-2px 0 0 32px}
    .lookup{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;border:1px solid var(--line);background:var(--surface);font-size:11.5px;color:var(--muted);max-width:100%}
    .lookup svg{width:13px;height:13px;flex:none}.lookup span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .files{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}.files .tag{background:var(--surface);border:1px solid var(--line)}
    .line.ai{align-self:flex-start}.line.ai .bubble{border-bottom-left-radius:5px}
    .line .meta-line{font-size:11px;color:var(--muted);margin:3px 4px 0}
    .problem{align-self:flex-start;margin-left:32px;display:flex;gap:7px;align-items:center;padding:6px 12px;border-radius:10px;font-size:12.5px;background:color-mix(in srgb,var(--warn) 12%,var(--surface));color:var(--warn);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent)}
    .problem svg{width:15px;height:15px}
    .bar .actions{display:flex;gap:8px;flex-wrap:wrap}
    .empty-state{max-width:560px;margin:auto}.empty-state p{line-height:1.55}
  `];

  constructor() {
    super();
    Object.assign(this, { loaded: false, view: 'all', q: '', items: [], total: 0, counts: {}, busy: false, showDetails: false });
    this.consumeContext(UMB_AUTH_CONTEXT, auth => { this.auth = auth; this.start(); });
    this.onResize = () => this.style.setProperty('--top', Math.max(60, this.getBoundingClientRect().top) + 'px');
  }
  connectedCallback() {
    super.connectedCallback(); window.addEventListener('resize', this.onResize); requestAnimationFrame(this.onResize);
    // New questions arrive while the page is open: refresh the list every half minute (never while reading a search result).
    this.timer = setInterval(() => { if (this.loaded && !document.hidden && !this.busy) this.load(true); }, 30000);
  }
  disconnectedCallback() { window.removeEventListener('resize', this.onResize); clearInterval(this.timer); super.disconnectedCallback(); }

  request(path, method, body) { return aiRequest(this.auth, '/history' + path, method, body); }

  async start() {
    if (this.started) return; this.started = true;
    try {
      await this.load();
      this.loaded = true;
      const wanted = new URLSearchParams(location.search).get('chat');
      if (wanted) this.select(wanted);
    } catch (e) { this.error = e.status === 404 ? 'The AI assistant is not included in this installation (LigataAI:Features).' : e.message; this.loaded = true; }
  }

  async load(quiet) {
    const params = new URLSearchParams({ view: this.view, take: '80' });
    if (this.q.trim()) params.set('q', this.q.trim());
    const seq = this.loadSeq = (this.loadSeq || 0) + 1;
    try {
      const data = await this.request('?' + params);
      if (seq !== this.loadSeq) return;
      this.items = data.items; this.total = data.total; this.counts = data.counts; this.setup = data.history;
      if (quiet && this.selected && this.items.some(i => i.id === this.selected && i.updated !== this.thread?.conversation.updated)) this.loadThread(this.selected);
    } catch (e) { if (!quiet) throw e; }
  }

  async select(id) {
    this.selected = id; this.thread = null;
    const url = new URL(location.href); url.searchParams.set('chat', id); history.replaceState(history.state, '', url);
    await this.loadThread(id);
    this.updateComplete.then(() => { const box = this.renderRoot.querySelector('.messages'); if (box) box.scrollTop = 0; });
  }

  async loadThread(id) {
    try { const data = await this.request(`/${id}`); if (this.selected === id) this.thread = data; }
    catch (e) { if (e.status === 404) { this.selected = null; this.thread = null; this.showToast('This conversation was deleted.'); this.load(true); } else this.showToast(e.message); }
  }

  showToast(text) { this.toast = text; clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { this.toast = ''; }, 4000); }

  async act(path, method = 'POST', body, success) {
    if (this.busy) return null;
    this.busy = true;
    try { const result = await this.request(path, method, body); if (success) this.showToast(success); return result ?? true; }
    catch (e) { this.showToast(e.message); return null; }
    finally { this.busy = false; }
  }

  async keep(c) {
    // Keeping beyond the period needs a reason (a complaint, a legal claim) and ends after 90 days unless kept again.
    let reason = '';
    if (!c.kept) { reason = (prompt('Why is this conversation kept beyond the history period? For example: complaint, legal claim. It is kept for 90 days.') || '').trim(); if (!reason) return; }
    const result = await this.act(`/${c.id}/keep`, 'POST', { keep: !c.kept, reason, days: 90 }, c.kept ? 'No longer kept: deleted with the others after the history period.' : 'Kept for 90 days.');
    if (result?.conversation) { this.thread = { ...this.thread, conversation: result.conversation }; await this.load(true); }
  }
  async remove(c) {
    if (!confirm('Delete this conversation permanently? This cannot be undone.')) return;
    if (await this.act(`/${c.id}`, 'DELETE', undefined, 'Conversation deleted.')) { this.selected = null; this.thread = null; await this.load(true); }
  }
  async removeAll() {
    const count = (this.counts.all || 0) - (this.counts.kept || 0);
    if (!count || !confirm(`Delete ${number(count)} conversation${count === 1 ? '' : 's'} permanently? Kept conversations stay. This cannot be undone.`)) return;
    const result = await this.act('/delete-all', 'POST');
    if (result) { this.showToast(`${number(result.deleted)} conversation${result.deleted === 1 ? '' : 's'} deleted.`); if (!this.thread?.conversation.kept) { this.selected = null; this.thread = null; } await this.load(true); }
  }

  setView(view) { this.view = view; this.load(true); }
  search(value) { this.q = value; clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => this.load(true), 300); }

  render() {
    if (!this.loaded) return html`<div class="center">${icon('refresh', 'spin')}<p>Loading the conversations…</p></div>`;
    if (this.error) return html`<div class="app"><div class="notice error">${icon('warn')}<div><strong>The conversations are not available</strong><p>${this.error}</p></div></div></div>`;
    const s = this.setup || {};
    const c = this.thread?.conversation;
    if (!s.enabled && !this.counts.all) return this.offState();
    return html`<div class="app">
      <div class="bar">
        <div class="grow"><h1>AI conversations</h1>
          <div class="sub">${s.enabled ? html`<span class="pill ok"><i></i>History on · kept ${number(s.days)} day${s.days === 1 ? '' : 's'}</span>` : html`<span class="pill warn"><i></i>History off · no new conversations are kept</span>`}
            <span class="pill"><i></i>${number(this.counts.all)} conversation${this.counts.all === 1 ? '' : 's'}</span>
            ${this.counts.unanswered ? html`<span class="pill warn" title="Questions without an answer, or answers that offered your team because the AI did not know"><i></i>${number(this.counts.unanswered)} with unanswered questions</span>` : nothing}</div></div>
        <div class="actions">
          ${s.editor ? html`<a class="btn" href=${settingsPath}>${icon('shield')}History settings</a>` : nothing}
          ${s.editor ? html`<button class="btn quiet danger" ?disabled=${this.busy || !(this.counts.all - this.counts.kept)} @click=${() => this.removeAll()}>${icon('trash')}Delete all</button>` : nothing}
        </div>
      </div>
      <div class="panes ${this.showDetails ? 'show-details' : ''} ${c ? 'has-thread' : ''}">
        ${this.listPane()}
        ${c ? this.threadPane(c) : html`<section class="pane thread"><div class="center">${icon('chat')}<h2>Pick a conversation</h2><p>What visitors asked the assistant, what it looked up on your website and what it answered. Newest first.</p></div></section>`}
        ${c ? this.detailsPane(c) : html`<section class="pane details">${this.aboutCard()}</section>`}
      </div>
      ${this.toast ? html`<div class="toast" role="status">${this.toast}</div>` : nothing}
    </div>`;
  }

  offState() {
    const s = this.setup || {};
    return html`<div class="app"><div class="center empty-state">${icon('chat')}<h2>No conversations are kept</h2>
      <p>The website does not keep conversations with the AI. To read what visitors ask, switch on the history under <b>Settings → Privacy → Conversation history</b>. Visitors then decide in the chat whether their conversations may be kept, and kept conversations are deleted automatically after the period you choose.</p>
      ${s.editor ? html`<a class="btn primary" href=${settingsPath}>${icon('shield')}Open the privacy settings</a>` : html`<p class="muted">Ask an administrator to switch it on.</p>`}
    </div></div>`;
  }

  listPane() {
    const n = key => this.counts[key] || 0;
    return html`<section class="pane list-pane">
      <div class="filters">
        <div class="views" role="group" aria-label="Show">${views.map(([key, label]) => html`<button type="button" aria-pressed=${String(this.view === key)} @click=${() => this.setView(key)}>${label}${n(key) ? html`<span class="n">${number(n(key))}</span>` : nothing}</button>`)}</div>
        <div class="search"><input type="search" placeholder="Search…" title="Search questions, answers and pages" .value=${this.q} @input=${e => this.search(e.target.value)} aria-label="Search"></div>
      </div>
      <div class="items">
        ${this.items.length ? this.items.map(item => html`<button type="button" class="row-item" aria-current=${String(item.id === this.selected)} @click=${() => this.select(item.id)}>
            <span class="face">${icon('sparkle')}</span>
            <span style="min-width:0"><span class="who"><b>${item.topic || 'Attachment only'}</b><time>${ago(item.updated)}</time></span>
              <div class="topic">${item.pageTitle || item.pagePath || ''}</div>
              <div class="tags">${this.tags(item)}</div></span>
          </button>`)
        : html`<div class="center" style="padding:40px 16px">${icon(this.q ? 'search' : 'check')}<p>${this.q ? 'No conversations match your search.' : this.view === 'unanswered' ? 'Every question was answered.' : 'No conversations here.'}</p></div>`}
        ${this.total > this.items.length ? html`<div class="more"><small>${this.items.length} of ${number(this.total)} shown. Search to narrow down.</small></div>` : nothing}
      </div>
    </section>`;
  }

  tags(c) {
    const tags = [html`<span class="tag">${icon('chat')}${c.turns} question${c.turns === 1 ? '' : 's'}</span>`];
    if (c.unanswered) tags.push(html`<span class="tag wait">${icon('warn')}${c.unanswered} unanswered</span>`);
    if (c.conversationId) tags.push(html`<span class="tag live">${icon('team')}Team</span>`);
    if (c.kept) tags.push(html`<span class="tag">${icon('pin')}Kept</span>`);
    if (c.language) tags.push(html`<span class="tag">${c.language.toUpperCase()}</span>`);
    return tags;
  }

  threadPane(c) {
    const t = this.thread;
    return html`<section class="pane thread" style="grid-template-rows:auto 1fr">
      <div class="thread-head">
        <button class="icon-btn back-btn" aria-label="Back to the list" @click=${() => { this.selected = null; this.thread = null; }}>${icon('back')}</button>
        <span class="face">${icon('sparkle')}</span>
        <div class="grow"><h2 title=${c.topic}>${c.topic || 'Attachment only'}</h2>
          <div class="meta">${c.pagePath ? html`<span title=${c.pageTitle}>${icon('globe')} ${c.pagePath}</span>` : nothing}<span>${when(c.created)}</span>${c.language ? html`<span>${languages[c.language] || c.language.toUpperCase()}</span>` : nothing}</div></div>
        <div class="row">
          ${c.conversationId && this.setup?.inbox ? html`<a class="btn" href=${inboxPath(c.conversationId)}>${icon('inbox')}Open in Inbox</a>` : nothing}
          <button class="btn ${c.kept ? 'primary' : ''}" ?disabled=${this.busy} title=${c.kept ? 'Kept for a reason; click to stop keeping it' : 'Keep it beyond the history period, for a reason'} @click=${() => this.keep(c)}>${icon('pin')}${c.kept ? 'Kept' : 'Keep'}</button>
          <button class="icon-btn" title="Details" aria-label="Details" @click=${() => { this.showDetails = !this.showDetails; }}>${icon('panel')}</button>
        </div>
      </div>
      <div class="messages" role="log">${t.turns.map(turn => this.turn(turn))}</div>
    </section>`;
  }

  turn(turn) {
    const parts = [];
    parts.push(html`<div class="line visitor"><span class="face small">${icon('person')}</span><div><div class="label">Visitor · ${when(turn.at)}${turn.attempts > 1 ? html` · asked ${turn.attempts}×` : nothing}</div>
      <div class="bubble">${turn.question || html`<span class="muted">(attachment only)</span>`}${turn.files?.length ? html`<div class="files">${turn.files.map(f => html`<span class="tag">${icon(f.type === 'image' ? 'palette' : 'file')}${f.name}</span>`)}</div>` : nothing}</div></div></div>`);
    const lookups = (turn.lookups || []).flat();
    if (lookups.length) parts.push(html`<div class="turn-tools">${lookups.map(call => this.lookup(call))}</div>`);
    if (turn.answer) parts.push(html`<div class="line ai"><span class="face small">${icon('sparkle')}</span><div><div class="label">AI assistant${turn.durationMs ? html` · ${seconds(turn.durationMs)}` : nothing}</div>
      <div class="bubble">${rich(turn.answer)}</div>
      ${turn.offeredTeam || turn.completionTokens ? html`<div class="meta-line">${turn.offeredTeam ? 'Offered the team · ' : ''}${turn.completionTokens ? `${number(turn.promptTokens)} tokens read, ${number(turn.completionTokens)} written` : ''}</div>` : nothing}</div></div>`);
    if (turn.outcome === 'stopped') parts.push(html`<div class="event">${icon('close')}The visitor stopped the answer</div>`);
    else if (turn.outcome !== 'answered') parts.push(html`<div class="problem">${icon('warn')}${outcomeText(turn.outcome)}</div>`);
    if (turn.offeredTeam && !turn.answer) parts.push(html`<div class="event">${icon('team')}Offered the team</div>`);
    return parts;
  }

  lookup(call) {
    const args = call.arguments || {};
    if (call.name === 'search_website') return html`<span class="lookup" title="The assistant searched your website">${icon('search')}<span>Searched “${args.query || ''}”</span></span>`;
    if (call.name === 'read_pages') return html`<span class="lookup" title="The assistant read these pages or documents">${icon('page')}<span>Read ${(args.pages || []).join(', ')}</span></span>`;
    return html`<span class="lookup">${icon('search')}<span>${call.name}</span></span>`;
  }

  detailsPane(c) {
    const s = this.setup || {};
    const deleted = new Date(Math.min(c.expires ? new Date(c.expires).getTime() : Infinity, new Date(c.updated).getTime() + (s.days || 30) * 86400000));
    return html`<section class="pane details">
      <div><h3>Conversation</h3><dl>
        <dt>Started</dt><dd>${when(c.created)}</dd>
        <dt>Last question</dt><dd>${when(c.updated)}</dd>
        <dt>Questions</dt><dd>${number(c.turns)}${c.unanswered ? ` · ${number(c.unanswered)} unanswered` : ''}</dd>
        ${c.summaries ? html`<dt>Memory</dt><dd>Summarized ${c.summaries}× because it was full</dd>` : nothing}
        ${c.language ? html`<dt>Language</dt><dd>${languages[c.language] || c.language.toUpperCase()}</dd>` : nothing}
        ${c.pagePath ? html`<dt>Page</dt><dd title=${c.pagePath}>${c.pageTitle || c.pagePath}<br><small class="muted">${c.pagePath}</small></dd>` : nothing}
        <dt>Answered by</dt><dd>${c.engine === 'api' ? 'Claude (Anthropic API)' : 'Own AI server'}</dd>
        <dt>Deleted</dt><dd>${c.kept ? `Kept until ${new Date(c.keptUntil).toLocaleDateString(undefined, { dateStyle: 'medium' })}: ${c.keptReason || ''}` : `${deleted.toLocaleDateString(undefined, { dateStyle: 'medium' })}, unless you keep it or the visitor deletes it earlier`}</dd>
      </dl></div>
      ${c.conversationId ? html`<div><h3>Team</h3><p class="muted" style="font-size:13px">The visitor asked your team from this conversation${s.inbox ? html`: <a href=${inboxPath(c.conversationId)}>open it in the Inbox</a>` : ''}.</p></div>` : nothing}
      ${this.aboutCard()}
      <div><h3>Danger zone</h3><button class="btn quiet danger" ?disabled=${this.busy} @click=${() => this.remove(c)}>${icon('trash')}Delete conversation</button></div>
    </section>`;
  }

  aboutCard() {
    const s = this.setup || {};
    return html`<div><h3>About the history</h3><p class="muted" style="font-size:12.5px;line-height:1.5">
      ${s.enabled ? `Conversations are kept unless the visitor objected, and deleted ${number(s.days)} day${s.days === 1 ? '' : 's'} after their last question unless you keep one for a reason.` : 'The history is switched off: these conversations are deleted when their period ends.'}
      Visitors can delete their conversations in the chat; objecting (Stop keeping) or withdrawing consent deletes them too. No IP addresses and no files are kept.</p></div>`;
  }
}
customElements.define('ligata-ai-history', LigataAIHistory);
export default LigataAIHistory;
