import { html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { icon, number, compact, date } from './ui.js?v=0.7.3';

const kinds = { text: ['text', 'Text'], file: ['file', 'File'] };

/** The path is the prefix or below it, by whole segments (as on the server). */
const below = (path, prefix) => {
  const p = path.endsWith('/') ? path : path + '/';
  return p.toLowerCase().startsWith((prefix.endsWith('/') ? prefix : prefix + '/').toLowerCase()) || (prefix === '/' && p === '/');
};

export const knowledgeView = {
  async uploadFiles(files) {
    const list = [...files];
    if (!list.length) return;
    await this.run(async () => {
      const warnings = [];
      for (const [index, file] of list.entries()) {
        this.message = `Reading ${file.name} (${index + 1} of ${list.length})…`;
        const form = new FormData();
        form.append('file', file);
        try {
          const result = await this.request('/knowledge/upload', 'POST', form, { timeout: 180000 });
          this.knowledge = [...this.knowledge.filter(k => k.id !== result.item.id), result.item];
          if (result.warning) warnings.push(`${file.name}: ${result.warning}`);
        } catch (e) { warnings.push(`${file.name}: ${e.message}`); }
      }
      this.message = `${list.length - warnings.filter(w => !w.includes('looked up when needed')).length} of ${list.length} file${list.length === 1 ? '' : 's'} added.`;
      this.warning = warnings.join(' ');
      this.loadIndex();
    });
  },

  async openEditor(item) {
    if (item) await this.run(async () => { const full = await this.request('/knowledge/' + item.id); this.editing = { id: full.id, title: full.title, text: full.text, kind: full.kind }; });
    else this.editing = { id: null, title: '', text: '', kind: 'text' };
    await this.updateComplete;
    this.renderRoot.querySelector('dialog.editor')?.showModal();
  },

  async saveEditor(event) {
    event.preventDefault();
    await this.run(async () => {
      const result = await this.request('/knowledge', 'POST', { id: this.editing.id, title: this.editing.title, text: this.editing.text });
      this.knowledge = [...this.knowledge.filter(k => k.id !== result.item.id), result.item].sort((a, b) => a.sortOrder - b.sortOrder);
      this.renderRoot.querySelector('dialog.editor')?.close();
      this.editing = null;
      this.warning = result.warning || '';
      this.loadIndex();
    }, 'Knowledge saved.');
  },

  async toggleItem(item, enabled) {
    await this.run(async () => {
      await this.request(`/knowledge/${item.id}/enabled`, 'POST', { enabled });
      this.knowledge = this.knowledge.map(k => k.id === item.id ? { ...k, enabled } : k);
      this.loadIndex();
    });
  },

  /** Always known (read with every question, uses the budget) or looked up when needed. */
  async pinItem(item, pinned) {
    await this.run(async () => {
      await this.request(`/knowledge/${item.id}/pinned`, 'POST', { enabled: pinned });
      this.knowledge = this.knowledge.map(k => k.id === item.id ? { ...k, pinned } : k);
      this.refreshBudget(); this.loadIndex();
    }, pinned ? `“${item.title}” is now read with every question.` : `“${item.title}” is now looked up when needed.`);
  },

  async deleteItem(item) {
    if (!confirm(`Delete “${item.title}”? The assistant will no longer know this content.`)) return;
    await this.run(async () => { await this.request('/knowledge/' + item.id, 'DELETE'); this.knowledge = this.knowledge.filter(k => k.id !== item.id); this.loadIndex(); }, 'Knowledge deleted.');
  },

  async moveItem(index, delta) {
    const list = [...this.knowledge];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.knowledge = list.map((k, i) => ({ ...k, sortOrder: i }));
    await this.run(() => this.request('/knowledge/order', 'POST', { ids: list.map(k => k.id) }));
  },

  async recount() { await this.run(async () => { this.knowledge = (await this.request('/knowledge/recount', 'POST', {}, { timeout: 180000 })).knowledge; }, `Token counts updated by ${this.api() ? 'Claude' : 'the AI gateway'}.`); },

  /** What the assistant can look up (saved settings) and, with a query, a test search. */
  async loadIndex(query = '') {
    try { this.index = await this.request('/knowledge/index' + (query ? '?q=' + encodeURIComponent(query) : '')); } catch { this.index = null; }
  },

  async loadPages() {
    try { this.pages = await this.request('/pages'); } catch (e) { this.pages = []; this.error = e.message; }
  },

  async openPages() {
    await this.loadPages();
    this.pageFilter = '';
    await this.updateComplete;
    this.renderRoot.querySelector('dialog.pages-dialog')?.showModal();
  },

  /** Why a page is not read: null when it is. */
  pageState(page) {
    const k = this.settings.knowledge;
    if (!page.hasTemplate) return 'no-template';
    if (!k.usePages) return 'off';
    if (k.excludedPaths.some(p => p.trim() && below(page.url, p.trim()))) return 'section';
    return k.excludedPages.includes(page.key) ? 'page' : null;
  },

  setPage(page, used) {
    const excluded = this.settings.knowledge.excludedPages.filter(key => key !== page.key);
    this.set('knowledge.excludedPages', used ? excluded : [...excluded, page.key]);
  },

  knowledgeView() {
    const b = this.settings.behaviour;
    const k = this.settings.knowledge;
    const items = this.knowledge.filter(item => item.kind !== 'page');
    const used = items.filter(item => item.enabled && item.pinned).reduce((n, item) => n + item.tokens, 0);
    const over = used > b.knowledgeBudget;
    const estimated = items.some(item => item.estimated && item.pinned);
    const pages = this.pages || [];
    const readable = pages.filter(p => p.hasTemplate);
    const usedPages = readable.filter(p => !this.pageState(p)).length;
    const shown = pages.filter(p => !this.pageFilter || `${p.name} ${p.url}`.toLowerCase().includes(this.pageFilter.toLowerCase()));
    const i = this.index;
    if (!this.pages && !this.loadingPages) { this.loadingPages = true; this.loadPages(); if (!this.index) this.loadIndex(); }
    const reasons = { 'no-template': 'not a web page', off: 'website pages are off', section: 'in a left-out section', page: 'left out' };
    return html`<div class="grid">
      <section class="card">
        <header><div><h2>Knowledge</h2><p class="muted">The assistant looks up what it needs while it answers: it searches your website pages and the documents below and reads only what fits the question. So even a large website fits, and new pages are known as soon as they are published.</p></div></header>
        <div class="row">
          <span class="pill info">${icon('page')}${i ? `${number(i.pages)} page${i.pages === 1 ? '' : 's'}` : '…'}</span>
          <span class="pill info">${icon('file')}${i ? `${number(i.documents)} document${i.documents === 1 ? '' : 's'}` : '…'}</span>
          ${i?.languages?.length > 1 ? html`<span class="pill info">${icon('globe')}${i.languages.join(' · ')}</span>` : nothing}
          <small class="muted grow">searchable right now (saved settings)${i?.languages?.length > 1 ? ', every language on its own' : ''}${i?.textTokens ? ` · about ${compact(i.textTokens)} tokens of text, read only when a question needs it` : ''}</small>
        </div>
        ${i?.truncated ? html`<div class="notice warning section">${icon('warn')}<div>This website has more pages than the assistant reads (the first ${number(i.maxPages)}, closest to the top). Leave out sections it does not need, such as archives, so it reads the pages that matter.</div></div>` : nothing}
        ${i?.siteMap ? html`<details class="section"><summary>What the assistant gets with every question</summary><pre class="code">${i.siteMap}</pre><small class="muted">The list of pages, without their text: the assistant searches and reads the text when a question needs it.</small></details>` : nothing}
        <form class="row section" @submit=${e => { e.preventDefault(); this.run(() => this.loadIndex(this.searchQuery || '')); }}>
          <label class="control grow" style="margin:0"><span class="sr">Test a search</span><input type="search" placeholder="Test a search, e.g. opening hours" .value=${this.searchQuery || ''} @input=${e => { this.searchQuery = e.target.value; }}></label>
          <button class="btn" ?disabled=${this.busy}>${icon('search')}Search</button>
        </form>
        ${i?.hits?.length ? html`<div class="hits">${i.hits.map(hit => html`<div class="hit"><strong>${hit.title}</strong> <small class="muted">${hit.url || 'document'}</small><p>${hit.text}</p></div>`)}</div>`
          : this.searchQuery && i?.hits ? html`<small class="muted">Nothing found. The assistant searches with other words too, and in the language of your website.</small>` : nothing}
      </section>

      <section class="card">
        <header><div><h2>Website pages</h2><p class="muted">Every published page is included, also pages you add later. Leave out what the assistant should not use.</p></div>
          <button class="btn" ?disabled=${!k.usePages} @click=${() => this.openPages()}>${icon('page')}Choose pages</button></header>
        ${this.toggle('knowledge.usePages', 'Use the website’s pages', 'Off: the assistant knows only the documents and texts below.')}
        ${k.usePages ? html`<p class="section"><strong>${this.pages ? `${number(usedPages)} of ${number(readable.length)} pages used` : 'Loading pages…'}</strong>${k.excludedPages.length ? html` <small class="muted">· ${number(k.excludedPages.length)} left out</small>` : nothing}</p>
          <div class="section">${this.list('knowledge.excludedPaths', 'Leave out whole sections', { max: 50, placeholder: '/shop/', help: 'A path leaves out its page and every page below it, also pages added later.' })}</div>` : nothing}
      </section>

      <section class="card">
        <header><div><h2>Documents and texts</h2><p class="muted">Price lists, FAQs, brochures: searched like your pages. Mark short essentials (opening hours, key facts) as <em>always known</em> to have them read with every question.</p></div>
          <div class="row"><button class="btn" @click=${() => this.openEditor(null)}>${icon('text')}Write text</button>
            <label class="btn primary">${icon('upload')}Upload files<input class="sr" type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm" @change=${e => { this.uploadFiles(e.target.files); e.target.value = ''; }}></label></div></header>
        <div class="row" style="margin-bottom:8px"><strong class="grow">Always known: ${number(used)} of ${number(b.knowledgeBudget)} tokens</strong>${estimated ? html`<button class="btn small" @click=${() => this.recount()}>${icon('refresh')}Count exactly</button>` : nothing}<button class="btn small quiet" @click=${() => { this.tab = 'behaviour'; }}>Change budget</button></div>
        <div class="meter ${over ? 'over' : ''}" role="meter" aria-valuemin="0" aria-valuemax=${b.knowledgeBudget} aria-valuenow=${used}><i style="width:${Math.min(100, used / Math.max(1, b.knowledgeBudget) * 100)}%"></i></div>
        <small class="muted" style="display:block;margin-top:8px">${over ? 'Always-known knowledge exceeds the budget. Let the assistant look some of it up instead, or raise the budget.' : 'Everything else is looked up when needed and uses no budget.'}${estimated ? ` Counts marked “est.” were estimated because ${this.api() ? 'Claude' : 'the AI gateway'} was not reachable.` : ''}</small>
      </section>

      <div class="drop ${this.dragOver ? 'over' : ''}" @dragover=${e => { e.preventDefault(); this.dragOver = true; }} @dragleave=${() => { this.dragOver = false; }} @drop=${e => { e.preventDefault(); this.dragOver = false; this.uploadFiles(e.dataTransfer.files); }}>
        ${icon('upload')}<strong>Drop files here</strong><small>PDF, Word (.docx), text, Markdown, CSV, JSON or HTML · up to 15 MB each. Scanned PDFs need text recognition first.</small>
      </div>

      ${items.length ? html`<div class="knowledge">${items.map((item, index) => html`<div class="k-item ${item.enabled ? '' : 'off'}">
          <span class="k-kind" title=${kinds[item.kind]?.[1] || item.kind}>${icon(kinds[item.kind]?.[0] || 'file')}</span>
          <div style="min-width:0"><div class="k-title">${item.title}${item.pinned ? html` <span class="pill ok">${icon('pin')}Always known</span>` : nothing}</div><div class="k-meta"><span>${kinds[item.kind]?.[1] || item.kind}</span>${item.source ? html`<span>${item.source}</span>` : nothing}<span>${number(item.characters)} characters</span><span>Updated ${date(item.updatedUtc)}</span></div><div class="k-preview">${item.preview}</div></div>
          <div class="k-tokens">${number(item.tokens)}<small>${item.estimated ? 'tokens (est.)' : 'tokens'}</small></div>
          <div class="k-actions">
            <label class="switch small" title=${item.enabled ? 'Used by the assistant' : 'Not used'}><input type="checkbox" .checked=${item.enabled} ?disabled=${this.busy} @change=${e => this.toggleItem(item, e.target.checked)}><span class="sr">Use this source</span></label>
            <button class="icon-btn ${item.pinned ? 'active' : ''}" title=${item.pinned ? 'Always known: read with every question. Click to look it up only when needed.' : 'Looked up when needed. Click to make it always known (uses the knowledge budget).'} aria-pressed=${String(!!item.pinned)} ?disabled=${this.busy} @click=${() => this.pinItem(item, !item.pinned)}>${icon('pin')}</button>
            <button class="icon-btn" title="Move up" ?disabled=${index === 0 || this.busy} @click=${() => this.moveItem(this.knowledge.indexOf(item), -1)}>${icon('up')}</button>
            <button class="icon-btn" title="Move down" ?disabled=${index === items.length - 1 || this.busy} @click=${() => this.moveItem(this.knowledge.indexOf(item), 1)}>${icon('down')}</button>
            <button class="icon-btn" title="Edit" @click=${() => this.openEditor(item)}>${icon('edit')}</button>
            <button class="icon-btn" title="Delete" @click=${() => this.deleteItem(item)}>${icon('trash')}</button>
          </div></div>`)}</div>`
        : html`<div class="card empty">${icon('book')}<h2>No documents yet</h2><p>Your website pages are already searchable. Add a price list, FAQ or brochure that is not on the website.</p></div>`}

      <dialog class="editor" @close=${() => { this.editing = null; }}>
        ${this.editing ? html`<form @submit=${e => this.saveEditor(e)}>
          <header><h2>${this.editing.id ? 'Edit knowledge' : 'New knowledge'}</h2></header>
          <div class="body">
            <label class="control"><span>Title</span><input type="text" maxlength="200" required .value=${this.editing.title} @input=${e => { this.editing = { ...this.editing, title: e.target.value }; }}></label>
            <label class="control"><span>Text</span><textarea rows="18" required .value=${this.editing.text} @input=${e => { this.editing = { ...this.editing, text: e.target.value }; }}></textarea><span class="count">${number(this.editing.text.length)} characters ≈ ${compact(this.editing.text.length / 3.6)} tokens</span></label>
          </div>
          <footer><button type="button" class="btn quiet" @click=${() => this.renderRoot.querySelector('dialog.editor').close()}>Cancel</button><button class="btn primary" ?disabled=${this.busy}>${icon('save')}Save</button></footer>
        </form>` : nothing}
      </dialog>

      <dialog class="pages-dialog">
        <form method="dialog">
          <header><h2>Choose pages</h2><p class="muted">Ticked pages are used. Changes apply when you save.</p></header>
          <div class="body">
            <label class="control"><span class="sr">Filter pages</span><input type="text" placeholder="Filter pages…" .value=${this.pageFilter} @input=${e => { this.pageFilter = e.target.value; }}></label>
            <div class="row"><button type="button" class="btn small" @click=${() => this.set('knowledge.excludedPages', [])}>Use all pages</button><button type="button" class="btn small quiet" @click=${() => this.set('knowledge.excludedPages', readable.map(p => p.key))}>Leave all out</button><span class="grow"></span><small>${number(usedPages)} of ${number(readable.length)} used</small></div>
            <div class="pages">${shown.length ? shown.map(p => { const state = this.pageState(p); return html`<label style="padding-left:${8 + Math.max(0, p.level - 1) * 18}px" class=${state && state !== 'page' ? 'locked' : ''}><input type="checkbox" .checked=${!state} ?disabled=${state && state !== 'page'} @change=${e => this.setPage(p, e.target.checked)}><span>${p.name}</span>${state && state !== 'page' ? html`<span class="pill">${reasons[state]}</span>` : nothing}<small>${p.url || p.contentType}</small></label>`; }) : html`<p class="muted">No published pages found.</p>`}</div>
          </div>
          <footer><button class="btn primary">Done</button></footer>
        </form>
      </dialog>
    </div>`;
  },
};
