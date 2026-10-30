// Integration test: the device adapter (js/core/sync-cloudflare.js) against the Worker, over real HTTP on localhost.
// Run with: node worker/test/adapter.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';
import { CloudflareAdapter, passwordProof, signInCloudflare } from '../../js/core/sync-cloudflare.js';
import { SyncError } from '../../js/core/sync-supabase.js';

const here = dirname(fileURLToPath(import.meta.url));
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(join(here, '..', 'schema.sql'), 'utf8'));

// The D1 surface the Worker uses, on top of node:sqlite.
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
const env = { DB, TOKEN_SECRET: 'adapter-test-secret', ALLOWED_ORIGIN: 'https://pharmacy.example' };

// Serve the Worker over HTTP, the way the browser reaches it.
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const response = await worker.fetch(
    new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, body: body && req.method !== 'GET' ? body : undefined }),
    env,
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
let checks = 0;
const check = (label, condition, detail = '') => {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label} ${detail}`);
  } else console.log(`ok   ${label}`);
};

// The owner account, seeded as seed-owner.mjs does it (a small iteration count keeps the test quick).
const salt = Buffer.from('0123456789abcdef').toString('base64');
const hash = await passwordProof('owner-pass-1', salt, 1000);
sqlite.prepare("INSERT INTO members (id, username, salt, hash, iterations, active, stamp) VALUES ('owner', 'owner', ?, ?, 1000, 1, '')").run(salt, hash);

const config = { backend: 'cloudflare', url, username: 'owner' };

// Sign-in
let session;
try {
  session = await signInCloudflare(config, 'owner-pass-1');
  check('the device signs in with its password', Boolean(session.accessToken && session.refreshToken));
} catch (err) {
  check('the device signs in with its password', false, err.message);
}
const wrong = await signInCloudflare(config, 'not-the-password').catch((err) => err);
check('a wrong password gives an auth error', wrong instanceof SyncError && wrong.code === 'auth', String(wrong?.code));
const unknown = await signInCloudflare({ ...config, username: 'nobody' }, 'owner-pass-1').catch((err) => err);
check('an unknown username gives an auth error', unknown instanceof SyncError && unknown.code === 'auth', String(unknown?.code));
const offline = await signInCloudflare({ ...config, url: 'http://127.0.0.1:1' }, 'owner-pass-1').catch((err) => err);
check('no connection gives a network error', offline instanceof SyncError && offline.code === 'network', String(offline?.code));

// Push and pull through the adapter
const saved = [];
const adapter = new CloudflareAdapter(config, session, async (next) => saved.push(next));
const ownerOp = {
  opId: '001000000000100.000000.d1', stamp: '001000000000100.000000.d1', store: 'users', op: 'put', key: 'owner',
  record: { id: 'owner', username: 'owner', salt, hash, iterations: 1000, active: true, stamp: '001000000000100.000000.d1' },
};
const saleOp = { opId: '001000000000101.000000.d1', stamp: '001000000000101.000000.d1', store: 'sales', op: 'put', key: 's1', record: { id: 's1', total: 900 } };
const held = await adapter.push([ownerOp, saleOp]);
check('push confirms every op', held.length === 2 && held.includes(ownerOp.opId) && held.includes(saleOp.opId));
const again = await adapter.push([saleOp]);
check('a repeated push is still confirmed, not stored twice', again.includes(saleOp.opId) && sqlite.prepare('SELECT COUNT(*) AS n FROM ops').get().n === 2);

const page = await adapter.pull(0, 500);
check('pull returns the ops in order with a cursor', page.ops.length === 2 && page.ops[0].opId === ownerOp.opId && page.cursor === 2, JSON.stringify(page.cursor));
check('pull keeps the record of each op', page.ops[1].record.total === 900);
const empty = await adapter.pull(page.cursor, 500);
check('pull after the cursor is empty', empty.ops.length === 0 && empty.cursor === page.cursor);

// An expired access token is renewed with the refresh token, and the new session is saved
adapter.session = { ...adapter.session, expiresAt: 0 };
await adapter.auth();
check('an expired session is renewed and saved', saved.length === 1 && saved[0].accessToken !== session.accessToken);
const after = await adapter.pull(0, 500);
check('the renewed session still works', after.ops.length === 2);

// A revoked access token asks the owner to sign in again
adapter.session = { ...adapter.session, accessToken: 'bad.token', expiresAt: Date.now() + 3600000 };
const denied = await adapter.pull(0, 500).catch((err) => err);
check('a rejected access token gives an auth error', denied instanceof SyncError && denied.code === 'auth', String(denied?.code));

// The adapter declares that it keeps no snapshots
check('the adapter opts out of snapshots', adapter.snapshots === false && (await adapter.latestSnapshot()) === null);

server.closeAllConnections();
server.close();
console.log(`\n${checks - failures} of ${checks} checks passed.`);
process.exit(failures ? 1 : 0);
