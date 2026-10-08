import { html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { icon, number, compact } from './ui.js?v=0.5.2';

export const connectionView = {
  async saveConnection(event) {
    event.preventDefault();
    await this.run(async () => {
      const result = await this.request('/connection', 'POST', { gatewayUrl: this.urlInput, apiKey: this.keyInput || null, version: this.version });
      this.version = result.version;
      this.settings = { ...this.settings, gatewayUrl: result.connection.gatewayUrl };
      this.saved = JSON.stringify({ ...JSON.parse(this.saved), gatewayUrl: result.connection.gatewayUrl });
      this.connection = result.connection;
      this.status = result;
      this.keyInput = '';
      if (!result.ok) throw new Error(`Saved, but the gateway did not answer: ${result.message}`);
    }, 'Connected. The AI gateway answered.');
  },

  async clearKey() {
    if (!confirm('Remove the stored API key? The assistant stops working until a new key is added.')) return;
    await this.run(async () => { this.connection = (await this.request('/connection/key', 'DELETE')).connection; await this.refreshStatus(); }, 'API key removed.');
  },

  /** API mode: nothing to enter here. The key lives in the site's configuration and is only ever sent to Anthropic. */
  claudeCard() {
    const c = this.connection || {}, k = c.claude || {};
    return html`<section class="card">
      <header><div><h2>Claude API</h2><p class="muted">Answers come from Anthropic's Claude, called directly from this website's server. No separate AI server is needed.</p></div><span class="pill info">API mode</span></header>
      <dl class="facts">
        <dt>Model</dt><dd>${k.modelName} <code>${k.model}</code></dd>
        <dt>API key</dt><dd>${k.configured ? html`<span class="pill ok"><i></i>Configured</span> <small class="muted">LigataAI:Claude:ApiKey</small>` : html`<span class="pill bad"><i></i>Missing</span> <small class="muted">Add LigataAI:Claude:ApiKey</small>`}</dd>
        <dt>Thinking</dt><dd>${({ low: 'Low effort: fast, thinks only when needed', medium: 'Medium effort', high: 'High effort: most careful, slowest' })[k.effort] || k.effort}${this.settings.behaviour.thinking ? ' · raised one level by “Think before answering”' : ''}</dd>
        ${k.customEndpoint ? html`<dt>Endpoint</dt><dd>Custom (LigataAI:Claude:BaseUrl)</dd>` : nothing}
      </dl>
      <div class="notice">${icon('key')}<div>The key is read from the site's configuration on this server and only sent to Anthropic. Browsers and this backoffice never see it, not even in part.</div></div>
      <div class="row section"><button type="button" class="btn" ?disabled=${this.busy} @click=${() => this.run(async () => { await this.refreshStatus(); if (!this.status?.ok) throw new Error(this.status?.message || 'Claude did not answer.'); }, 'Connected. Anthropic accepted the key and the model is available.')}>${icon('plug')}Test connection</button></div>
    </section>`;
  },

  claudeStatus(s) {
    const k = this.connection?.claude || {}, l = s.status.limits || {}, u = s.status.usage || {};
    return html`<dl class="facts">
      <dt>Model</dt><dd>${s.status.model}</dd>
      <dt>Per question</dt><dd>up to ${number(s.status.contextTokens)} tokens (instructions, knowledge and the conversation)</dd>
      <dt>Answers right now</dt><dd>${u.active ?? 0} of at most ${number(l.maxConcurrent)} at the same time</dd>
      <dt>Today</dt><dd>${number(u.questionsToday)} ${l.questionsPerDay ? html`of ${number(l.questionsPerDay)}` : ''} questions · ${compact(u.promptTokensToday || 0)} tokens read, ${compact(u.completionTokensToday || 0)} written</dd>
      <dt>Attachments</dt><dd>Screenshots and PDFs ≤ ${Math.round((l.maxPdfBytes || 0) / 1048576)} MB, ${l.maxPdfPages} pages (read as text on this server)</dd>
    </dl>
    <small class="muted">Limits come from LigataAI:Claude (QuestionsPerDay, MaxConcurrent, MaxContextTokens). For a hard cost ceiling, also set a monthly spend limit in the Anthropic Console.</small>`;
  },

  connectionView() {
    const c = this.connection || {};
    const s = this.status;
    const origins = c.allowedOrigins || [];
    const api = this.api();
    return html`<div class="grid two">
      ${api ? this.claudeCard() : html`<section class="card">
        <header><div><h2>AI gateway</h2><p class="muted">The shared Ligata AI server that runs the model. Your API key stays on this server and is never sent to visitors.</p></div></header>
        <form class="grid" @submit=${e => this.saveConnection(e)}>
          <label class="control"><span>Gateway address</span><input type="url" required .value=${this.urlInput || ''} ?disabled=${c.gatewayUrlFromConfig} @input=${e => { this.urlInput = e.target.value; }} placeholder="https://ai.example.ch">
            <small>${c.gatewayUrlFromConfig ? 'Set in appsettings (LigataAI:GatewayUrl) and cannot be changed here.' : 'For a site on the AI machine itself: http://127.0.0.1:1210'}</small>${this.fieldError('gatewayUrl')}</label>
          <label class="control ${this.errors.apiKey ? 'invalid' : ''}"><span>API key</span><input type="password" autocomplete="off" spellcheck="false" .value=${this.keyInput} ?disabled=${c.keySource === 'configuration'} @input=${e => { this.keyInput = e.target.value.trim(); }} placeholder=${c.keyHint ? `Stored: ${c.keyHint}. Paste a new key to replace it.` : 'lai_…'}>
            <small>${c.keySource === 'configuration' ? `Provided by configuration (LigataAI:ApiKey): ${c.keyHint}.` : c.keySource === 'backoffice' ? 'Stored encrypted with this server’s Data Protection keys.' : c.keySource === 'unreadable' ? 'The stored key can no longer be decrypted on this server (for example after moving servers). Paste it again.' : 'Ask the gateway operator for a key: node cli.mjs keys create "Your website"'}</small>${this.fieldError('apiKey')}</label>
          <div class="row"><button class="btn primary" ?disabled=${this.busy}>${icon('plug')}Save & test</button>
            <button type="button" class="btn" ?disabled=${this.busy} @click=${() => this.run(() => this.refreshStatus())}>${icon('refresh')}Test again</button>
            ${c.keySource === 'backoffice' ? html`<button type="button" class="btn quiet danger" ?disabled=${this.busy} @click=${() => this.clearKey()}>${icon('trash')}Remove key</button>` : nothing}</div>
        </form>
      </section>`}

      <section class="card">
        <header><div><h2>Status</h2></div>${this.statusPill()}</header>
        ${s?.ok && api ? this.claudeStatus(s) : s?.ok ? html`<dl class="facts">
          <dt>Model</dt><dd>${s.status.model}</dd><dt>State</dt><dd>${s.status.state}</dd><dt>Context window</dt><dd>${number(s.status.contextTokens)} tokens</dd>
          <dt>Screenshots</dt><dd>${s.status.vision ? 'Supported' : 'Not available'}</dd><dt>Queue</dt><dd>${s.status.queueWaiting} waiting</dd>
          <dt>Daily limit</dt><dd>${number(s.status.usage?.requests)} / ${number(s.status.limits?.requestsPerDay)} questions</dd>
          <dt>Max per site</dt><dd>${s.status.limits?.maxQueued} queued · ${compact(s.status.limits?.maxContextTokens)} context</dd>
          <dt>Attachments</dt><dd>${s.status.limits?.maxImages} images ≤ ${Math.round((s.status.limits?.maxImageBytes || 0) / 1048576)} MB · PDFs ≤ ${Math.round((s.status.limits?.maxPdfBytes || 0) / 1048576)} MB, ${s.status.limits?.maxPdfPages} pages</dd>
        </dl>` : html`<div class="notice error">${icon('warn')}<div><strong>${s?.code === 'not_configured' ? (api ? 'No API key yet' : 'Not connected yet') : s?.code === 'invalid_key' ? 'The key was rejected' : s?.code === 'model_unavailable' && api ? 'The model is not available' : api ? 'Claude is not reachable' : 'The gateway is not reachable'}</strong><p>${s?.message || ''}</p></div></div>`}
      </section>

      <section class="card" style="grid-column:1/-1">
        <header><div><h2>Website integration</h2><p class="muted">Host settings from appsettings.json. Developers change these, not editors.</p></div></header>
        <dl class="facts">
          <dt>Placement</dt><dd>${c.autoInject ? 'Automatic: added before </body> on pages that use tag helpers' : 'Manual only (LigataAI:AutoInject is false)'}</dd>
          <dt>Public API</dt><dd>${c.publicApiBase}</dd>
          <dt>Allowed origins</dt><dd>${origins.length ? origins.join(', ') : 'Only this CMS host. Add your public website to LigataAI:AllowedOrigins if it is served from another domain (for example a static export).'}</dd>
        </dl>
        <details class="section"><summary><strong>Configuration example</strong></summary>
          <pre class="code" style="margin-top:10px">${api ? `"LigataAI": {
  "Mode": "api",
  "Claude": { "Model": "claude-haiku-5-5", "QuestionsPerDay": 1500, "MaxConcurrent": 8 },
  "PublicApiBase": "https://cms.example.ch/api/ligata-ai",
  "AllowedOrigins": ["https://www.example.ch"],
  "MessagesPerTenMinutes": 20
}
// The key belongs in an environment variable or secret store: LigataAI__Claude__ApiKey` : `"LigataAI": {
  "Mode": "gpu",
  "PublicApiBase": "https://cms.example.ch/api/ligata-ai",
  "AllowedOrigins": ["https://www.example.ch"],
  "TrustCloudflareLoopbackHeader": true,
  "MessagesPerTenMinutes": 20
}
// Secrets belong in environment variables, e.g. LigataAI__ApiKey
// "Mode": "api" uses Claude through Anthropic instead (LigataAI__Claude__ApiKey).`}</pre>
          <small>Manual placement in a template: <code>@await Component.InvokeAsync("LigataAssistant")</code>. JavaScript API on the page: <code>LigataAI.open()</code>, <code>LigataAI.ask("…")</code>.</small>
        </details>
      </section>
    </div>`;
  },
};
