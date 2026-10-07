import { css } from '@umbraco-cms/backoffice/external/lit';

export const inboxStyles = css`
  :host{--top:150px;--note:#fff6d6;--note-line:#f0d98a;--visitor:var(--subtle);--mine:var(--accent);--on-mine:var(--uui-color-interactive-contrast,#fff)}
  .app{display:grid;grid-template-rows:auto 1fr;height:calc(100dvh - var(--top));min-height:520px;padding:18px 24px 20px;gap:14px;box-sizing:border-box}
  .bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .bar h1{font-size:22px}.bar .sub{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px}
  .panes{display:grid;grid-template-columns:360px minmax(0,1fr) 300px;gap:14px;min-height:0}
  .panes.no-details{grid-template-columns:360px minmax(0,1fr)}
  .pane{background:var(--surface);border:1px solid var(--line);border-radius:14px;min-height:0;display:flex;flex-direction:column;overflow:hidden}
  .filters{padding:12px 12px 8px;border-bottom:1px solid var(--line);display:grid;gap:10px}
  .views{display:flex;gap:4px;flex-wrap:wrap}
  .views button{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:5px 8px;border-radius:8px;font-weight:600;font-size:12.5px;color:var(--muted)}
  .views button:hover{background:var(--subtle);color:var(--uui-color-text)}.views button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}
  .views .n{min-width:18px;padding:0 6px;border-radius:999px;background:var(--subtle);font-size:11px;line-height:18px;text-align:center;color:var(--muted)}
  .views button[aria-pressed=true] .n{background:var(--accent);color:var(--on-mine)}.views .n.hot{background:var(--danger);color:#fff}
  .search{display:flex;gap:8px;align-items:center}.search input{flex:1;min-width:0;border:1px solid var(--line);border-radius:9px;padding:7px 10px;background:var(--surface)}
  .search input:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
  .kinds{display:inline-flex;padding:2px;border-radius:8px;background:var(--subtle);border:1px solid var(--line)}.kinds button{border:0;background:transparent;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600;color:var(--muted)}.kinds button[aria-pressed=true]{background:var(--surface);color:var(--uui-color-text);box-shadow:0 1px 2px rgba(0,0,0,.1)}
  .items{flex:1;overflow-y:auto;padding:6px}
  .row-item{position:relative;display:grid;grid-template-columns:auto 1fr;gap:10px;width:100%;text-align:left;border:0;background:transparent;padding:10px;border-radius:10px;cursor:pointer;color:inherit}
  .row-item:hover{background:var(--subtle)}.row-item[aria-current=true]{background:var(--accent-soft)}
  .row-item .who{display:flex;gap:6px;align-items:baseline;min-width:0}.row-item .who b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px}
  .row-item time{font-size:11.5px;color:var(--muted);white-space:nowrap}
  .row-item .topic{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
  .row-item.unread .who b,.row-item.unread .topic{color:var(--uui-color-text);font-weight:700}
  .row-item .tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}
  .row-item .dot{position:absolute;top:14px;left:4px;width:7px;height:7px;border-radius:50%;background:var(--danger)}
  .face{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;flex:none;overflow:hidden;font-weight:700;font-size:12px;background:color-mix(in srgb,var(--accent) 14%,var(--surface));color:var(--accent);position:relative}
  .face img{width:100%;height:100%;object-fit:cover}.face svg{width:17px;height:17px}.face.small{width:24px;height:24px;font-size:10px}.face.large{width:56px;height:56px;font-size:18px}
  .face .online{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 2px var(--surface)}
  .face-wrap{position:relative;display:inline-flex}.face-wrap .online{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 2px var(--surface)}
  .scrim{position:fixed;inset:0;background:rgba(15,18,30,.45);z-index:29}
  .tag{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;background:var(--subtle);color:var(--muted);white-space:nowrap}
  .tag svg{width:12px;height:12px}.tag.wait{background:color-mix(in srgb,var(--warn) 15%,transparent);color:var(--warn)}.tag.live{background:color-mix(in srgb,var(--ok) 13%,transparent);color:var(--ok)}.tag.hot{background:color-mix(in srgb,var(--danger) 12%,transparent);color:var(--danger)}
  .more{display:flex;justify-content:center;padding:8px}
  .thread{display:grid;grid-template-rows:auto 1fr auto;min-height:0}
  .thread-head{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line)}
  .thread-head .grow{min-width:0}.thread-head h2{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.thread-head .meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--muted);margin-top:2px}
  .thread-head .meta a{color:inherit}
  .messages{overflow-y:auto;padding:18px 18px 10px;display:flex;flex-direction:column;gap:10px;background:color-mix(in srgb,var(--subtle) 45%,var(--surface))}
  .line{display:flex;gap:8px;max-width:78%;align-items:flex-end}
  .line .bubble{padding:9px 13px;border-radius:16px;background:var(--surface);border:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;font-size:14px}
  .line .label{font-size:11.5px;color:var(--muted);margin:0 4px 3px;display:flex;gap:6px;align-items:center}
  .line.visitor{align-self:flex-start}.line.visitor .bubble{border-bottom-left-radius:5px}
  .line.agent{align-self:flex-end;flex-direction:row-reverse}.line.agent .bubble{background:var(--mine);color:var(--on-mine);border-color:transparent;border-bottom-right-radius:5px}.line.agent .label{justify-content:flex-end}
  .line.agent.email .bubble{background:color-mix(in srgb,var(--mine) 12%,var(--surface));color:var(--uui-color-text);border-color:color-mix(in srgb,var(--mine) 30%,transparent)}
  .line.history{opacity:.78}.line.history .bubble{background:transparent;border-style:dashed;font-size:13px}
  .line.ai .bubble{background:color-mix(in srgb,var(--c-knowledge) 7%,var(--surface))}
  .note{align-self:stretch;margin:2px 30px;padding:9px 12px;border-radius:12px;background:var(--note);border:1px solid var(--note-line);color:#5c4a0b;font-size:13.5px;white-space:pre-wrap;overflow-wrap:anywhere}
  .note .label{display:flex;gap:6px;align-items:center;font-size:11.5px;font-weight:700;margin-bottom:3px}.note svg{width:14px;height:14px}
  .event{align-self:center;display:flex;gap:7px;align-items:center;padding:4px 12px;border-radius:999px;background:var(--surface);border:1px solid var(--line);font-size:12px;color:var(--muted)}
  .event svg{width:14px;height:14px}.event.good{color:var(--ok)}
  .divider{display:flex;align-items:center;gap:10px;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:4px 0}
  .divider::before,.divider::after{content:'';flex:1;height:1px;background:var(--line)}
  .typing{align-self:flex-start;display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--muted)}
  .dots{display:inline-flex;gap:3px;padding:8px 10px;border-radius:12px;background:var(--surface);border:1px solid var(--line)}.dots i{width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.35;animation:bounce 1.2s infinite}.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
  @keyframes bounce{0%,60%,100%{transform:none;opacity:.35}30%{transform:translateY(-3px);opacity:1}}
  .composer{border-top:1px solid var(--line);padding:10px 12px 12px;display:grid;gap:8px;background:var(--surface)}
  .composer .modes{display:flex;gap:4px}.composer .modes button{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:5px 10px;border-radius:7px;font-size:12.5px;font-weight:600;color:var(--muted)}
  .composer .modes button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}.composer .modes button.note[aria-pressed=true]{background:var(--note);color:#7a5d00}
  .composer textarea{width:100%;min-height:70px;max-height:220px;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--surface);line-height:1.5}
  .composer textarea:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
  .composer.note textarea{background:var(--note);border-color:var(--note-line)}
  .composer .hint{font-size:11.5px;color:var(--muted)}
  .gate{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:12px 14px;border-radius:12px;background:var(--accent-soft)}
  .gate p{font-size:13.5px}
  .details{overflow-y:auto;padding:16px;display:grid;gap:18px;align-content:start}
  .details h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px}
  .details dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0;font-size:13px}.details dt{color:var(--muted)}.details dd{margin:0;overflow-wrap:anywhere;font-weight:600}
  .visitor-card{display:flex;gap:12px;align-items:center}
  .agents{display:grid;gap:8px}.agent{display:flex;gap:10px;align-items:center;font-size:13px}.agent small{display:block}
  .appear{border:1px solid var(--line);border-radius:12px;padding:12px;display:grid;gap:10px;background:var(--subtle)}
  .bubble-preview{display:flex;gap:8px;align-items:flex-end}.bubble-preview .bubble{padding:7px 11px;border-radius:13px;border-bottom-left-radius:4px;background:var(--surface);border:1px solid var(--line);font-size:13px}.bubble-preview .label{font-size:11px;color:var(--muted);margin:0 0 2px 3px}
  .center{display:grid;place-items:center;text-align:center;gap:10px;padding:30px;color:var(--muted);height:100%;align-content:center}
  .center svg{width:40px;height:40px;opacity:.6}.center h2{color:var(--uui-color-text)}
  .presence{display:inline-flex;align-items:center;gap:6px;font-size:12.5px}.presence i{width:8px;height:8px;border-radius:50%;background:var(--muted);opacity:.5}.presence.on i{background:var(--ok);opacity:1;box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 18%,transparent)}
  .status-switch{display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);font-weight:600;font-size:13px}
  .status-switch i{width:9px;height:9px;border-radius:50%;background:var(--ok)}.status-switch.away i{background:var(--warn)}
  dialog .modes-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .mode-card{display:grid;gap:10px;text-align:left;border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface);cursor:pointer}
  .mode-card[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}.mode-card b{font-size:13.5px}.mode-card small{display:block}
  .mode-card:disabled{cursor:not-allowed;opacity:.6}
  .toast{position:fixed;right:22px;bottom:22px;z-index:20;display:flex;gap:10px;align-items:center;max-width:360px;padding:12px 14px;border-radius:12px;background:var(--uui-color-text,#1b1d26);color:#fff;box-shadow:0 12px 30px rgba(0,0,0,.25);font-size:13.5px}
  .toast button{color:#fff;border-color:rgba(255,255,255,.3);background:transparent}
  .back-btn{display:none}
  @media(max-width:1280px){.panes{grid-template-columns:300px minmax(0,1fr)}.panes .details{display:none}.panes.show-details{grid-template-columns:300px minmax(0,1fr) 280px}.panes.show-details .details{display:grid}}
  @media(max-width:860px){.app{padding:12px}.panes,.panes.show-details{grid-template-columns:1fr}.panes.has-thread .list-pane{display:none}.panes:not(.has-thread) .thread{display:none}.back-btn{display:inline-grid}.panes .details{display:none!important}}
`;
