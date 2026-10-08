import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { QueueError } from './queue.mjs';
import { LlmError } from './llm.mjs';
import { DocumentError, pdfToText } from './pdf.mjs';

// Public, server-to-server API used by the Umbraco package. Browsers never call it directly
// (no CORS headers), and every route except /v1/health and /robots.txt requires an API key.

class HttpError extends Error {
  constructor(status, code, message, extra = {}) { super(message); Object.assign(this, { status, code, extra }); }
}

const JPEG = [0xff, 0xd8, 0xff], PNG = [0x89, 0x50, 0x4e, 0x47];
const starts = (bytes, signature) => signature.every((b, i) => bytes[i] === b);

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length'] || 0);
    if (declared > limit) return reject(new HttpError(413, 'too_large', 'The request is too large.'));
    const chunks = []; let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new HttpError(413, 'too_large', 'The request is too large.')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new HttpError(400, 'invalid_json', 'The request body must be JSON.')); }
    });
    request.on('error', reject);
  });
}

function send(response, status, body, headers = {}) {
  if (response.headersSent) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  response.end(JSON.stringify(body));
}

function fail(response, error) {
  const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
  const code = error.code || 'internal_error';
  const retryAfter = error.retryAfter ?? (status === 503 ? 30 : undefined);
  const message = status === 500 ? 'The gateway failed to process the request.' : error.message;
  send(response, status, { error: { code, message, ...(error.extra || {}), ...(error.details && code === 'context_full' ? error.details : {}) } }, retryAfter ? { 'Retry-After': String(retryAfter) } : {});
}

const NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The website's tools in llama-server's (OpenAI) format: [{ name, description, parameters }] with a JSON-schema object each.
 * The website runs them; the gateway only passes the calls on (see chat).
 */
export function normalizeTools(input) {
  if (input == null) return undefined;
  if (!Array.isArray(input) || !input.length || input.length > 8) throw new HttpError(400, 'invalid_tools', 'Provide between 1 and 8 tools.');
  if (JSON.stringify(input).length > 16000) throw new HttpError(413, 'invalid_tools', 'The tool definitions are too large.');
  return input.map(tool => {
    if (!NAME.test(tool?.name || '') || typeof tool.description !== 'string' || tool.parameters?.type !== 'object') throw new HttpError(400, 'invalid_tools', 'Each tool needs a name, a description and object parameters.');
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
  });
}

/** One earlier lookup in llama-server's format: the arguments as JSON text (the chat template renders them in the model's own syntax). */
function toolCall(call, index) {
  if (!NAME.test(call?.id || '') || !NAME.test(call?.name || '') || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) throw new HttpError(400, 'invalid_messages', `Message ${index + 1} has an invalid tool call.`);
  const json = JSON.stringify(call.arguments);
  if (json.length > 4000) throw new HttpError(413, 'invalid_messages', `Message ${index + 1} has a tool call that is too large.`);
  return { id: call.id, type: 'function', function: { name: call.name, arguments: json } };
}

/**
 * Converts the package's message format into llama-server's OpenAI format, validating every part. Earlier lookups arrive as
 * an assistant message with toolCalls [{ id, name, arguments }] followed by one { role: 'tool', toolCallId, content } per call.
 */
export function normalizeMessages(input, limits) {
  if (!Array.isArray(input) || !input.length || input.length > limits.maxMessages) throw new HttpError(400, 'invalid_messages', 'Provide between 1 and ' + limits.maxMessages + ' messages.');
  let images = 0, open = null;
  const messages = input.map((message, index) => {
    if (!['system', 'user', 'assistant', 'tool'].includes(message?.role)) throw new HttpError(400, 'invalid_messages', `Message ${index + 1} has an invalid role.`);
    if (message.role === 'system' && index !== 0) throw new HttpError(400, 'invalid_messages', 'Only the first message may be a system message.');
    if (message.role === 'tool') {
      if (!open?.has(message.toolCallId) || typeof message.content !== 'string' || message.content.length > (limits.maxToolResultChars ?? 120000)) throw new HttpError(400, 'invalid_messages', `Message ${index + 1} is not the result of an earlier tool call.`);
      open.delete(message.toolCallId);
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (open?.size) throw new HttpError(400, 'invalid_messages', `Message ${index + 1} follows tool calls without their results.`);
    open = null;
    if (message.role === 'assistant' && message.toolCalls != null) {
      if (!Array.isArray(message.toolCalls) || !message.toolCalls.length || message.toolCalls.length > 8 || (message.content != null && typeof message.content !== 'string')) throw new HttpError(400, 'invalid_messages', `Message ${index + 1} has invalid tool calls.`);
      const calls = message.toolCalls.map(call => toolCall(call, index));
      open = new Set(calls.map(call => call.id));
      return { role: 'assistant', content: message.content || '', tool_calls: calls };
    }
    if (typeof message.content === 'string') return { role: message.role, content: message.content };
    if (!Array.isArray(message.content) || message.content.length > 20) throw new HttpError(400, 'invalid_messages', `Message ${index + 1} has invalid content.`);
    const parts = message.content.map(part => {
      if (part?.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text };
      if (part?.type === 'document' && typeof part.text === 'string') {
        const name = String(part.name || 'document').replace(/[\r\n"]/g, ' ').slice(0, 120);
        return { type: 'text', text: `<attached_document name="${name}">\n${part.text}\n</attached_document>` };
      }
      if (part?.type === 'image' && typeof part.data === 'string') {
        if (message.role !== 'user') throw new HttpError(400, 'invalid_messages', 'Only visitor messages can contain images.');
        if (++images > limits.maxImages) throw new HttpError(413, 'too_many_images', `A conversation can contain at most ${limits.maxImages} images. Start a new chat to send more.`);
        const bytes = Buffer.from(part.data, 'base64');
        if (bytes.length > limits.maxImageBytes) throw new HttpError(413, 'image_too_large', `Images can be at most ${Math.round(limits.maxImageBytes / 1048576)} MB.`);
        const mime = starts(bytes, JPEG) ? 'image/jpeg' : starts(bytes, PNG) ? 'image/png' : null;
        if (!mime) throw new HttpError(415, 'unsupported_image', 'Only PNG and JPEG screenshots are supported.');
        return { type: 'image_url', image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` } };
      }
      throw new HttpError(400, 'invalid_messages', `Message ${index + 1} contains an unsupported part.`);
    });
    return { role: message.role, content: parts };
  });
  if (open?.size) throw new HttpError(400, 'invalid_messages', 'Tool calls are missing their results.');
  if (messages.at(-1).role !== 'user') throw new HttpError(400, 'invalid_messages', 'The last message must be from the visitor.');
  return { messages, images };
}

export function createServer({ config, keys, scheduler, llm, monitor, slots, log = () => {} }) {
  // How many answers run at once and how much of the KV pool one conversation may use.
  const parallel = props => Math.max(1, Math.min(config.parallel?.conversations || 1, props.slots || 1));
  // Shared pool: one conversation may use conversationTokens of it. Split slots: each slot's own part is the limit.
  const shared = () => config.parallel?.sharedPool !== false;
  const conversationTokens = props => Math.min(props.contextTokens, shared() && parallel(props) > 1 ? config.parallel?.conversationTokens || props.contextTokens : props.contextTokens);
  const configure = props => {
    if (slots.epoch !== llm.epoch) { slots.reset(); slots.epoch = llm.epoch; }
    slots.resize(props.slots); slots.contextTokens = props.contextTokens; slots.shared = shared();
    scheduler.configure({ parallel: parallel(props), capacity: shared() ? props.contextTokens - slots.reserve : Infinity });
  };

  // Lookups waiting for the website's results, by round id. The answer keeps its place and slot meanwhile.
  const rounds = new Map();
  const waitForResults = (id, keyId, signal) => new Promise((resolve, reject) => {
    const finish = (settle, value) => { clearTimeout(timer); signal.removeEventListener('abort', aborted); rounds.delete(id); settle(value); };
    const aborted = () => finish(reject, signal.reason ?? new QueueError('cancelled', 'The visitor left.', 499, 0));
    const timer = setTimeout(() => finish(reject, new LlmError('tool_timeout', 'The website did not answer the assistant\'s lookup in time.', 504)), config.tools.waitSeconds * 1000);
    rounds.set(id, { keyId, resolve: results => finish(resolve, results) });
    if (signal.aborted) aborted(); else signal.addEventListener('abort', aborted, { once: true });
  });

  const routes = {
    'GET /v1/health': async () => ({ status: 200, body: { ok: true, model: await llm.health() } }),

    'GET /v1/status': async ({ key }) => {
      const model = await llm.health();
      const props = model === 'ready' ? await llm.props().catch(() => null) : null;
      if (props) configure(props);
      return { status: 200, body: {
        model: { state: model, name: props?.model ?? null, contextTokens: props ? Math.min(conversationTokens(props), key.limits.maxContextTokens) : 0, vision: props?.vision ?? false },
        queue: scheduler.snapshot(),
        gpu: { healthy: !monitor.latest?.spilling },
        limits: { ...key.limits, maxImages: config.limits.maxImages, maxImageBytes: config.limits.maxImageBytes, maxPdfBytes: config.limits.maxPdfBytes, maxPdfPages: config.limits.maxPdfPages, maxTokensCap: config.generation.maxTokensCap },
        usage: keys.usageOf(key),
        // tools: the model may look things up while answering (POST /v1/chat with tools, then /v1/chat/tool-results).
        features: ['tools'],
      } };
    },

    /** The website's results for one round of lookups: { round, results: [{ id, content }] }. */
    'POST /v1/chat/tool-results': async ({ key, body }) => {
      const waiting = typeof body.round === 'string' ? rounds.get(body.round) : null;
      if (!waiting || waiting.keyId !== key.id) throw new HttpError(404, 'unknown_round', 'No answer is waiting for these results.');
      const results = Array.isArray(body.results) ? body.results : null;
      if (!results || results.length > 8 || results.some(r => !NAME.test(r?.id || '') || typeof r.content !== 'string')) throw new HttpError(400, 'invalid_results', 'Provide up to 8 results as { id, content }.');
      if (results.reduce((n, r) => n + r.content.length, 0) > config.tools.maxResultChars) throw new HttpError(413, 'too_large', 'The results are too large.');
      waiting.resolve(new Map(results.map(r => [r.id, r.content])));
      return { status: 200, body: { ok: true } };
    },

    'POST /v1/tokenize': async ({ body }) => {
      const texts = Array.isArray(body.texts) ? body.texts : null;
      if (!texts || texts.length > 200 || texts.some(t => typeof t !== 'string')) throw new HttpError(400, 'invalid_texts', 'Provide up to 200 strings in "texts".');
      if (texts.reduce((n, t) => n + t.length, 0) > config.limits.maxTokenizeChars) throw new HttpError(413, 'too_large', 'Too much text to count at once.');
      if (await llm.health() !== 'ready') throw new LlmError('model_unavailable', 'The assistant model is offline right now.', 503);
      const counts = [];
      for (const text of texts) counts.push(await llm.countText(text));
      return { status: 200, body: { counts } };
    },

    'POST /v1/extract': async ({ body }) => {
      if (typeof body.data !== 'string') throw new HttpError(400, 'invalid_document', 'Provide the PDF as base64 in "data".');
      const bytes = Buffer.from(body.data, 'base64');
      if (bytes.length > config.limits.maxPdfBytes) throw new HttpError(413, 'pdf_too_large', `PDFs can be at most ${Math.round(config.limits.maxPdfBytes / 1048576)} MB.`);
      const result = await pdfToText(bytes, { maxPages: Math.min(Number(body.maxPages) || config.limits.maxPdfPages, config.limits.maxPdfPages) });
      const tokens = (await llm.health()) === 'ready' ? await llm.countText(result.text) : null;
      return { status: 200, body: { ...result, tokens } };
    },
  };

  async function chat(request, response, key, body, abort) {
    const { messages, images } = normalizeMessages(body.messages, { ...config.limits, maxToolResultChars: config.tools.maxResultChars });
    const tools = normalizeTools(body.tools);
    // none: the tools stay declared (same prompt, same cache) but may not be called, e.g. while a conversation is summarized.
    // required: the first round must look something up (the website knows the question touches its content); later rounds may answer.
    const toolChoice = tools && ['none', 'required'].includes(body.toolChoice) ? body.toolChoice : undefined;
    // After this many rounds of lookups the model must answer with what it found (one more round without lookups).
    const lookupRounds = Math.min(Math.max(Math.floor(Number(body.lookupRounds)) || config.tools.maxRounds, 1), config.tools.maxRounds);
    if (images && !(await llm.props().catch(() => ({ vision: false }))).vision) throw new HttpError(422, 'vision_unavailable', 'Image understanding is not available right now.');
    const props = await llm.props();
    configure(props);
    const contextLimit = Math.min(conversationTokens(props), key.limits.maxContextTokens, Number(body.contextLimit) || Infinity);
    const maxTokens = Math.min(Math.max(Number(body.maxTokens) || config.generation.defaultMaxTokens, 16), config.generation.maxTokensCap);
    const promptTokens = await llm.countPrompt(messages, config.imageTokens, tools, abort.signal);
    if (promptTokens + Math.min(maxTokens, 256) > contextLimit) throw new HttpError(413, 'context_full', 'This conversation no longer fits into the assistant\'s memory. Start a new chat.', { promptTokens, contextTokens: contextLimit });
    if (!keys.hasQuota(key)) throw new HttpError(429, 'daily_quota', 'This website has reached its daily question limit. Please try again tomorrow.', {}, );

    if (abort.signal.aborted) { log('cancelled', { key: key.id }); return; }
    let open = false;
    const event = (name, data) => {
      if (!open) {
        open = true;
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
      }
      response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => open && response.write(': ping\n\n'), 15000);
    const started = Date.now();
    const visitor = typeof body.visitor === 'string' ? body.visitor.slice(0, 128) : '';
    try {
      await scheduler.enqueue({
        keyId: key.id, visitor, maxQueued: key.limits.maxQueued, signal: abort.signal, tokens: promptTokens + maxTokens + (tools && toolChoice !== 'none' ? config.tools.reserveTokens : 0),
        onUpdate: ({ position, estimate }) => position > 0 && event('queued', { position, estimatedWaitSeconds: estimate }),
        run: async signal => {
          keys.take(key);
          // A slot for this answer: the conversation's own, else one warm with the site's knowledge. Frees room in the pool if needed.
          const fresh = await llm.props();
          configure(fresh);
          const slot = await slots.assign(key.id, promptTokens + maxTokens + (tools && toolChoice !== 'none' ? config.tools.reserveTokens : 0), id => llm.eraseSlot(id), visitor || null);
          // maxSeconds counts from the moment llama-server works on this answer. Running next to others, it can first
          // wait for another conversation's long prompt to be read (llama-server reads prompts one after the other).
          const timeout = new AbortController();
          const expire = () => timeout.abort(new DOMException('The answer took too long.', 'TimeoutError'));
          let timer = setTimeout(expire, config.generation.maxSeconds * 2000), working = false;
          const limit = AbortSignal.any([signal, timeout.signal]);
          try {
            slots.record(slot, promptTokens);
            event('started', { promptTokens, contextTokens: contextLimit, waitedMs: Date.now() - started });
            let completion = 0, firstToken = 0, wrote = false, cachedTokens = 0, lookups = 0;
            const options = { ...config.generation, maxTokens, temperature: body.temperature ?? config.generation.temperature, thinking: !!body.thinking, tools, toolChoice, slot: slots.slots.length > 1 ? slot : undefined };
            // One round per lookup: the model calls tools, the website answers, the model continues where it stopped.
            for (let round = 0; ; round++) {
              let text = '', result = null;
              const choice = tools && round >= lookupRounds ? 'none' : round > 0 && toolChoice === 'required' ? 'auto' : toolChoice;
              for await (const part of llm.chat(messages, { ...options, toolChoice: choice }, limit)) {
                if (!working) { working = true; clearTimeout(timer); timer = setTimeout(expire, config.generation.maxSeconds * 1000); }
                if (part.type === 'progress') { if (part.total > 2048) event('progress', { processed: Math.max(part.processed || 0, part.cache || 0), total: part.total }); }
                else if (part.type === 'reasoning') event('thinking', {});
                else if (part.type === 'delta') { firstToken ||= Date.now(); wrote = true; text += part.text; event('delta', { text: part.text }); }
                else result = part;
              }
              const prompt = result.usage?.prompt_tokens ?? promptTokens;
              const written = result.usage?.completion_tokens ?? result.timings?.predicted_n ?? 0;
              completion += written;
              if (round === 0) cachedTokens = result.timings?.cache_n ?? 0;
              keys.record(key, result.timings?.prompt_n ?? prompt, written);
              slots.record(slot, prompt + written);
              if (result.finishReason === 'tool_calls' && result.toolCalls?.length && tools) {
                if (round >= lookupRounds) throw new LlmError('model_failed', 'The assistant kept looking things up without answering.', 502);
                const id = randomBytes(12).toString('base64url');
                lookups += result.toolCalls.length;
                event('tool_calls', { round: id, calls: result.toolCalls });
                const results = await waitForResults(id, key.id, limit);
                // The call as the model wrote it (with its thinking, so the cached tokens match) and one result per call.
                messages.push({ role: 'assistant', content: text, tool_calls: result.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })), ...(result.reasoning ? { reasoning_content: result.reasoning } : {}) });
                for (const call of result.toolCalls) messages.push({ role: 'tool', tool_call_id: call.id, content: results.get(call.id) ?? 'No result.' });
                const next = await llm.countPrompt(messages, config.imageTokens, tools);
                if (next + Math.min(maxTokens, 256) > contextLimit) throw new LlmError('context_full', 'This conversation no longer fits into the assistant\'s memory. Start a new chat.', 413, { promptTokens: next, contextTokens: contextLimit });
                continue;
              }
              // The token limit ran out while the model was still thinking: no answer text at all.
              if (!wrote && result.finishReason === 'length') { event('error', { code: 'thinking_limit', message: 'The assistant thought for too long and could not finish its answer. Please try again or ask more specifically.' }); break; }
              event('done', {
                finishReason: result.finishReason,
                usage: { promptTokens: prompt, completionTokens: completion, cachedTokens },
                context: { used: prompt + written, limit: contextLimit },
                timings: { promptPerSecond: Math.round(result.timings?.prompt_per_second || 0), tokensPerSecond: Math.round((result.timings?.predicted_per_second || 0) * 10) / 10, firstTokenMs: firstToken ? firstToken - started : null, totalMs: Date.now() - started },
              });
              break;
            }
            log('chat', { key: key.id, promptTokens, completion, lookups, ms: Date.now() - started });
          } finally { clearTimeout(timer); slots.release(slot); }
        },
      });
    } catch (error) {
      if (error.code === 'cancelled' || abort.signal.aborted) { log('cancelled', { key: key.id }); return; }
      if (error.name === 'TimeoutError') error = new LlmError('answer_timeout', 'The answer took too long and was stopped.', 504);
      if (!open) throw error;
      event('error', { code: error.code || 'internal_error', message: error.status ? error.message : 'The answer failed.', ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
        ...(error.code === 'context_full' && error.details ? { promptTokens: error.details.promptTokens, contextTokens: error.details.contextTokens } : {}) });
      log('chat_error', { key: key.id, code: error.code });
    } finally {
      clearInterval(heartbeat);
      if (open) response.end();
    }
  }

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://gateway');
    const route = `${request.method} ${url.pathname}`;
    // An API on a public hostname, not a website: search engines and AI crawlers stay out.
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      if (route === 'GET /robots.txt') {
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        return response.end('User-agent: *\nDisallow: /\n');
      }
      if (route === 'GET /v1/health') return send(response, 200, (await routes[route]()).body);
      const known = route === 'POST /v1/chat' || routes[route];
      if (!known) throw new HttpError(404, 'not_found', 'Unknown endpoint.');
      const key = keys.verify(request.headers.authorization);
      if (!key) { await new Promise(r => setTimeout(r, 250)); throw new HttpError(401, 'invalid_key', 'A valid API key is required.'); }
      const body = request.method === 'POST' ? await readBody(request, config.limits.maxBodyBytes) : {};
      if (route === 'POST /v1/chat') {
        // Listen for the visitor leaving from the start: a request that closes while its prompt is counted must not be queued.
        const abort = new AbortController();
        response.on('close', () => { if (!response.writableFinished) abort.abort(new QueueError('cancelled', 'The visitor left.', 499, 0)); });
        if (response.destroyed) abort.abort(new QueueError('cancelled', 'The visitor left.', 499, 0));
        const state = await llm.health(0);
        if (state !== 'ready') throw new LlmError(state === 'loading' ? 'model_loading' : 'model_unavailable', state === 'loading' ? 'The assistant model is starting. Please try again in a minute.' : 'The assistant model is offline right now. Please try again in a few minutes.', 503);
        return await chat(request, response, key, body, abort);
      }
      const result = await routes[route]({ key, body, request });
      send(response, result.status, result.body);
    } catch (error) {
      if (!(error instanceof HttpError || error instanceof QueueError || error instanceof LlmError || error instanceof DocumentError)) log('error', { route, message: error.message });
      fail(response, error);
    }
  });
}
