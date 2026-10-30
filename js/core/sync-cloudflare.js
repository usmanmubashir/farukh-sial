// Cloudflare adapter for the sync engine (worker/ holds the server). Plain fetch, no SDK.
// The Worker address and the pharmacy username are kept on this device. The password is used on the device to
// derive the same PBKDF2 hash the app stores, and only that proof is sent. The password itself never leaves the device.
// Snapshots are not used with this server: a device that joins replays the op log from the start.
import { SyncError } from './sync-supabase.js';

const PBKDF2_ITERATIONS = 310000;
const REFRESH_MARGIN_MS = 60000;
const enc = new TextEncoder();

/** The proof sent to the server: PBKDF2-SHA256 of the password with the account's salt, base64. */
export async function passwordProof(password, saltB64, iterations = PBKDF2_ITERATIONS) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function send(config, path, init = {}) {
  let res;
  try {
    res = await fetch(`${config.url}${path}`, init);
  } catch (err) {
    throw new SyncError('No connection to the sync server.', 'network');
  }
  return res;
}

const readJson = async (res) => res.json().catch(() => ({}));

function sessionFrom(body, res) {
  if (!res.ok || !body.access_token) {
    const code = res.status === 400 || res.status === 401 || res.status === 403 ? 'auth' : 'sync';
    throw new SyncError(code === 'auth' ? 'The sync sign-in was refused. Check the username and password.' : `Sign-in failed (${res.status}).`, code);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    // Sign-in also tells the device the pharmacy's name, so a joining device needs no name typed in.
    pharmacyName: body.pharmacy_name ?? '',
  };
}

/**
 * Signs a device in to the pharmacy's server: fetches the account's salt, derives the proof, and asks for tokens.
 * config: { url, username }. Returns the session to keep on this device.
 */
export async function signInCloudflare(config, password) {
  const saltRes = await send(config, `/auth/salt?username=${encodeURIComponent(config.username)}`);
  if (saltRes.status === 404) throw new SyncError('That username is not on this sync server.', 'auth');
  if (!saltRes.ok) throw new SyncError(`The sync server answered ${saltRes.status}.`, 'server');
  const { salt, iterations } = await readJson(saltRes);
  const proof = await passwordProof(password, salt, iterations);
  const res = await send(config, '/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.username, proof }),
  });
  return sessionFrom(await readJson(res), res);
}

export class CloudflareAdapter {
  /** config: { url, username }. session: { accessToken, refreshToken, expiresAt }. saveSession keeps a renewed session. */
  constructor(config, session, saveSession) {
    this.name = 'cloudflare';
    this.snapshots = false;
    this.config = config;
    this.session = session;
    this.saveSession = saveSession;
  }

  /** Renews the access token when it is close to expiring. The refresh token is used once and replaced. */
  async auth() {
    if (this.session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return;
    const res = await send(this.config, '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.session.refreshToken }),
    });
    this.session = sessionFrom(await readJson(res), res);
    await this.saveSession(this.session);
  }

  async request(path, init = {}) {
    const res = await send(this.config, path, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.session.accessToken}`, 'Content-Type': 'application/json' },
    });
    if (res.status === 401) throw new SyncError('Sign in again in Settings.', 'auth');
    if (!res.ok) throw new SyncError(`The sync server answered ${res.status}.`, 'server');
    return res;
  }

  /** Stores ops on the server. A repeated op is ignored there, so a retry never doubles a change. */
  async push(ops) {
    const body = ops.map((op) => ({ opId: op.opId, stamp: op.stamp, store: op.store, op: op.op, key: op.key, record: op.record ?? null }));
    const res = await this.request('/ops', { method: 'POST', body: JSON.stringify({ ops: body }) });
    const { held = [] } = await readJson(res);
    return held;
  }

  /** Ops after the server cursor, oldest first. The cursor is the seq of the last op returned. */
  async pull(cursor, limit) {
    const res = await this.request(`/ops?after=${cursor}&limit=${limit}`);
    const { ops = [], cursor: next = cursor } = await readJson(res);
    return {
      ops: ops.map((row) => ({ opId: row.opId, stamp: row.stamp, store: row.store, op: row.op, key: row.key, record: row.record ?? undefined })),
      cursor: Number(next),
    };
  }

  // Snapshots are off for this server (snapshots === false): the engine never calls these.
  async latestSnapshot() {
    return null;
  }

  async readSnapshot() {
    return [];
  }

  async writeSnapshot() {}

  async completeSnapshot() {}
}
