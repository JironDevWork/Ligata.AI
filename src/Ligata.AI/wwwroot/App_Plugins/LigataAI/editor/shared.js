import { html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { bearer, managementBase } from '../api.js?v=0.13.3';

// Tabler Icons 3.35.0 (MIT, https://tabler.io/icons), outline set: the same family as the rest of the package.
const paths = {
  sparkle: 'M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2-2a2 2 0 0 1-2-2a2 2 0 0 1-2 2zm0-12a2 2 0 0 1 2 2a2 2 0 0 1 2-2a2 2 0 0 1-2-2a2 2 0 0 1-2 2zm-7 12a6 6 0 0 1 6-6a6 6 0 0 1-6-6a6 6 0 0 1-6 6a6 6 0 0 1 6 6z',
  close: 'M18 6l-12 12 M6 6l12 12',
  plus: 'M12 5l0 14 M5 12l14 0',
  send: 'M10 14l11-11 M21 3l-6.5 18a.55 .55 0 0 1-1 0l-3.5-7l-7-3.5a.55 .55 0 0 1 0-1l18-6.5',
  stop: 'M5 5m0 2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2z',
  clip: 'M15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3l6.5-6.5a3 3 0 0 0-6-6l-6.5 6.5a4.5 4.5 0 0 0 9 9l6.5-6.5',
  expand: 'M16 4l4 0l0 4 M14 10l6-6 M8 20l-4 0l0-4 M4 20l6-6 M16 20l4 0l0-4 M14 14l6 6 M8 4l-4 0l0 4 M4 4l6 6',
  collapse: 'M5 9l4 0l0-4 M3 3l6 6 M5 15l4 0l0 4 M3 21l6-6 M19 9l-4 0l0-4 M15 9l6-6 M19 15l-4 0l0 4 M15 15l6 6',
  history: 'M12 8l0 4l2 2 M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5',
  search: 'M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M21 21l-6-6',
  eye: 'M10 12a2 2 0 1 0 4 0a2 2 0 0 0-4 0 M21 12c-2.4 4-5.4 6-9 6c-3.6 0-6.6-2-9-6c2.4-4 5.4-6 9-6c3.6 0 6.6 2 9 6',
  tree: 'M3 15m0 2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z M15 15m0 2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z M9 3m0 2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z M6 15v-1a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1 M12 9l0 3',
  blocks: 'M4 4h6v6h-6z M14 4h6v6h-6z M4 14h6v6h-6z M17 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  photo: 'M15 8h.01 M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-12a3 3 0 0 1-3-3v-12z M3 16l5-5c.928-.893 2.072-.893 3 0l5 5 M14 14l1-1c.928-.893 2.072-.893 3 0l3 3',
  open: 'M12 6h-6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6 M11 13l9-9 M15 4h5v5',
  back: 'M5 12l14 0 M5 12l6 6 M5 12l6-6',
  edit: 'M4 20h4l10.5-10.5a2.828 2.828 0 1 0-4-4l-10.5 10.5v4 M13.5 6.5l4 4',
  create: 'M14 3v4a1 1 0 0 0 1 1h4 M17 21h-10a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z M12 11l0 6 M9 14l6 0',
  publish: 'M21 12a9 9 0 1 0-9 9 M3.6 9h16.8 M3.6 15h8.4 M11.578 3a17 17 0 0 0 0 18 M12.5 3c1.719 2.755 2.5 5.876 2.5 9 M18 21v-7m3 3l-3-3l-3 3',
  move: 'M18 9l3 3l-3 3 M15 12h6 M6 9l-3 3l3 3 M3 12h6 M9 18l3 3l3-3 M12 15v6 M15 6l-3-3l-3 3 M12 3v6',
  trash: 'M4 7l16 0 M10 11l0 6 M14 11l0 6 M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12 M9 7v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3',
  undo: 'M9 14l-4-4l4-4 M5 10h11a4 4 0 1 1 0 8h-1',
  check: 'M5 12l5 5l10-10',
  checkCircle: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M9 12l2 2l4-4',
  xCircle: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M10 10l4 4m0-4l-4 4',
  warn: 'M12 9v4 M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636-2.87l-8.106-13.536a1.914 1.914 0 0 0-3.274 0z M12 16h.01',
  info: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0 M12 9h.01 M11 12h1v4h1',
  bolt: 'M13 3l0 7l6 0l-8 11l0-7l-6 0l8-11',
  hand: 'M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5 M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5 M14 5.5a1.5 1.5 0 0 1 3 0v6.5 M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1-6 6h-2h.208a6 6 0 0 1-5.012-2.7a69.74 69.74 0 0 1-.196-.3c-.312-.479-1.407-2.388-3.286-5.728a1.5 1.5 0 0 1 .536-2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47',
  shield: 'M11.46 20.846a12 12 0 0 1-7.96-14.846a12 12 0 0 0 8.5-3a12 12 0 0 0 8.5 3a12 12 0 0 1-.09 7.06 M15 19l2 2l4-4',
  page: 'M14 3v4a1 1 0 0 0 1 1h4 M17 21h-10a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z M9 9l1 0 M9 13l6 0 M9 17l6 0',
  chevron: 'M9 6l6 6l-6 6',
  more: 'M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
};
export const glyph = (name, extra) => html`<svg viewBox="0 0 24 24" aria-hidden="true" class=${extra || nothing}><path d=${paths[name] || paths.sparkle}></path></svg>`;

export const kindIcon = kind => ({ edit: 'edit', create: 'create', publish: 'publish', unpublish: 'publish', move: 'move', delete: 'trash', media: 'photo' }[kind] || 'edit');
export const kindLabel = kind => ({ edit: 'Edit', create: 'Create', publish: 'Publish', unpublish: 'Unpublish', move: 'Move', delete: 'Delete', media: 'Media' }[kind] || kind);
export const stepIcon = tool => ({ search_content: 'search', list_children: 'tree', read_content: 'eye', describe_type: 'blocks', search_media: 'photo', open_page: 'open' }[tool] || 'sparkle');

/** The backoffice address of a page (culture or "invariant"). */
export const documentPath = (key, culture) => `/umbraco/section/content/workspace/document/edit/${key}${culture ? '/' + culture : ''}`;

/** The page open in the backoffice, read from the address: { key, culture } or null. */
export function openDocument(location = window.location) {
  const m = /\/workspace\/document\/edit\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/([^/?#]+))?/i.exec(location.pathname);
  if (!m) return null;
  const culture = m[2] && m[2] !== 'invariant' && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(m[2]) ? m[2] : null;
  return { key: m[1].toLowerCase(), culture };
}

export function go(path) {
  if (window.location.pathname + window.location.search === path) return;
  window.history.pushState(null, '', path);
}

/** Answers are Markdown: bold, italics, code, lists, headings and links (umb://document/… opens the page in the backoffice). Never HTML. */
const inlinePattern = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(\s*([^)\s]+)\s*\)|`([^`]+)`/;
function inline(line, onOpen) {
  const out = [];
  let rest = line, m;
  while ((m = inlinePattern.exec(rest))) {
    if (m.index) out.push(rest.slice(0, m.index));
    if (m[1] !== undefined) out.push(html`<strong>${m[1]}</strong>`);
    else if (m[2] !== undefined) out.push(html`<em>${m[2]}</em>`);
    else if (m[3] !== undefined) {
      const target = m[4];
      const doc = /^umb:\/\/document\/([0-9a-f-]{32,36})/i.exec(target);
      if (doc) {
        const key = doc[1].length === 32 ? doc[1].replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5') : doc[1];
        out.push(html`<a class="doc" href=${documentPath(key)} @click=${e => { e.preventDefault(); onOpen?.(key); }}>${glyph('page')}${m[3]}</a>`);
      } else if (/^(https?:\/\/|\/(?!\/)|mailto:|tel:)/i.test(target)) out.push(html`<a href=${target} target="_blank" rel="noopener">${m[3]}</a>`);
      else out.push(`${m[3]} (${target})`);
    }
    else out.push(html`<code>${m[5]}</code>`);
    rest = rest.slice(m.index + m[0].length);
  }
  out.push(rest);
  return out;
}

export function markdown(text, onOpen) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let list = null, paragraph = [], table = null;
  // Tables: rows written as "| a | b |"; a row of dashes after the first makes it the header.
  const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const separator = row => /^[\s|:-]+$/.test(row) && row.includes('-');
  const flush = () => {
    if (paragraph.length) { blocks.push(html`<p>${paragraph.map((l, i) => html`${i ? html`<br>` : nothing}${inline(l, onOpen)}`)}</p>`); paragraph = []; }
    if (list) { const items = list.items; blocks.push(list.ordered ? html`<ol>${items.map(i => html`<li>${inline(i, onOpen)}</li>`)}</ol>` : html`<ul>${items.map(i => html`<li>${inline(i, onOpen)}</li>`)}</ul>`); list = null; }
    if (table) {
      const head = table.length > 1 && separator(table[1]) ? cells(table[0]) : null;
      const rows = (head ? table.slice(2) : table).filter(r => !separator(r)).map(cells);
      blocks.push(html`<div class="table"><table>${head ? html`<thead><tr>${head.map(c => html`<th>${inline(c, onOpen)}</th>`)}</tr></thead>` : nothing}<tbody>${rows.map(r => html`<tr>${r.map(c => html`<td>${inline(c, onOpen)}</td>`)}</tr>`)}</tbody></table></div>`);
      table = null;
    }
  };
  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) { if (!table) { flush(); table = []; } table.push(line); continue; }
    if (table) flush();
    const heading = /^#{1,6}\s+(.*)/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)/.exec(line);
    if (heading) { flush(); blocks.push(html`<h4>${inline(heading[1], onOpen)}</h4>`); }
    else if (bullet || number) {
      if (paragraph.length) { const p = paragraph; paragraph = []; blocks.push(html`<p>${p.map((l, i) => html`${i ? html`<br>` : nothing}${inline(l, onOpen)}`)}</p>`); }
      const ordered = !!number;
      if (list && list.ordered !== ordered) flush();
      list ||= { ordered, items: [] };
      list.items.push((bullet || number)[1]);
    }
    else if (!line.trim()) flush();
    else { if (list) flush(); paragraph.push(line); }
  }
  flush();
  return blocks;
}

/** Word-level difference of two texts: [{ op: 'same' | 'del' | 'add', text }]. Falls back to whole texts when they are long. */
export function diff(before, after) {
  const a = String(before || ''), b = String(after || '');
  // Words, spaces and single punctuation marks: "lasts." → "lasts for generations." changes only the end.
  const split = s => s.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || [];
  const x = split(a), y = split(b);
  if (x.length * y.length > 400000) return [{ op: 'del', text: a }, { op: 'add', text: b }];
  const n = x.length, m = y.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out = [];
  const push = (op, text) => { const last = out.at(-1); if (last && last.op === op) last.text += text; else out.push({ op, text }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { push('same', x[i]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) push('del', x[i++]);
    else push('add', y[j++]);
  }
  while (i < n) push('del', x[i++]);
  while (j < m) push('add', y[j++]);
  return out;
}

/** A POST that answers with server-sent events. onEvent(name, data) for each; resolves when the stream ends. */
export async function stream(auth, path, body, onEvent, signal) {
  const response = await fetch(managementBase + path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { ...(await bearer(auth)), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!response.ok || !(response.headers.get('content-type') || '').includes('text/event-stream')) {
    const data = await response.json().catch(() => null);
    const error = new Error(data?.message || data?.error?.message || `Request failed (${response.status}).`);
    error.code = data?.code || data?.error?.code; error.status = response.status;
    throw error;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      let name = 'message', data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) name = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!data) continue;
      try { onEvent(name, JSON.parse(data)); } catch (e) { console.warn('Ligata AI: bad event', e); }
    }
  }
}

export function when(value) {
  if (!value) return '';
  const date = new Date(String(value).endsWith('Z') ? value : value + 'Z'), today = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} ${time}`;
}

export const modeInfo = {
  readonly: { label: 'Read only', icon: 'eye', text: 'Finds and reads pages, and changes nothing.' },
  manual: { label: 'Manual', icon: 'hand', text: 'Asks before every change.' },
  auto: { label: 'Auto', icon: 'bolt', text: 'Makes safe drafts on its own; asks before risky changes and the rest.' },
  bypass: { label: 'Bypass', icon: 'shield', text: 'Makes every allowed change without asking.' },
};
export const effortInfo = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high' };
