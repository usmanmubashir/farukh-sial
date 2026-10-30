// Local test server for the whole app: the app's files, and the sync Worker under /sync (same origin, no CORS).
// Usage: node worker/test/combined-dev.mjs [port] [owner-username] [owner-password]
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';

const [port = '8787', username = 'owner', password = 'owner-pass-1'] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(join(here, '..', 'schema.sql'), 'utf8'));

const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind(...values) { args = values; return stmt; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { sqlite.prepare(sql).run(...args); return { success: true }; },
    };
    return stmt;
  },
  async batch(statements) { for (const statement of statements) await statement.run(); return []; },
};

const salt = randomBytes(16);
const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, key, 256);
sqlite.prepare("INSERT INTO members (id, username, salt, hash, iterations, active, stamp) VALUES ('owner', ?, ?, ?, 310000, 1, '')")
  .run(username, salt.toString('base64'), Buffer.from(bits).toString('base64'));
const env = { DB, TOKEN_SECRET: randomBytes(32).toString('hex'), ALLOWED_ORIGIN: `http://localhost:${port}` };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/sync/') || url.pathname === '/sync') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const path = url.pathname.slice('/sync'.length) + url.search;
    const response = await worker.fetch(new Request(`http://worker.local${path}`, { method: req.method, headers: req.headers, body: body && req.method !== 'GET' ? body : undefined }), env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(Number(port), '127.0.0.1', () => console.log(`app + sync on http://localhost:${port} (owner: ${username})`));
