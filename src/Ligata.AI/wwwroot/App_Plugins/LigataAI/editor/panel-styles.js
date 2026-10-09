import { css } from '@umbraco-cms/backoffice/external/lit';

/** The content assistant's chat: Umbraco's own colours (light, dark and high-contrast themes), quiet motion. */
export const panelStyles = css`
  :host{position:fixed;inset:auto 0 0 auto;z-index:900;font-family:var(--uui-font-family,Lato,system-ui,sans-serif);font-size:14px;line-height:1.5;color:var(--ink);-webkit-font-smoothing:antialiased;
    --ink:var(--uui-color-text,#1b1d26);--muted:var(--uui-color-text-alt,#646979);--surface:var(--uui-color-surface,#fff);--subtle:var(--uui-color-surface-alt,#f4f5f8);--line:var(--uui-color-border,#e3e5ec);
    --accent:var(--uui-color-interactive,#3544b1);--on-accent:var(--uui-color-interactive-contrast,#fff);--soft:color-mix(in srgb,var(--accent) 9%,var(--surface));
    --ok:#1f8f4e;--warn:#b97700;--danger:var(--uui-color-danger,#c62f3b);--ease:cubic-bezier(.2,.8,.2,1);--shadow:0 24px 64px -18px rgba(12,16,34,.32),0 6px 18px -6px rgba(12,16,34,.16)}
  *,*::before,*::after{box-sizing:border-box}
  button,textarea,input{font:inherit;color:inherit}
  button{cursor:pointer;border:0;background:none;padding:0}
  button:disabled{opacity:.45;cursor:not-allowed}
  svg{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
  :focus-visible{outline:2px solid color-mix(in srgb,var(--accent) 70%,transparent);outline-offset:2px;border-radius:6px}
  a{color:var(--accent)}

  /* launcher: above the workspace's Save and Publish bar */
  .launcher{position:fixed;right:24px;bottom:84px;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--on-accent);
    box-shadow:0 12px 28px -8px color-mix(in srgb,var(--accent) 60%,transparent),0 3px 8px rgba(12,16,34,.18);transition:transform .25s var(--ease),box-shadow .25s var(--ease);animation:pop .35s var(--ease)}
  .launcher:hover{transform:translateY(-2px) scale(1.04)}.launcher:active{transform:scale(.96)}
  .launcher svg{width:24px;height:24px}
  .launcher .badge{position:absolute;top:-3px;right:-3px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--warn);color:#fff;font-size:11.5px;font-weight:700;display:grid;place-items:center;box-shadow:0 0 0 2px var(--surface)}

  .panel{position:fixed;right:24px;bottom:84px;width:min(440px,calc(100vw - 32px));height:min(680px,calc(100vh - 164px));display:flex;flex-direction:column;overflow:hidden;
    background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);transform-origin:bottom right;
    visibility:hidden;opacity:0;transform:translateY(10px) scale(.97);transition:opacity .2s var(--ease),transform .28s var(--ease),visibility 0s .28s,width .28s var(--ease),height .28s var(--ease)}
  .panel.open{visibility:visible;opacity:1;transform:none;transition:opacity .2s var(--ease),transform .28s var(--ease),width .28s var(--ease),height .28s var(--ease)}
  .panel.docked{width:min(600px,calc(100vw - 32px));height:calc(100vh - 156px)}

  header{display:flex;align-items:center;gap:6px;padding:10px 8px 10px 14px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,var(--soft),var(--surface))}
  .mark{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--accent);color:var(--on-accent);flex:none;margin-right:4px}
  .mark svg{width:18px;height:18px}
  .title{flex:1;min-width:0;display:grid}
  .title strong{font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sub{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sub .live{color:var(--accent);animation:pulse 1.4s infinite}.sub .wait{color:var(--warn);font-weight:600}
  .icon{width:32px;height:32px;border-radius:8px;display:inline-grid;place-items:center;color:var(--muted);flex:none;transition:background .15s,color .15s;cursor:pointer}
  .icon:hover:not(:disabled),.icon[aria-pressed=true]{background:var(--subtle);color:var(--ink)}
  .icon.small{width:26px;height:26px}.icon.small svg{width:15px;height:15px}

  .log,.list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
  .log{padding:16px 16px 8px;display:flex;flex-direction:column;gap:10px}
  .log::-webkit-scrollbar,.list::-webkit-scrollbar{width:8px}.log::-webkit-scrollbar-thumb,.list::-webkit-scrollbar-thumb{background:var(--line);border-radius:8px}
  .log>*{animation:rise .26s var(--ease);flex-shrink:0}

  .empty{margin:auto 0;padding:18px 6px;display:grid;gap:10px;justify-items:center;text-align:center}
  .empty.small{padding:30px 10px;color:var(--muted)}
  .empty h3{margin:0;font-size:16px}.empty p{margin:0;color:var(--muted);max-width:330px}
  .hero{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;background:var(--soft);color:var(--accent)}.hero svg{width:24px;height:24px}
  .ideas{display:grid;gap:6px;width:100%;margin-top:8px}
  .ideas button{text-align:left;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font-size:13px;transition:border-color .15s,background .15s}
  .ideas button:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line));background:var(--soft)}

  .msg{display:flex;flex-direction:column;max-width:100%}
  .msg.user{align-self:flex-end;align-items:flex-end;max-width:86%}
  .msg.user .bubble{background:var(--soft);border:1px solid color-mix(in srgb,var(--accent) 16%,transparent);padding:8px 12px;border-radius:14px 14px 4px 14px;white-space:pre-wrap;overflow-wrap:anywhere}
  .on{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);margin:0 2px 3px}.on svg{width:12px;height:12px}
  .files{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.file{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--surface);border:1px solid var(--line)}.file svg{width:13px;height:13px}
  .msg.ai .text{overflow-wrap:anywhere}
  .msg.ai p{margin:0 0 8px}.msg.ai p:last-child,.msg.ai ul:last-child,.msg.ai ol:last-child{margin-bottom:0}
  .msg.ai ul,.msg.ai ol{margin:0 0 8px;padding-left:20px}.msg.ai li{margin:2px 0}
  .msg.ai h4{margin:10px 0 4px;font-size:14px}
  .msg.ai code{font-size:12.5px;padding:1px 5px;border-radius:5px;background:var(--subtle);border:1px solid var(--line)}
  .msg.ai a.doc{display:inline-flex;align-items:center;gap:3px;font-weight:600;text-decoration:none;padding:0 5px 0 3px;border-radius:6px;background:var(--soft)}
  .msg.ai a.doc svg{width:13px;height:13px}.msg.ai a.doc:hover{text-decoration:underline}
  .msg.stopped .text{opacity:.7}
  .muted{color:var(--muted)}

  .steps{display:grid;gap:2px;padding:2px 0 2px 10px;border-left:2px solid var(--line);margin-left:8px}
  .step{display:flex;gap:7px;align-items:flex-start;font-size:12.5px;color:var(--muted);padding:2px 0}
  .step-icon{width:16px;height:18px;display:grid;place-items:center;flex:none}.step-icon svg{width:14px;height:14px}
  .step.failed{color:var(--warn)}.step.stopped{opacity:.6}
  .step a{color:inherit;text-decoration:underline;text-decoration-color:var(--line)}.step a:hover{color:var(--accent)}
  .step-detail{opacity:.8}
  .steps-toggle{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:var(--muted);padding:2px 0}.steps-toggle svg{width:13px;height:13px;transition:transform .2s}.steps-toggle svg.turned{transform:rotate(90deg)}
  .spinner{width:12px;height:12px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) 25%,transparent);border-top-color:var(--accent);display:inline-block;animation:spin .8s linear infinite}

  .card{border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden;transition:border-color .2s,box-shadow .2s}
  .card.pending{border-color:color-mix(in srgb,var(--warn) 55%,var(--line));box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 12%,transparent)}
  .card.declined,.card.undone{opacity:.72}
  .card.failed{border-color:color-mix(in srgb,var(--danger) 40%,var(--line))}
  .card-head{display:flex;gap:10px;align-items:flex-start;padding:10px 12px 8px}
  .card-icon{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;flex:none;background:var(--soft);color:var(--accent)}.card-icon svg{width:16px;height:16px}
  .kind-publish .card-icon,.kind-unpublish .card-icon{background:color-mix(in srgb,var(--ok) 12%,var(--surface));color:var(--ok)}
  .kind-delete .card-icon{background:color-mix(in srgb,var(--danger) 10%,var(--surface));color:var(--danger)}
  .kind-move .card-icon,.kind-media .card-icon{background:color-mix(in srgb,var(--warn) 12%,var(--surface));color:var(--warn)}
  .card-title{display:grid;gap:4px;min-width:0}.card-title strong{font-size:13.5px;line-height:1.35}
  .badge{display:inline-flex;align-items:center;gap:4px;justify-self:start;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--subtle);color:var(--muted)}
  .badge svg{width:12px;height:12px}.badge .spinner{width:10px;height:10px}
  .badge.ok{background:color-mix(in srgb,var(--ok) 12%,transparent);color:var(--ok)}.badge.wait{background:color-mix(in srgb,var(--warn) 14%,transparent);color:var(--warn)}
  .badge.bad{background:color-mix(in srgb,var(--danger) 11%,transparent);color:var(--danger)}.badge.live{color:var(--accent)}
  .changes{display:grid;gap:8px;padding:0 12px 10px}
  .field{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.2px;margin-bottom:3px}
  .lang{font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;background:var(--subtle);border:1px solid var(--line);color:var(--muted);margin-left:2px}
  .value{font-size:13px;padding:7px 10px;border-radius:8px;background:var(--subtle);white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto}
  .value+.value{margin-top:4px}
  .value.removed{background:color-mix(in srgb,var(--danger) 8%,var(--surface));text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--danger) 55%,transparent);color:color-mix(in srgb,var(--ink) 75%,transparent)}
  .value.added{background:color-mix(in srgb,var(--ok) 10%,var(--surface))}
  del{background:color-mix(in srgb,var(--danger) 16%,transparent);text-decoration-color:color-mix(in srgb,var(--danger) 70%,transparent);border-radius:3px}
  ins{background:color-mix(in srgb,var(--ok) 20%,transparent);text-decoration:none;border-radius:3px}
  .notes{list-style:none;margin:0;padding:0 12px 10px;display:grid;gap:4px}
  .notes li{display:flex;gap:6px;font-size:12px;color:var(--muted)}.notes svg{width:14px;height:14px;margin-top:2px}
  .reason{margin:0;padding:0 12px 10px;font-size:12px;color:var(--muted)}.reason.bad{color:var(--danger)}
  .card-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:8px 12px;border-top:1px solid var(--line);background:var(--subtle)}
  .card-actions.subtle{justify-content:flex-start;background:none;padding:6px 8px}
  .note{flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:6px 9px;background:var(--surface);font-size:12.5px}
  .note:focus{outline:0;border-color:var(--accent)}

  .btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;font-weight:600;font-size:12.5px;border:1px solid var(--line);background:var(--surface);transition:background .15s,filter .15s}
  .btn svg{width:15px;height:15px}
  .btn:hover:not(:disabled){background:var(--subtle)}.btn:active:not(:disabled){transform:translateY(1px)}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}.btn.primary:hover:not(:disabled){filter:brightness(.94);background:var(--accent)}
  .btn.quiet{border-color:transparent;background:transparent;color:var(--muted)}.btn.quiet:hover:not(:disabled){color:var(--ink);background:var(--surface)}
  .btn.link{border:0;background:none;color:var(--accent);padding:4px 6px;font-weight:600}.btn.link:hover{background:var(--soft)}

  .notice{display:flex;gap:8px;align-items:center;justify-content:center;font-size:12px;color:var(--muted);text-align:center;padding:2px 10px}.notice svg{width:14px;height:14px}
  .problem{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-radius:10px;font-size:12.5px;background:color-mix(in srgb,var(--danger) 8%,var(--surface));color:var(--danger);border:1px solid color-mix(in srgb,var(--danger) 25%,transparent)}
  .problem span{flex:1}.problem svg{width:16px;height:16px;margin-top:1px}
  .thinking{display:flex;align-items:center;gap:4px;padding:2px 2px 6px;color:var(--muted);font-size:12.5px}
  .thinking span{width:6px;height:6px;border-radius:50%;background:var(--accent);opacity:.35;animation:bounce 1.2s infinite}.thinking span:nth-child(2){animation-delay:.15s}.thinking span:nth-child(3){animation-delay:.3s}
  .thinking em{font-style:normal;margin-left:6px}

  .approve-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid color-mix(in srgb,var(--warn) 30%,var(--line));background:color-mix(in srgb,var(--warn) 8%,var(--surface));font-size:12.5px;font-weight:600;color:var(--warn)}
  .approve-bar span{flex:1}.approve-bar svg{width:16px;height:16px}

  .composer{padding:8px 12px 12px;border-top:1px solid var(--line);display:grid;gap:6px}
  .context{display:inline-flex;align-items:center;gap:5px;justify-self:start;max-width:100%;font-size:11.5px;color:var(--muted);padding:2px 8px 2px 6px;border-radius:999px;background:var(--subtle);border:1px solid var(--line)}
  .context svg{width:13px;height:13px}.context span:not(.lang){white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .attachments{display:flex;gap:6px;flex-wrap:wrap}
  .thumb{position:relative;width:52px;height:52px;border-radius:8px;overflow:hidden;border:1px solid var(--line)}.thumb img{width:100%;height:100%;object-fit:cover}
  .thumb button{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;display:grid;place-items:center}.thumb button svg{width:11px;height:11px}
  .input{border:1px solid var(--line);border-radius:12px;background:var(--surface);transition:border-color .15s,box-shadow .15s}
  .input:focus-within{border-color:color-mix(in srgb,var(--accent) 60%,var(--line));box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent)}
  textarea{display:block;width:100%;border:0;background:none;resize:none;padding:10px 12px 4px;max-height:180px;line-height:1.45;outline:0}
  textarea::placeholder{color:var(--muted)}
  .input .row{display:flex;align-items:center;gap:4px;padding:4px 6px 6px}
  .grow{flex:1}
  .chooser{position:relative}
  .pill{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;font-size:12px;font-weight:600;color:var(--muted);border:1px solid var(--line);background:var(--surface);white-space:nowrap}
  .pill svg{width:13px;height:13px}.pill:hover{color:var(--ink);background:var(--subtle)}
  .pill.mode-auto{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 35%,var(--line));background:var(--soft)}
  .pill.mode-bypass{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 45%,var(--line));background:color-mix(in srgb,var(--warn) 9%,var(--surface))}
  .menu{position:absolute;bottom:calc(100% + 6px);left:0;z-index:5;min-width:250px;padding:5px;border-radius:12px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow);display:grid;gap:2px;animation:rise .18s var(--ease)}
  .menu button{display:flex;gap:9px;align-items:flex-start;text-align:left;padding:7px 9px;border-radius:8px}
  .menu button:hover,.menu button[aria-checked=true]{background:var(--subtle)}
  .menu button>svg{margin-top:2px;width:16px;height:16px;color:var(--muted)}
  .menu .mode-auto>svg{color:var(--accent)}.menu .mode-bypass>svg{color:var(--warn)}
  .menu span{display:grid;flex:1}.menu b{font-size:13px}.menu small{font-size:11.5px;color:var(--muted);line-height:1.35}
  .menu svg.tick{color:var(--accent)}
  .send{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--on-accent);transition:filter .15s,transform .15s}
  .send:hover{filter:brightness(.94)}.send:active{transform:scale(.94)}.send svg{width:17px;height:17px}
  .send.stop{background:var(--ink);color:var(--surface)}
  .quota{margin:0;font-size:11.5px;color:var(--muted);text-align:right}

  .list{padding:8px}
  .chat-row{display:flex;align-items:center;gap:4px;border-radius:10px;padding-right:4px}
  .chat-row:hover,.chat-row.current{background:var(--subtle)}
  .chat-open{flex:1;min-width:0;display:grid;text-align:left;padding:8px 10px}
  .chat-title{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .chat-meta{font-size:11.5px;color:var(--muted)}
  .list-note{font-size:11.5px;color:var(--muted);padding:10px;margin:0}

  .spin{animation:spin 1.6s linear infinite}
  @keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  @keyframes pop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}
  @keyframes bounce{0%,60%,100%{transform:none;opacity:.35}30%{transform:translateY(-3px);opacity:1}}
  @keyframes pulse{50%{opacity:.5}}@keyframes spin{to{transform:rotate(360deg)}}
  @media (max-width:600px){.panel,.panel.docked{right:8px;left:8px;width:auto;bottom:76px;height:calc(100vh - 140px)}.launcher{right:16px}}
  @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;
