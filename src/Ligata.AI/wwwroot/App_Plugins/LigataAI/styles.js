import { css } from '@umbraco-cms/backoffice/external/lit';

export const styles = css`
  :host{display:block;color:var(--uui-color-text,#1b1d26);font-size:14px;
    --line:var(--uui-color-border,#e3e5ec);--muted:var(--uui-color-text-alt,#646979);--surface:var(--uui-color-surface,#fff);--subtle:var(--uui-color-surface-alt,#f5f6f9);
    --accent:var(--uui-color-interactive,#3544b1);--accent-soft:color-mix(in srgb,var(--accent) 9%,transparent);--ok:#1f9d55;--warn:#c98200;--danger:var(--uui-color-danger,#c62f3b);
    --c-instructions:#8b93a7;--c-knowledge:#5b6cff;--c-chat:#2cb67d;--c-answer:#f2a93b;--radius:12px}
  *{box-sizing:border-box}button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}
  svg{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
  h1,h2,h3,h4,p{margin:0}h1{font-size:24px;letter-spacing:-.5px;line-height:1.2}h2{font-size:17px;letter-spacing:-.2px}h3{font-size:14.5px}p{line-height:1.55}
  small,.muted{color:var(--muted)}small{font-size:12px;line-height:1.45}
  :focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 55%,transparent);outline-offset:2px}
  .workspace{max-width:1480px;margin:auto;padding:26px 32px 48px}
  .eyebrow{font-size:10.5px;text-transform:uppercase;letter-spacing:1.3px;font-weight:700;color:var(--muted)}
  .top{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:18px}
  .top .title{display:grid;gap:6px}.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.row.section{display:flex}.grow{flex:1}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--line);border-radius:9px;background:var(--surface);padding:8px 14px;font-weight:600;line-height:1.35;white-space:nowrap;text-decoration:none;transition:background .15s,border-color .15s}
  .btn:hover:not(:disabled){background:var(--subtle)}.btn:active:not(:disabled){transform:translateY(1px)}.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--uui-color-interactive-contrast,#fff)}.btn.primary:hover:not(:disabled){filter:brightness(.94);background:var(--accent)}
  .btn.quiet{border-color:transparent;background:transparent;color:var(--muted);font-weight:500}.btn.quiet:hover:not(:disabled){color:var(--uui-color-text);background:var(--subtle)}.btn.danger{color:var(--danger)}.btn.small{padding:5px 10px;font-size:12.5px;border-radius:7px}
  .icon-btn{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px;border:0;background:transparent;color:var(--muted)}.icon-btn:hover:not(:disabled){background:var(--subtle);color:var(--uui-color-text)}
  .pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;background:var(--subtle);color:var(--muted);white-space:nowrap}
  .pill i{width:7px;height:7px;border-radius:50%;background:currentColor}.pill.ok{background:color-mix(in srgb,var(--ok) 12%,transparent);color:var(--ok)}.pill.warn{background:color-mix(in srgb,var(--warn) 14%,transparent);color:var(--warn)}.pill.bad{background:color-mix(in srgb,var(--danger) 11%,transparent);color:var(--danger)}.pill.info{background:var(--accent-soft);color:var(--accent)}
  .switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-weight:600;user-select:none}
  .switch input{appearance:none;width:40px;height:23px;border-radius:999px;background:color-mix(in srgb,var(--muted) 35%,transparent);position:relative;margin:0;transition:background .2s;flex:none;cursor:pointer}
  .switch input::after{content:'';position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s}
  .switch input:checked{background:var(--ok)}.switch input:checked::after{transform:translateX(17px)}
  .switch.small{font-weight:500}.switch small{display:block;font-weight:400}
  nav.tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin-bottom:22px;overflow-x:auto}
  nav.tabs button{display:inline-flex;align-items:center;gap:8px;border:0;background:transparent;padding:11px 14px;color:var(--muted);font-weight:600;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
  nav.tabs button:hover{color:var(--uui-color-text)}nav.tabs button[aria-current=page]{color:var(--accent);border-bottom-color:var(--accent)}
  nav.tabs .count{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--subtle);color:var(--muted)}
  .notice{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:10px;margin-bottom:16px;border:1px solid var(--line);background:var(--subtle)}
  .notice.success{border-color:color-mix(in srgb,var(--ok) 35%,transparent);background:color-mix(in srgb,var(--ok) 7%,var(--surface))}.notice.error{border-color:color-mix(in srgb,var(--danger) 35%,transparent);background:color-mix(in srgb,var(--danger) 6%,var(--surface))}
  .notice.warning{border-color:color-mix(in srgb,var(--warn) 40%,transparent);background:color-mix(in srgb,var(--warn) 7%,var(--surface))}.notice>div{flex:1}.notice ul{margin:6px 0 0;padding-left:18px}
  .grid{display:grid;gap:18px}.two{grid-template-columns:repeat(2,minmax(0,1fr))}.three{grid-template-columns:repeat(3,minmax(0,1fr))}
  .split{display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:24px;align-items:start}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px}
  .card>header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.card>header p{margin-top:3px}
  .section{display:grid;gap:14px}.section+.section,.card>:not(header):not(.section)+.section{margin-top:22px;padding-top:22px;border-top:1px solid var(--line)}.card>.grid+small{display:block;margin-top:14px}
  .control{display:grid;gap:6px;align-content:start}.control>span{font-weight:600;font-size:13px}.control small{margin-top:-2px}
  .control input[type=text],.control input[type=search],.control input[type=url],.control input[type=email],.control input[type=password],.control input[type=number],.control select,.control textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;background:var(--surface);transition:border-color .15s,box-shadow .15s}
  .control textarea{resize:vertical;line-height:1.5}.control input:focus,.control select:focus,.control textarea:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
  .control.invalid input,.control.invalid textarea,.control.invalid select{border-color:var(--danger)}.control .error{color:var(--danger);font-size:12px}
  .control .count{justify-self:end;font-size:11.5px;color:var(--muted)}
  .range{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}.range input{width:100%;accent-color:var(--accent)}.range output{min-width:74px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
  .segmented{display:inline-flex;justify-self:start;padding:3px;border-radius:10px;background:var(--subtle);border:1px solid var(--line);flex-wrap:wrap}
  .segmented button{border:0;background:transparent;padding:6px 12px;border-radius:7px;font-weight:600;color:var(--muted);font-size:13px}.segmented button[aria-pressed=true]{background:var(--surface);color:var(--uui-color-text);box-shadow:0 1px 3px rgba(0,0,0,.1)}
  .swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px}
  .swatch{border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--surface);text-align:left;display:grid;gap:8px;transition:border-color .15s,box-shadow .15s}
  .swatch[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}.swatch .chips{display:flex;gap:4px}.swatch .chips i{width:18px;height:18px;border-radius:6px;border:1px solid rgba(0,0,0,.08)}.swatch b{font-size:12.5px}
  .colors{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
  .color{display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid var(--line);border-radius:9px}.color input[type=color]{width:32px;height:32px;border:0;padding:0;background:none;border-radius:7px;cursor:pointer}.color span{display:grid;font-size:12.5px;font-weight:600}.color code{font-size:11.5px;color:var(--muted);font-weight:400}
  .icons{display:flex;gap:8px;flex-wrap:wrap}.icons button{width:46px;height:46px;border-radius:12px;border:1px solid var(--line);background:var(--surface);display:grid;place-items:center}.icons button[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);color:var(--accent)}.icons svg{width:22px;height:22px}
  .list-editor{display:grid;gap:8px}.list-editor .item{display:flex;gap:8px}.list-editor input{flex:1}
  .preview{position:sticky;top:12px;display:grid;gap:10px}
  .preview .frame{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--subtle);height:720px;display:grid;place-items:center}
  .preview iframe{width:100%;height:100%;border:0;background:#fff}.preview .frame.mobile iframe{width:390px;height:100%;border-left:1px solid var(--line);border-right:1px solid var(--line)}
  .budget{display:grid;gap:12px}.stack{display:flex;height:14px;border-radius:999px;overflow:hidden;background:var(--subtle)}
  .stack i{display:block;height:100%;transition:width .5s}.stack .instructions{background:var(--c-instructions)}.stack .knowledge{background:var(--c-knowledge)}.stack .chat{background:var(--c-chat)}.stack .answer{background:var(--c-answer)}.stack .over{background:var(--danger)}
  .legend{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px 18px}.legend div{display:flex;gap:8px;align-items:flex-start}.legend i{width:10px;height:10px;border-radius:3px;margin-top:5px;flex:none}.legend b{display:block;font-variant-numeric:tabular-nums}
  .meter{height:8px;border-radius:999px;background:var(--subtle);overflow:hidden}.meter i{display:block;height:100%;background:var(--c-knowledge);border-radius:inherit;transition:width .5s}.meter.over i{background:var(--danger)}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.stat{padding:14px;border-radius:10px;background:var(--subtle)}.stat b{display:block;font-size:22px;letter-spacing:-.4px;font-variant-numeric:tabular-nums}.stat small{display:block}.stat b.bad{color:var(--danger)}
  .checklist{display:grid;gap:10px;margin:0;padding:0;list-style:none}.checklist li{display:flex;gap:10px;align-items:flex-start}.checklist .mark{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--subtle);color:var(--muted)}.checklist .done .mark{background:color-mix(in srgb,var(--ok) 15%,transparent);color:var(--ok)}.checklist .mark svg{width:13px;height:13px;stroke-width:2.4}
  dl.facts{display:grid;grid-template-columns:auto 1fr;gap:8px 18px;margin:0}dl.facts dt{color:var(--muted)}dl.facts dd{margin:0;font-weight:600;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
  .knowledge{display:grid;gap:8px}.k-item{display:grid;grid-template-columns:auto 1fr auto auto;gap:14px;align-items:center;padding:12px 14px;border:1px solid var(--line);border-radius:11px;background:var(--surface);transition:border-color .15s}
  .k-item.off{background:var(--subtle)}.k-item.off .k-title{color:var(--muted)}.k-item:hover{border-color:color-mix(in srgb,var(--accent) 35%,var(--line))}
  .k-kind{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent)}.k-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.k-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:2px}.k-preview{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:640px}
  .k-tokens{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}.k-tokens small{display:block;font-weight:400}
  .k-actions{display:flex;gap:2px;align-items:center}
  .drop{display:grid;place-items:center;gap:8px;padding:26px;border:2px dashed var(--line);border-radius:14px;text-align:center;color:var(--muted);transition:border-color .15s,background .15s}
  .drop.over{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}.drop svg{width:28px;height:28px}
  .empty{display:grid;place-items:center;gap:10px;text-align:center;padding:40px 20px;color:var(--muted)}.empty svg{width:34px;height:34px}
  dialog{border:0;border-radius:16px;padding:0;width:min(760px,calc(100vw - 40px));max-height:calc(100vh - 60px);box-shadow:0 30px 80px rgba(0,0,0,.3);color:inherit;background:var(--surface)}
  dialog::backdrop{background:rgba(15,18,30,.45)}dialog form{display:grid;grid-template-rows:auto 1fr auto;max-height:calc(100vh - 60px)}dialog header{padding:18px 22px;border-bottom:1px solid var(--line)}dialog .body{padding:18px 22px;overflow:auto;display:grid;gap:14px}dialog footer{padding:14px 22px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:10px}
  .pages{display:grid;gap:2px;max-height:52vh;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:6px}.pages label{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:7px;cursor:pointer}.pages label:hover{background:var(--subtle)}.pages small{margin-left:auto}
  .pages label.locked{cursor:default;color:var(--muted)}.icon-btn.active{color:var(--accent);background:var(--accent-soft)}
  details summary{cursor:pointer;font-weight:600;margin-bottom:8px}details pre.code{max-height:320px;margin-bottom:6px}
  .hits{display:grid;gap:8px;margin-top:12px}.hit{padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}.hit p{margin:4px 0 0;font-size:13px;color:var(--muted);white-space:pre-line;max-height:7.5em;overflow:hidden}
  .chart{display:flex;align-items:flex-end;gap:3px;height:140px;padding-top:10px}.chart div{flex:1;min-width:4px;display:flex;flex-direction:column-reverse;gap:1px;height:100%}.chart i{display:block;border-radius:3px 3px 0 0;min-height:0}.chart .answered{background:var(--c-chat)}.chart .failed{background:var(--danger)}.chart .busy{background:var(--c-answer)}
  pre.code.policy{max-height:420px;margin-top:14px;font-size:12px;line-height:1.55}
  pre.code{margin:0;padding:12px 14px;border-radius:10px;background:var(--subtle);border:1px solid var(--line);font-size:12.5px;overflow:auto;white-space:pre-wrap}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .features{display:grid;gap:10px}.feature{display:flex;gap:14px;align-items:center;padding:12px 14px;border:1px solid var(--line);border-radius:12px;transition:border-color .15s,background .15s}
  .feature.on{border-color:color-mix(in srgb,var(--ok) 40%,var(--line));background:color-mix(in srgb,var(--ok) 4%,var(--surface))}.feature small{display:inline-flex;gap:5px;align-items:center;margin-top:4px}.feature small svg{width:14px;height:14px}
  .muted-card{opacity:.82}
  .display-modes{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
  .engines{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.swatch.engine{padding:14px 16px;gap:8px}.swatch.engine small{font-size:12.5px;line-height:1.45}
  .engine-icon{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent)}
  .add-engine>summary{display:inline-flex;align-items:center;gap:8px;color:var(--muted)}.add-engine[open]>summary{margin-bottom:4px}
  .other-engine>summary{font-size:13px;color:var(--muted);margin:0}
  .swatch.display{gap:6px}.swatch.display small{font-size:11.5px;line-height:1.35}
  .mini{display:flex;gap:7px;align-items:flex-end;padding:8px;border-radius:10px;background:var(--subtle);margin-bottom:4px}.mini b{display:block;font-size:10.5px;color:var(--muted);font-weight:600;margin:0 0 2px 2px}
  .mini .face{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;flex:none;font-style:normal;font-size:9px;font-weight:700;background:color-mix(in srgb,var(--accent) 16%,var(--surface));color:var(--accent)}.mini .face svg{width:13px;height:13px}
  .mini-bubble{display:block;font-size:11.5px;padding:5px 8px;border-radius:9px;border-bottom-left-radius:3px;background:var(--surface);border:1px solid var(--line);white-space:nowrap}
  .team-card .big{font-size:26px;font-weight:700;letter-spacing:-.5px;font-variant-numeric:tabular-nums}
  .spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
  @media(max-width:1180px){.split{grid-template-columns:1fr}.preview{position:static}.preview .frame{height:640px}}
  @media(max-width:820px){.two,.three,.engines{grid-template-columns:1fr}.workspace{padding:18px 16px 40px}.k-item{grid-template-columns:auto 1fr;}.k-tokens,.k-actions{grid-column:2}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
`;
