// Development helper: a mock llama-server on a fixed port, for UI work without the GPU.
//   node test/mock-server.mjs [port] [delayMs]
import { startMockLlm } from './mock-llm.mjs';
import http from 'node:http';
const mock = await startMockLlm();
mock.state.delayMs = Number(process.argv[3] || 40);
mock.state.contextTokens = 131072;
mock.state.tokens = 'Thanks for your question! Here is a **mock** answer from the development model:\n\n- Websites start at *CHF 4,800*\n- Hosting is CHF 25 per month\n\nSee [our contact page](/kontakt/) to book a call.'.match(/\S+\s*/g);
// Forward a fixed port to the mock's random port so the gateway config stays stable.
const target = new URL(mock.url);
http.createServer((req, res) => {
  const upstream = http.request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  upstream.on('error', () => res.destroy());
  req.pipe(upstream);
}).listen(Number(process.argv[2] || 1298), '127.0.0.1', () => console.log('mock llama-server on', process.argv[2] || 1298));
