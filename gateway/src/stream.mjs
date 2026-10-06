import http from 'node:http';

// fetch() (undici) gives up after 300 s without response headers. A 250k-token prompt takes longer
// than that to process on the 3060, so streaming calls to llama-server use node:http without timeouts.
// One connection per request (no keep-alive): a reused socket that llama-server already closed would
// fail the next request with ECONNRESET. Resolves with { status, body } (body: async iterable of Buffers).
export function postStream(url, payload, signal) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const data = Buffer.from(JSON.stringify(payload));
    const request = http.request({
      hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: 'POST', agent: false, signal,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Connection: 'close' },
    }, response => resolve({ status: response.statusCode, body: response }));
    request.on('error', reject); // stays attached: late socket errors must not crash the process
    request.end(data);
  });
}

export async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
