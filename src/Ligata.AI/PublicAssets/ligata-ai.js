/*! Ligata AI website assistant | (c) Ligata */
(() => {
  'use strict';
  const script = document.currentScript || document.querySelector('script[data-ligata-ai]');
  if (!script || window.__ligataAI) return;
  window.__ligataAI = true;

  let settings;
  try { settings = JSON.parse(script.dataset.settings || '{}'); } catch { settings = {}; }
  const api = (script.dataset.api || '/api/ligata-ai').replace(/\/$/, '');
  const look = Object.assign({
    theme: 'ligata', colorScheme: 'light', position: 'left', accent: '#2f5bff', accentText: '#ffffff', background: '#ffffff', surface: '#f3f4f8', text: '#15171f', mutedText: '#5d6272',
    userBubble: '#2f5bff', userText: '#ffffff', assistantBubble: '#f3f4f8', assistantText: '#15171f', font: 'inherit', radius: 20, launcherSize: 60, launcherIcon: 'chat', launcherLabel: '',
    panelWidth: 400, panelHeight: 640, offsetX: 24, offsetY: 24, showContextMeter: true, showQueuePosition: true, showBranding: true, animations: true, teaser: '', teaserDelaySeconds: 6, zIndex: 2147483000,
  }, settings.appearance || {});
  const limits = Object.assign({ maxImages: 8, maxImageBytes: 5242880, maxPdfBytes: 10485760, maxPdfPages: 80, maxAttachments: 4, maxMessageCharacters: 8000 }, settings.limits || {});
  const preview = script.dataset.preview === 'true';

  // ---------- language ----------
  const strings = {
    en: { open: 'Open chat', close: 'Close chat', minimize: 'Minimize', newChat: 'New conversation', send: 'Send', stop: 'Stop', attach: 'Attach a screenshot or PDF', placeholder: 'Ask a question…', online: 'Online', busy: 'Busy right now', starting: 'Starting up', offline: 'Offline', degraded: 'Running slowly', checking: 'Connecting…', queue: n => n === 1 ? 'You are next' : `You are number ${n} in line`, wait: s => s < 60 ? `about ${Math.max(5, Math.round(s / 5) * 5)} s` : `about ${Math.round(s / 60)} min`, thinking: 'Thinking…', reading: p => `Reading the conversation… ${p}%`, typing: 'Writing…', memory: 'Memory', free: 'free', memoryHelp: (u, l) => `This conversation uses ${u} of ${l} tokens the assistant can keep in mind. When it is full, start a new conversation.`, memoryFull: 'The conversation is almost full. Start a new one soon.', retry: 'Try again', reconnect: 'Reconnect', newChatConfirm: 'Start a new conversation? The current one will be cleared.', removeAttachment: 'Remove attachment', pages: n => `${n} page${n === 1 ? '' : 's'}`, tokens: n => `${n} tokens`, processing: 'Reading file…', dropHere: 'Drop screenshots or PDFs here', contact: 'Contact us', email: 'Email us', poweredBy: 'Private AI by Ligata', notKept: 'not kept after leaving the page', you: 'You', unread: 'New answer', copy: 'Copy', copied: 'Copied',
      errors: { network: 'The assistant cannot be reached right now.', visitor_busy: 'Please wait for the current answer before asking the next question.', rate_limited: 'You are sending messages too quickly. Please wait a moment.', site_busy: 'Many people are asking right now. Please try again in a minute.', queue_full: 'The assistant is very busy right now. Please try again in a minute.', queue_timeout: 'The assistant is too busy to answer right now. Please try again shortly.', daily_quota: 'The assistant has answered its maximum number of questions for today.', model_unavailable: 'The assistant is offline right now.', model_loading: 'The assistant is starting up. Please try again in a minute.', gateway_unavailable: 'The assistant is offline right now.', context_full: 'This conversation is too long for the assistant to keep in mind. Start a new conversation.', answer_timeout: 'The answer took too long and was stopped. Try a shorter question.', model_failed: 'Something went wrong while answering. Please try again.', disabled: 'The assistant is switched off.', image_too_large: 'This image is too large.', unsupported_image: 'Only PNG, JPEG and WebP images are supported.', unsupported_file: 'Only screenshots (PNG, JPEG, WebP) and PDFs can be attached.', too_many_images: 'This conversation already has the maximum number of images. Start a new one to send more.', too_many_files: 'You can attach up to four files per message.', pdf_too_large: 'This PDF is too large.', pdf_no_text: 'This PDF has no readable text (it may be scanned). Attach screenshots of the pages instead.', pdf_encrypted: 'This PDF is password-protected.', invalid_pdf: 'This PDF could not be read.', documents_disabled: 'PDFs are not accepted here.', images_disabled: 'Images are not accepted here.', message_too_long: 'This message is too long.', origin_denied: 'The assistant is not available on this website.', default: 'Something went wrong. Please try again.' } },
    de: { open: 'Chat öffnen', close: 'Chat schliessen', minimize: 'Minimieren', newChat: 'Neues Gespräch', send: 'Senden', stop: 'Stopp', attach: 'Screenshot oder PDF anhängen', placeholder: 'Stell eine Frage …', online: 'Online', busy: 'Gerade ausgelastet', starting: 'Startet', offline: 'Offline', degraded: 'Läuft langsam', checking: 'Verbinde …', queue: n => n === 1 ? 'Du bist als Nächstes dran' : `Du bist Nummer ${n} in der Warteschlange`, wait: s => s < 60 ? `etwa ${Math.max(5, Math.round(s / 5) * 5)} s` : `etwa ${Math.round(s / 60)} min`, thinking: 'Denkt nach …', reading: p => `Liest das Gespräch … ${p} %`, typing: 'Schreibt …', memory: 'Gedächtnis', free: 'frei', memoryHelp: (u, l) => `Dieses Gespräch belegt ${u} von ${l} Tokens, die der Assistent im Kopf behalten kann. Wenn es voll ist, beginne ein neues Gespräch.`, memoryFull: 'Das Gespräch ist fast voll. Beginne bald ein neues.', retry: 'Erneut versuchen', reconnect: 'Neu verbinden', newChatConfirm: 'Neues Gespräch beginnen? Das aktuelle wird gelöscht.', removeAttachment: 'Anhang entfernen', pages: n => `${n} Seite${n === 1 ? '' : 'n'}`, tokens: n => `${n} Tokens`, processing: 'Datei wird gelesen …', dropHere: 'Screenshots oder PDFs hier ablegen', contact: 'Kontakt', email: 'E-Mail schreiben', poweredBy: 'Private KI von Ligata', notKept: 'nach dem Seitenwechsel nicht mehr verfügbar', you: 'Du', unread: 'Neue Antwort', copy: 'Kopieren', copied: 'Kopiert',
      errors: { network: 'Der Assistent ist gerade nicht erreichbar.', visitor_busy: 'Bitte warte auf die aktuelle Antwort, bevor du die nächste Frage stellst.', rate_limited: 'Du sendest zu schnell Nachrichten. Bitte warte einen Moment.', site_busy: 'Gerade fragen sehr viele Leute. Bitte versuche es in einer Minute erneut.', queue_full: 'Der Assistent ist gerade sehr ausgelastet. Bitte versuche es in einer Minute erneut.', queue_timeout: 'Der Assistent ist gerade zu ausgelastet. Bitte versuche es gleich noch einmal.', daily_quota: 'Der Assistent hat heute bereits die maximale Anzahl Fragen beantwortet.', model_unavailable: 'Der Assistent ist gerade offline.', model_loading: 'Der Assistent startet gerade. Bitte versuche es in einer Minute erneut.', gateway_unavailable: 'Der Assistent ist gerade offline.', context_full: 'Dieses Gespräch ist zu lang, um es im Kopf zu behalten. Beginne ein neues Gespräch.', answer_timeout: 'Die Antwort hat zu lange gedauert und wurde abgebrochen. Versuche eine kürzere Frage.', model_failed: 'Beim Antworten ist etwas schiefgelaufen. Bitte versuche es erneut.', disabled: 'Der Assistent ist ausgeschaltet.', image_too_large: 'Dieses Bild ist zu gross.', unsupported_image: 'Nur PNG-, JPEG- und WebP-Bilder werden unterstützt.', unsupported_file: 'Anhängen kannst du Screenshots (PNG, JPEG, WebP) und PDFs.', too_many_images: 'Dieses Gespräch enthält bereits die maximale Anzahl Bilder. Beginne ein neues, um weitere zu senden.', too_many_files: 'Pro Nachricht kannst du bis zu vier Dateien anhängen.', pdf_too_large: 'Dieses PDF ist zu gross.', pdf_no_text: 'Dieses PDF enthält keinen lesbaren Text (vielleicht gescannt). Hänge stattdessen Screenshots der Seiten an.', pdf_encrypted: 'Dieses PDF ist passwortgeschützt.', invalid_pdf: 'Dieses PDF konnte nicht gelesen werden.', documents_disabled: 'PDFs werden hier nicht angenommen.', images_disabled: 'Bilder werden hier nicht angenommen.', message_too_long: 'Diese Nachricht ist zu lang.', origin_denied: 'Der Assistent ist auf dieser Website nicht verfügbar.', default: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.' } },
    fr: { open: 'Ouvrir le chat', close: 'Fermer le chat', minimize: 'Réduire', newChat: 'Nouvelle conversation', send: 'Envoyer', stop: 'Arrêter', attach: 'Joindre une capture ou un PDF', placeholder: 'Posez une question…', online: 'En ligne', busy: 'Très sollicité', starting: 'Démarrage', offline: 'Hors ligne', degraded: 'Ralenti', checking: 'Connexion…', queue: n => n === 1 ? 'Vous êtes le prochain' : `Vous êtes numéro ${n} dans la file`, wait: s => s < 60 ? `environ ${Math.max(5, Math.round(s / 5) * 5)} s` : `environ ${Math.round(s / 60)} min`, thinking: 'Réflexion…', reading: p => `Lecture de la conversation… ${p} %`, typing: 'Rédaction…', memory: 'Mémoire', free: 'libre', memoryHelp: (u, l) => `Cette conversation utilise ${u} des ${l} tokens que l’assistant peut retenir. Quand elle est pleine, commencez-en une nouvelle.`, memoryFull: 'La conversation est presque pleine.', retry: 'Réessayer', reconnect: 'Reconnecter', newChatConfirm: 'Commencer une nouvelle conversation ? L’actuelle sera effacée.', removeAttachment: 'Retirer la pièce jointe', pages: n => `${n} page${n === 1 ? '' : 's'}`, tokens: n => `${n} tokens`, processing: 'Lecture du fichier…', dropHere: 'Déposez des captures ou des PDF ici', contact: 'Nous contacter', email: 'Nous écrire', poweredBy: 'IA privée par Ligata', notKept: 'non conservé après un changement de page', you: 'Vous', unread: 'Nouvelle réponse', copy: 'Copier', copied: 'Copié', errors: {} },
    it: { open: 'Apri la chat', close: 'Chiudi la chat', minimize: 'Riduci', newChat: 'Nuova conversazione', send: 'Invia', stop: 'Ferma', attach: 'Allega uno screenshot o un PDF', placeholder: 'Fai una domanda…', online: 'Online', busy: 'Molto richiesto', starting: 'In avvio', offline: 'Offline', degraded: 'Rallentato', checking: 'Connessione…', queue: n => n === 1 ? 'Sei il prossimo' : `Sei il numero ${n} in coda`, wait: s => s < 60 ? `circa ${Math.max(5, Math.round(s / 5) * 5)} s` : `circa ${Math.round(s / 60)} min`, thinking: 'Sto pensando…', reading: p => `Lettura della conversazione… ${p}%`, typing: 'Sto scrivendo…', memory: 'Memoria', free: 'libera', memoryHelp: (u, l) => `Questa conversazione usa ${u} dei ${l} token che l’assistente può ricordare. Quando è piena, iniziane una nuova.`, memoryFull: 'La conversazione è quasi piena.', retry: 'Riprova', reconnect: 'Riconnetti', newChatConfirm: 'Iniziare una nuova conversazione? Quella attuale verrà cancellata.', removeAttachment: 'Rimuovi allegato', pages: n => `${n} pagin${n === 1 ? 'a' : 'e'}`, tokens: n => `${n} token`, processing: 'Lettura del file…', dropHere: 'Trascina qui screenshot o PDF', contact: 'Contattaci', email: 'Scrivici', poweredBy: 'IA privata di Ligata', notKept: 'non conservato dopo il cambio di pagina', you: 'Tu', unread: 'Nuova risposta', copy: 'Copia', copied: 'Copiato', errors: {} },
  };
  const languageSetting = settings.language || 'auto';
  const lang = languageSetting !== 'auto' && strings[languageSetting] ? languageSetting : (strings[(document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase()] ? (document.documentElement.lang || navigator.language).slice(0, 2).toLowerCase() : 'en');
  const t = Object.assign({}, strings.en, strings[lang]);
  t.errors = Object.assign({}, strings.en.errors, strings[lang].errors);
  const errorText = (code, fallback) => t.errors[code] || fallback || t.errors.default;
  const number = n => new Intl.NumberFormat(lang).format(Math.round(n));
  const compact = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '')}k` : String(Math.round(n));

  // ---------- markup helpers ----------
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeHref = href => /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href) ? href : null;
  function inline(text) {
    const code = [];
    let html = escape(text).replace(/`([^`\n]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`);
    html = html.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
      const url = safeHref(href.replace(/&amp;/g, '&'));
      return url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    });
    html = html.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<em>$2</em>');
    return html.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escape(code[i])}</code>`);
  }
  /** Small, safe Markdown subset: paragraphs, lists, code blocks, bold/italic, links. HTML is always escaped. */
  function markdown(source) {
    const blocks = [];
    const lines = String(source || '').replace(/\r/g, '').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const body = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
        i++; blocks.push(`<pre><code>${escape(body.join('\n'))}</code></pre>`); continue;
      }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
        const ordered = /^\s*\d/.test(line); const items = [];
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>`);
        blocks.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
      }
      if (/^#{1,6}\s+/.test(line)) { blocks.push(`<p><strong>${inline(line.replace(/^#{1,6}\s+/, ''))}</strong></p>`); i++; continue; }
      if (!line.trim()) { i++; continue; }
      const paragraph = [];
      while (i < lines.length && lines[i].trim() && !/^```|^\s*([-*•]|\d+[.)])\s+|^#{1,6}\s+/.test(lines[i])) paragraph.push(inline(lines[i++]));
      blocks.push(`<p>${paragraph.join('<br>')}</p>`);
    }
    return blocks.join('');
  }

  const icons = {
    chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5z"/><path d="M8.5 8.5h7M8.5 11.5h4.5"/>',
    sparkle: '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9z"/><path d="M18.5 3.5v3M17 5h3M5.5 17v2.5M4.25 18.25h2.5"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7M12 16.6v.4"/>',
    wave: '<path d="M7.5 11.5V6.8a1.4 1.4 0 0 1 2.8 0v4.2M10.3 10.5V5.4a1.4 1.4 0 0 1 2.8 0v5.1M13.1 10.6V6.2a1.4 1.4 0 0 1 2.8 0v6.3"/><path d="M15.9 9.8a1.4 1.4 0 0 1 2.8 0v3.4a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.6-2.2l-2.7-3.6a1.4 1.4 0 0 1 2.1-1.8l1.1 1.2"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>', minimize: '<path d="M6 9.5 12 15.5l6-6"/>', send: '<path d="M5 12h12M12 6l6 6-6 6"/>', stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
    attach: '<path d="M15.5 7.5 9 14a2 2 0 0 0 2.8 2.8l6.9-6.9a4 4 0 0 0-5.7-5.7l-7 7a6 6 0 0 0 8.5 8.5l5-5"/>', refresh: '<path d="M19 12a7 7 0 1 1-2-4.9M19 4.5v4h-4"/>', pdf: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4M9 13h6M9 16h4"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>', mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  };
  const svg = (name, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${extra}>${icons[name] || icons.chat}</svg>`;

  // ---------- styles ----------
  const fonts = { inherit: 'inherit', system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif', serif: 'ui-serif, "Iowan Old Style", Georgia, serif', mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace' };
  const side = look.position === 'right' ? 'right' : 'left';
  const css = `
  :host{all:initial;position:fixed;${side}:var(--lai-x);bottom:var(--lai-y);z-index:${Number(look.zIndex) || 2147483000};font-family:${fonts[look.font] || 'inherit'};font-size:15px;line-height:1.5;color:var(--lai-text);-webkit-font-smoothing:antialiased;
    --lai-x:${+look.offsetX}px;--lai-y:${+look.offsetY}px;--lai-accent:${look.accent};--lai-on-accent:${look.accentText};--lai-bg:${look.background};--lai-surface:${look.surface};--lai-text:${look.text};--lai-muted:${look.mutedText};
    --lai-user:${look.userBubble};--lai-on-user:${look.userText};--lai-bot:${look.assistantBubble};--lai-on-bot:${look.assistantText};--lai-line:color-mix(in srgb,var(--lai-text) 11%,transparent);--lai-radius:${+look.radius}px;--lai-size:${+look.launcherSize}px;
    --lai-w:${+look.panelWidth}px;--lai-h:${+look.panelHeight}px;--lai-ok:#1f9d55;--lai-warn:#d98b00;--lai-off:#9aa0ad;--lai-danger:#c62f3b;--lai-ease:cubic-bezier(.2,.8,.2,1)}
  ${look.colorScheme === 'dark' ? ':host' : look.colorScheme === 'auto' ? '@media (prefers-color-scheme:dark){:host' : ':host(.never)'}{--lai-bg:#121419;--lai-surface:#1c1f27;--lai-text:#eef0f5;--lai-muted:#a3a9b8;--lai-bot:#1f232c;--lai-on-bot:#eef0f5;--lai-line:rgba(255,255,255,.09)}${look.colorScheme === 'auto' ? '}' : ''}
  *,*::before,*::after{box-sizing:border-box}
  button,textarea,input{font:inherit;color:inherit}
  button{cursor:pointer;border:0;background:none;padding:0}
  svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
  :focus-visible{outline:2px solid var(--lai-accent);outline-offset:2px}
  .sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .launcher-row{display:flex;align-items:center;gap:12px;flex-direction:${side === 'right' ? 'row-reverse' : 'row'}}
  .launcher{position:relative;width:var(--lai-size);height:var(--lai-size);border-radius:999px;background:var(--lai-accent);color:var(--lai-on-accent);display:grid;place-items:center;
    box-shadow:0 10px 30px -8px color-mix(in srgb,var(--lai-accent) 55%,transparent),0 3px 8px rgba(15,18,30,.18);transition:transform .25s var(--lai-ease),box-shadow .25s var(--lai-ease)}
  .launcher:hover{transform:translateY(-2px) scale(1.03)}.launcher:active{transform:scale(.96)}
  .launcher svg{width:calc(var(--lai-size)*.44);height:calc(var(--lai-size)*.44);transition:transform .3s var(--lai-ease),opacity .2s}
  .launcher .when-open{position:absolute;opacity:0;transform:rotate(-90deg) scale(.6)}
  :host([open]) .launcher .when-closed{opacity:0;transform:rotate(90deg) scale(.6)}
  :host([open]) .launcher .when-open{opacity:1;transform:none}
  .launcher img{width:100%;height:100%;border-radius:inherit;object-fit:cover}
  .launcher .dot{position:absolute;top:2px;${side === 'right' ? 'left' : 'right'}:2px;width:13px;height:13px;border-radius:50%;border:2.5px solid var(--lai-accent);background:var(--lai-off);transition:background .3s}
  :host([state=ready]) .launcher .dot{background:var(--lai-ok)}:host([state=busy]) .launcher .dot,:host([state=starting]) .launcher .dot,:host([state=degraded]) .launcher .dot{background:var(--lai-warn)}
  .launcher .badge{position:absolute;top:-4px;${side === 'right' ? 'left' : 'right'}:-4px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--lai-danger);color:#fff;font-size:12px;font-weight:700;display:none;place-items:center}
  :host([unread]) .launcher .badge{display:grid}
  .label{background:var(--lai-bg);color:var(--lai-text);padding:9px 15px;border-radius:999px;font-weight:600;font-size:14px;box-shadow:0 6px 24px -6px rgba(15,18,30,.25);border:1px solid var(--lai-line);white-space:nowrap;cursor:pointer}
  :host([open]) .label{display:none}
  .teaser{position:absolute;bottom:calc(var(--lai-size) + 14px);${side}:0;width:max-content;max-width:min(280px,calc(100vw - 2*var(--lai-x)));background:var(--lai-bg);color:var(--lai-text);border:1px solid var(--lai-line);border-radius:16px;
    border-${side === 'right' ? 'bottom-right' : 'bottom-left'}-radius:5px;padding:12px 34px 12px 14px;box-shadow:0 14px 40px -12px rgba(15,18,30,.35);font-size:14px;cursor:pointer;animation:rise .35s var(--lai-ease)}
  .teaser button{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;color:var(--lai-muted)}.teaser button svg{width:15px;height:15px}
  .panel{position:absolute;bottom:calc(var(--lai-size) + 16px);${side}:0;width:min(var(--lai-w),calc(100vw - 2*var(--lai-x)));height:min(var(--lai-h),calc(100vh - var(--lai-size) - var(--lai-y) - 40px));
    background:var(--lai-bg);color:var(--lai-text);border-radius:var(--lai-radius);border:1px solid var(--lai-line);display:flex;flex-direction:column;overflow:hidden;
    box-shadow:0 30px 80px -20px rgba(15,18,30,.45),0 8px 24px -8px rgba(15,18,30,.2);transform-origin:bottom ${side};visibility:hidden;opacity:0;transform:translateY(12px) scale(.96);
    transition:opacity .22s var(--lai-ease),transform .3s var(--lai-ease),visibility 0s .3s}
  :host([open]) .panel{visibility:visible;opacity:1;transform:none;transition:opacity .22s var(--lai-ease),transform .3s var(--lai-ease)}
  header{display:flex;align-items:center;gap:12px;padding:14px 12px 12px 16px;background:linear-gradient(180deg,color-mix(in srgb,var(--lai-accent) 9%,var(--lai-bg)),var(--lai-bg));border-bottom:1px solid var(--lai-line)}
  .avatar{width:38px;height:38px;border-radius:50%;background:var(--lai-accent);color:var(--lai-on-accent);display:grid;place-items:center;flex:none;overflow:hidden;font-weight:700}
  .avatar img{width:100%;height:100%;object-fit:cover}.avatar svg{width:20px;height:20px}
  .title{flex:1;min-width:0}.title strong{display:block;font-size:15.5px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .status{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--lai-muted)}.status i{width:7px;height:7px;border-radius:50%;background:var(--lai-off);flex:none}
  :host([state=ready]) .status i{background:var(--lai-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--lai-ok) 20%,transparent)}:host([state=busy]) .status i,:host([state=starting]) .status i,:host([state=degraded]) .status i{background:var(--lai-warn)}
  .tool{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:var(--lai-muted);transition:background .15s,color .15s}.tool:hover{background:var(--lai-surface);color:var(--lai-text)}
  .meter{display:flex;align-items:center;gap:10px;padding:7px 16px;font-size:11.5px;color:var(--lai-muted);border-bottom:1px solid var(--lai-line);cursor:help}
  .meter .bar{flex:1;height:4px;border-radius:4px;background:var(--lai-surface);overflow:hidden}.meter .fill{height:100%;width:0;border-radius:inherit;background:var(--lai-accent);transition:width .6s var(--lai-ease),background .3s}
  .meter.warn .fill{background:var(--lai-warn)}.meter.full .fill{background:var(--lai-danger)}.meter-text{white-space:nowrap}.meter b{font-weight:600;color:var(--lai-text);font-variant-numeric:tabular-nums}
  .log{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:18px 14px 8px;display:flex;flex-direction:column;gap:12px;scroll-behavior:smooth}
  .log::-webkit-scrollbar{width:8px}.log::-webkit-scrollbar-thumb{background:var(--lai-line);border-radius:8px}
  .msg{display:flex;flex-direction:column;max-width:88%;animation:${look.animations ? 'rise .28s var(--lai-ease)' : 'none'}}
  .msg.user{align-self:flex-end;align-items:flex-end}.msg.bot{align-self:flex-start}
  .bubble{padding:10px 14px;border-radius:18px;background:var(--lai-bot);color:var(--lai-on-bot);overflow-wrap:anywhere;font-size:14.5px}
  .msg.user .bubble{background:var(--lai-user);color:var(--lai-on-user);border-bottom-right-radius:6px}.msg.bot .bubble{border-bottom-left-radius:6px}
  .bubble p{margin:0}.bubble p+p,.bubble p+ul,.bubble p+ol,.bubble ul+p,.bubble ol+p,.bubble pre+p,.bubble p+pre{margin-top:8px}
  .bubble ul,.bubble ol{margin:4px 0;padding-left:20px}.bubble li+li{margin-top:3px}
  .bubble a{color:inherit;text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1px}
  .bubble code{font-family:ui-monospace,Menlo,monospace;font-size:.88em;padding:1px 5px;border-radius:5px;background:color-mix(in srgb,currentColor 10%,transparent)}
  .bubble pre{margin:6px 0;padding:10px;border-radius:10px;background:color-mix(in srgb,currentColor 8%,transparent);overflow-x:auto;font-size:13px}.bubble pre code{padding:0;background:none}
  .bubble.streaming>:last-child::after{content:'';display:inline-block;width:7px;height:1em;margin-left:2px;vertical-align:-2px;background:currentColor;border-radius:2px;animation:blink 1s steps(2) infinite}
  .meta{display:flex;gap:6px;align-items:center;margin-top:4px;min-height:22px;font-size:11.5px;color:var(--lai-muted);opacity:0;transition:opacity .2s}
  .msg.bot:hover .meta,.msg.bot:focus-within .meta{opacity:1}
  .meta button{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:6px;color:var(--lai-muted)}.meta button:hover{background:var(--lai-surface);color:var(--lai-text)}.meta svg{width:14px;height:14px}
  .files{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;justify-content:flex-end}
  .file{display:flex;align-items:center;gap:8px;max-width:240px;padding:6px 10px 6px 6px;border-radius:12px;background:var(--lai-surface);border:1px solid var(--lai-line);font-size:12.5px;color:var(--lai-text)}
  .file img{width:36px;height:36px;border-radius:8px;object-fit:cover;flex:none}.file .icon{width:36px;height:36px;border-radius:8px;display:grid;place-items:center;background:color-mix(in srgb,var(--lai-accent) 12%,transparent);color:var(--lai-accent);flex:none}
  .file span{min-width:0}.file b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.file small{color:var(--lai-muted)}
  .file.gone{opacity:.65}.file .x{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:var(--lai-muted);margin-left:auto}.file .x:hover{background:var(--lai-bg);color:var(--lai-danger)}.file .x svg{width:13px;height:13px}
  .file.busy .icon{animation:pulse 1.2s infinite}
  .suggestions{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}
  .suggestions button{padding:7px 12px;border-radius:999px;border:1px solid color-mix(in srgb,var(--lai-accent) 35%,var(--lai-line));color:var(--lai-accent);font-size:13.5px;background:var(--lai-bg);text-align:left;transition:background .15s}
  .suggestions button:hover{background:color-mix(in srgb,var(--lai-accent) 8%,var(--lai-bg))}
  .notice{align-self:stretch;display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:14px;font-size:13.5px;background:var(--lai-surface);border:1px solid var(--lai-line);animation:rise .25s var(--lai-ease)}
  .notice.error{background:color-mix(in srgb,var(--lai-danger) 7%,var(--lai-bg));border-color:color-mix(in srgb,var(--lai-danger) 25%,transparent)}
  .notice .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  .chip{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;background:var(--lai-accent);color:var(--lai-on-accent);font-size:13px;font-weight:600;text-decoration:none}
  .chip.ghost{background:transparent;color:var(--lai-text);border:1px solid var(--lai-line)}.chip svg{width:15px;height:15px}
  .waiting{align-self:flex-start;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:18px;border-bottom-left-radius:6px;background:var(--lai-bot);color:var(--lai-on-bot);font-size:13.5px;max-width:88%}
  .dots{display:inline-flex;gap:4px}.dots i{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.35;animation:bounce 1.2s infinite}.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
  .waiting .progress{width:90px;height:4px;border-radius:4px;background:color-mix(in srgb,currentColor 15%,transparent);overflow:hidden}.waiting .progress b{display:block;height:100%;background:var(--lai-accent);transition:width .4s}
  .queue-pos{font-variant-numeric:tabular-nums}
  form{padding:10px 12px 12px;border-top:1px solid var(--lai-line);background:var(--lai-bg)}
  .pending{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.pending:empty{display:none}
  .composer{display:flex;align-items:flex-end;gap:6px;padding:6px;border-radius:calc(var(--lai-radius)*.8);border:1px solid var(--lai-line);background:var(--lai-surface);transition:border-color .15s,box-shadow .15s}
  .composer:focus-within{border-color:color-mix(in srgb,var(--lai-accent) 60%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--lai-accent) 15%,transparent)}
  textarea{flex:1;resize:none;border:0;outline:0;background:transparent;min-height:36px;max-height:140px;padding:7px 4px;font-size:15px;line-height:1.45}
  textarea::placeholder{color:var(--lai-muted)}
  .icon-btn{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:var(--lai-muted);flex:none;transition:background .15s,color .15s}.icon-btn:hover:not(:disabled){background:var(--lai-bg);color:var(--lai-text)}
  .send{background:var(--lai-accent);color:var(--lai-on-accent)}.send:hover:not(:disabled){background:var(--lai-accent);color:var(--lai-on-accent);filter:brightness(1.08)}
  .icon-btn:disabled{opacity:.4;cursor:not-allowed}
  .footer{display:flex;justify-content:space-between;gap:10px;margin-top:8px;font-size:11px;color:var(--lai-muted);line-height:1.4}
  .footer a{color:inherit}.footer .brand{white-space:nowrap;opacity:.8}
  .drop{position:absolute;inset:0;display:none;place-items:center;background:color-mix(in srgb,var(--lai-bg) 88%,transparent);border:2px dashed var(--lai-accent);border-radius:var(--lai-radius);color:var(--lai-accent);font-weight:600;z-index:3}
  .panel.dragging .drop{display:grid}
  .hidden{display:none!important}
  @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes bounce{0%,60%,100%{transform:none;opacity:.35}30%{transform:translateY(-4px);opacity:1}}
  @keyframes blink{to{opacity:0}}@keyframes pulse{50%{opacity:.5}}
  @media (max-width:520px){
    :host([open]){inset:0;${side}:0;bottom:0}
    :host([open]) .launcher-row{display:none}
    .panel{position:fixed;inset:0;width:100%;height:100%;height:100dvh;border-radius:0;border:0;bottom:0}
    header{padding-top:max(14px,env(safe-area-inset-top))}form{padding-bottom:max(12px,env(safe-area-inset-bottom))}
    textarea{font-size:16px}
  }
  ${look.animations ? '' : '*{animation:none!important;transition:none!important}'}
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;

  // ---------- state ----------
  const host = document.createElement('div');
  host.id = 'ligata-ai';
  host.setAttribute('state', 'checking');
  const root = host.attachShadow({ mode: 'open' });
  const storageKey = 'ligata-ai:' + location.host;
  const state = { open: false, status: 'checking', queue: null, messages: [], pending: [], busy: false, controller: null, context: { used: 0, limit: settings.contextLimit || 0 }, baseTokens: settings.baseTokens || 0, lastConfig: 0, teaserShown: false };
  // The backoffice preview keeps its conversation in the editor's page memory (it reloads on every settings change).
  const previewStore = preview && window.parent !== window ? window.parent : null;
  try { // conversation text survives page changes within this tab; attachments never do
    const saved = previewStore ? previewStore.__ligataAIPreviewState : JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (saved && Array.isArray(saved.messages) && Date.now() - saved.at < 6 * 3600 * 1000) { state.messages = saved.messages; state.context = saved.context || state.context; state.open = !!saved.open; }
  } catch { /* storage unavailable: keep the conversation in memory only */ }
  const persist = () => {
    if (previewStore) { previewStore.__ligataAIPreviewState = { at: Date.now(), messages: state.messages, context: state.context, open: state.open }; return; }
    try {
      const messages = state.messages.map(m => ({ role: m.role, content: m.content, files: (m.files || []).map(f => ({ kind: f.kind, name: f.name, pages: f.pages, gone: true })) }));
      sessionStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), messages, context: state.context, open: state.open }));
    } catch { }
  };

  const name = settings.name || 'Assistant';
  const avatar = settings.avatarUrl ? `<img src="${escape(settings.avatarUrl)}" alt="">` : look.launcherIcon !== 'avatar' ? svg(look.launcherIcon) : escape(name.slice(0, 1));
  root.innerHTML = `<style>${css}</style>
    <div class="panel" role="dialog" aria-modal="false" aria-label="${escape(name)}">
      <header>
        <div class="avatar">${avatar}</div>
        <div class="title"><strong>${escape(name)}</strong><span class="status"><i></i><span class="status-text">${t.checking}</span></span></div>
        <button class="tool" data-action="new" title="${t.newChat}" aria-label="${t.newChat}">${svg('refresh')}</button>
        <button class="tool" data-action="close" title="${t.minimize}" aria-label="${t.minimize}">${svg('minimize')}</button>
      </header>
      <div class="meter ${look.showContextMeter ? '' : 'hidden'}" role="meter" aria-label="${t.memory}" aria-valuemin="0" aria-valuemax="100"><span>${t.memory}</span><div class="bar"><div class="fill"></div></div><span class="meter-text"></span><span class="sr"></span></div>
      <div class="log" role="log" aria-live="polite" aria-relevant="additions"></div>
      <form novalidate>
        <div class="pending"></div>
        <div class="composer">
          <button type="button" class="icon-btn attach ${settings.allowImages || settings.allowPdfs ? '' : 'hidden'}" title="${t.attach}" aria-label="${t.attach}">${svg('attach')}</button>
          <input type="file" class="sr" tabindex="-1" multiple accept="${[settings.allowImages ? 'image/png,image/jpeg,image/webp' : '', settings.allowPdfs ? 'application/pdf,.pdf' : ''].filter(Boolean).join(',')}">
          <label class="sr" for="lai-input">${t.placeholder}</label>
          <textarea id="lai-input" rows="1" maxlength="${limits.maxMessageCharacters}" placeholder="${escape(settings.inputPlaceholder || t.placeholder)}"></textarea>
          <button type="submit" class="icon-btn send" title="${t.send}" aria-label="${t.send}">${svg('send')}</button>
        </div>
        <div class="footer"><span class="privacy">${escape(settings.privacyNotice || '')}${settings.privacyUrl ? ` <a href="${escape(safeHref(settings.privacyUrl) || '#')}" target="_blank" rel="noopener">↗</a>` : ''}</span>${look.showBranding ? `<span class="brand">${t.poweredBy}</span>` : ''}</div>
      </form>
      <div class="drop">${t.dropHere}</div>
    </div>
    <div class="launcher-row">
      <button class="launcher" aria-expanded="false" aria-label="${t.open}">
        ${look.launcherIcon === 'avatar' && settings.avatarUrl ? `<span class="when-closed" style="display:contents"><img src="${escape(settings.avatarUrl)}" alt=""></span>` : svg(look.launcherIcon, 'class="when-closed"')}
        ${svg('close', 'class="when-open"')}<span class="dot"></span><span class="badge">1</span>
      </button>
      ${look.launcherLabel ? `<span class="label" role="presentation">${escape(look.launcherLabel)}</span>` : ''}
    </div>`;
  const $ = selector => root.querySelector(selector);
  const panel = $('.panel'), log = $('.log'), input = $('textarea'), form = $('form'), fileInput = $('input[type=file]'), launcher = $('.launcher'), sendButton = $('.send'), pendingList = $('.pending');

  // ---------- rendering ----------
  function setStatus(status, queue) {
    state.status = status; state.queue = queue || null;
    host.setAttribute('state', status);
    const text = { ready: t.online, busy: t.busy, starting: t.starting, degraded: t.degraded, offline: t.offline, disabled: t.offline, checking: t.checking }[status] || t.offline;
    $('.status-text').textContent = text;
    updateComposer();
  }

  function updateMeter() {
    const limit = state.context.limit || settings.contextLimit || 0;
    if (!limit) return;
    const pendingTokens = state.pending.reduce((n, f) => n + (f.tokens || 0), 0) + Math.ceil(input.value.length / 3.5);
    const used = Math.max(state.context.used || 0, state.baseTokens) + pendingTokens;
    const ratio = Math.min(1, used / limit);
    const meter = $('.meter');
    $('.fill').style.width = `${Math.max(2, ratio * 100)}%`;
    $('.meter-text').innerHTML = `<b>${compact(Math.max(0, limit - used))}</b> ${t.free}`;
    meter.classList.toggle('warn', ratio > .75 && ratio <= .92); meter.classList.toggle('full', ratio > .92);
    meter.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    meter.title = t.memoryHelp(number(used), number(limit));
    $('.meter .sr').textContent = t.memoryHelp(number(used), number(limit));
  }

  const scrollDown = (force) => { if (force || log.scrollHeight - log.scrollTop - log.clientHeight < 140) log.scrollTop = log.scrollHeight; };

  function fileChip(file, removable) {
    const thumb = file.kind === 'image' && file.preview ? `<img src="${file.preview}" alt="">` : `<span class="icon">${svg(file.kind === 'image' ? 'attach' : 'pdf')}</span>`;
    const detail = file.gone ? t.notKept : file.error ? escape(file.error) : file.busy ? t.processing : file.kind === 'document' ? `${t.pages(file.pages || 1)} · ${t.tokens(compact(file.tokens || 0))}` : t.tokens(compact(file.tokens || 280));
    return `<div class="file ${file.gone ? 'gone' : ''} ${file.busy ? 'busy' : ''}">${thumb}<span><b>${escape(file.name)}</b><small>${detail}</small></span>${removable ? `<button type="button" class="x" data-remove="${file.id}" aria-label="${t.removeAttachment}">${svg('close')}</button>` : ''}</div>`;
  }

  function messageNode(message) {
    const node = document.createElement('div');
    node.className = `msg ${message.role === 'user' ? 'user' : 'bot'}`;
    if (message.role === 'user') {
      node.innerHTML = `${message.files?.length ? `<div class="files">${message.files.map(f => fileChip(f, false)).join('')}</div>` : ''}${message.content ? `<div class="bubble"><p>${escape(message.content).replace(/\n/g, '<br>')}</p></div>` : ''}`;
    } else {
      node.innerHTML = `<div class="bubble">${markdown(message.content)}</div><div class="meta"><button type="button" data-copy>${svg('copy')}<span>${t.copy}</span></button></div>`;
      node.querySelector('[data-copy]').addEventListener('click', event => {
        navigator.clipboard?.writeText(message.content).then(() => { const label = event.currentTarget.querySelector('span'); label.textContent = t.copied; setTimeout(() => { label.textContent = t.copy; }, 1500); }).catch(() => {});
      });
    }
    return node;
  }

  function renderAll() {
    log.innerHTML = '';
    const greeting = { role: 'assistant', content: settings.greeting || '' };
    if (greeting.content) { const node = messageNode(greeting); node.querySelector('.meta').remove(); log.append(node); }
    if (!state.messages.length && settings.suggestions?.length) {
      const list = document.createElement('div');
      list.className = 'suggestions';
      list.innerHTML = settings.suggestions.map(s => `<button type="button">${escape(s)}</button>`).join('');
      list.addEventListener('click', event => { const button = event.target.closest('button'); if (button) send(button.textContent); });
      log.append(list);
    }
    for (const message of state.messages) log.append(messageNode(message));
    if (['offline', 'disabled'].includes(state.status)) showOffline();
    updateMeter();
    scrollDown(true);
  }

  function notice(html, kind = '') {
    log.querySelectorAll('.notice.transient').forEach(n => n.remove());
    const node = document.createElement('div');
    node.className = `notice transient ${kind}`;
    node.innerHTML = html;
    log.append(node);
    scrollDown(true);
    return node;
  }

  function contactActions() {
    const actions = [];
    if (settings.fallbackEmail) actions.push(`<a class="chip" href="mailto:${escape(settings.fallbackEmail)}">${svg('mail')}${t.email}</a>`);
    if (settings.fallbackUrl && safeHref(settings.fallbackUrl)) actions.push(`<a class="chip ghost" href="${escape(settings.fallbackUrl)}">${svg('link')}${t.contact}</a>`);
    return actions.join('');
  }

  function showOffline() {
    const node = notice(`<div><div>${escape(state.status === 'disabled' ? t.errors.disabled : settings.fallbackMessage || t.errors.model_unavailable)}</div><div class="actions">${contactActions()}<button type="button" class="chip ghost" data-reconnect>${svg('refresh')}${t.reconnect}</button></div></div>`);
    node.querySelector('[data-reconnect]').addEventListener('click', () => refreshConfig(true));
  }

  function showError(code, message, retry) {
    const offline = ['network', 'gateway_unavailable', 'model_unavailable'].includes(code);
    const node = notice(`<div><div>${escape(errorText(code, message))}</div><div class="actions">${code === 'context_full' ? `<button type="button" class="chip" data-new>${svg('refresh')}${t.newChat}</button>` : ''}${retry ? `<button type="button" class="chip ${code === 'context_full' ? 'ghost' : ''}" data-retry>${svg('refresh')}${t.retry}</button>` : ''}${offline ? contactActions() : ''}</div></div>`, 'error');
    node.querySelector('[data-retry]')?.addEventListener('click', () => { node.remove(); retry(); });
    node.querySelector('[data-new]')?.addEventListener('click', () => reset(false));
  }

  function updateComposer() {
    const unavailable = ['offline', 'disabled'].includes(state.status) && !preview;
    const working = state.pending.some(f => f.busy);
    input.disabled = unavailable;
    sendButton.disabled = !state.busy && (unavailable || working || (!input.value.trim() && !state.pending.length));
    sendButton.innerHTML = state.busy ? svg('stop') : svg('send');
    sendButton.title = sendButton.ariaLabel = state.busy ? t.stop : t.send;
    $('.attach').disabled = unavailable || state.busy;
    pendingList.innerHTML = state.pending.map(f => fileChip(f, true)).join('');
    updateMeter();
  }

  // In the backoffice preview the widget runs in a same-origin iframe and borrows the editor's login.
  async function request(path, options = {}) {
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(preview && window.parent !== window && window.parent.__ligataAIPreviewAuth ? await window.parent.__ligataAIPreviewAuth() : {}) };
    return fetch(`${api}/${path}`, { cache: 'no-store', credentials: preview ? 'same-origin' : 'omit', ...options, headers });
  }

  // ---------- availability ----------
  async function refreshConfig(force) {
    if (!force && Date.now() - state.lastConfig < 20000) return;
    state.lastConfig = Date.now();
    try {
      const response = await request('config', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (data.settings) {
        state.context.limit = data.settings.contextLimit || state.context.limit;
        state.baseTokens = data.settings.baseTokens || state.baseTokens;
        Object.assign(limits, data.settings.limits || {});
      }
      setStatus(data.state === 'disabled' && preview ? 'ready' : data.state, data.queue);
    } catch { setStatus('offline'); }
    if (state.open) renderAll();
  }

  // ---------- attachments ----------
  const readAsDataUrl = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });

  /** Screenshots are downscaled in the browser and re-encoded as JPEG/PNG: smaller uploads, same vision tokens. */
  async function prepareImage(file) {
    if (file.size > 12 * 1024 * 1024) throw Object.assign(new Error(), { code: 'image_too_large' });
    const bitmap = await createImageBitmap(file).catch(() => { throw Object.assign(new Error(), { code: 'unsupported_image' }); });
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
    if (!blob || blob.size > limits.maxImageBytes) blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .7));
    if (!blob || blob.size > limits.maxImageBytes) throw Object.assign(new Error(), { code: 'image_too_large' });
    const dataUrl = await readAsDataUrl(blob);
    const thumb = document.createElement('canvas');
    const t2 = Math.min(1, 96 / Math.max(canvas.width, canvas.height));
    thumb.width = Math.round(canvas.width * t2); thumb.height = Math.round(canvas.height * t2);
    thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
    return { data: dataUrl.split(',')[1], preview: thumb.toDataURL('image/jpeg', .7), tokens: 280 };
  }

  async function addFiles(files) {
    for (const file of files) {
      const isImage = /^image\/(png|jpeg|webp)$/.test(file.type);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const item = { id: Math.random().toString(36).slice(2), name: file.name || (isImage ? 'screenshot.png' : 'document.pdf'), kind: isImage ? 'image' : 'document', busy: true };
      const fail = code => { state.pending = state.pending.filter(p => p !== item); updateComposer(); showError(code); };
      if ((!isImage || !settings.allowImages) && (!isPdf || !settings.allowPdfs)) { showError(isImage ? 'images_disabled' : isPdf ? 'documents_disabled' : 'unsupported_file'); continue; }
      if (state.pending.length >= limits.maxAttachments) { showError('too_many_files'); break; }
      if (isImage && state.messages.concat([{ files: state.pending }]).flatMap(m => m.files || []).filter(f => f.kind === 'image' && !f.gone).length >= limits.maxImages) { showError('too_many_images'); break; }
      state.pending.push(item); updateComposer();
      try {
        if (isImage) Object.assign(item, await prepareImage(file));
        else {
          if (file.size > limits.maxPdfBytes) { fail('pdf_too_large'); continue; }
          const data = (await readAsDataUrl(file)).split(',')[1];
          const response = await request('attachments', { method: 'POST', body: JSON.stringify({ name: item.name, data }) });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) { fail(body.error?.code || 'invalid_pdf'); continue; }
          Object.assign(item, { text: body.text, pages: body.pages, tokens: body.tokens || Math.ceil(body.text.length / 3.5) });
        }
        item.busy = false;
      } catch (error) { fail(error.code || (isImage ? 'unsupported_image' : 'network')); continue; }
      updateComposer();
    }
  }

  // ---------- conversation ----------
  function payload() {
    return {
      pageTitle: document.title.slice(0, 150), pagePath: location.pathname.slice(0, 300),
      messages: state.messages.map(m => ({
        role: m.role, content: m.content,
        attachments: (m.files || []).filter(f => !f.gone).map(f => f.kind === 'image' ? { type: 'image', name: f.name, data: f.data } : { type: 'document', name: f.name, text: f.text }),
      })),
    };
  }

  async function send(text, isRetry) {
    if (state.busy) return;
    text = (text ?? input.value).trim();
    if (!isRetry) {
      if (!text && !state.pending.length) return;
      if (state.pending.some(f => f.busy)) return;
      state.messages.push({ role: 'user', content: text, files: state.pending.map(({ busy, ...f }) => f) });
      state.pending = []; input.value = ''; autosize();
      log.querySelector('.suggestions')?.remove();
      log.append(messageNode(state.messages.at(-1)));
    }
    log.querySelectorAll('.notice.transient').forEach(n => n.remove());
    state.busy = true; updateComposer(); scrollDown(true);
    const waiting = document.createElement('div');
    waiting.className = 'waiting';
    waiting.innerHTML = `<span class="dots"><i></i><i></i><i></i></span><span class="wait-text"></span>`;
    log.append(waiting); scrollDown(true);
    const waitText = waiting.querySelector('.wait-text');
    let answer = null, bubble = null, answerText = '', frame = 0;
    const paint = () => { frame = 0; if (bubble) { bubble.innerHTML = markdown(answerText) || '<p></p>'; scrollDown(); } };
    const controller = state.controller = new AbortController();
    let ended = false;
    const finish = () => { if (ended) return; ended = true; state.busy = false; state.controller = null; waiting.remove(); bubble?.classList.remove('streaming'); updateComposer(); persist(); };
    try {
      const response = await request(preview ? 'preview' : 'chat', { method: 'POST', signal: controller.signal, body: JSON.stringify(preview ? { chat: payload(), settings: window.parent.__ligataAIPreviewSettings?.() } : payload()) });
      if (!response.ok || !response.body || !(response.headers.get('content-type') || '').includes('event-stream')) {
        const body = await response.json().catch(() => ({}));
        finish();
        if (body.error?.code === 'context_full') { state.context.used = body.error.promptTokens || state.context.limit; updateMeter(); }
        if (['gateway_unavailable', 'model_unavailable', 'disabled'].includes(body.error?.code)) setStatus(body.error.code === 'disabled' ? 'disabled' : 'offline');
        showError(body.error?.code || 'network', body.error?.message, ['context_full', 'disabled', 'daily_quota', 'origin_denied', 'message_too_long'].includes(body.error?.code) ? null : () => send('', true));
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          const name = /^event: (.*)$/m.exec(block)?.[1];
          const raw = /^data: (.*)$/m.exec(block)?.[1];
          if (!name || !raw) continue;
          const data = JSON.parse(raw);
          if (name === 'queued') {
            if (look.showQueuePosition) waitText.innerHTML = `<span class="queue-pos">${t.queue(data.position)}</span> · ${t.wait(data.estimatedWaitSeconds || 10)}`;
          } else if (name === 'started') {
            waitText.textContent = '';
            if (data.contextTokens) state.context.limit = data.contextTokens;
            state.context.used = data.promptTokens || state.context.used; updateMeter();
          } else if (name === 'progress') {
            const percent = Math.min(99, Math.round(data.processed / data.total * 100));
            waitText.innerHTML = `${t.reading(percent)} <span class="progress"><b style="width:${percent}%"></b></span>`;
          } else if (name === 'thinking') {
            waitText.textContent = t.thinking;
          } else if (name === 'delta') {
            if (!answer) {
              waiting.remove();
              answer = { role: 'assistant', content: '' };
              state.messages.push(answer);
              const node = messageNode(answer);
              bubble = node.querySelector('.bubble'); bubble.classList.add('streaming');
              log.append(node);
            }
            answerText += data.text; answer.content = answerText;
            if (!frame) frame = requestAnimationFrame(paint);
          } else if (name === 'done') {
            state.context = { used: data.context.used, limit: data.context.limit };
            if (!state.open) host.setAttribute('unread', '');
          } else if (name === 'error') {
            finish();
            if (answer && !answerText) state.messages.pop();
            showError(data.code, data.message, data.code === 'context_full' ? null : () => send('', true));
          }
        }
      }
      if (frame) { cancelAnimationFrame(frame); paint(); }
      if (!answer && !ended) { finish(); showError('model_failed', null, () => send('', true)); return; }
      finish();
    } catch (error) {
      if (frame) { cancelAnimationFrame(frame); paint(); }
      const stopped = controller.signal.aborted;
      finish();
      if (stopped) { if (answer && !answerText) state.messages.pop(); return; }
      setStatus('offline');
      showError('network', null, () => send('', true));
    }
  }

  function reset(ask = true) {
    if (ask && state.messages.length && !confirm(t.newChatConfirm)) return;
    state.controller?.abort();
    state.messages = []; state.pending = []; state.context.used = 0;
    persist(); renderAll(); updateComposer(); input.focus();
  }

  // ---------- open / close ----------
  function open(value) {
    state.open = value;
    host.toggleAttribute('open', value);
    launcher.setAttribute('aria-expanded', String(value));
    launcher.setAttribute('aria-label', value ? t.close : t.open);
    root.querySelector('.teaser')?.remove();
    if (value) {
      host.removeAttribute('unread');
      renderAll();
      refreshConfig(true);
      setTimeout(() => { if (!matchMedia('(max-width:520px)').matches || state.messages.length) input.focus({ preventScroll: true }); }, 50);
      if (matchMedia('(max-width:520px)').matches) document.documentElement.style.setProperty('overflow', 'hidden');
    } else {
      document.documentElement.style.removeProperty('overflow');
    }
    persist();
  }

  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }

  launcher.addEventListener('click', () => open(!state.open));
  $('.label')?.addEventListener('click', () => open(true));
  root.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'close') { open(false); launcher.focus(); }
    if (action === 'new') reset(true);
    const remove = event.target.closest('[data-remove]')?.dataset.remove;
    if (remove) { state.pending = state.pending.filter(f => f.id !== remove); updateComposer(); }
  });
  form.addEventListener('submit', event => { event.preventDefault(); if (state.busy) state.controller?.abort(); else send(); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!state.busy) send(); } });
  input.addEventListener('input', () => { autosize(); updateComposer(); });
  input.addEventListener('paste', event => { const files = [...(event.clipboardData?.files || [])]; if (files.length) { event.preventDefault(); addFiles(files); } });
  $('.attach').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
  panel.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); panel.classList.add('dragging'); } });
  panel.addEventListener('dragleave', event => { if (!panel.contains(event.relatedTarget)) panel.classList.remove('dragging'); });
  panel.addEventListener('drop', event => { event.preventDefault(); panel.classList.remove('dragging'); addFiles([...event.dataTransfer.files]); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && state.open) { open(false); launcher.focus(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.open) refreshConfig(false); });
  setInterval(() => { if (state.open && !state.busy && !document.hidden) refreshConfig(['offline', 'starting', 'busy'].includes(state.status)); }, 30000);

  // ---------- start ----------
  const mount = () => {
    document.body.append(host);
    setStatus('checking');
    if (state.open || script.dataset.open === 'true') open(true);
    else setTimeout(() => refreshConfig(true), 1500); // status dot without delaying the page
    if (look.teaser && !state.open && !state.messages.length) {
      setTimeout(() => {
        if (state.open || state.teaserShown) return;
        state.teaserShown = true;
        const teaser = document.createElement('div');
        teaser.className = 'teaser';
        teaser.innerHTML = `${escape(look.teaser)}<button type="button" aria-label="${t.close}">${svg('close')}</button>`;
        teaser.addEventListener('click', event => { if (event.target.closest('button')) teaser.remove(); else open(true); });
        $('.launcher-row').append(teaser);
      }, Math.max(0, +look.teaserDelaySeconds) * 1000);
    }
  };
  window.LigataAI = { open: () => open(true), close: () => open(false), toggle: () => open(!state.open), reset: () => reset(false), ask: text => { open(true); send(text); } };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
