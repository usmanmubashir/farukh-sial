// Runs the sync Worker on localhost with an in-memory database, for trying the app end to end.
// Usage: node worker/test/dev-server.mjs [port] [owner-username] [owner-password]
// The owner is seeded with the same PBKDF2 derivation as the app, so the password typed in the app works.
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, webcrypto } from 'node:crypto';
import worker from '../src/index.js';

const [port = '8799', username = 'owner', password = 'owner-pass-1'] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(join(here, '..', 'schema.sql'), 'utf8'));

const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind(...values) {
        args = values;
        return stmt;
      },
      async first() {
        return sqlite.prepare(sql).get(...args) ?? null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...args) };
      },
      async run() {
        sqlite.prepare(sql).run(...args);
        return { success: true };
      },
    };
    return stmt;
  },
  async batch(statements) {
    for (const statement of statements) await statement.run();
    return [];
  },
};

const salt = randomBytes(16);
const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, key, 256);
sqlite
  .prepare("INSERT INTO members (id, username, salt, hash, iterations, active, stamp) VALUES ('owner', ?, ?, ?, 310000, 1, '')")
  .run(username, salt.toString('base64'), Buffer.from(bits).toString('base64'));

const env = { DB, TOKEN_SECRET: randomBytes(32).toString('hex'), ALLOWED_ORIGIN: 'http://localhost:8787' };

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const response = await worker.fetch(
    new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: body && req.method !== 'GET' ? body : undefined }),
    env,
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(Number(port), '127.0.0.1', () => console.log(`sync server on http://127.0.0.1:${port} (owner: ${username})`));
