import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerApi } from './api.js';
import { dbFile } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');
// PONDO_PORT wins, then a harness-assigned PORT (preview servers), then default.
const port = +(process.env.PONDO_PORT ?? process.env.PORT ?? 4177);

const app = Fastify({ logger: false });
registerApi(app);

if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  // SPA fallback: anything that isn't /api/* gets index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html');
  });
} else {
  console.log('web/dist not found — API only (run `npm run build` for the UI, or use `npm run dev`)');
}

await app.listen({ port, host: '127.0.0.1' });
console.log(`Pondo → http://localhost:${port}   (db: ${dbFile})`);

// Pretty-hostname listener: with a hosts entry (127.0.0.1 pondo.test) this makes
// plain http://pondo.test work by proxying port 80 to the main port.
// macOS allows unprivileged port-80 binding only on the wildcard interface
// (127.0.0.1 gets EACCES), so we bind wildcard and refuse non-loopback callers
// to keep the app localhost-only.
if (port !== 80) {
  const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  http.createServer((req, res) => {
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      res.writeHead(403);
      res.end('Pondo is local-only');
      return;
    }
    const upstream = http.request(
      { host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers },
      up => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); },
    );
    upstream.on('error', () => { res.writeHead(502); res.end('Pondo backend not reachable'); });
    req.pipe(upstream);
  })
    .once('error', () => console.log(`port 80 unavailable — pretty hostname disabled, use :${port}`))
    .listen(80, () => console.log('Pondo → http://pondo.test   (needs the hosts entry)'));
}
