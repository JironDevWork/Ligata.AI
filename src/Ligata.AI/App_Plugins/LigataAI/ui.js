import { html, nothing } from '@umbraco-cms/backoffice/external/lit';

// Tabler Icons 3.35.0 (MIT, https://tabler.io/icons), outline set. The launcher glyphs (chat, sparkle, help, wave) are the same as in the widget.
const paths = {
  chat: 'M8 9h8 M8 13h6 M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3h-2a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3h12z',
  sparkle: 'M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2-2a2 2 0 0 1-2-2a2 2 0 0 1-2 2zm0-12a2 2 0 0 1 2 2a2 2 0 0 1 2-2a2 2 0 0 1-2-2a2 2 0 0 1-2 2zm-7 12a6 6 0 0 1 6-6a6 6 0 0 1-6-6a6 6 0 0 1-6 6a6 6 0 0 1 6 6z',
  help: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0 M12 16v.01 M12 13a2 2 0 0 0 .914-3.782a1.98 1.98 0 0 0-2.414 .483',
  wave: 'M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5 M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5 M14 5.5a1.5 1.5 0 0 1 3 0v6.5 M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1-6 6h-2h.208a6 6 0 0 1-5.012-2.7a69.74 69.74 0 0 1-.196-.3c-.312-.479-1.407-2.388-3.286-5.728a1.5 1.5 0 0 1 .536-2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47',
  avatar: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 10m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M6.168 18.849a4 4 0 0 1 3.832-2.849h4a4 4 0 0 1 3.834 2.855',
  home: 'M5 12l-2 0l9-9l9 9l-2 0 M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7 M9 21v-6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6',
  palette: 'M12 21a9 9 0 0 1 0-18c4.97 0 9 3.582 9 8c0 1.06-.474 2.078-1.318 2.828c-.844 .75-1.989 1.172-3.182 1.172h-2.5a2 2 0 0 0-1 3.75a1.3 1.3 0 0 1-1 2.25 M8.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M12.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M16.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  sliders: 'M14 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M4 6l8 0 M16 6l4 0 M8 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M4 12l2 0 M10 12l10 0 M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M4 18l11 0 M19 18l1 0',
  book: 'M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0 M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0 M3 6l0 13 M12 6l0 13 M21 6l0 13',
  plug: 'M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1-5-5l1.5-1.5z M17 12l-5-5l1.5-1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z M3 21l2.5-2.5 M18.5 5.5l2.5-2.5 M10 11l-2 2 M13 14l-2 2',
  chart: 'M3 13a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z M15 9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z M9 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z M4 20h14',
  save: 'M6 4h10l4 4v10a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2 M12 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M14 4l0 4l-6 0l0-4',
  check: 'M5 12l5 5l10-10',
  close: 'M18 6l-12 12 M6 6l12 12',
  plus: 'M12 5l0 14 M5 12l14 0',
  upload: 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2 M7 9l5-5l5 5 M12 4l0 12',
  file: 'M14 3v4a1 1 0 0 0 1 1h4 M17 21h-10a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z',
  text: 'M4 6l16 0 M4 12l10 0 M4 18l14 0',
  page: 'M14 3v4a1 1 0 0 0 1 1h4 M17 21h-10a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z M9 9l1 0 M9 13l6 0 M9 17l6 0',
  edit: 'M4 20h4l10.5-10.5a2.828 2.828 0 1 0-4-4l-10.5 10.5v4 M13.5 6.5l4 4',
  trash: 'M4 7l16 0 M10 11l0 6 M14 11l0 6 M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12 M9 7v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3',
  up: 'M6 15l6-6l6 6',
  down: 'M6 9l6 6l6-6',
  refresh: 'M20 11a8.1 8.1 0 0 0-15.5-2m-.5-4v4h4 M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4',
  info: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0 M12 9h.01 M11 12h1v4h1',
  warn: 'M12 9v4 M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636-2.87l-8.106-13.536a1.914 1.914 0 0 0-3.274 0z M12 16h.01',
  monitor: 'M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-16a1 1 0 0 1-1-1v-10z M7 20h10 M9 16v4 M15 16v4',
  phone: 'M6 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-14z M11 4h2 M12 17v.01',
  sun: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M3 12h1m8-9v1m8 8h1m-9 8v1m-6.4-15.4l.7 .7m12.1-.7l-.7 .7m0 11.4l.7 .7m-12.1-.7l-.7 .7',
  moon: 'M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1-8.313-12.454z',
  key: 'M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1-4.069 0l-.301-.301l-6.558 6.558a2 2 0 0 1-1.239 .578l-.175 .008h-1.172a1 1 0 0 1-.993-.883l-.007-.117v-1.172a2 2 0 0 1 .467-1.284l.119-.13l.414-.414h2v-2h2v-2l2.144-2.144l-.301-.301a2.877 2.877 0 0 1 0-4.069l2.643-2.643a2.877 2.877 0 0 1 4.069 0z M15 9h.01',
  copy: 'M7 7m0 2.667a2.667 2.667 0 0 1 2.667-2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1-2.667 2.667h-8.666a2.667 2.667 0 0 1-2.667-2.667z M4.012 16.737a2.005 2.005 0 0 1-1.012-1.737v-10c0-1.1 .9-2 2-2h10c.75 0 1.158 .385 1.5 1',
  pulse: 'M3 12h4l3 8l4-16l3 8h4',
  back: 'M15 6l-6 6l6 6',
  inbox: 'M4 4m0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2z M4 13h3l3 3h4l3-3h3',
  person: 'M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0 M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2',
  team: 'M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2 M16 3.13a4 4 0 0 1 0 7.75 M21 21v-2a4 4 0 0 0-3-3.85',
  mail: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2v-10z M3 7l9 6l9-6',
  note: 'M13 20l7-7 M13 20v-6a1 1 0 0 1 1-1h6v-7a2 2 0 0 0-2-2h-12a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7',
  door: 'M13 12v.01 M3 21h18 M5 21v-16a2 2 0 0 1 2-2h7.5m2.5 10.5v7.5 M14 7h7m-3-3l3 3l-3 3',
  join: 'M15 8v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2 M21 12h-13l3-3 M11 15l-3-3',
  send: 'M10 14l11-11 M21 3l-6.5 18a.55 .55 0 0 1-1 0l-3.5-7l-7-3.5a.55 .55 0 0 1 0-1l18-6.5',
  bell: 'M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6 M9 17v1a3 3 0 0 0 6 0v-1',
  volume: 'M15 8a5 5 0 0 1 0 8 M17.7 5a9 9 0 0 1 0 14 M6 15h-2a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1-1.5 .5l-3.5-4.5',
  mute: 'M15 8a5 5 0 0 1 1.912 4.934m-1.377 2.602a5 5 0 0 1-.535 .464 M17.7 5a9 9 0 0 1 2.362 11.086m-1.676 2.299a9 9 0 0 1-.686 .615 M9.069 5.054l.431-.554a.8 .8 0 0 1 1.5 .5v2m0 4v8a.8 .8 0 0 1-1.5 .5l-3.5-4.5h-2a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l1.294-1.664 M3 3l18 18',
  search: 'M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M21 21l-6-6',
  globe: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0 M3.6 9h16.8 M3.6 15h16.8 M11.5 3a17 17 0 0 0 0 18 M12.5 3a17 17 0 0 1 0 18',
  clock: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0 M12 7v5l3 3',
  archive: 'M3 4m0 2a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2z M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10 M10 12l4 0',
  reopen: 'M9 14l-4-4l4-4 M5 10h11a4 4 0 1 1 0 8h-1',
  panel: 'M4 4m0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2z M15 4l0 16',
  more: 'M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  shield: 'M11.46 20.846a12 12 0 0 1-7.96-14.846a12 12 0 0 0 8.5-3a12 12 0 0 0 8.5 3a12 12 0 0 1-.09 7.06 M15 19l2 2l4-4',
};
export const icon = (name, extra) => html`<svg viewBox="0 0 24 24" aria-hidden="true" class=${extra || nothing}><path d=${paths[name] || paths.chat}></path></svg>`;
export const number = value => new Intl.NumberFormat().format(Math.round(value || 0));
export const compact = value => value >= 1000 ? `${(value / 1000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/, '')}k` : String(Math.round(value || 0));
export const date = value => value ? new Date(String(value).endsWith('Z') ? value : value + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

/** Form controls bound to dotted setting paths (e.g. "identity.name"). Mixed into the dashboard. */
export const controls = {
  value(path) { return path.split('.').reduce((o, k) => o?.[k], this.settings); },
  fieldError(path) { return this.errors?.[path] ? html`<span class="error">${this.errors[path]}</span>` : nothing; },
  text(path, label, { help = '', type = 'text', placeholder = '', max = 0, rows = 0 } = {}) {
    const value = this.value(path) ?? '';
    return html`<label class="control ${this.errors?.[path] ? 'invalid' : ''}"><span>${label}</span>
      ${rows ? html`<textarea rows=${rows} maxlength=${max || nothing} placeholder=${placeholder} .value=${value} @input=${e => this.set(path, e.target.value)}></textarea>`
             : html`<input type=${type} maxlength=${max || nothing} placeholder=${placeholder} .value=${String(value)} @input=${e => this.set(path, type === 'number' ? Number(e.target.value) : e.target.value)}>`}
      ${help ? html`<small>${help}</small>` : nothing}${max && rows ? html`<span class="count">${number(value.length)} / ${number(max)}</span>` : nothing}${this.fieldError(path)}</label>`;
  },
  toggle(path, label, help = '') {
    return html`<label class="switch small"><input type="checkbox" .checked=${!!this.value(path)} @change=${e => this.set(path, e.target.checked)}><span>${label}${help ? html`<small class="muted">${help}</small>` : nothing}</span></label>`;
  },
  segmented(path, label, options, help = '') {
    const value = this.value(path);
    return html`<div class="control"><span>${label}</span><div class="segmented" role="group" aria-label=${label}>${options.map(([v, l]) => html`<button type="button" aria-pressed=${String(value === v)} @click=${() => this.set(path, v)}>${l}</button>`)}</div>${help ? html`<small>${help}</small>` : nothing}${this.fieldError(path)}</div>`;
  },
  range(path, label, min, max, step, format = v => v, help = '') {
    const value = this.value(path);
    return html`<div class="control"><span>${label}</span><div class="range"><input type="range" min=${min} max=${max} step=${step} .value=${String(value)} aria-label=${label} @input=${e => this.set(path, Number(e.target.value))}><output>${format(value)}</output></div>${help ? html`<small>${help}</small>` : nothing}${this.fieldError(path)}</div>`;
  },
  select(path, label, options, help = '') {
    const value = this.value(path);
    return html`<label class="control"><span>${label}</span><select @change=${e => this.set(path, e.target.value)}>${options.map(([v, l]) => html`<option value=${v} .selected=${v === value}>${l}</option>`)}</select>${help ? html`<small>${help}</small>` : nothing}${this.fieldError(path)}</label>`;
  },
  list(path, label, { max = 6, placeholder = '', help = '' } = {}) {
    const items = this.value(path) || [];
    return html`<div class="control ${this.errors?.[path] ? 'invalid' : ''}"><span>${label}</span><div class="list-editor">
      ${items.map((item, i) => html`<div class="item"><input type="text" maxlength="300" .value=${item} placeholder=${placeholder} @input=${e => this.set(path, items.map((x, j) => j === i ? e.target.value : x))}><button type="button" class="icon-btn" aria-label="Remove" @click=${() => this.set(path, items.filter((_, j) => j !== i))}>${icon('close')}</button></div>`)}
      ${items.length < max ? html`<div><button type="button" class="btn small" @click=${() => this.set(path, [...items, ''])}>${icon('plus')}Add</button></div>` : nothing}
    </div>${help ? html`<small>${help}</small>` : nothing}${this.fieldError(path)}</div>`;
  },
};
