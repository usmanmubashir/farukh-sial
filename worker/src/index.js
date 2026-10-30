// Sync server for Shifa Pharmacy POS on Cloudflare Workers with a D1 database. One deployment serves one pharmacy.
//
// Sign-in: the app derives the password hash on the device (PBKDF2, the same value it stores) and sends that proof.
// The server compares it with the stored hash, so the Worker never runs PBKDF2 and the password never leaves the device.
// Access tokens are HMAC-signed and last an hour. Refresh tokens are random, stored as SHA-256, and rotate on every use.
//
// Routes (all JSON):
//   GET  /auth/salt?username=            → { salt, iterations }
//   POST /auth/token   { username, proof } → { access_token, refresh_token, expires_in }
//   POST /auth/refresh { refresh_token }   → the same shape, with a new refresh token
//   POST /ops          { ops: [...] } (auth) → { held: [opId] }   stores ops; repeats are ignored
//   GET  /ops?after=SEQ&limit=N (auth)       → { ops: [...], cursor }
//
// Secrets (set with `npx wrangler secret put`): TOKEN_SECRET, a long random string.
const ACCESS_SECONDS = 3600;
const REFRESH_SECONDS = 60 * 60 * 24 * 90;
const PUSH_LIMIT = 200;
const PULL_LIMIT = 1000;
const enc = new TextEncoder();

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** CORS: only the app's origins may call the server from a browser. */
function corsFor(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function hmacKey(env) {
  if (!env.TOKEN_SECRET) throw new Error('TOKEN_SECRET is not set');
  return crypto.subtle.importKey('raw', enc.encode(env.TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signAccess(env, memberId) {
  const payload = btoa(JSON.stringify({ sub: memberId, exp: Date.now() + ACCESS_SECONDS * 1000 }));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(payload));
  return `${payload}.${toB64(sig)}`;
}

/** The member id in a valid, unexpired access token, or null. */
async function verifyAccess(env, token) {
  const [payload, sig] = String(token ?? '').split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), fromB64(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(atob(payload));
    return data.exp > Date.now() ? data.sub : null;
  } catch {
    // Malformed base64 or JSON is a bad token, not a server error.
    return null;
  }
}

async function sha256Hex(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings in time that does not depend on where they differ. */
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function issueTokens(env, memberId) {
  const refresh = toB64(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = Date.now() + REFRESH_SECONDS * 1000;
  await env.DB.prepare('INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(refresh), memberId, expiresAt)
    .run();
  return {
    access_token: await signAccess(env, memberId),
    refresh_token: refresh,
    expires_in: ACCESS_SECONDS,
    token_type: 'bearer',
  };
}

async function activeMember(env, username) {
  return env.DB.prepare('SELECT * FROM members WHERE username = ? AND active = 1').bind(username).first();
}

async function signIn(request, env) {
  const body = await request.json().catch(() => ({}));
  const member = await activeMember(env, String(body.username ?? '').trim().toLowerCase());
  // Always compare, even for an unknown name, so the answer takes the same time either way.
  const stored = member?.hash ?? '';
  if (!member || typeof body.proof !== 'string' || !sameText(body.proof, stored)) {
    return json({ error: 'invalid_credentials' }, 401);
  }
  const pharmacy = await env.DB.prepare("SELECT name FROM pharmacy WHERE id = 1").first();
  return json({ ...(await issueTokens(env, member.id)), pharmacy_name: pharmacy?.name ?? "" });
}

async function refresh(request, env) {
  const body = await request.json().catch(() => ({}));
  const hash = await sha256Hex(String(body.refresh_token ?? ''));
  const session = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash = ?').bind(hash).first();
  // The old refresh token is used up whether or not it is still valid.
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
  if (!session || session.expires_at < Date.now()) return json({ error: 'invalid_refresh' }, 401);
  const member = await env.DB.prepare('SELECT id FROM members WHERE id = ? AND active = 1').bind(session.member_id).first();
  if (!member) return json({ error: 'invalid_refresh' }, 401);
  return json(await issueTokens(env, member.id));
}

/** Keeps the members table in step with the users ops (last writer wins, by stamp). */
function memberStatement(env, op) {
  if (op.store !== 'users') return null;
  if (op.op === 'delete') return env.DB.prepare('DELETE FROM members WHERE id = ?').bind(op.key);
  const r = op.record;
  if (!r || !r.username || !r.salt || !r.hash) return null;
  return env.DB.prepare(
    `INSERT INTO members (id, username, salt, hash, iterations, active, stamp) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, salt = excluded.salt, hash = excluded.hash,
       iterations = excluded.iterations, active = excluded.active, stamp = excluded.stamp
     WHERE excluded.stamp > members.stamp`,
  ).bind(op.key, r.username, r.salt, r.hash, r.iterations, r.active === false ? 0 : 1, op.stamp);
}

async function pushOps(request, env) {
  const body = await request.json().catch(() => ({}));
  const ops = Array.isArray(body.ops) ? body.ops : [];
  if (ops.length > PUSH_LIMIT) return json({ error: 'too_many_ops', limit: PUSH_LIMIT }, 413);
  const statements = [];
  for (const op of ops) {
    if (!op.opId || !op.stamp || !op.store || !op.op || op.key === undefined) return json({ error: 'bad_op' }, 400);
    statements.push(
      env.DB.prepare('INSERT OR IGNORE INTO ops (op_id, stamp, store, op, key, record) VALUES (?, ?, ?, ?, ?, ?)').bind(
        op.opId,
        op.stamp,
        op.store,
        op.op,
        String(op.key),
        op.record === undefined || op.record === null ? null : JSON.stringify(op.record),
      ),
    );
    const member = memberStatement(env, op);
    if (member) statements.push(member);
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ held: ops.map((op) => op.opId) });
}

async function pullOps(url, env) {
  const after = Math.max(0, Number(url.searchParams.get('after') ?? 0) || 0);
  const limit = Math.min(PULL_LIMIT, Math.max(1, Number(url.searchParams.get('limit') ?? 500) || 500));
  const { results } = await env.DB.prepare('SELECT seq, op_id, stamp, store, op, key, record FROM ops WHERE seq > ? ORDER BY seq LIMIT ?')
    .bind(after, limit)
    .all();
  return json({
    ops: results.map((row) => ({
      seq: row.seq,
      opId: row.op_id,
      stamp: row.stamp,
      store: row.store,
      op: row.op,
      key: row.key,
      record: row.record === null ? undefined : JSON.parse(row.record),
    })),
    cursor: results.length ? results[results.length - 1].seq : after,
  });
}

export default {
  async fetch(request, env) {
    const cors = corsFor(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const respond = (response) => {
      for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
      return response;
    };
    try {
      if (url.pathname === '/' && request.method === 'GET') return respond(json({ service: 'shifa-sync', ok: true }));
      if (url.pathname === '/auth/salt' && request.method === 'GET') {
        const member = await activeMember(env, (url.searchParams.get('username') ?? '').trim().toLowerCase());
        if (!member) return respond(json({ error: 'unknown_user' }, 404));
        return respond(json({ salt: member.salt, iterations: member.iterations }));
      }
      if (url.pathname === '/auth/token' && request.method === 'POST') return respond(await signIn(request, env));
      if (url.pathname === '/auth/refresh' && request.method === 'POST') return respond(await refresh(request, env));

      // Everything below needs a valid access token.
      const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
      const memberId = await verifyAccess(env, bearer);
      if (!memberId) return respond(json({ error: 'unauthorized' }, 401));
      if (url.pathname === '/ops' && request.method === 'POST') return respond(await pushOps(request, env));
      if (url.pathname === '/ops' && request.method === 'GET') return respond(await pullOps(url, env));
      return respond(json({ error: 'not_found' }, 404));
    } catch (err) {
      console.error('[sync] request failed', err);
      return respond(json({ error: 'server_error' }, 500));
    }
  },
};
