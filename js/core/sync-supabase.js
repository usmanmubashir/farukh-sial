// Supabase adapter for the sync engine. Plain fetch against the Auth and REST endpoints, no SDK.
// The project URL and anon key are typed into Settings and kept on this device; nothing secret is in the code.
// Row-level security (docs/supabase.sql) limits every request to the signed-in pharmacy.

/** A failed sync request. code 'auth' means the owner must sign in again; anything else is retried. */
export class SyncError extends Error {
  constructor(message, code = 'sync') {
    super(message);
    this.name = 'SyncError';
    this.code = code;
  }
}

const REFRESH_MARGIN_MS = 60000;

function readSession(body, res) {
  if (!res.ok || !body.access_token) {
    const code = res.status === 400 || res.status === 401 || res.status === 403 ? 'auth' : 'sync';
    throw new SyncError(body.error_description || body.msg || body.error || `Sign-in failed (${res.status}).`, code);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

async function tokenRequest(config, grant, payload) {
  let res;
  try {
    res = await fetch(`${config.url}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new SyncError('No connection to the sync server.', 'network');
  }
  const body = await res.json().catch(() => ({}));
  return readSession(body, res);
}

/** Signs in with the pharmacy's sync account. Returns the session to keep on this device. */
export const signIn = (config, email, password) => tokenRequest(config, 'password', { email, password });

export class SupabaseAdapter {
  /**
   * config: { url, anonKey }. session: { accessToken, refreshToken, expiresAt }.
   * saveSession(session) is called whenever the token is renewed, so the new refresh token is kept.
   */
  constructor(config, session, saveSession) {
    this.name = 'supabase';
    this.config = config;
    this.session = session;
    this.saveSession = saveSession;
  }

  /** Renews the access token when it is close to expiring, using the refresh token. */
  async auth() {
    if (this.session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return;
    this.session = await tokenRequest(this.config, 'refresh_token', { refresh_token: this.session.refreshToken });
    await this.saveSession(this.session);
  }

  headers(extra = {}) {
    return {
      apikey: this.config.anonKey,
      Authorization: `Bearer ${this.session.accessToken}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  async request(path, init = {}) {
    let res;
    try {
      res = await fetch(`${this.config.url}${path}`, { ...init, headers: this.headers(init.headers) });
    } catch (err) {
      throw new SyncError('No connection to the sync server.', 'network');
    }
    if (res.status === 401 || res.status === 403) throw new SyncError('Sign in again in Settings.', 'auth');
    if (!res.ok) throw new SyncError(`The sync server answered ${res.status}. ${(await res.text()).slice(0, 200)}`, 'server');
    return res;
  }

  /** Stores ops. Repeats are ignored by the server (op_id is the key), so a retry never doubles a change. */
  async push(ops) {
    const body = ops.map((op) => ({
      op_id: op.opId,
      device_id: op.stamp.split('.').slice(2).join('.'),
      stamp: op.stamp,
      store: op.store,
      op: op.op,
      key: op.key,
      record: op.record ?? null,
    }));
    await this.request('/rest/v1/ops?on_conflict=op_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(body),
    });
    return ops.map((op) => op.opId);
  }

  /** Ops after the server cursor, oldest first. The cursor is the seq of the last op returned. */
  async pull(cursor, limit) {
    const res = await this.request(`/rest/v1/ops?select=seq,op_id,stamp,store,op,key,record&seq=gt.${cursor}&order=seq.asc&limit=${limit}`);
    const rows = await res.json();
    return {
      ops: rows.map((row) => ({ opId: row.op_id, stamp: row.stamp, store: row.store, op: row.op, key: row.key, record: row.record ?? undefined })),
      cursor: rows.length ? Number(rows[rows.length - 1].seq) : cursor,
    };
  }

  async latestSnapshot() {
    const res = await this.request('/rest/v1/snapshots?select=snapshot_id,cursor&store=eq._meta&order=created_at.desc&limit=1');
    const [row] = await res.json();
    return row ? { id: row.snapshot_id, cursor: Number(row.cursor) } : null;
  }

  async readSnapshot(id, store, part) {
    const res = await this.request(`/rest/v1/snapshots?select=rows&snapshot_id=eq.${id}&store=eq.${store}&part=eq.${part}`);
    const [row] = await res.json();
    return row?.rows ?? [];
  }

  async writeSnapshot(id, cursor, store, part, rows) {
    await this.request('/rest/v1/snapshots', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ snapshot_id: id, cursor, store, part, rows }]),
    });
  }

  /** The marker row is written last. A snapshot without it is ignored, so a half-uploaded one is never used. */
  async completeSnapshot(id, cursor) {
    await this.writeSnapshot(id, cursor, '_meta', 0, { complete: true });
  }
}
