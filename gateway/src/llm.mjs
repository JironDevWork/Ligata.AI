// Client for the local llama-server (OpenAI-compatible API plus its native helpers).
import { postStream, readAll } from './stream.mjs';

export class LlmError extends Error {
  constructor(code, message, status = 503, details = {}) {
    super(message);
    this.code = code; this.status = status; this.details = details;
  }
}

const unavailable = () => new LlmError('model_unavailable', 'The assistant model is offline right now. Please try again in a few minutes.', 503);

export class Llm {
  constructor(base, { requestTimeoutMs = 60000 } = {}) {
    this.base = base.replace(/\/$/, '');
    this.requestTimeoutMs = requestTimeoutMs;
    this.cachedHealth = { at: 0, value: 'down' };
    this.cachedProps = null;
    this.epoch = 0; // increases whenever llama-server comes back, so slot bookkeeping can reset
  }

  async health(maxAgeMs = 2000) {
    if (Date.now() - this.cachedHealth.at < maxAgeMs) return this.cachedHealth.value;
    let value = 'down';
    try {
      const response = await fetch(this.base + '/health', { signal: AbortSignal.timeout(3000) });
      value = response.ok ? 'ready' : response.status === 503 ? 'loading' : 'down';
    } catch { value = 'down'; }
    if (value !== 'ready') this.cachedProps = null; // a restarted server may use another profile
    if (value === 'ready' && this.cachedHealth.value !== 'ready') this.epoch++;
    this.cachedHealth = { at: Date.now(), value };
    return value;
  }

  async props() {
    if (this.cachedProps) return this.cachedProps;
    const data = await this.json('/props');
    this.cachedProps = {
      contextTokens: data.default_generation_settings?.n_ctx ?? 0,
      vision: !!data.modalities?.vision,
      model: String(data.model_alias || data.model_path || '').split(/[\\/]/).pop(),
      build: data.build_info,
      slots: data.total_slots || 1,
    };
    return this.cachedProps;
  }

  async json(path, body, signal) {
    let response;
    try {
      response = await fetch(this.base + path, {
        method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.requestTimeoutMs)]) : AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) { if (signal?.aborted) throw error; throw unavailable(); }
    if (response.status === 503) throw new LlmError('model_loading', 'The assistant model is starting. Please try again in a minute.', 503);
    if (!response.ok) throw new LlmError('model_failed', `The model rejected the request (${response.status}).`, 502, { body: (await response.text()).slice(0, 500) });
    return response.json();
  }

  /** Frees a slot's cached prompt in the shared KV pool. */
  async eraseSlot(id) {
    const response = await fetch(`${this.base}/slots/${id}?action=erase`, { method: 'POST', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new LlmError('slot_erase_failed', 'Could not free a prompt cache slot.', 502);
  }

  async countText(text) {
    if (!text) return 0;
    return (await this.json('/tokenize', { content: text })).tokens.length;
  }

  /** Exact prompt size: render the chat template, then tokenize. Images are added by estimate. */
  async countPrompt(messages, imageTokens) {
    let images = 0;
    const textOnly = messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map(p => (p.type === 'image_url' ? (images++, '') : p.text)).join('\n'),
    }));
    const { prompt } = await this.json('/apply-template', { messages: textOnly, chat_template_kwargs: { enable_thinking: false } });
    return (await this.countText(prompt)) + images * imageTokens;
  }

  /**
   * Streams a chat completion. Yields {type:'progress', total, cache, processed}, {type:'delta', text}, {type:'reasoning'} and finally
   * {type:'done', usage, timings, finishReason}.
   */
  async *chat(messages, options, signal) {
    let response;
    try {
      response = await postStream(this.base + '/v1/chat/completions', {
        messages, stream: true, stream_options: { include_usage: true }, cache_prompt: true, return_progress: true,
        max_tokens: options.maxTokens, temperature: options.temperature, top_p: options.topP, top_k: options.topK, min_p: 0,
        chat_template_kwargs: { enable_thinking: !!options.thinking }, reasoning_format: 'deepseek',
        ...(options.slot !== undefined ? { id_slot: options.slot } : {}),
      }, signal);
    } catch (error) { if (signal?.aborted) throw signal.reason ?? error; throw unavailable(); }
    if (response.status !== 200) {
      const text = await readAll(response.body).catch(() => '');
      let error = {};
      try { error = JSON.parse(text).error || {}; } catch {}
      if (error.type === 'exceed_context_size_error') throw new LlmError('context_full', 'This conversation no longer fits into the assistant\'s memory. Start a new chat.', 413, { promptTokens: error.n_prompt_tokens, contextTokens: error.n_ctx });
      if (response.status === 503) throw new LlmError('model_loading', 'The assistant model is starting. Please try again in a minute.', 503);
      throw new LlmError('model_failed', 'The model could not answer this request.', 502, { status: response.status, body: text.slice(0, 500) });
    }
    const decoder = new TextDecoder();
    let buffer = '', usage = null, timings = null, finishReason = null, reasoning = false;
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          const data = JSON.parse(payload);
          if (data.error) throw new LlmError('model_failed', 'The model stopped while answering.', 502, { error: data.error });
          if (data.prompt_progress) yield { type: 'progress', ...data.prompt_progress };
          const choice = data.choices?.[0];
          if (choice?.delta?.reasoning_content && !reasoning) { reasoning = true; yield { type: 'reasoning' }; }
          if (choice?.delta?.content) yield { type: 'delta', text: choice.delta.content };
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (data.usage) usage = data.usage;
          if (data.timings) timings = data.timings;
        }
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (error instanceof LlmError) throw error;
      throw new LlmError('model_failed', 'The connection to the model was lost while answering.', 502);
    }
    if (!finishReason && !usage) throw new LlmError('model_failed', 'The model stopped unexpectedly.', 502);
    yield { type: 'done', usage, timings, finishReason };
  }
}
