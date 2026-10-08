import http from 'node:http';
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

/** Converts the package's message format into llama-server's OpenAI format, validating every part. */
export function normalizeMessages(input, limits) {
  if (!Array.isArray(input) || !input.length || input.length > limits.maxMessages) throw new HttpError(400, 'invalid_messages', 'Provide between 1 and ' + limits.maxMessages + ' messages.');
  let images = 0;
  const messages = input.map((message, index) => {
    if (!['system', 'user', 'assistant'].includes(message?.role)) throw new HttpError(400, 'invalid_messages', `Message ${index + 1} has an invalid role.`);
    if (message.role === 'system' && index !== 0) throw new HttpError(400, 'invalid_messages', 'Only the first message may be a system message.');
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
  if (messages.at(-1).role !== 'user') throw new HttpError(400, 'invalid_messages', 'The last message must be from the visitor.');
  return { messages, images };
}

export function createServer({ config, keys, scheduler, llm, monitor, slots, log = () => {} }) {
  const routes = {
    'GET /v1/health': async () => ({ status: 200, body: { ok: true, model: await llm.health() } }),

    'GET /v1/status': async ({ key }) => {
      const model = await llm.health();
      const props = model === 'ready' ? await llm.props().catch(() => null) : null;
      return { status: 200, body: {
        model: { state: model, name: props?.model ?? null, contextTokens: props ? Math.min(props.contextTokens, key.limits.maxContextTokens) : 0, vision: props?.vision ?? false },
        queue: scheduler.snapshot(),
        gpu: { healthy: !monitor.latest?.spilling },
        limits: { ...key.limits, maxImages: config.limits.maxImages, maxImageBytes: config.limits.maxImageBytes, maxPdfBytes: config.limits.maxPdfBytes, maxPdfPages: config.limits.maxPdfPages, maxTokensCap: config.generation.maxTokensCap },
        usage: keys.usageOf(key),
      } };
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

  async function chat(request, response, key, body) {
    const { messages, images } = normalizeMessages(body.messages, config.limits);
    if (images && !(await llm.props().catch(() => ({ vision: false }))).vision) throw new HttpError(422, 'vision_unavailable', 'Image understanding is not available right now.');
    const props = await llm.props();
    const contextLimit = Math.min(props.contextTokens, key.limits.maxContextTokens, Number(body.contextLimit) || Infinity);
    const maxTokens = Math.min(Math.max(Number(body.maxTokens) || config.generation.defaultMaxTokens, 16), config.generation.maxTokensCap);
    const promptTokens = await llm.countPrompt(messages, config.imageTokens);
    if (promptTokens + Math.min(maxTokens, 256) > contextLimit) throw new HttpError(413, 'context_full', 'This conversation no longer fits into the assistant\'s memory. Start a new chat.', { promptTokens, contextTokens: contextLimit });
    if (!keys.hasQuota(key)) throw new HttpError(429, 'daily_quota', 'This website has reached its daily question limit. Please try again tomorrow.', {}, );

    const abort = new AbortController();
    response.on('close', () => { if (!response.writableFinished) abort.abort(new QueueError('cancelled', 'The visitor left.', 499, 0)); });
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
    try {
      await scheduler.enqueue({
        keyId: key.id, visitor: typeof body.visitor === 'string' ? body.visitor.slice(0, 128) : '', maxQueued: key.limits.maxQueued, signal: abort.signal,
        onUpdate: ({ position, estimate }) => position > 0 && event('queued', { position, estimatedWaitSeconds: estimate }),
        run: async signal => {
          const limit = AbortSignal.any([signal, AbortSignal.timeout(config.generation.maxSeconds * 1000)]);
          keys.take(key);
          // Pin this website to a prompt-cache slot and make room in the shared KV pool if needed.
          const fresh = await llm.props();
          if (slots.epoch !== llm.epoch) { slots.reset(); slots.epoch = llm.epoch; }
          slots.resize(fresh.slots); slots.contextTokens = fresh.contextTokens;
          const slot = await slots.assign(key.id, promptTokens + maxTokens, id => llm.eraseSlot(id));
          slots.record(slot, promptTokens);
          event('started', { promptTokens, contextTokens: contextLimit, waitedMs: Date.now() - started });
          let completion = 0, firstToken = 0;
          for await (const part of llm.chat(messages, { ...config.generation, maxTokens, temperature: body.temperature ?? config.generation.temperature, thinking: !!body.thinking, slot: slots.slots.length > 1 ? slot : undefined }, limit)) {
            if (part.type === 'progress') { if (part.total > 2048) event('progress', { processed: Math.max(part.processed || 0, part.cache || 0), total: part.total }); }
            else if (part.type === 'reasoning') event('thinking', {});
            else if (part.type === 'delta') { firstToken ||= Date.now(); event('delta', { text: part.text }); }
            else {
              const prompt = part.usage?.prompt_tokens ?? promptTokens;
              completion = part.usage?.completion_tokens ?? part.timings?.predicted_n ?? 0;
              keys.record(key, part.timings?.prompt_n ?? prompt, completion);
              slots.record(slot, prompt + completion);
              event('done', {
                finishReason: part.finishReason,
                usage: { promptTokens: prompt, completionTokens: completion, cachedTokens: part.timings?.cache_n ?? 0 },
                context: { used: prompt + completion, limit: contextLimit },
                timings: { promptPerSecond: Math.round(part.timings?.prompt_per_second || 0), tokensPerSecond: Math.round((part.timings?.predicted_per_second || 0) * 10) / 10, firstTokenMs: firstToken ? firstToken - started : null, totalMs: Date.now() - started },
              });
            }
          }
          log('chat', { key: key.id, promptTokens, completion, ms: Date.now() - started });
        },
      });
    } catch (error) {
      if (error.code === 'cancelled' || abort.signal.aborted) { log('cancelled', { key: key.id }); return; }
      if (error.name === 'TimeoutError') error = new LlmError('answer_timeout', 'The answer took too long and was stopped.', 504);
      if (!open) throw error;
      event('error', { code: error.code || 'internal_error', message: error.status ? error.message : 'The answer failed.', ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
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
        const state = await llm.health(0);
        if (state !== 'ready') throw new LlmError(state === 'loading' ? 'model_loading' : 'model_unavailable', state === 'loading' ? 'The assistant model is starting. Please try again in a minute.' : 'The assistant model is offline right now. Please try again in a few minutes.', 503);
        return await chat(request, response, key, body);
      }
      const result = await routes[route]({ key, body, request });
      send(response, result.status, result.body);
    } catch (error) {
      if (!(error instanceof HttpError || error instanceof QueueError || error instanceof LlmError || error instanceof DocumentError)) log('error', { route, message: error.message });
      fail(response, error);
    }
  });
}
