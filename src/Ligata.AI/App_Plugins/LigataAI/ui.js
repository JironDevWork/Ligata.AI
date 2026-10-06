import { html, nothing } from '@umbraco-cms/backoffice/external/lit';

const paths = {
  chat: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5zM8.5 8.5h7M8.5 11.5h4.5',
  sparkle: 'M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9zM18.5 3.5v3M17 5h3M5.5 17v2.5M4.25 18.25h2.5',
  help: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7M12 16.6v.4',
  wave: 'M7.5 11.5V6.8a1.4 1.4 0 0 1 2.8 0v4.2M10.3 10.5V5.4a1.4 1.4 0 0 1 2.8 0v5.1M13.1 10.6V6.2a1.4 1.4 0 0 1 2.8 0v6.3M15.9 9.8a1.4 1.4 0 0 1 2.8 0v3.4a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.6-2.2l-2.7-3.6a1.4 1.4 0 0 1 2.1-1.8l1.1 1.2',
  avatar: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4.5 20.5c1.2-3.6 4.2-5.5 7.5-5.5s6.3 1.9 7.5 5.5',
  home: 'M4 11 12 4l8 7M6 9.5V20h12V9.5', palette: 'M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.4-1.9-.5-1.2.3-2.6 1.6-2.6h1.8a3.7 3.7 0 0 0 3.7-3.7C20.5 7.6 16.7 3.5 12 3.5M7.5 12h.01M9.5 8h.01M14.5 8h.01',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5', book: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7.5h6',
  plug: 'M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21', chart: 'M4 20h16M7 16V10M12 16V5M17 16v-4',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6', check: 'm5 12.5 4.5 4.5L19 7.5', close: 'M6 6l12 12M18 6 6 18', plus: 'M12 5v14M5 12h14',
  upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v4.5h15V15', file: 'M7 3.5h7l4 4V20.5H6V4zM14 3.5V8h4', text: 'M5 6h14M5 10h14M5 14h9M5 18h6', page: 'M4 5h16v14H4zM4 9h16M8 13h8M8 16h5',
  edit: 'M14.5 5.5l4 4L9 19H5v-4zM12.5 7.5l4 4', trash: 'M4 7h16M10 7V4h4v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6', up: 'm6 15 6-6 6 6', down: 'm6 9 6 6 6-6',
  refresh: 'M19 12a7 7 0 1 1-2-4.9M19 4.5v4h-4', info: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17M12 11v5M12 8v.01', warn: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17v.01',
  monitor: 'M3.5 5h17v11h-17zM9 20h6M12 16v4', phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1M11 18h2', sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4', moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10',
  key: 'M14.5 4a5.5 5.5 0 1 0 1.6 10.8L18 17h2v-2l-1.5-1.5A5.5 5.5 0 0 0 14.5 4M15 8.5h.01', copy: 'M8.5 8.5h11v11h-11zM15.5 8.5V4.5h-11v11h4',
  pulse: 'M3 12h4l2.5-6 5 12 2.5-6h4',
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
