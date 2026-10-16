// Локальный сервер «Кто заруинил?»: раздаёт сайт и отвечает на /api/* через общий модуль public/opendota.js
// (тот же код, что в браузере на GitHub Pages), с кэшем на диске. Без зависимостей: нужен только Node 18+.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from './public/opendota.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const CACHE = path.join(ROOT, 'cache');
const PORT = Number(process.env.PORT) || 4777;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

await fs.mkdir(CACHE, { recursive: true });

// Кэш на диске: ключ → cache/<ключ>.json
const file = (key) => path.join(CACHE, `${key.replace(/[^\w.-]/g, '_')}.json`);
const store = {
  get: async (key) => { try { return JSON.parse(await fs.readFile(file(key), 'utf8')); } catch { return null; } },
  set: (key, value) => fs.writeFile(file(key), JSON.stringify(value)),
  del: (key) => fs.rm(file(key), { force: true }),
};
const backend = createBackend({ store, apiKey: process.env.OPENDOTA_API_KEY || '', mode: 'server' });

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function serveStatic(res, url) {
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const target = path.normalize(path.join(PUBLIC, rel));
  if (!target.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const r = await backend.handle(req.method, url.pathname.slice('/api'.length), url.searchParams);
      send(res, r.status, r.body);
    } else await serveStatic(res, url);
  } catch (e) {
    send(res, 502, { error: `Ошибка: ${e.message}` });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Кто заруинил? → http://localhost:${PORT}\n`);
});
