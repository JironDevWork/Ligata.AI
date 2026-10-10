import { html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { icon, number, compact } from './ui.js?v=0.9.1';

const names = { gpu: 'Ligata GPU', api: 'Claude API' };

export const connectionView = {
  /** Visitors' engine and each engine's own status (the Connection tab tests every engine that is set up). */
  async refreshEngines() {
    if (!this.licensedFeatures().assistant) return;
    const c = this.connection || {};
    const ids = ['gpu', 'api'].filter(id => c.engines?.[id] || c.mode === id);
    const results = await Promise.all(ids.map(id => this.request(`/status?engine=${id}`).catch(e => ({ ok: false, code: 'error', message: e.message, engine: id }))));
    const next = {};
    results.forEach((result, i) => { next[ids[i]] = result; if (result.connection) this.connection = result.connection; });
    this.engineStatus = next;
    if (next[this.connection.mode]) this.status = next[this.connection.mode];
  },

  /** A status for one engine: shown on its card, and in the header when visitors use it. */
  keepStatus(result) {
    this.connection = result.connection;
    this.engineStatus = { ...(this.engineStatus || {}), [result.engine]: result };
    if (result.engine === result.connection.mode) this.status = result;
  },

  async testEngine(id) {
    await this.run(async () => {
      const result = await this.request(`/status?engine=${id}`);
      this.keepStatus(result);
      if (!result.ok) throw new Error(result.message || `${names[id]} did not answer.`);
    }, id === 'api' ? 'Connected. Anthropic accepted the key and the model is available.' : 'Connected. The AI gateway answered.');
  },

  async saveConnection(event) {
    event.preventDefault();
    await this.run(async () => {
      const result = await this.request('/connection', 'POST', { gatewayUrl: this.urlInput, apiKey: this.keyInput || null, version: this.version });
      this.version = result.version;
      this.settings = { ...this.settings, gatewayUrl: result.connection.gatewayUrl, engine: result.connection.choice };
      this.saved = JSON.stringify({ ...JSON.parse(this.saved), gatewayUrl: result.connection.gatewayUrl, engine: result.connection.choice });
      this.keepStatus(result);
      this.keyInput = '';
      if (!result.ok) throw new Error(`Saved, but the gateway did not answer: ${result.message}`);
    }, 'Connected. The AI gateway answered.');
    this.afterEngineChange();
  },

  async saveClaudeKey(event) {
    event.preventDefault();
    await this.run(async () => {
      const result = await this.request('/connection/claude', 'POST', { apiKey: this.claudeKeyInput });
      // The engine that answered before stays the choice (saved with a new version), so adding a key never switches visitors.
      if (result.version != null) {
        this.version = result.version;
        this.settings = { ...this.settings, engine: result.connection.choice };
        this.saved = JSON.stringify({ ...JSON.parse(this.saved), engine: result.connection.choice });
      }
      this.keepStatus(result);
      this.claudeKeyInput = '';
      if (!result.ok) throw new Error(`Saved, but Anthropic did not accept it: ${result.message}`);
    }, 'Saved. Anthropic accepted the key and the model is available.');
    this.afterEngineChange();
  },

  /** What removing a key does to visitors, in one sentence. */
  removalEffect(id) {
    const c = this.connection || {}, other = id === 'api' ? 'gpu' : 'api';
    if (c.mode !== id) return '';
    return c.engines?.[other] ? ` ${names[other]} answers instead, and visitors are asked for their consent again.` : ' The assistant stops answering until a key is added.';
  },

  async clearKey() {
    if (!confirm(`Remove the stored key for the Ligata AI gateway?${this.removalEffect('gpu')}`)) return;
    await this.run(async () => { this.connection = (await this.request('/connection/key', 'DELETE')).connection; await this.refreshEngines(); }, 'Key removed.');
    this.afterEngineChange();
  },

  async clearClaudeKey() {
    if (!confirm(`Remove the stored Anthropic API key?${this.removalEffect('api')}`)) return;
    await this.run(async () => { this.connection = (await this.request('/connection/claude-key', 'DELETE')).connection; await this.refreshEngines(); }, 'Anthropic API key removed.');
    this.afterEngineChange();
  },

  async chooseEngine(id) {
    const c = this.connection || {};
    if (c.mode === id || this.busy) return;
    const recipient = id === 'api' ? 'Claude by Anthropic (USA)' : `the Ligata GPU (${this.privacy?.gpuOperator || 'Ligata'}${this.privacy?.gpuOperatorCountry ? `, ${this.privacy.gpuOperatorCountry}` : ''})`;
    if (!confirm(`Answer your visitors with ${recipient}?\n\nThe consent request names who answers, so every visitor is asked again. Copy the updated text for your privacy policy under Privacy.`)) return;
    await this.run(async () => {
      const result = await this.request('/engine', 'POST', { engine: id, version: this.version });
      this.version = result.version;
      this.settings = { ...this.settings, engine: id };
      this.saved = JSON.stringify({ ...JSON.parse(this.saved), engine: id });
      this.keepStatus(result);
      if (!result.ok) throw new Error(`Switched to ${names[id]}, but it did not answer: ${result.message}`);
    }, `${names[id]} answers your visitors now. They are asked for their consent again.`);
    this.afterEngineChange();
  },

  /** The engine decides the consent text, the privacy policy, the limits and the preview. */
  afterEngineChange() {
    this.refreshPrivacy();
    this.refreshBudget();
    this.schedulePreview(true);
  },

  enginePill(id) {
    const s = this.engineStatus?.[id], api = id === 'api';
    if (!s) return html`<span class="pill"><i></i>Checking…</span>`;
    if (!s.ok) return html`<span class="pill bad" title=${s.message || ''}><i></i>${s.code === 'not_configured' ? 'No key' : s.code === 'invalid_key' ? 'Key rejected' : s.code === 'model_unavailable' ? 'Model not available' : api ? 'Not reachable' : 'Offline'}</span>`;
    return s.status.state === 'busy' ? html`<span class="pill warn"><i></i>Busy</span>` : s.status.state === 'ready' ? html`<span class="pill ok"><i></i>Online</span>` : html`<span class="pill warn"><i></i>${s.status.state}</span>`;
  },

  /** Shown only when both engines are set up: which one answers. */
  engineChoice() {
    const c = this.connection || {};
    const where = { gpu: `Gemma 4 on ${this.privacy?.gpuOperator || 'Ligata'}'s own GPU${this.privacy?.gpuOperatorCountry ? ` (${this.privacy.gpuOperatorCountry})` : ''}. Messages do not leave the operator's server; answers queue when the GPU is busy.`, api: `${c.claude?.modelName || 'Claude'} by Anthropic, USA. Several visitors are answered at once; every question is billed per token by Anthropic.` };
    return html`<section class="card" style="grid-column:1/-1">
      <header><div><h2>AI engine</h2><p class="muted">Both engines are set up. Choose which one answers your visitors.</p></div></header>
      <div class="engines" role="radiogroup" aria-label="AI engine">${['gpu', 'api'].map(id => html`<button type="button" role="radio" class="swatch engine" aria-checked=${String(c.mode === id)} aria-pressed=${String(c.mode === id)} ?disabled=${this.busy} @click=${() => this.chooseEngine(id)}>
        <span class="row"><span class="engine-icon">${icon(id === 'api' ? 'globe' : 'monitor')}</span><b class="grow">${names[id]}</b>${c.mode === id ? html`<span class="pill ok"><i></i>In use</span>` : this.enginePill(id)}</span>
        <small>${where[id]}</small></button>`)}</div>
      <small class="muted" style="display:block;margin-top:12px">Switching asks every visitor for consent again, because the consent names who answers. The text for your privacy policy under Privacy changes with it. How much each engine thinks is set under Behaviour.</small>
    </section>`;
  },

  gpuCard() {
    const c = this.connection || {}, inUse = c.mode === 'gpu' && c.engines?.gpu;
    return html`<section class="card">
      <header><div><h2>Ligata GPU</h2><p class="muted">The shared Ligata AI server that runs the model. Your key stays on this server and is never sent to visitors.</p></div>${inUse ? html`<span class="pill ok"><i></i>In use</span>` : nothing}</header>
      <form class="grid" @submit=${e => this.saveConnection(e)}>
        <label class="control"><span>Gateway address</span><input type="url" required .value=${this.urlInput || ''} ?disabled=${c.gatewayUrlFromConfig} @input=${e => { this.urlInput = e.target.value; }} placeholder="https://ai.example.ch">
          <small>${c.gatewayUrlFromConfig ? 'Set in appsettings (LigataAI:GatewayUrl) and cannot be changed here.' : 'For a site on the AI machine itself: http://127.0.0.1:1210'}</small>${this.fieldError('gatewayUrl')}</label>
        <label class="control ${this.errors.apiKey ? 'invalid' : ''}"><span>API key</span><input type="password" name="gatewayKey" autocomplete="off" spellcheck="false" .value=${this.keyInput} ?disabled=${c.keySource === 'configuration'} @input=${e => { this.keyInput = e.target.value.trim(); }} placeholder=${c.keyHint ? `Stored: ${c.keyHint}. Paste a new key to replace it.` : 'lai_…'}>
          <small>${c.keySource === 'configuration' ? `Provided by configuration (LigataAI:ApiKey): ${c.keyHint}.` : c.keySource === 'backoffice' ? 'Stored encrypted with this server’s Data Protection keys.' : c.keySource === 'unreadable' ? 'The stored key can no longer be decrypted on this server (for example after moving servers). Paste it again.' : 'Ask the gateway operator for a key: node cli.mjs keys create "Your website"'}</small>${this.fieldError('apiKey')}</label>
        <div class="row"><button class="btn primary" ?disabled=${this.busy}>${icon('plug')}Save & test</button>
          ${c.engines?.gpu ? html`<button type="button" class="btn" ?disabled=${this.busy} @click=${() => this.testEngine('gpu')}>${icon('refresh')}Test again</button>` : nothing}
          ${c.keySource === 'backoffice' || c.keySource === 'unreadable' ? html`<button type="button" class="btn quiet danger" ?disabled=${this.busy} @click=${() => this.clearKey()}>${icon('trash')}Remove key</button>` : nothing}</div>
      </form>
    </section>`;
  },

  claudeCard() {
    const c = this.connection || {}, k = c.claude || {}, inUse = c.mode === 'api' && c.engines?.api;
    const fromConfig = k.keySource === 'configuration';
    return html`<section class="card">
      <header><div><h2>Claude API</h2><p class="muted">Anthropic's Claude, called directly from this website's server. No separate AI server is needed.</p></div>${inUse ? html`<span class="pill ok"><i></i>In use</span>` : nothing}</header>
      <form class="grid" @submit=${e => this.saveClaudeKey(e)}>
        <dl class="facts">
          <dt>Model</dt><dd>${k.modelName} <code>${k.model}</code></dd>
          ${k.customEndpoint ? html`<dt>Endpoint</dt><dd>Custom (LigataAI:Claude:BaseUrl)</dd>` : nothing}
        </dl>
        <label class="control ${this.errors.claudeKey ? 'invalid' : ''}"><span>Anthropic API key</span><input type="password" name="claudeKey" autocomplete="off" spellcheck="false" .value=${this.claudeKeyInput || ''} ?disabled=${fromConfig} @input=${e => { this.claudeKeyInput = e.target.value.trim(); }} placeholder=${k.keyHint ? `Stored: ${k.keyHint}. Paste a new key to replace it.` : 'sk-ant-…'}>
          <small>${fromConfig ? `Provided by configuration (LigataAI:Claude:ApiKey): ${k.keyHint}.` : k.keySource === 'backoffice' ? 'Stored encrypted with this server’s Data Protection keys and only ever sent to Anthropic.' : k.keySource === 'unreadable' ? 'The stored key can no longer be decrypted on this server (for example after moving servers). Paste it again.' : 'Create a key in the Anthropic Console (API keys). It is stored encrypted and only ever sent to Anthropic. A key in the configuration (LigataAI__Claude__ApiKey) also works.'}</small>${this.fieldError('claudeKey')}</label>
        <div class="row">${fromConfig ? nothing : html`<button class="btn primary" ?disabled=${this.busy || !this.claudeKeyInput}>${icon('key')}Save & test</button>`}
          ${k.configured ? html`<button type="button" class="btn" ?disabled=${this.busy} @click=${() => this.testEngine('api')}>${icon('refresh')}Test again</button>` : nothing}
          ${k.keySource === 'backoffice' || k.keySource === 'unreadable' ? html`<button type="button" class="btn quiet danger" ?disabled=${this.busy} @click=${() => this.clearClaudeKey()}>${icon('trash')}Remove key</button>` : nothing}</div>
      </form>
      <div class="notice" style="margin:16px 0 0">${icon('info')}<div>Browsers and this backoffice never see the key, only its first and last characters. For a hard cost ceiling, also set a monthly spend limit in the Anthropic Console.</div></div>
    </section>`;
  },

  claudeStatus(s) {
    const l = s.status.limits || {}, u = s.status.usage || {};
    return html`<dl class="facts">
      <dt>Model</dt><dd>${s.status.model}</dd>
      <dt>Per question</dt><dd>up to ${number(s.status.contextTokens)} tokens (instructions, knowledge and the conversation)</dd>
      <dt>Answers right now</dt><dd>${u.active ?? 0} of at most ${number(l.maxConcurrent)} at the same time</dd>
      <dt>Today</dt><dd>${number(u.questionsToday)} ${l.questionsPerDay ? html`of ${number(l.questionsPerDay)}` : ''} questions · ${compact(u.promptTokensToday || 0)} tokens read, ${compact(u.completionTokensToday || 0)} written</dd>
      <dt>Attachments</dt><dd>Screenshots and PDFs ≤ ${Math.round((l.maxPdfBytes || 0) / 1048576)} MB, ${l.maxPdfPages} pages (read as text on this server)</dd>
    </dl>
    <small class="muted">Limits come from LigataAI:Claude (QuestionsPerDay, MaxConcurrent, MaxContextTokens).</small>`;
  },

  gpuStatus(s) {
    return html`<dl class="facts">
      <dt>Model</dt><dd>${s.status.model}</dd><dt>State</dt><dd>${s.status.state}</dd><dt>Context window</dt><dd>${number(s.status.contextTokens)} tokens</dd>
      <dt>Screenshots</dt><dd>${s.status.vision ? 'Supported' : 'Not available'}</dd><dt>Queue</dt><dd>${s.status.queueWaiting} waiting</dd>
      <dt>Daily limit</dt><dd>${number(s.status.usage?.requests)} / ${number(s.status.limits?.requestsPerDay)} questions</dd>
      <dt>Max per site</dt><dd>${s.status.limits?.maxQueued} queued · ${compact(s.status.limits?.maxContextTokens)} context</dd>
      <dt>Attachments</dt><dd>${s.status.limits?.maxImages} images ≤ ${Math.round((s.status.limits?.maxImageBytes || 0) / 1048576)} MB · PDFs ≤ ${Math.round((s.status.limits?.maxPdfBytes || 0) / 1048576)} MB, ${s.status.limits?.maxPdfPages} pages</dd>
    </dl>`;
  },

  statusCard(id) {
    const s = this.engineStatus?.[id], api = id === 'api';
    return html`<section class="card">
      <header><div><h2>${api ? 'Claude status' : 'GPU status'}</h2></div>${this.enginePill(id)}</header>
      ${!s ? html`<div class="notice">${icon('info')}<div>Checking…</div></div>` : s.ok ? (api ? this.claudeStatus(s) : this.gpuStatus(s)) : html`<div class="notice error">${icon('warn')}<div><strong>${s.code === 'not_configured' ? (api ? 'No API key yet' : 'Not connected yet') : s.code === 'invalid_key' ? 'The key was rejected' : s.code === 'model_unavailable' && api ? 'The model is not available' : api ? 'Claude is not reachable' : 'The gateway is not reachable'}</strong><p>${s.message || ''}</p></div></div>`}
    </section>`;
  },

  connectionView() {
    const c = this.connection || {}, e = c.engines || {};
    const origins = c.allowedOrigins || [];
    const both = e.gpu && e.api, none = !e.gpu && !e.api;
    // The engines set up, the one in use first; nothing set up yet: the configured default. The other waits, folded, in "Add another AI engine".
    const shown = none ? [c.defaultEngine === 'api' ? 'api' : 'gpu'] : ['gpu', 'api'].filter(id => e[id]).sort((a, b) => (b === c.mode) - (a === c.mode));
    const missing = both ? null : ['gpu', 'api'].find(id => !shown.includes(id));
    return html`<div class="grid two">
      ${both ? this.engineChoice() : nothing}
      ${shown.map(id => html`${id === 'api' ? this.claudeCard() : this.gpuCard()}${this.statusCard(id)}`)}
      ${missing ? html`<details class="add-engine" style="grid-column:1/-1">
        <summary>${icon('plus')} Add another AI engine</summary>
        <p class="muted" style="margin:6px 0 14px">${none ? `${names[missing]} can answer instead: add its key here.` : `Only ${names[c.mode]} is set up, so it answers every question.`} With keys for both, you can switch between the two here.</p>
        ${missing === 'api' ? this.claudeCard() : this.gpuCard()}
      </details>` : nothing}

      <section class="card" style="grid-column:1/-1">
        <header><div><h2>Website integration</h2><p class="muted">Host settings from appsettings.json. Developers change these, not editors.</p></div></header>
        <dl class="facts">
          <dt>Placement</dt><dd>${c.autoInject ? 'Automatic: added before </body> on pages that use tag helpers' : 'Manual only (LigataAI:AutoInject is false)'}</dd>
          <dt>Public API</dt><dd>${c.publicApiBase}</dd>
          <dt>Allowed origins</dt><dd>${origins.length ? origins.join(', ') : 'Only this CMS host. Add your public website to LigataAI:AllowedOrigins if it is served from another domain (for example a static export).'}</dd>
        </dl>
        <details class="section"><summary><strong>Configuration example</strong></summary>
          <pre class="code" style="margin-top:10px">${`"LigataAI": {
  "Mode": "gpu",
  "Claude": { "Model": "claude-haiku-5-5", "QuestionsPerDay": 1500, "MaxConcurrent": 8 },
  "PublicApiBase": "https://cms.example.ch/api/ligata-ai",
  "AllowedOrigins": ["https://www.example.ch"],
  "TrustCloudflareLoopbackHeader": true,
  "MessagesPerTenMinutes": 20
}
// Keys belong in environment variables or a secret store, or above (stored encrypted):
//   LigataAI__ApiKey          the key for the Ligata AI gateway (GPU)
//   LigataAI__Claude__ApiKey  an Anthropic API key (Claude)
// With both set up, editors choose the engine here; "Mode" is the default ("api" = Claude).`}</pre>
          <small>Manual placement in a template: <code>@await Component.InvokeAsync("LigataAssistant")</code>. JavaScript API on the page: <code>LigataAI.open()</code>, <code>LigataAI.ask("…")</code>.</small>
        </details>
      </section>
    </div>`;
  },
};
