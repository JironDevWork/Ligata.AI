import { LitElement, html, css, nothing } from '@umbraco-cms/backoffice/external/lit';
import { UmbElementMixin } from '@umbraco-cms/backoffice/element-api';
import { UMB_AUTH_CONTEXT } from '@umbraco-cms/backoffice/auth';
import { aiRequest } from '../api.js?v=0.13.1';
import { styles } from '../styles.js?v=0.13.1';
import { icon, controls, number, compact } from '../ui.js?v=0.13.1';
import { glyph, kindIcon, kindLabel, documentPath, go, diff, when, modeInfo, effortInfo } from './shared.js?v=0.13.1';

const tabs = [['activity', 'Activity', 'history'], ['settings', 'Settings', 'sliders'], ['usage', 'Usage', 'chart'], ['privacy', 'Privacy', 'shield']];
const actions = [
  ['edit', 'Change content', 'Text, fields and blocks of pages, saved as drafts.'],
  ['create', 'Create pages', 'New pages, saved as drafts.'],
  ['publish', 'Publish', 'Make drafts live on the website.'],
  ['unpublish', 'Unpublish', 'Take pages off the website.'],
  ['move', 'Move and sort', 'Move pages in the tree or change their order.'],
  ['delete', 'Delete', 'Move pages to the recycle bin (never deleted for good).'],
  ['media', 'Upload images', 'Save images attached in the chat to the media library.'],
];
const kinds = [['', 'Everything'], ...actions.map(([k]) => [k, kindLabel(k)]), ['declined', 'Declined'], ['failed', 'Not done'], ['undone', 'Undone']];
// Claude Haiku 5.5 list prices per million tokens (prompts up to 100k tokens): input, cached input, output.
const prices = { 'claude-haiku-5-5': [0.10, 0.01, 0.50] };

/**
 * The content assistant for the editor groups: what it did and who steered it (Activity), what it may do and for whom
 * (Settings), and what it costs (Usage).
 */
class LigataAIEditorDashboard extends UmbElementMixin(LitElement) {
  static properties = Object.fromEntries(['tab', 'privacy', 'privacyLanguage', 'loaded', 'settings', 'version', 'saved', 'meta', 'busy', 'message', 'error', 'errors', 'activity', 'filter', 'open', 'detail', 'usage', 'tree', 'picking', 'typeFilter']
    .map(k => [k, { state: true }]));
  static styles = [styles, css`
    .lead{color:var(--muted);max-width:760px}
    table.grid-table{width:100%;border-collapse:collapse;font-size:13px}
    .grid-table th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);font-weight:700;padding:8px 10px;border-bottom:1px solid var(--line)}
    .grid-table td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
    .grid-table tr:last-child td{border-bottom:0}
    .grid-table .center{text-align:center}.grid-table input[type=checkbox]{width:16px;height:16px;accent-color:var(--accent);cursor:pointer}
    .mode-head{display:inline-flex;align-items:center;gap:5px}.mode-head svg{width:14px;height:14px}
    .action-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:16px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
    .action-row:last-child{border-bottom:0}.action-row small{display:block}
    .auto{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);white-space:nowrap}.auto input{accent-color:var(--accent)}
    .chips{display:flex;gap:6px;flex-wrap:wrap}.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 6px 4px 10px;border-radius:999px;background:var(--subtle);border:1px solid var(--line);font-size:12.5px}
    .chip button{border:0;background:none;color:var(--muted);display:grid;place-items:center;width:20px;height:20px;border-radius:50%}.chip button:hover{background:var(--surface);color:var(--uui-color-text)}.chip svg{width:13px;height:13px}
    .tree{border:1px solid var(--line);border-radius:10px;max-height:300px;overflow:auto;padding:6px}
    .tree-row{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:7px}.tree-row:hover{background:var(--subtle)}
    .tree-row .twist{width:22px;height:22px;border:0;background:none;display:grid;place-items:center;color:var(--muted);border-radius:6px}.tree-row .twist svg{width:14px;height:14px;transition:transform .15s}.tree-row .twist.open svg{transform:rotate(90deg)}
    .tree-row .name{flex:1}.tree-children{margin-left:18px}
    .types{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:4px 14px;max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px 10px}
    .types label{display:flex;gap:7px;align-items:center;font-size:13px;padding:3px 0}.types small{color:var(--muted)}
    .toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
    .toolbar input,.toolbar select{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface)}
    .toolbar input{min-width:240px;flex:1;max-width:380px}
    .feed{display:grid;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface)}
    .entry{border-bottom:1px solid var(--line)}.entry:last-child{border-bottom:0}
    .entry>button{width:100%;display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:12px;align-items:center;text-align:left;padding:11px 14px;border:0;background:none}
    .entry>button:hover{background:var(--subtle)}.entry.open>button{background:var(--subtle)}
    .kind{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent)}.kind svg{width:17px;height:17px}
    .kind.publish,.kind.unpublish{background:color-mix(in srgb,var(--ok) 12%,transparent);color:var(--ok)}.kind.delete{background:color-mix(in srgb,var(--danger) 10%,transparent);color:var(--danger)}
    .kind.move,.kind.media{background:color-mix(in srgb,var(--warn) 12%,transparent);color:var(--warn)}
    .entry .what{display:grid;gap:2px;min-width:0}.entry .what strong{font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .entry .meta{font-size:12px;color:var(--muted);display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .entry .tags{display:flex;gap:6px;align-items:center}
    .who{display:inline-flex;align-items:center;gap:5px}.who i{width:18px;height:18px;border-radius:50%;display:inline-grid;place-items:center;font-style:normal;font-size:10px;font-weight:700;background:var(--accent-soft);color:var(--accent)}
    .detail{padding:4px 14px 16px 60px;display:grid;gap:10px}
    .asked{font-size:13px;padding:8px 12px;border-radius:10px;background:var(--subtle);border:1px solid var(--line)}.asked b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
    .diff-field{display:grid;gap:4px}.diff-field .label{font-size:11.5px;font-weight:700;color:var(--muted)}
    .diff-value{font-size:13px;padding:8px 10px;border-radius:8px;background:var(--subtle);white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto}
    .diff-value.removed{background:color-mix(in srgb,var(--danger) 8%,var(--surface));text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--danger) 55%,transparent)}
    .diff-value.added{background:color-mix(in srgb,var(--ok) 10%,var(--surface))}
    del{background:color-mix(in srgb,var(--danger) 16%,transparent);border-radius:3px}ins{background:color-mix(in srgb,var(--ok) 20%,transparent);text-decoration:none;border-radius:3px}
    .lang{font-size:10.5px;font-weight:700;padding:1px 5px;border-radius:4px;background:var(--subtle);border:1px solid var(--line);color:var(--muted)}
    .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-bottom:18px}
    .tile{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--surface)}.tile b{display:block;font-size:22px;letter-spacing:-.4px;font-variant-numeric:tabular-nums}.tile small{font-size:12px}
    .bars{display:flex;align-items:flex-end;gap:4px;height:120px;padding:10px 0 0;border-bottom:1px solid var(--line)}.bars i{flex:1;min-width:4px;max-width:28px;border-radius:4px 4px 0 0;background:var(--accent);opacity:.8;position:relative}.bars i:hover{opacity:1}
    .status-line{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .ok-text{color:var(--ok)}.bad-text{color:var(--danger)}
    .more{display:flex;justify-content:center;padding:12px}
    .empty-feed{padding:40px 20px;text-align:center;color:var(--muted)}
  `];

  constructor() {
    super();
    const wanted = new URLSearchParams(location.search).get('tab');
    Object.assign(this, { tab: tabs.some(t => t[0] === wanted) ? wanted : 'activity', loaded: false, busy: false, message: '', error: '', errors: {}, filter: { q: '', kind: '', user: '' }, activity: null, open: null, detail: null, tree: {}, picking: false, typeFilter: '' });
    this.consumeContext(UMB_AUTH_CONTEXT, auth => { this.auth = auth; this.start(); });
  }

  request(path, method, body) { return aiRequest(this.auth, '/editor' + path, method, body); }

  async start() {
    if (this.started) return; this.started = true;
    try { await this.loadSettings(); await this.loadTab(); }
    catch (e) { this.error = e.status === 404 ? 'The content assistant is not included in this installation (LigataAI:Features:ContentAssistant).' : e.message; }
    this.loaded = true;
  }

  async loadSettings() {
    const data = await this.request('/settings');
    this.meta = data; this.settings = data.settings; this.version = data.version; this.saved = JSON.stringify(data.settings);
  }

  async loadTab() {
    if (this.tab === 'activity') await this.loadActivity();
    if (this.tab === 'usage') this.usage = await this.request('/usage?days=30');
    if (this.tab === 'privacy') await this.loadPrivacy();
  }

  /** The privacy note for staff, written for the settings on screen (unsaved changes too). */
  async loadPrivacy(language = this.privacyLanguage || 'de') {
    this.privacyLanguage = language;
    try { this.privacy = await this.request(`/privacy?language=${language}`, 'POST', this.settings); }
    catch (e) { this.privacy = { language, error: e.message }; }
  }

  async copyPrivacy() {
    try { await navigator.clipboard.writeText(this.privacy.text); this.message = 'Copied. Add it to your staff privacy notes or internal guidelines, and fill in the parts in [square brackets].'; }
    catch { this.error = 'The browser did not allow copying. Select the text and copy it with Ctrl+C.'; }
  }

  downloadPrivacy() {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([this.privacy.text], { type: 'text/markdown;charset=utf-8' }));
    link.download = this.privacy.language === 'de' ? 'datenschutz-inhaltsassistent.md' : 'privacy-content-assistant.md';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  get dirty() { return this.settings && JSON.stringify(this.settings) !== this.saved; }

  set(path, value) {
    const keys = path.split('.');
    const next = structuredClone(this.settings);
    let target = next;
    for (const key of keys.slice(0, -1)) target = target[key];
    target[keys.at(-1)] = value;
    this.settings = next; this.message = '';
    if (this.errors[path]) { const { [path]: _, ...rest } = this.errors; this.errors = rest; }
  }

  async run(callback, success) {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.errors = {};
    try { await callback(); if (success) this.message = success; }
    catch (e) { this.error = e.message; this.errors = e.errors || {}; }
    finally { this.busy = false; }
  }

  async save() {
    const clean = structuredClone(this.settings);
    clean.access = clean.access.filter(a => a.modes.length);
    clean.autoApprove = clean.autoApprove.filter(a => clean.actions.includes(a));
    clean.scope.protectedFields = clean.scope.protectedFields.map(f => f.trim()).filter(Boolean);
    const result = await this.request('/settings', 'POST', { settings: clean, version: this.version });
    this.settings = result.settings; this.version = result.version; this.saved = JSON.stringify(result.settings);
    this.message = 'Saved. Open chats use the new settings with their next message.';
  }

  switchTab(tab) {
    this.tab = tab; this.message = ''; this.error = '';
    const url = new URL(location.href); url.searchParams.set('tab', tab); history.replaceState(history.state, '', url);
    this.run(() => this.loadTab());
  }

  render() {
    if (!this.loaded) return html`<div class="workspace"><div class="empty">${icon('refresh', 'spin')}<p>Loading…</p></div></div>`;
    if (!this.settings) return html`<div class="workspace"><div class="notice error">${icon('warn')}<div><strong>Could not load the content assistant</strong><p>${this.error}</p></div></div></div>`;
    const s = this.settings;
    return html`<div class="workspace">
      <div class="top">
        <div class="title"><span class="eyebrow">Ligata AI</span><h1>Content assistant</h1>
          <div class="row">${this.statusPill()}<span class="pill ${s.enabled ? 'ok' : ''}"><i></i>${s.enabled ? 'Switched on' : 'Switched off'}</span>${this.dirty ? html`<span class="pill warn"><i></i>Unsaved changes</span>` : nothing}</div></div>
        <div class="row">
          ${this.dirty ? html`<button class="btn quiet" ?disabled=${this.busy} @click=${() => { this.settings = JSON.parse(this.saved); this.errors = {}; }}>Discard</button>` : nothing}
          <button class="btn primary" ?disabled=${this.busy || !this.dirty} @click=${() => this.run(() => this.save())}>${icon('save')}${this.busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
      ${this.message ? html`<div class="notice success" role="status">${icon('check')}<div>${this.message}</div><button class="icon-btn" aria-label="Dismiss" @click=${() => this.message = ''}>${icon('close')}</button></div>` : nothing}
      ${this.error ? html`<div class="notice error" role="alert">${icon('warn')}<div><strong>Please check</strong><p>${this.error}</p>${Object.keys(this.errors).length ? html`<ul>${Object.values(this.errors).map(v => html`<li>${v}</li>`)}</ul>` : nothing}</div><button class="icon-btn" aria-label="Dismiss" @click=${() => this.error = ''}>${icon('close')}</button></div>` : nothing}
      <nav class="tabs" aria-label="Content assistant">${tabs.map(([id, label, i]) => html`<button aria-current=${this.tab === id ? 'page' : 'false'} @click=${() => this.switchTab(id)}>${id === 'activity' ? glyph('history') : icon(i)}${label}</button>`)}</nav>
      ${this.tab === 'settings' ? this.settingsView() : this.tab === 'usage' ? this.usageView() : this.tab === 'privacy' ? this.privacyView() : this.activityView()}
    </div>`;
  }

  statusPill() {
    const c = this.meta?.claude;
    if (!c) return nothing;
    return c.ready ? html`<span class="pill ok"><i></i>${c.modelName}</span>` : html`<span class="pill bad" title="Add an Anthropic API key under AI Assistant → Settings → Connection"><i></i>No Anthropic API key</span>`;
  }

  // ---------- activity ----------
  async loadActivity(more) {
    const f = this.filter;
    const params = new URLSearchParams({ take: '50', skip: more ? String(this.activity?.items.length || 0) : '0' });
    if (f.q.trim()) params.set('q', f.q.trim());
    if (f.kind) params.set('kind', f.kind);
    if (f.user) params.set('user', f.user);
    const seq = this.seq = (this.seq || 0) + 1;
    const data = await this.request('/activity?' + params);
    if (seq !== this.seq) return;
    this.activity = more ? { ...data, items: [...this.activity.items, ...data.items] } : data;
  }

  filterBy(key, value) {
    this.filter = { ...this.filter, [key]: value };
    clearTimeout(this.filterTimer);
    this.filterTimer = setTimeout(() => this.loadActivity().catch(e => this.error = e.message), key === 'q' ? 300 : 0);
  }

  async toggleEntry(row) {
    if (this.open === row.id) { this.open = null; return; }
    this.open = row.id; this.detail = null;
    try { this.detail = await this.request('/activity/' + row.id); } catch (e) { this.error = e.message; }
  }

  async undo(row) {
    if (!confirm(`Undo “${row.summary}”?`)) return;
    await this.run(async () => {
      await this.request(`/activity/${row.id}/undo`, 'POST');
      await this.loadActivity();
      this.open = null;
    }, 'Undone. The values from before are back (as a draft).');
  }

  activityView() {
    const a = this.activity;
    return html`
      <p class="lead">Everything the content assistant did or proposed: who was steering it, what they asked, what changed (before and after) and how it was approved. Changes can be undone while nothing else changed them since.</p>
      <div class="toolbar">
        <input type="search" placeholder="Search pages, requests or people…" .value=${this.filter.q} @input=${e => this.filterBy('q', e.target.value)}>
        <select @change=${e => this.filterBy('kind', e.target.value)}>${kinds.map(([v, l]) => html`<option value=${v} .selected=${this.filter.kind === v}>${l}</option>`)}</select>
        <select @change=${e => this.filterBy('user', e.target.value)}><option value="">Everyone</option>${(a?.users || []).map(u => html`<option value=${u.key} .selected=${this.filter.user === u.key}>${u.name}</option>`)}</select>
        <span class="grow"></span>${a ? html`<small>${number(a.total)} entr${a.total === 1 ? 'y' : 'ies'}</small>` : nothing}
      </div>
      ${!a ? html`<div class="empty">${icon('refresh', 'spin')}</div>` : a.items.length === 0 ? html`<div class="feed"><div class="empty-feed">${this.filter.q || this.filter.kind || this.filter.user ? 'Nothing matches these filters.' : 'Nothing yet. What the assistant changes shows up here.'}</div></div>` : html`
        <div class="feed">${a.items.map(row => this.entry(row))}</div>
        ${a.items.length < a.total ? html`<div class="more"><button class="btn" @click=${() => this.run(() => this.loadActivity(true))}>Show more</button></div>` : nothing}`}`;
  }

  entry(row) {
    const open = this.open === row.id;
    const outcome = { done: html`<span class="pill ok"><i></i>Done</span>`, failed: html`<span class="pill bad"><i></i>Not done</span>`, declined: html`<span class="pill"><i></i>Declined</span>`, undone: html`<span class="pill info"><i></i>Undone</span>` }[row.outcome] || nothing;
    const approval = { manual: 'approved by hand', auto: 'auto mode', bypass: 'bypass mode', undo: 'undo' }[row.approval] || row.approval;
    return html`<div class="entry ${open ? 'open' : ''}">
      <button aria-expanded=${String(open)} @click=${() => this.toggleEntry(row)}>
        <span class="kind ${row.kind}">${glyph(row.tool === 'undo' ? 'undo' : kindIcon(row.kind))}</span>
        <span class="what"><strong>${row.summary}</strong>
          <span class="meta"><span class="who"><i>${(row.userName || '?').slice(0, 1).toUpperCase()}</i>${row.userName}</span>·<span>${when(row.created)}</span>·<span>${row.outcome === 'declined' ? 'proposed' : approval}</span>${row.culture ? html`<span class="lang">${row.culture}</span>` : nothing}</span></span>
        <span class="tags">${outcome}</span>
      </button>
      ${open ? this.entryDetail(row) : nothing}
    </div>`;
  }

  entryDetail(row) {
    const d = this.detail;
    if (!d || d.action.id !== row.id) return html`<div class="detail">${icon('refresh', 'spin')}</div>`;
    return html`<div class="detail">
      ${row.request ? html`<div class="asked"><b>${row.userName} asked</b>${row.request}</div>` : nothing}
      ${d.changes.map(c => this.diffField(c))}
      ${row.error ? html`<div class="notice error">${icon('warn')}<div>${row.error}</div></div>` : nothing}
      ${row.undone ? html`<small>Undone by ${row.undoneBy} on ${when(row.undone)}.</small>` : nothing}
      <div class="row">
        ${row.documentKey && row.kind !== 'media' && row.outcome !== 'declined' ? html`<button class="btn small" @click=${() => go(documentPath(row.documentKey, row.culture))}>${glyph('open')}Open page</button>` : nothing}
        ${row.undoable ? html`<button class="btn small" ?disabled=${this.busy} @click=${() => this.undo(row)}>${glyph('undo')}Undo</button>` : nothing}
      </div>
    </div>`;
  }

  diffField(c) {
    const before = c.beforeText ?? '', after = c.afterText ?? '';
    const label = html`<span class="label">${c.label}${c.culture ? html` <span class="lang">${c.culture}</span>` : nothing}</span>`;
    if (!before) return html`<div class="diff-field">${label}<div class="diff-value added">${after || '(empty)'}</div></div>`;
    if (!after) return html`<div class="diff-field">${label}<div class="diff-value removed">${before}</div></div>`;
    const parts = diff(before, after);
    const share = parts.filter(p => p.op !== 'same').reduce((n, p) => n + p.text.length, 0) / Math.max(1, before.length + after.length);
    if (share > 0.6) return html`<div class="diff-field">${label}<div class="diff-value removed">${before}</div><div class="diff-value added">${after}</div></div>`;
    return html`<div class="diff-field">${label}<div class="diff-value">${parts.map(p => p.op === 'same' ? p.text : p.op === 'del' ? html`<del>${p.text}</del>` : html`<ins>${p.text}</ins>`)}</div></div>`;
  }

  // ---------- settings ----------
  settingsView() {
    const s = this.settings, m = this.meta;
    return html`<div class="grid" style="max-width:1100px">
      <section class="card">
        <header><div><h2>Content assistant</h2><p class="muted">A chat at the bottom right of the backoffice that finds, reads and changes content for the people below, with their own Umbraco permissions. It uses ${m.claude.modelName} with the Anthropic API key under Connection.</p></div>
          <label class="switch"><input type="checkbox" .checked=${s.enabled} @change=${e => this.set('enabled', e.target.checked)}><span>${s.enabled ? 'On' : 'Off'}</span></label></header>
        ${!m.claude.ready ? html`<div class="notice warning">${icon('warn')}<div>No Anthropic API key is set up. Add it under <a href="/umbraco/section/ai-assistant/dashboard/settings?tab=connection">Settings → Connection</a>; until then only administrators see the assistant (with this hint).</div></div>` : nothing}
      </section>
      ${this.whoCard()}
      ${this.actionsCard()}
      ${this.whereCard()}
      ${this.behaviourCard()}
      ${this.limitsCard()}
    </div>`;
  }

  whoCard() {
    const s = this.settings, groups = this.meta.groups;
    const modesOf = alias => s.access.find(a => a.group.toLowerCase() === alias.toLowerCase())?.modes || [];
    // Read only comes with every other mode (it can only do less), so it is ticked and locked there.
    const implied = (alias, mode) => mode === 'readonly' && modesOf(alias).some(m => m !== 'readonly');
    const toggle = (alias, mode, on) => {
      const access = structuredClone(s.access);
      let entry = access.find(a => a.group.toLowerCase() === alias.toLowerCase());
      if (!entry) { entry = { group: alias, modes: [] }; access.push(entry); }
      entry.modes = on ? [...new Set([...entry.modes, mode])].sort((a, b) => Object.keys(modeInfo).indexOf(a) - Object.keys(modeInfo).indexOf(b)) : entry.modes.filter(x => x !== mode);
      this.set('access', access.filter(a => a.modes.length));
    };
    return html`<section class="card">
      <header><div><h2>Who can use it</h2><p class="muted">A user group with at least one mode sees the assistant. People in several groups get every mode of their groups. Groups that may change content can always switch to Read only; give a group only Read only to let it find and read. Start with administrators; add other groups once it has proven itself.</p></div></header>
      <table class="grid-table"><thead><tr><th>User group</th>${Object.entries(modeInfo).map(([k, v]) => html`<th class="center" title=${v.text}><span class="mode-head">${glyph(v.icon)}${v.label}</span></th>`)}</tr></thead>
        <tbody>${groups.map(g => html`<tr><td><strong>${g.name}</strong> <small class="muted">${g.alias}</small></td>
          ${Object.keys(modeInfo).map(mode => html`<td class="center"><input type="checkbox" aria-label="${g.name}: ${modeInfo[mode].label}" .checked=${modesOf(g.alias).includes(mode) || implied(g.alias, mode)} ?disabled=${implied(g.alias, mode)} title=${implied(g.alias, mode) ? 'Comes with the other modes of this group' : ''} @change=${e => toggle(g.alias, mode, e.target.checked)}></td>`)}</tr>`)}
        </tbody></table>
      ${this.fieldError('access')}
      <div class="section">
        ${this.segmented('defaultMode', 'Mode of a new conversation', Object.entries(modeInfo).map(([k, v]) => [k, v.label]), 'Each person can switch between the modes their group allows, in the chat.')}
        <div class="grid two">${Object.entries(modeInfo).map(([k, v]) => html`<div class="row" style="align-items:flex-start;gap:8px">${glyph(v.icon)}<small><b>${v.label}</b>: ${k === 'auto' ? `makes the changes ticked under “Auto approves” on its own unless they are risky (clearing a field, removing a block, changing what all languages share), and asks before the others.` : v.text}</small></div>`)}</div>
      </div>
    </section>`;
  }

  actionsCard() {
    const s = this.settings;
    const toggle = (key, list, on) => this.set(list, on ? [...new Set([...s[list], key])] : s[list].filter(x => x !== key));
    return html`<section class="card">
      <header><div><h2>What it may do</h2><p class="muted">Finding, reading and opening pages is always allowed. Changes are only made where the person steering it may make them in Umbraco.</p></div></header>
      ${actions.map(([key, label, help]) => html`<div class="action-row">
        <div><strong>${label}</strong><small class="muted">${help}</small></div>
        <label class="auto" title="In Auto mode, this runs without asking"><input type="checkbox" .checked=${s.autoApprove.includes(key)} ?disabled=${!s.actions.includes(key)} @change=${e => toggle(key, 'autoApprove', e.target.checked)}>Auto approves</label>
        <label class="switch small"><input type="checkbox" .checked=${s.actions.includes(key)} @change=${e => { toggle(key, 'actions', e.target.checked); if (!e.target.checked) this.set('autoApprove', this.settings.autoApprove.filter(x => x !== key)); }}><span class="sr-only"></span></label>
      </div>`)}
      <div class="section">
        ${this.text('askAfterChanges', 'In Auto mode, ask again after this many changes for one message', { type: 'number', help: 'A safety net against long runs of changes. 0 never asks again.' })}
      </div>
    </section>`;
  }

  async loadTree(parent) {
    const key = parent || 'root';
    if (this.tree[key]) { this.tree = { ...this.tree, [key + ':open']: !this.tree[key + ':open'] }; return; }
    const items = await this.request('/tree' + (parent ? '?parent=' + parent : ''));
    this.tree = { ...this.tree, [key]: items, [key + ':open']: true };
  }

  treeRows(parent) {
    const items = this.tree[parent || 'root'] || [];
    const chosen = this.settings.scope.roots;
    return items.map(n => html`<div class="tree-row">
        ${n.hasChildren ? html`<button class="twist ${this.tree[n.key + ':open'] ? 'open' : ''}" aria-label="Show subpages" @click=${() => this.loadTree(n.key)}>${glyph('chevron')}</button>` : html`<span style="width:22px"></span>`}
        <span class="name">${n.name}</span>
        <button class="btn small" ?disabled=${chosen.includes(n.key)} @click=${() => this.addRoot(n)}>${chosen.includes(n.key) ? 'Chosen' : 'Choose'}</button>
      </div>${this.tree[n.key + ':open'] ? html`<div class="tree-children">${this.treeRows(n.key)}</div>` : nothing}`);
  }

  addRoot(node) {
    this.meta = { ...this.meta, roots: [...this.meta.roots.filter(r => r.key !== node.key), { key: node.key, name: node.name, path: node.name }] };
    this.set('scope.roots', [...this.settings.scope.roots, node.key]);
  }

  whereCard() {
    const s = this.settings, m = this.meta;
    const rootName = key => m.roots.find(r => r.key === key)?.path || key;
    const filter = this.typeFilter.toLowerCase();
    const types = m.types.filter(t => !filter || t.name.toLowerCase().includes(filter) || t.alias.toLowerCase().includes(filter));
    const toggleType = (alias, on) => this.set('scope.readOnlyTypes', on ? [...s.scope.readOnlyTypes, alias] : s.scope.readOnlyTypes.filter(a => a !== alias));
    return html`<section class="card">
      <header><div><h2>Where it may work</h2><p class="muted">Always within each person's own start nodes and permissions in Umbraco; these settings narrow it further.</p></div></header>
      <div class="section">
        <div class="control"><span>Parts of the site</span>
          <div class="chips">${s.scope.roots.length === 0 ? html`<span class="chip">The whole site</span>` : s.scope.roots.map(k => html`<span class="chip">${glyph('page')}${rootName(k)}<button aria-label="Remove" @click=${() => this.set('scope.roots', s.scope.roots.filter(r => r !== k))}>${icon('close')}</button></span>`)}
            <button class="btn small" @click=${() => { this.picking = !this.picking; if (this.picking && !this.tree.root) this.loadTree(null); }}>${icon('plus')}${this.picking ? 'Done' : 'Choose pages'}</button></div>
          <small>The assistant reads and changes only these pages and everything below them.</small>
          ${this.picking ? html`<div class="tree">${this.treeRows(null)}</div>` : nothing}
        </div>
      </div>
      <div class="section">
        <div class="control"><span>Read-only page and block types</span>
          <input type="search" placeholder="Filter types…" .value=${this.typeFilter} @input=${e => this.typeFilter = e.target.value} style="max-width:320px;border:1px solid var(--line);border-radius:8px;padding:8px 10px">
          <div class="types">${types.map(t => html`<label><input type="checkbox" .checked=${s.scope.readOnlyTypes.includes(t.alias)} @change=${e => toggleType(t.alias, e.target.checked)}>${t.name} <small>${t.element ? 'block' : 'page'}</small></label>`)}</div>
          <small>It can read these but never change them (for example the website settings or a form block).</small></div>
      </div>
      <div class="section">
        ${this.list('scope.protectedFields', 'Protected fields', { max: 40, placeholder: 'Property alias, e.g. umbracoNaviHide', help: 'Fields it never changes, on any page or block.' })}
      </div>
      <div class="section">
        <div class="control"><span>Languages it may change</span>
          <div class="row">${m.languages.map(l => html`<label class="switch small"><input type="checkbox" .checked=${s.scope.cultures.length === 0 || s.scope.cultures.includes(l.isoCode)} @change=${e => {
            const all = m.languages.map(x => x.isoCode);
            const current = s.scope.cultures.length ? s.scope.cultures : all;
            const next = e.target.checked ? [...new Set([...current, l.isoCode])] : current.filter(c => c !== l.isoCode);
            this.set('scope.cultures', next.length === all.length ? [] : next);
          }}><span>${l.cultureName}${l.isDefault ? ' (default)' : ''}</span></label>`)}</div>
          <small>It reads every language; it writes only these.</small></div>
      </div>
    </section>`;
  }

  behaviourCard() {
    return html`<section class="card">
      <header><div><h2>How it works</h2></div></header>
      <div class="section">
        ${this.meta.effortFromConfig
          ? html`<div class="control"><span>Thinking effort</span><div class="row"><span class="pill info"><i></i>${effortInfo[this.meta.effortFromConfig]}</span><small>Set in the site's configuration (<code>LigataAI:ContentAssistant:Effort</code>), which wins over this page.</small></div></div>`
          : this.segmented('effort', 'Thinking effort', ['off', 'low', 'medium', 'high', 'xhigh'].map(e => [e, effortInfo[e]]), 'How much it thinks before acting. Medium suits most editing; higher takes longer and costs more. A default can also be set in the configuration (LigataAI:ContentAssistant:Effort).')}
        ${this.toggle('effortInChat', 'Editors may choose Low, Medium or High in the chat')}
      </div>
      <div class="section">
        ${this.text('guidelines', 'Editorial guidelines', { rows: 6, max: 4000, placeholder: 'For example: Swiss spelling (ss instead of ß). Address readers formally (Sie). Headings without a full stop. Keep the brand name “Atelier Ahorn” as is.', help: 'Rules it follows whenever it writes content.' })}
      </div>
    </section>`;
  }

  limitsCard() {
    return html`<section class="card">
      <header><div><h2>Limits and records</h2><p class="muted">Separate from the website assistant's limits.</p></div></header>
      <div class="grid three">
        ${this.text('limits.messagesPerUser', 'Messages per person per day', { type: 'number', help: '0 = unlimited.' })}
        ${this.text('limits.messagesPerDay', 'Messages per day for the whole site', { type: 'number', help: 'A ceiling on cost. 0 = unlimited.' })}
        ${this.text('limits.maxSteps', 'Steps per message', { type: 'number', help: 'Searches, reads and changes before it must answer (2–60).' })}
        ${this.text('limits.keepChatsDays', 'Keep conversations (days)', { type: 'number', help: 'Each person sees only their own.' })}
        ${this.text('limits.keepActivityDays', 'Keep the activity log (days)', { type: 'number' })}
      </div>
    </section>`;
  }

  // ---------- usage ----------
  privacyView() {
    const note = this.privacy, language = this.privacyLanguage || 'de', responsible = !!this.settings.responsible?.trim();
    return html`<div class="grid">
      <section class="card">
        <header><div><h2>Who is responsible</h2><p class="muted">The employer or site operator with its address, and a contact for privacy questions. It opens the privacy note below and the one editors read in the chat.</p></div></header>
        ${this.text('responsible', 'Responsible party and privacy contact', { rows: 4, max: 1000, placeholder: 'Atelier Ahorn GmbH, Musterstrasse 12, 8400 Winterthur\nPrivacy questions: datenschutz@ahorn.example' })}
        ${!responsible ? html`<div class="notice warning">${icon('warn')}<div>Until you fill this in and save, editors see a placeholder in square brackets in the chat's privacy note.</div></div>` : nothing}
        <div class="section">${this.toggle('notForMonitoring', 'The activity log is not used to monitor staff', 'Adds to the note: the activity log and the usage figures are not used to monitor performance or behaviour. Switch it on only when that holds, for example under a works agreement.')}</div>
      </section>
      <section class="card">
        <header><div><h2>Privacy note for staff</h2><p class="muted">What the people who use the assistant need to know (Art. 13 GDPR, Art. 19 DSG): what goes to Anthropic, who sees what, how long it is kept. Written for these settings, including unsaved changes. Editors read the saved version in the chat under <em>Privacy note</em>, in their backoffice language. A template, not legal advice: have it reviewed.</p></div></header>
        <div class="row">
          <div class="segmented" role="group" aria-label="Language">${[['de', 'Deutsch'], ['en', 'English']].map(([value, label]) => html`<button type="button" aria-pressed=${String(language === value)} @click=${() => this.loadPrivacy(value)}>${label}</button>`)}</div>
          <span class="grow"></span>
          <button type="button" class="btn small" @click=${() => this.loadPrivacy(language)}>${icon('refresh')}Update</button>
          <button type="button" class="btn small" ?disabled=${!note?.text} @click=${() => this.downloadPrivacy()}>${icon('file')}Download</button>
          <button type="button" class="btn small primary" ?disabled=${!note?.text} @click=${() => this.copyPrivacy()}>${icon('copy')}Copy</button>
        </div>
        ${note?.error ? html`<div class="notice error">${icon('warn')}<div>${note.error}</div></div>`
          : html`<pre class="code policy" aria-label="Privacy note for staff" tabindex="0">${note?.text || 'Loading…'}</pre>`}
        <ul class="checklist section">
          <li><span class="mark">${icon('edit')}</span><div class="grow"><small>Give the note to everyone in the groups that may use the assistant, for example with your staff privacy notes or internal guidelines. Fill in the parts in [square brackets].</small></div></li>
          <li><span class="mark">${icon('edit')}</span><div class="grow"><small>The activity log and the usage per person show who did what, and when. In Germany, involve an existing works council before you introduce the assistant (§ 87(1) no. 6 BetrVG); in Austria a works agreement may be needed (§§ 96, 96a ArbVG). In Switzerland, monitoring behaviour is not allowed (Art. 26 ArGV 3); a log that makes changes traceable is, when proportionate and staff are informed.</small></div></li>
          <li><span class="mark">${icon('edit')}</span><div class="grow"><small>Add the assistant to your record of processing activities, and keep Anthropic’s Data Processing Addendum with your records. The template also lives in the package under <code>docs/privacy/staff-de.md</code> and <code>staff-en.md</code>.</small></div></li>
        </ul>
      </section>
    </div>`;
  }

  usageView() {
    const u = this.usage;
    if (!u) return html`<div class="empty">${icon('refresh', 'spin')}</div>`;
    const sum = key => u.days.reduce((n, d) => n + d[key], 0);
    const price = prices[u.model];
    const cost = price ? ((sum('promptTokens') - sum('cachedTokens')) * price[0] + sum('cachedTokens') * price[1] + sum('completionTokens') * price[2]) / 1e6 : null;
    const max = Math.max(1, ...u.days.map(d => d.messages));
    return html`
      <p class="lead">The last 30 days. Limits: ${u.limits.messagesPerUser || 'unlimited'} messages per person and ${u.limits.messagesPerDay || 'unlimited'} for the site per day.</p>
      <div class="tiles">
        <div class="tile"><b>${number(sum('messages'))}</b><small class="muted">messages</small></div>
        <div class="tile"><b>${number(sum('changes'))}</b><small class="muted">changes made</small></div>
        <div class="tile"><b>${number(sum('steps'))}</b><small class="muted">tool steps</small></div>
        <div class="tile"><b>${compact(sum('promptTokens'))} / ${compact(sum('completionTokens'))}</b><small class="muted">tokens in / out (${compact(sum('cachedTokens'))} from cache)</small></div>
        ${cost != null ? html`<div class="tile"><b>≈ $${cost.toFixed(cost < 1 ? 3 : 2)}</b><small class="muted">at Claude Haiku 5.5 list prices</small></div>` : nothing}
      </div>
      <section class="card"><header><h2>Messages per day</h2></header>
        ${u.days.length === 0 ? html`<p class="muted">No messages yet.</p>` : html`<div class="bars">${u.days.map(d => html`<i style="height:${Math.max(4, d.messages / max * 100)}%" title="${d.day}: ${d.messages} messages, ${d.changes} changes"></i>`)}</div>`}
      </section>
      <section class="card" style="margin-top:18px"><header><h2>By person</h2></header>
        ${u.users.length === 0 ? html`<p class="muted">Nobody has used it yet.</p>` : html`<table class="grid-table"><thead><tr><th>Person</th><th>Today</th><th>Messages</th><th>Changes</th><th>Tokens in / out</th></tr></thead>
          <tbody>${u.users.map(p => html`<tr><td><strong>${p.name}</strong></td><td>${p.today}</td><td>${number(p.messages)}</td><td>${number(p.changes)}</td><td>${compact(p.promptTokens)} / ${compact(p.completionTokens)}</td></tr>`)}</tbody></table>`}
      </section>`;
  }
}
Object.assign(LigataAIEditorDashboard.prototype, controls);
customElements.define('ligata-ai-editor-dashboard', LigataAIEditorDashboard);
export default LigataAIEditorDashboard;
