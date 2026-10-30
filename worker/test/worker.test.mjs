// Tests for the sync Worker, run with plain Node (node worker/test/worker.test.mjs). No deployment needed.
// D1 is replaced by an in-memory SQLite database that answers the same calls (prepare/bind/first/all/run/batch).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(join(here, '..', 'schema.sql'), 'utf8'));

// The D1 surface the Worker uses, on top of node:sqlite.
const DB = {
  prepare(sql) {
    const args = [];
    const stmt = {
      bind(...values) {
        args.splice(0, args.length, ...values);
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

const env = { DB, TOKEN_SECRET: 'test-secret-value', ALLOWED_ORIGIN: 'https://pharmacy.example' };
let failures = 0;
let checks = 0;
const check = (label, condition, detail = '') => {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label} ${detail}`);
  } else {
    console.log(`ok   ${label}`);
  }
};

const call = (method, path, { body, token, origin } = {}) =>
  worker.fetch(
    new Request(`https://sync.test${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );

/** The device-side proof: PBKDF2-SHA256 of the password, base64, exactly as the app derives it. */
async function proofFor(password, saltB64, iterations) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

// A member seeded the way seed-owner.mjs does it: a salt and a hash of the password.
const salt = btoa('0123456789abcdef');
const iterations = 1000;
const ownerHash = await proofFor('owner-pass-1', salt, iterations);
sqlite
  .prepare('INSERT INTO members (id, username, salt, hash, iterations, active, stamp) VALUES (?, ?, ?, ?, ?, 1, ?)')
  .run('owner', 'owner', salt, ownerHash, iterations, '');

// Sign-in
let res = await call('GET', '/auth/salt?username=nobody');
check('unknown user gets 404 for the salt', res.status === 404);
res = await call('GET', '/auth/salt?username=owner');
const saltBody = await res.json();
check('salt endpoint returns salt and iterations', res.status === 200 && saltBody.salt === salt && saltBody.iterations === iterations);

res = await call('POST', '/auth/token', { body: { username: 'owner', proof: 'wrong' } });
check('a wrong proof is refused', res.status === 401);
res = await call('POST', '/auth/token', { body: { username: 'owner', proof: await proofFor('owner-pass-1', salt, iterations) } });
const session = await res.json();
check('the right proof gets tokens', res.status === 200 && session.access_token && session.refresh_token);
const token = session.access_token;

// Auth is required for ops
res = await call('GET', '/ops?after=0');
check('ops need an access token', res.status === 401);
res = await call('GET', '/ops?after=0', { token: 'bad.token' });
check('a forged token is refused', res.status === 401);

// Push: a sale and an owner change to the staff record
const sale = { opId: '001000000000001.000000.dev-a', stamp: '001000000000001.000000.dev-a', store: 'sales', op: 'put', key: 'sale-1', record: { id: 'sale-1', total: 1500, stamp: '001000000000001.000000.dev-a' } };
res = await call('POST', '/ops', { token, body: { ops: [sale] } });
const held = await res.json();
check('a push returns the op ids it holds', res.status === 200 && held.held.join() === sale.opId);
await call('POST', '/ops', { token, body: { ops: [sale] } });
const rowCount = sqlite.prepare('SELECT COUNT(*) AS n FROM ops WHERE op_id = ?').get(sale.opId).n;
check('a repeated push is stored once', rowCount === 1, `rows=${rowCount}`);

// Staff: a user record is projected into members, last writer wins
const staffNew = { opId: '001000000000010.000000.dev-a', stamp: '001000000000010.000000.dev-a', store: 'users', op: 'put', key: 'staff-1', record: { id: 'staff-1', username: 'asif', salt, hash: 'hash-v1', iterations, active: true, sections: ['pos'] } };
await call('POST', '/ops', { token, body: { ops: [staffNew] } });
let member = sqlite.prepare('SELECT * FROM members WHERE id = ?').get('staff-1');
check('a staff user op creates a member', member && member.username === 'asif' && member.hash === 'hash-v1');

const staffOld = { ...staffNew, opId: '001000000000005.000000.dev-b', stamp: '001000000000005.000000.dev-b', record: { ...staffNew.record, hash: 'hash-stale' } };
await call('POST', '/ops', { token, body: { ops: [staffOld] } });
member = sqlite.prepare('SELECT * FROM members WHERE id = ?').get('staff-1');
check('an older change does not overwrite a newer one', member.hash === 'hash-v1');

const staffPassword = { ...staffNew, opId: '001000000000020.000000.dev-b', stamp: '001000000000020.000000.dev-b', record: { ...staffNew.record, hash: 'hash-v2' } };
await call('POST', '/ops', { token, body: { ops: [staffPassword] } });
member = sqlite.prepare('SELECT * FROM members WHERE id = ?').get('staff-1');
check('a newer password change is applied', member.hash === 'hash-v2');

res = await call('POST', '/auth/token', { body: { username: 'asif', proof: 'hash-v2' } });
check('a staff member signs in with the new proof', res.status === 200);
res = await call('POST', '/auth/token', { body: { username: 'asif', proof: 'hash-v1' } });
check('the old password no longer signs in', res.status === 401);

// Deactivated accounts cannot sign in
const staffOff = { ...staffNew, opId: '001000000000030.000000.dev-a', stamp: '001000000000030.000000.dev-a', record: { ...staffNew.record, hash: 'hash-v2', active: false } };
await call('POST', '/ops', { token, body: { ops: [staffOff] } });
res = await call('POST', '/auth/token', { body: { username: 'asif', proof: 'hash-v2' } });
check('a disabled member cannot sign in', res.status === 401);

// Pull: everything after a cursor, in order
res = await call('GET', '/ops?after=0&limit=2', { token });
let page = await res.json();
check('pull returns ops in server order with a cursor', page.ops.length === 2 && page.ops[0].opId === sale.opId && page.cursor === page.ops[1].seq);
res = await call('GET', `/ops?after=${page.cursor}&limit=50`, { token });
const rest = await res.json();
check('the next pull starts after the cursor', rest.ops.length >= 3 && rest.ops.every((o) => o.seq > page.cursor));
res = await call('GET', `/ops?after=${rest.cursor}`, { token });
check('a pull at the end is empty and keeps the cursor', (await res.json()).ops.length === 0);

// Delete removes the member
const staffGone = { opId: '001000000000040.000000.dev-a', stamp: '001000000000040.000000.dev-a', store: 'users', op: 'delete', key: 'staff-1' };
await call('POST', '/ops', { token, body: { ops: [staffGone] } });
check('a delete op removes the member', !sqlite.prepare('SELECT 1 FROM members WHERE id = ?').get('staff-1'));

// Refresh tokens rotate
res = await call('POST', '/auth/refresh', { body: { refresh_token: session.refresh_token } });
const rotated = await res.json();
check('a refresh token gives new tokens', res.status === 200 && rotated.access_token && rotated.refresh_token !== session.refresh_token);
res = await call('POST', '/auth/refresh', { body: { refresh_token: session.refresh_token } });
check('a used refresh token cannot be used again', res.status === 401);

// CORS: only the app's origin is allowed
res = await call('OPTIONS', '/ops', { origin: 'https://pharmacy.example' });
check('the app origin is allowed', res.headers.get('Access-Control-Allow-Origin') === 'https://pharmacy.example');
res = await call('OPTIONS', '/ops', { origin: 'https://evil.example' });
check('other origins get no CORS header', res.headers.get('Access-Control-Allow-Origin') === null);

console.log(`\n${checks - failures} of ${checks} checks passed.`);
process.exit(failures ? 1 : 0);
