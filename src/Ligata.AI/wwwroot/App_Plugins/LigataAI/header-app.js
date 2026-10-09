import { LitElement, html, css, nothing } from '@umbraco-cms/backoffice/external/lit';
import { UmbElementMixin } from '@umbraco-cms/backoffice/element-api';
import { UMB_AUTH_CONTEXT } from '@umbraco-cms/backoffice/auth';
import { aiRequest } from './api.js?v=0.8.0';

const inboxPath = '/umbraco/section/ai-assistant/dashboard/inbox';
const enabled = key => { try { return localStorage.getItem('ligata-ai-inbox:' + key) !== '0'; } catch { return true; } };

/**
 * Website chat badge in the Umbraco header: how many conversations need a reply, from anywhere in
 * the backoffice. Its long poll is also the team member's presence, so visitors see the team as
 * online while someone available has Umbraco open.
 */
class LigataAIHeaderApp extends UmbElementMixin(LitElement) {
  static properties = { count: { state: true }, online: { state: true } };
  static styles = css`
    :host{position:relative;display:inline-flex}
    .badge{position:absolute;top:2px;right:0;min-width:17px;height:17px;padding:0 5px;border-radius:999px;background:var(--uui-color-danger,#d42054);color:#fff;font:700 10.5px/17px system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 0 0 2px var(--uui-color-header-surface,#1b264f)}
  
  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  `;

  constructor() {
    super();
    this.count = 0;
    this.consumeContext(UMB_AUTH_CONTEXT, auth => { this.auth = auth; if (!this.running) this.loop(); });
  }
  connectedCallback() { super.connectedCallback(); this.alive = true; if (this.auth && !this.running) this.loop(); }
  disconnectedCallback() { this.alive = false; super.disconnectedCallback(); }

  async loop() {
    this.running = true;
    let version = -1, delay = 0;
    while (this.alive) {
      try {
        const data = await aiRequest(this.auth, '/inbox/updates?version=' + version, 'GET', undefined, { timeout: 40000 });
        version = data.version;
        const count = data.counts?.needsReply || 0;
        // The Inbox chimes itself while it is open.
        if (count > this.count && this.primed && !window.__ligataAIInboxOpen) this.alert(count);
        this.count = count; this.online = data.online; this.primed = true;
        delay = 0;
      } catch (e) {
        if (e.status === 403 || e.status === 404) break; // no access or no live chat/email in this installation
        delay = Math.min(60000, (delay || 2000) * 2);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    this.running = false;
  }

  alert(count) {
    if (enabled('sound')) {
      try {
        this.audio ||= new (window.AudioContext || window.webkitAudioContext)();
        const now = this.audio.currentTime;
        [660, 990].forEach((f, i) => { const o = this.audio.createOscillator(), g = this.audio.createGain(), s = now + i * .14; o.frequency.value = f; g.gain.setValueAtTime(.0001, s); g.gain.exponentialRampToValueAtTime(.08, s + .02); g.gain.exponentialRampToValueAtTime(.0001, s + .45); o.connect(g).connect(this.audio.destination); o.start(s); o.stop(s + .5); });
      } catch { }
    }
    try {
      if (localStorage.getItem('ligata-ai-inbox:notify') === '1' && document.hidden && Notification.permission === 'granted') {
        const n = new Notification('Website chat', { body: `${count} conversation${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} a reply`, tag: 'ligata-ai-badge' });
        n.onclick = () => { window.focus(); this.open(); n.close(); };
      }
    } catch { }
  }

  open() { window.history.pushState(null, '', inboxPath); }

  render() {
    const label = this.count ? `${this.count} website conversation${this.count === 1 ? '' : 's'} need${this.count === 1 ? 's' : ''} a reply` : 'Website chat inbox';
    return html`<uui-button compact look="primary" label=${label} title=${label} @click=${() => this.open()}><uui-icon name="icon-chat"></uui-icon></uui-button>
      ${this.count ? html`<span class="badge" aria-hidden="true">${this.count > 9 ? '9+' : this.count}</span>` : nothing}`;
  }
}
customElements.define('ligata-ai-header-app', LigataAIHeaderApp);
export default LigataAIHeaderApp;
