import { html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { icon } from './ui.js?v=0.7.4';
import { themes, colorFields, contrast, readablePairs } from './themes.js?v=0.7.4';

export const appearanceView = {
  /** Warns (without blocking) when a colour pair is hard to read; shown even while the colour list is collapsed. */
  contrastNotice(a) {
    const low = readablePairs.map(([text, back, label]) => ({ label, ratio: contrast(a[text], a[back]) })).filter(x => x.ratio < 4.5);
    if (!low.length) return nothing;
    return html`<div class="notice warning" style="margin-top:14px">${icon('warn')}<div><strong>Some text may be hard to read</strong>
      <ul>${low.map(x => html`<li>${x.label}: ${x.ratio.toFixed(1)}:1</li>`)}</ul><small>Aim for at least 4.5:1 so every visitor can read the chat comfortably.</small></div></div>`;
  },

  appearanceView() {
    const a = this.settings.appearance;
    return html`<div class="split">
      <div class="grid">
        <section class="card">
          <header><div><h2>Theme</h2><p class="muted">Start from a theme, then fine-tune any colour.</p></div></header>
          <div class="swatches">${Object.entries(themes).map(([key, theme]) => html`<button type="button" class="swatch" aria-pressed=${String(a.theme === key)} @click=${() => this.applyTheme(key)}>
            <span class="chips"><i style="background:${theme.accent}"></i><i style="background:${theme.background}"></i><i style="background:${theme.surface}"></i><i style="background:${theme.text}"></i></span><b>${theme.label}</b></button>`)}
            ${a.theme === 'custom' ? html`<button type="button" class="swatch" aria-pressed="true"><span class="chips"><i style="background:${a.accent}"></i><i style="background:${a.background}"></i><i style="background:${a.surface}"></i><i style="background:${a.text}"></i></span><b>Custom</b></button>` : nothing}
          </div>
          <div class="section">
            ${this.segmented('appearance.colorScheme', 'Colour mode', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Follow visitor']], 'Dark mode keeps your accent and bubble colours and uses a dark panel.')}
          </div>
          <details class="section"><summary><strong>Colours</strong> <small class="muted">All ten can be changed.</small></summary>
            <div class="colors" style="margin-top:12px">${colorFields.map(([key, label]) => html`<label class="color"><input type="color" .value=${a[key]} @input=${e => this.set('appearance.' + key, e.target.value)}><span>${label}<code>${a[key]}</code></span></label>`)}</div>
            ${this.errors && Object.keys(this.errors).some(k => colorFields.some(([c]) => k === 'appearance.' + c)) ? html`<span class="error">Colours must be hex values like #2f5bff.</span>` : nothing}
          </details>
          ${this.contrastNotice(a)}
        </section>
        <section class="card">
          <header><div><h2>Chat bubble</h2><p class="muted">The button visitors click to open the assistant.</p></div></header>
          <div class="grid two">
            ${this.segmented('appearance.position', 'Position', [['left', 'Bottom left'], ['right', 'Bottom right']])}
            <div class="control"><span>Icon</span><div class="icons">${['chat', 'sparkle', 'help', 'wave', 'avatar'].map(name => html`<button type="button" aria-pressed=${String(a.launcherIcon === name)} title=${name} aria-label=${name} ?disabled=${name === 'avatar' && !this.settings.identity.avatarUrl} @click=${() => this.set('appearance.launcherIcon', name)}>${icon(name)}</button>`)}</div>${!this.settings.identity.avatarUrl ? html`<small>Add an avatar image under Behaviour to use it as the bubble.</small>` : nothing}${this.fieldError('appearance.launcherIcon')}</div>
            ${this.range('appearance.launcherSize', 'Bubble size', 44, 88, 2, v => `${v} px`)}
            ${this.text('appearance.launcherLabel', 'Label next to the bubble', { max: 30, placeholder: 'e.g. Questions? Ask us', help: 'Optional. Leave empty for just the bubble.' })}
            ${this.range('appearance.offsetX', 'Distance from the side', 0, 120, 2, v => `${v} px`)}
            ${this.range('appearance.offsetY', 'Distance from the bottom', 0, 120, 2, v => `${v} px`)}
          </div>
          <div class="section">
            ${this.text('appearance.teaser', 'Teaser message', { max: 160, placeholder: 'e.g. 👋 Hi! Can I help you find something?', help: 'A small speech bubble that appears once per page if the visitor has not opened the chat.' })}
            ${a.teaser ? this.range('appearance.teaserDelaySeconds', 'Show the teaser after', 0, 60, 1, v => `${v} s`) : nothing}
          </div>
        </section>
        <section class="card">
          <header><div><h2>Chat window</h2></div></header>
          <div class="grid two">
            ${this.range('appearance.panelWidth', 'Width', 320, 560, 10, v => `${v} px`)}
            ${this.range('appearance.panelHeight', 'Height', 420, 900, 10, v => `${v} px`)}
            ${this.range('appearance.radius', 'Corner roundness', 0, 32, 1, v => `${v} px`)}
            ${this.select('appearance.font', 'Font', [['inherit', 'Same as the website'], ['system', 'System UI'], ['rounded', 'Rounded'], ['serif', 'Serif'], ['mono', 'Monospace']])}
          </div>
          <div class="section">
            ${this.toggle('appearance.showContextMeter', 'Show the memory bar', 'Off by default. A slim bar above the input (“Memory”, in German “Gedächtnis”) showing how full the conversation memory is. Long conversations are counted and summarized either way.')}
            ${this.api() ? nothing : this.toggle('appearance.showQueuePosition', 'Show queue position', 'When the shared AI is busy, visitors see their place in line and the expected wait.')}
            ${this.toggle('appearance.animations', 'Animations', 'Visitors who prefer reduced motion never see animations.')}
            ${this.licensedFeatures().liveChat ? this.toggle('appearance.sound', 'Chime when the team replies', 'A soft sound when a team member answers while the chat is closed or the tab is in the background.') : nothing}
            ${this.toggle('appearance.showBranding', this.api() ? 'Show “AI by Ligata”' : 'Show “Private AI by Ligata”')}
          </div>
          <details class="section"><summary><strong>Advanced</strong></summary>
            <div style="margin-top:12px">${this.text('appearance.zIndex', 'Stacking order (z-index)', { type: 'number', help: 'Raise or lower this if the bubble should appear above or below other floating elements on your site.' })}</div>
          </details>
        </section>
      </div>
      ${this.previewPane()}
    </div>`;
  },
};
