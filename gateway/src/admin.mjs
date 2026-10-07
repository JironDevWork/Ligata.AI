import http from 'node:http';

// Local operator page on the loopback admin port (never routed through the tunnel).
// Writes require a custom header (browsers cannot send it cross-site without a CORS preflight, which
// this server never grants) and an exact loopback Host header (defeats DNS rebinding).
export function createAdmin({ config, keys, scheduler, slots, monitor, llm }) {
  const allowedHosts = new Set([`127.0.0.1:${config.adminPort}`, `localhost:${config.adminPort}`]);
  const status = async () => ({ model: await llm.health(), props: await llm.props().catch(() => null), queue: scheduler.snapshot(), slots: slots.snapshot(), memory: monitor.latest, memoryHistory: monitor.history.slice(-120), keys: keys.list() });
  const json = (response, code, body) => response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body, null, 2));
  const read = request => new Promise((resolve, reject) => { let body = ''; request.on('data', c => { body += c; if (body.length > 10000) request.destroy(); }); request.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } }); });

  return http.createServer(async (request, response) => {
    if (!allowedHosts.has(request.headers.host)) return json(response, 421, { error: 'Use http://127.0.0.1:' + config.adminPort });
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'");
    const url = new URL(request.url, 'http://admin');
    try {
      if (request.method === 'GET' && url.pathname === '/status') return json(response, 200, await status());
      if (request.method === 'GET' && url.pathname === '/') return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(page);
      if (request.method !== 'POST' || request.headers['x-ligata-admin'] !== '1') return json(response, 404, { error: 'Not found' });
      if (url.pathname === '/keys') {
        const body = await read(request);
        const limits = Object.fromEntries(['requestsPerDay', 'maxContextTokens', 'maxQueued'].filter(k => Number.isInteger(body[k]) && body[k] > 0).map(k => [k, body[k]]));
        return json(response, 200, keys.create(body.name, limits));
      }
      const revoke = /^\/keys\/([a-f0-9]{12})\/revoke$/.exec(url.pathname);
      if (revoke) return json(response, 200, keys.revoke(revoke[1]));
      const limits = /^\/keys\/([a-f0-9]{12})\/limits$/.exec(url.pathname);
      if (limits) {
        const body = await read(request);
        return json(response, 200, keys.setLimits(limits[1], Object.fromEntries(['requestsPerDay', 'maxContextTokens', 'maxQueued'].filter(k => Number.isInteger(body[k]) && body[k] > 0).map(k => [k, body[k]]))));
      }
      return json(response, 404, { error: 'Not found' });
    } catch (error) { return json(response, 400, { error: error.message }); }
  });
}

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ligata AI gateway</title>
<style>
:root{--ink:#16181f;--muted:#646979;--line:#e4e6ec;--bg:#f6f7f9;--card:#fff;--accent:#2f5bff;--ok:#1f9d55;--warn:#c98200;--bad:#c62f3b}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
main{max-width:1180px;margin:auto;padding:28px 24px 60px}h1{font-size:24px;margin:0 0 4px;letter-spacing:-.4px}h2{font-size:16px;margin:0 0 12px}.muted{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:20px 0}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.big{font-size:22px;font-weight:650;letter-spacing:-.3px;font-variant-numeric:tabular-nums}.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;background:#eef0f4}
.pill i{width:7px;height:7px;border-radius:50%;background:currentColor}.ok{color:var(--ok);background:#e7f6ee}.warn{color:var(--warn);background:#fbf3e2}.bad{color:var(--bad);background:#fbeaec}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:middle}th{font-size:12px;color:var(--muted);font-weight:600}td.num{font-variant-numeric:tabular-nums}
button,input{font:inherit}button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:7px 12px;cursor:pointer;font-weight:600}button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}button.danger{color:var(--bad)}
input{border:1px solid var(--line);border-radius:8px;padding:8px 10px;width:100%}form{display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:10px;align-items:end}label span{display:block;font-size:12px;font-weight:600;margin-bottom:4px}
.key{margin-top:14px;padding:14px;border-radius:10px;background:#0f1115;color:#e8e9ee;font-family:ui-monospace,monospace;word-break:break-all}.key small{display:block;color:#a3a9b8;font-family:system-ui;margin-top:6px}
.slots{display:flex;gap:10px;flex-wrap:wrap}.slot{flex:1;min-width:180px;padding:10px 12px;border-radius:10px;background:var(--bg)}svg{width:100%;height:80px}
@media(max-width:760px){form{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Ligata AI gateway</h1><div class="muted" id="model">Loading…</div>
<div class="grid">
  <div class="card"><div class="muted">Queue</div><div class="big" id="queue">–</div><div class="muted" id="queue2"></div></div>
  <div class="card"><div class="muted">RAM (llama-server)</div><div class="big" id="ram">–</div><div class="muted" id="ram2"></div></div>
  <div class="card"><div class="muted">VRAM</div><div class="big" id="vram">–</div><div class="muted" id="vram2"></div></div>
  <div class="card"><div class="muted">GPU-shared RAM</div><div class="big" id="shared">–</div><div id="spill"></div></div>
</div>
<div class="card"><h2>RAM over time</h2><svg id="chart" viewBox="0 0 600 80" preserveAspectRatio="none"></svg><div class="muted" id="chart2"></div></div>
<div class="card" style="margin-top:14px"><h2>Prompt caches (one slot per recently active website)</h2><div class="slots" id="slots"></div></div>
<div class="card" style="margin-top:14px"><h2>Website keys</h2>
<form id="create"><label><span>Website / client</span><input name="name" required maxlength="100" placeholder="Muster AG – www.muster.ch"></label><label><span>Questions per day</span><input name="requestsPerDay" type="number" min="1" value="2000"></label><label><span>Max context (tokens)</span><input name="maxContextTokens" type="number" min="4096" value="262144"></label><label><span>Max waiting</span><input name="maxQueued" type="number" min="1" value="10"></label><button class="primary">Create key</button></form>
<div id="created"></div>
<table style="margin-top:16px"><thead><tr><th>Website</th><th>Status</th><th>Today</th><th>Total</th><th>Limits</th><th>Last used</th><th></th></tr></thead><tbody id="keys"></tbody></table></div>
<p class="muted">Keys are stored only as hashes; a new key is shown once. Revoking applies immediately. Command line: <code>node cli.mjs keys …</code></p>
</main><script>
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => new Intl.NumberFormat().format(n || 0);
async function post(path, body) { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ligata-Admin': '1' }, body: JSON.stringify(body || {}) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; }
async function load() {
  const s = await (await fetch('/status', { cache: 'no-store' })).json();
  $('model').innerHTML = (s.model === 'ready' ? '<span class="pill ok"><i></i>Model ready</span> ' : '<span class="pill bad"><i></i>Model ' + esc(s.model) + '</span> ') + (s.props ? esc(s.props.model) + ' · ' + fmt(s.props.contextTokens) + ' tokens · ' + s.props.slots + ' slots · vision ' + (s.props.vision ? 'on' : 'off') : '');
  $('queue').textContent = (s.queue.running ? 'answering' : 'idle') + (s.queue.waiting ? ' · ' + s.queue.waiting + ' waiting' : '');
  $('queue2').textContent = fmt(s.queue.completed) + ' answered since start · ~' + s.queue.averageSeconds + ' s each';
  const m = s.memory || {};
  $('ram').textContent = m.running ? fmt(m.workingSetMB) + ' MB' : '–'; $('ram2').textContent = 'working set';
  $('vram').textContent = m.running ? fmt(m.processVramMB) + ' MB' : '–'; $('vram2').textContent = m.running ? 'GPU ' + fmt(m.gpuUsedMB) + ' / ' + fmt(m.gpuTotalMB) + ' MB' : '';
  $('shared').textContent = m.running ? fmt(m.sharedRamMB) + ' MB' : '–';
  $('spill').innerHTML = m.running ? (m.spilling ? '<span class="pill bad"><i></i>Spilling into RAM</span>' : '<span class="pill ok"><i></i>Everything in VRAM</span>') : '';
  const h = s.memoryHistory || [];
  if (h.length > 1) { const max = Math.max(...h.map(x => x.ws)) * 1.1, min = Math.min(...h.map(x => x.ws)) * .9; $('chart').innerHTML = '<polyline fill="none" stroke="#2f5bff" stroke-width="2" points="' + h.map((x, i) => (i / (h.length - 1) * 600).toFixed(1) + ',' + (80 - (x.ws - min) / (max - min || 1) * 76 - 2).toFixed(1)).join(' ') + '"/>'; $('chart2').textContent = 'Last ' + h.length + ' samples: ' + fmt(Math.min(...h.map(x => x.ws))) + '–' + fmt(Math.max(...h.map(x => x.ws))) + ' MB'; }
  const names = Object.fromEntries(s.keys.map(k => [k.id, k.name]));
  $('slots').innerHTML = s.slots.map(x => '<div class="slot"><b>Slot ' + x.id + '</b><div class="muted">' + (x.site ? esc(names[x.site] || x.site) + '<br>' + fmt(x.tokens) + ' tokens cached · idle ' + x.idleSeconds + ' s' : 'empty') + '</div></div>').join('');
  $('keys').innerHTML = s.keys.map(k => '<tr><td><b>' + esc(k.name) + '</b><div class="muted">' + k.id + '</div></td><td>' + (k.revokedAt ? '<span class="pill bad"><i></i>revoked</span>' : '<span class="pill ok"><i></i>active</span>') + '</td><td class="num">' + fmt(k.usage?.requests) + ' / ' + fmt(k.limits.requestsPerDay) + '</td><td class="num">' + fmt(k.usage?.totalRequests) + ' questions<br><span class="muted">' + fmt((k.usage?.totalPromptTokens || 0) + (k.usage?.totalCompletionTokens || 0)) + ' tokens</span></td><td class="num">' + fmt(k.limits.maxContextTokens) + ' ctx<br><span class="muted">' + k.limits.maxQueued + ' waiting</span></td><td class="muted">' + (k.usage?.lastUsedAt ? new Date(k.usage.lastUsedAt).toLocaleString() : 'never') + '</td><td>' + (k.revokedAt ? '' : '<button class="danger" data-revoke="' + k.id + '">Revoke</button>') + '</td></tr>').join('') || '<tr><td colspan="7" class="muted">No keys yet.</td></tr>';
}
$('create').addEventListener('submit', async e => {
  e.preventDefault(); const f = new FormData(e.target);
  try { const r = await post('/keys', { name: f.get('name'), requestsPerDay: +f.get('requestsPerDay'), maxContextTokens: +f.get('maxContextTokens'), maxQueued: +f.get('maxQueued') }); $('created').innerHTML = '<div class="key">' + esc(r.key) + '<small>Copy this key now and paste it into the website\\'s AI Assistant → Connection. It is not shown again.</small></div>'; e.target.reset(); load(); }
  catch (error) { alert(error.message); }
});
document.addEventListener('click', async e => { const id = e.target.dataset.revoke; if (id && confirm('Revoke this key? The website stops getting answers immediately.')) { await post('/keys/' + id + '/revoke'); load(); } });
load(); setInterval(load, 5000);
</script></body></html>`;
