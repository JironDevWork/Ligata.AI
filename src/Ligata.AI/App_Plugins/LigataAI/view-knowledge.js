import { html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { icon, number, compact, date } from './ui.js?v=0.1.0';

const kinds = { text: ['text', 'Text'], file: ['file', 'File'], page: ['page', 'Website page'] };

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
      this.message = `${list.length - warnings.filter(w => !w.includes('switched off')).length} of ${list.length} file${list.length === 1 ? '' : 's'} added.`;
      this.warning = warnings.join(' ');
      this.schedulePreview();
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
    }, 'Knowledge saved.');
  },

  async toggleItem(item, enabled) {
    await this.run(async () => {
      await this.request(`/knowledge/${item.id}/enabled`, 'POST', { enabled });
      this.knowledge = this.knowledge.map(k => k.id === item.id ? { ...k, enabled } : k);
    });
  },

  async deleteItem(item) {
    if (!confirm(`Delete “${item.title}”? The assistant will no longer know this content.`)) return;
    await this.run(async () => { await this.request('/knowledge/' + item.id, 'DELETE'); this.knowledge = this.knowledge.filter(k => k.id !== item.id); }, 'Knowledge deleted.');
  },

  async moveItem(index, delta) {
    const list = [...this.knowledge];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.knowledge = list.map((k, i) => ({ ...k, sortOrder: i }));
    await this.run(() => this.request('/knowledge/order', 'POST', { ids: list.map(k => k.id) }));
  },

  async openPages() {
    await this.run(async () => { this.pages = await this.request('/pages'); this.pageSelection = new Set(); this.pageFilter = ''; });
    await this.updateComplete;
    this.renderRoot.querySelector('dialog.pages-dialog')?.showModal();
  },

  async importPages(event) {
    event.preventDefault();
    const keys = [...this.pageSelection];
    if (!keys.length) return;
    await this.run(async () => {
      const result = await this.request('/knowledge/pages', 'POST', { keys }, { timeout: 300000 });
      this.knowledge = result.knowledge;
      const skipped = result.results.filter(r => r.skipped).length;
      const switchedOff = result.results.filter(r => r.warning).length;
      this.renderRoot.querySelector('dialog.pages-dialog')?.close();
      this.message = `${keys.length - skipped} page${keys.length - skipped === 1 ? '' : 's'} imported${skipped ? `, ${skipped} without text skipped` : ''}.`;
      this.warning = switchedOff ? `${switchedOff} page${switchedOff === 1 ? ' was' : 's were'} saved but switched off because the knowledge budget is full.` : '';
    });
  },

  async recount() { await this.run(async () => { this.knowledge = (await this.request('/knowledge/recount', 'POST', {}, { timeout: 180000 })).knowledge; }, 'Token counts updated by the AI gateway.'); },

  knowledgeView() {
    const b = this.settings.behaviour;
    const used = this.knowledge.filter(k => k.enabled).reduce((n, k) => n + k.tokens, 0);
    const over = used > b.knowledgeBudget;
    const estimated = this.knowledge.some(k => k.estimated);
    const pages = (this.pages || []).filter(p => !this.pageFilter || `${p.name} ${p.url}`.toLowerCase().includes(this.pageFilter.toLowerCase()));
    const imported = new Set(this.knowledge.filter(k => k.contentKey).map(k => k.contentKey));
    return html`<div class="grid">
      <section class="card">
        <header><div><h2>Knowledge</h2><p class="muted">Everything the assistant should know: offers, prices, FAQs, opening hours, policies. Enabled sources are read with every question.</p></div>
          <div class="row"><button class="btn" @click=${() => this.openPages()}>${icon('page')}Import website pages</button><button class="btn" @click=${() => this.openEditor(null)}>${icon('text')}Write text</button>
            <label class="btn primary">${icon('upload')}Upload files<input class="sr" type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm" @change=${e => { this.uploadFiles(e.target.files); e.target.value = ''; }}></label></div></header>
        <div class="row" style="margin-bottom:8px"><strong class="grow">${number(used)} of ${number(b.knowledgeBudget)} tokens used</strong>${estimated ? html`<button class="btn small" @click=${() => this.recount()}>${icon('refresh')}Count exactly</button>` : nothing}<button class="btn small quiet" @click=${() => { this.tab = 'behaviour'; }}>Change budget</button></div>
        <div class="meter ${over ? 'over' : ''}" role="meter" aria-valuemin="0" aria-valuemax=${b.knowledgeBudget} aria-valuenow=${used}><i style="width:${Math.min(100, used / Math.max(1, b.knowledgeBudget) * 100)}%"></i></div>
        <small class="muted" style="display:block;margin-top:8px">${over ? 'Enabled knowledge exceeds the budget. Switch sources off or raise the budget.' : `About ${compact(Math.max(0, b.knowledgeBudget - used))} tokens free (≈ ${compact(Math.max(0, b.knowledgeBudget - used) * 0.75)} words).`}${estimated ? ' Counts marked “est.” were estimated because the AI gateway was not reachable.' : ''}</small>
      </section>

      <div class="drop ${this.dragOver ? 'over' : ''}" @dragover=${e => { e.preventDefault(); this.dragOver = true; }} @dragleave=${() => { this.dragOver = false; }} @drop=${e => { e.preventDefault(); this.dragOver = false; this.uploadFiles(e.dataTransfer.files); }}>
        ${icon('upload')}<strong>Drop files here</strong><small>PDF, Word (.docx), text, Markdown, CSV, JSON or HTML · up to 15 MB each. Scanned PDFs need text recognition first.</small>
      </div>

      ${this.knowledge.length ? html`<div class="knowledge">${this.knowledge.map((item, index) => html`<div class="k-item ${item.enabled ? '' : 'off'}">
          <span class="k-kind" title=${kinds[item.kind]?.[1] || item.kind}>${icon(kinds[item.kind]?.[0] || 'file')}</span>
          <div style="min-width:0"><div class="k-title">${item.title}</div><div class="k-meta"><span>${kinds[item.kind]?.[1] || item.kind}</span>${item.source ? html`<span>${item.source}</span>` : nothing}<span>${number(item.characters)} characters</span><span>Updated ${date(item.updatedUtc)}</span></div><div class="k-preview">${item.preview}</div></div>
          <div class="k-tokens">${number(item.tokens)}<small>${item.estimated ? 'tokens (est.)' : 'tokens'}</small></div>
          <div class="k-actions">
            <label class="switch small" title=${item.enabled ? 'Used by the assistant' : 'Not used'}><input type="checkbox" .checked=${item.enabled} ?disabled=${this.busy} @change=${e => this.toggleItem(item, e.target.checked)}><span class="sr">Use this source</span></label>
            <button class="icon-btn" title="Move up" ?disabled=${index === 0 || this.busy} @click=${() => this.moveItem(index, -1)}>${icon('up')}</button>
            <button class="icon-btn" title="Move down" ?disabled=${index === this.knowledge.length - 1 || this.busy} @click=${() => this.moveItem(index, 1)}>${icon('down')}</button>
            <button class="icon-btn" title=${item.kind === 'page' ? 'View text (re-import to refresh)' : 'Edit'} @click=${() => this.openEditor(item)}>${icon('edit')}</button>
            <button class="icon-btn" title="Delete" @click=${() => this.deleteItem(item)}>${icon('trash')}</button>
          </div></div>`)}</div>`
        : html`<div class="card empty">${icon('book')}<h2>No knowledge yet</h2><p>Import your website pages to get started in one click, or upload a price list, FAQ or brochure.</p></div>`}
      <small class="muted">Sources are read in this order. Keeping the order stable lets the AI server reuse its work between questions, so answers start faster.</small>

      <dialog class="editor" @close=${() => { this.editing = null; }}>
        ${this.editing ? html`<form @submit=${e => this.saveEditor(e)}>
          <header><h2>${this.editing.id ? 'Edit knowledge' : 'New knowledge'}</h2></header>
          <div class="body">
            <label class="control"><span>Title</span><input type="text" maxlength="200" required .value=${this.editing.title} @input=${e => { this.editing = { ...this.editing, title: e.target.value }; }}></label>
            <label class="control"><span>Text</span><textarea rows="18" required .value=${this.editing.text} @input=${e => { this.editing = { ...this.editing, text: e.target.value }; }}></textarea><span class="count">${number(this.editing.text.length)} characters ≈ ${compact(this.editing.text.length / 3.6)} tokens</span></label>
            ${this.editing.kind === 'page' ? html`<small class="muted">This text was imported from a website page. Importing the page again replaces your edits.</small>` : nothing}
          </div>
          <footer><button type="button" class="btn quiet" @click=${() => this.renderRoot.querySelector('dialog.editor').close()}>Cancel</button><button class="btn primary" ?disabled=${this.busy}>${icon('save')}Save</button></footer>
        </form>` : nothing}
      </dialog>

      <dialog class="pages-dialog">
        <form @submit=${e => this.importPages(e)}>
          <header><h2>Import website pages</h2><p class="muted">The published text of each page becomes knowledge. Import again after editing a page to refresh it.</p></header>
          <div class="body">
            <label class="control"><span class="sr">Filter pages</span><input type="text" placeholder="Filter pages…" .value=${this.pageFilter} @input=${e => { this.pageFilter = e.target.value; }}></label>
            <div class="row"><button type="button" class="btn small" @click=${() => { this.pageSelection = new Set(pages.filter(p => p.hasTemplate).map(p => p.key)); }}>Select all pages</button><button type="button" class="btn small quiet" @click=${() => { this.pageSelection = new Set(); }}>Clear</button><span class="grow"></span><small>${this.pageSelection.size} selected</small></div>
            <div class="pages">${pages.length ? pages.map(p => html`<label style="padding-left:${8 + Math.max(0, p.level - 1) * 18}px"><input type="checkbox" .checked=${this.pageSelection.has(p.key)} @change=${e => { const next = new Set(this.pageSelection); e.target.checked ? next.add(p.key) : next.delete(p.key); this.pageSelection = next; }}><span>${p.name}</span>${imported.has(p.key) ? html`<span class="pill info">imported</span>` : nothing}<small>${p.url || p.contentType}</small></label>`) : html`<p class="muted">No published pages found.</p>`}</div>
          </div>
          <footer><button type="button" class="btn quiet" @click=${() => this.renderRoot.querySelector('dialog.pages-dialog').close()}>Cancel</button><button class="btn primary" ?disabled=${this.busy || !this.pageSelection.size}>${icon('page')}Import ${this.pageSelection.size || ''} page${this.pageSelection.size === 1 ? '' : 's'}</button></footer>
        </form>
      </dialog>
    </div>`;
  },
};
