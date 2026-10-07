// A stand-in for the Anthropic Messages API (API mode), strict where the real API is strict, so
// request shape problems show up in tests without a real key or any cost.
//   node mock-anthropic.mjs [port]        → http://127.0.0.1:1230
//   POST /__mode {"mode":"ok|overloaded|ratelimit|unauthorized|slow"}   GET /__state
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const MOCK_KEY = 'sk-ant-mock-0000000000000000';
export const MOCK_MODEL = 'claude-haiku-5-5';

export function startMockAnthropic(port = 1230) {
  const state = { mode: 'ok', requests: 0, counts: 0, models: 0, last: null, keys: new Set(), cachedPrefix: null, errors: [] };
  const tokens = value => Math.ceil(JSON.stringify(value ?? '').length / 4);
  const fail = (response, status, type, message) => {
    state.errors.push(`${status} ${type}: ${message}`);
    response.writeHead(status, { 'Content-Type': 'application/json', ...(status === 429 ? { 'retry-after': '5' } : {}) });
    response.end(JSON.stringify({ type: 'error', error: { type, message } }));
  };

  /** The checks the real API applies to a Claude Haiku 5.5 request (a subset: what this package could get wrong). */
  function invalid(body) {
    if (body.model !== MOCK_MODEL) return `unknown model ${body.model}`;
    if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) return 'max_tokens: required';
    for (const field of ['temperature', 'top_p', 'top_k']) if (field in body) return `${field}: not supported with this model`;
    if (body.thinking && body.thinking.type !== 'adaptive') return 'thinking.type: budget_tokens is not supported';
    if (body.output_config?.effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(body.output_config.effort)) return 'output_config.effort: invalid';
    if (!Array.isArray(body.messages) || !body.messages.length) return 'messages: at least one message is required';
    if (body.messages.at(-1).role !== 'user') return 'This model does not support assistant message prefill. The conversation must end with a user message.';
    for (const message of body.messages) {
      if (!['user', 'assistant'].includes(message.role)) return `messages: invalid role ${message.role}`;
      const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
      if (!Array.isArray(blocks) || !blocks.length) return 'messages: content must be non-empty';
      for (const block of blocks) {
        if (block.type === 'text' && !String(block.text || '').trim()) return 'messages: text content blocks must be non-empty';
        if (block.type === 'image' && (block.source?.type !== 'base64' || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(block.source?.media_type) || !block.source?.data)) return 'messages: invalid image source';
        if (block.type === 'document' && (block.source?.type !== 'text' || block.source?.media_type !== 'text/plain' || !block.source?.data)) return 'messages: invalid document source';
      }
    }
    if (body.system && !Array.isArray(body.system) && typeof body.system !== 'string') return 'system: invalid';
    return null;
  }

  function answerFor(body) {
    const last = body.messages.at(-1);
    const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
    const asked = blocks.filter(b => b.type === 'text').map(b => b.text).join(' ');
    if (/refuse-me/i.test(asked)) return { refusal: true, parts: [] };
    if (/person|human|unknown|mensch|weiss nicht/i.test(asked)) return { parts: ['Sorry, ', 'I could not find ', 'that in my information. ', 'Our team can help.', '\n[[', 'te', 'am]]'] };
    const extras = [];
    const images = blocks.filter(b => b.type === 'image').length, documents = blocks.filter(b => b.type === 'document');
    if (images) extras.push(` I can see ${images} image${images > 1 ? 's' : ''}.`);
    if (documents.length) extras.push(` I read “${documents[0].title}” (${documents[0].source.data.length} characters).`);
    return { parts: ['Claude ', 'mock ', 'answer', ' about ', `“${asked.slice(0, 40)}”.`, ...extras] };
  }

  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.url === '/__state') return json(200, { ...state, keys: [...state.keys] });
    if (request.url === '/__mode') { Object.assign(state, JSON.parse(raw || '{}')); return json(200, { mode: state.mode }); }
    const key = request.headers['x-api-key'];
    state.keys.add(key ? key.slice(0, 7) + '…' : '(none)');
    if (!request.headers['anthropic-version']) return fail(response, 400, 'invalid_request_error', 'anthropic-version header is required');
    if (key !== MOCK_KEY || state.mode === 'unauthorized') return fail(response, 401, 'authentication_error', 'invalid x-api-key');
    const model = /^\/v1\/models\/([^/?]+)/.exec(request.url);
    if (model && request.method === 'GET') {
      state.models++;
      return decodeURIComponent(model[1]) === MOCK_MODEL ? json(200, { type: 'model', id: MOCK_MODEL, display_name: 'Claude Haiku 5.5', created_at: '2026-09-01T00:00:00Z' }) : fail(response, 404, 'not_found_error', `model: ${model[1]}`);
    }
    let body;
    try { body = JSON.parse(raw); } catch { return fail(response, 400, 'invalid_request_error', 'invalid JSON'); }
    if (request.url.startsWith('/v1/messages/count_tokens')) {
      state.counts++;
      return json(200, { input_tokens: tokens(body.system) + tokens(body.messages) });
    }
    if (!request.url.startsWith('/v1/messages')) return fail(response, 404, 'not_found_error', request.url);
    state.requests++; state.last = body;
    if (state.mode === 'overloaded') return fail(response, 529, 'overloaded_error', 'Overloaded');
    if (state.mode === 'ratelimit') return fail(response, 429, 'rate_limit_error', 'Number of request tokens has exceeded your rate limit');
    const problem = invalid(body);
    if (problem) return fail(response, 400, 'invalid_request_error', problem);
    if (!body.stream) return fail(response, 400, 'invalid_request_error', 'this mock only streams');

    // Prompt caching: everything up to the first cache_control breakpoint is "cached" from the second request on.
    const system = Array.isArray(body.system) ? body.system : [{ type: 'text', text: body.system || '' }];
    const breakpoint = system.findIndex(b => b.cache_control?.type === 'ephemeral');
    const prefix = breakpoint >= 0 ? JSON.stringify(system.slice(0, breakpoint + 1)) : null;
    const prefixTokens = prefix ? tokens(prefix) : 0;
    const read = prefix && state.cachedPrefix === prefix ? prefixTokens : 0, created = prefix && !read ? prefixTokens : 0;
    if (prefix) state.cachedPrefix = prefix;
    const input = Math.max(1, tokens(body.system) + tokens(body.messages) - read - created);

    const { parts, refusal } = answerFor(body);
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const send = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let closed = false;
    response.on('close', () => { closed = true; });
    send('message_start', { message: { id: 'msg_mock_' + state.requests, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: input, output_tokens: 1, cache_creation_input_tokens: created, cache_read_input_tokens: read } } });
    send('ping', {});
    let index = 0;
    // Higher effort thinks first (the thinking text is omitted by default, only a signature arrives).
    if (body.output_config?.effort && body.output_config.effort !== 'low') {
      send('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      await wait(state.mode === 'slow' ? 1500 : 150);
      send('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'mock-signature' } });
      send('content_block_stop', { index }); index++;
    }
    if (parts.length) {
      send('content_block_start', { index, content_block: { type: 'text', text: '' } });
      for (const part of parts) {
        await wait(state.mode === 'slow' ? 400 : 25);
        if (closed) return;
        send('content_block_delta', { index, delta: { type: 'text_delta', text: part } });
      }
      send('content_block_stop', { index });
    }
    send('message_delta', { delta: { stop_reason: refusal ? 'refusal' : 'end_turn', stop_sequence: null }, usage: { output_tokens: parts.length * 3 } });
    send('message_stop', {});
    response.end();
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${port}` })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startMockAnthropic(Number(process.argv[2]) || 1230);
  console.log(`Mock Anthropic API on ${url}`);
}
