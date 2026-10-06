import http from 'node:http';

// A stand-in for llama-server with switchable failure modes, so gateway behaviour under
// outages, slow answers and broken streams can be tested without a GPU.
export function startMockLlm() {
  const state = {
    mode: 'ok',            // ok | down | loading | error | drop | context
    delayMs: 20,           // per streamed token
    tokens: ['Hello', ' from', ' the', ' mock', '.'],
    contextTokens: 8192,
    vision: true,
    slots: 1, erased: [],
    active: 0, maxActive: 0, requests: 0, aborted: 0, lastBody: null,
  };
  const count = text => Math.ceil(String(text).length / 4);
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (state.mode === 'down') return request.socket.destroy();
    if (request.url === '/health') return state.mode === 'loading' ? json(503, { error: { message: 'Loading model' } }) : json(200, { status: 'ok' });
    if (state.mode === 'loading') return json(503, { error: { message: 'Loading model' } });
    if (request.url === '/props') return json(200, { default_generation_settings: { n_ctx: state.contextTokens }, modalities: { vision: state.vision }, model_path: 'mock.gguf', build_info: 'mock', total_slots: state.slots });
    const erase = /^\/slots\/(\d+)\?action=erase$/.exec(request.url);
    if (erase) { state.erased.push(Number(erase[1])); return json(200, { id_slot: Number(erase[1]), n_erased: 1 }); }
    if (request.url === '/tokenize') return json(200, { tokens: Array.from({ length: count(body.content) }, (_, i) => i) });
    if (request.url === '/apply-template') return json(200, { prompt: body.messages.map(m => `<${m.role}>${m.content}`).join('\n') });
    if (request.url === '/v1/chat/completions') {
      state.requests++; state.lastBody = body;
      if (state.mode === 'context') return json(400, { error: { type: 'exceed_context_size_error', n_prompt_tokens: 9999, n_ctx: state.contextTokens } });
      if (state.mode === 'error') return json(500, { error: { message: 'boom' } });
      state.active++; state.maxActive = Math.max(state.maxActive, state.active);
      let closed = false;
      response.on('close', () => { if (!response.writableFinished) { closed = true; state.aborted++; } });
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      try {
        for (const [i, token] of state.tokens.entries()) {
          await new Promise(r => setTimeout(r, state.delayMs));
          if (closed) return;
          if (state.mode === 'drop' && i === 2) { response.destroy(); return; }
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`);
        }
        const prompt = count(JSON.stringify(body.messages));
        response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: prompt, completion_tokens: state.tokens.length }, timings: { prompt_n: prompt, cache_n: 0, predicted_n: state.tokens.length, prompt_per_second: 1000, predicted_per_second: 30 } })}\n\n`);
        response.end('data: [DONE]\n\n');
      } finally { state.active--; }
      return;
    }
    json(404, {});
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) })));
}

/** A tiny, valid one-page PDF containing `text` (Helvetica, uncompressed). */
export function makePdf(lines) {
  const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map(l => `(${l.replace(/[()\\]/g, '\\$&')}) '`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
