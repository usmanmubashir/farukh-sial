// Sync engine. Sends the outbox to the server, applies other devices' changes, and keeps the status the header shows.
// The server is behind an adapter, so the engine does not know which one it is talking to (docs/SYNC.md):
//   auth()                                → resolves when the adapter can send; refreshes the token when needed
//   push(ops)                             → resolves with the opIds the server holds (a repeat counts as held)
//   pull(cursor, limit)                   → { ops, cursor }: ops after the server cursor, in server order
//   latestSnapshot()                      → { id, cursor } of the newest complete snapshot, or null
//   readSnapshot(id, store, part)         → rows of one part of a snapshot ([] when there are no more)
//   writeSnapshot(id, cursor, store, part, rows) and completeSnapshot(id, cursor) → how a device publishes one
// The engine never blocks the UI: it runs in the background, retries with backoff, and sends a batch only when it is online.
import * as db from './db.js';
import { SYNCED_STORES } from './db.js';
import { emit, on } from './events.js';
import { set as setState } from './store.js';
import * as replication from '../services/replication.js';
import { rebuildRollups } from '../services/rollups.js';
import { SupabaseAdapter, signIn, SyncError } from './sync-supabase.js';
import { CloudflareAdapter, signInCloudflare } from './sync-cloudflare.js';
import { syncServer } from './config.js';

const PUSH_BATCH = 200;
const PULL_PAGE = 500;
const SNAPSHOT_CHUNK = 300;
/** A device publishes a snapshot once the server has this many ops beyond the last snapshot. */
const SNAPSHOT_AFTER_OPS = 2000;
const WRITE_DEBOUNCE_MS = 3000;
const PERIODIC_MS = 15000;
const MAX_BACKOFF_MS = 5 * 60000;
const MAX_ISSUES = 50;

let adapter = null;
let inFlight = null;
let again = false;
let attempts = 0;
let retryTimer = null;
let writeTimer = null;
const status = {
  state: 'idle', // 'idle' | 'syncing' | 'error' | 'auth' (sign in again)
  pending: 0,
  lastSyncAt: null,
  lastError: null,
  issues: [],
};

export const syncActive = () => adapter !== null;

/** Plugs in a server adapter (see the contract at the top). Pass null to go back to local-only. */
export function setAdapter(next) {
  adapter = next ?? null;
}

/** What the header and the sync sheet show. */
export function getStatus() {
  return { ...status, configured: syncActive(), online: navigator.onLine };
}

function setStatus(patch) {
  Object.assign(status, patch);
  setState('syncPending', status.pending);
  emit('sync:status', getStatus());
}

export async function refreshPending() {
  const pending = await db.count('outbox', { index: 'status', query: 'pending' });
  if (pending !== status.pending) setStatus({ pending });
  return pending;
}

/* ---------- Connection settings (device-local, never in backups) ---------- */

export const getConfig = () => db.getSetting('syncConfig', null);

/**
 * Signs the device in to the sync server, stores the settings and the session on this device, and syncs.
 * backend: 'cloudflare' (Worker address and username) or 'supabase' (address, anon key and email; the default).
 * The password is used once and never stored. Only the refresh token is kept.
 * upload: send the records already on this device. True when this device starts the pharmacy's data; false when it
 * joins an existing pharmacy, so an empty device adds nothing.
 */
export async function connect({ backend = 'supabase', url, anonKey, email, username, password, upload = true }) {
  const base = String(url || syncServer()).trim().replace(/\/+$/, '');
  let config;
  let session;
  if (backend === 'cloudflare') {
    config = { backend, url: base, username: String(username).trim().toLowerCase() };
    session = await signInCloudflare(config, password);
    config.pharmacyName = session.pharmacyName ?? '';
  } else {
    config = { backend: 'supabase', url: base, anonKey: String(anonKey).trim(), email: String(email).trim() };
    session = await signIn(config, config.email, password);
  }
  await db.transaction((ctx) => {
    ctx.put('settings', { key: 'syncConfig', value: config });
    ctx.put('settings', { key: 'syncSession', value: session });
  });
  useAdapter(config, session);
  if (upload) await queueExisting();
  return syncNow();
}

/** Joins an existing pharmacy from an empty device: the same sign-in, no upload, then the first pull. */
export const joinPharmacy = (options) => connect({ ...options, upload: false });

/**
 * Queues every business row on this device, so records made before the first connect reach the server.
 * A row without a stamp gets one (a put stamps and queues it). A row that already has a stamp keeps it as its op id,
 * so queuing it twice is harmless: the server ignores a repeat.
 */
export async function queueExisting() {
  const CHUNK = 500;
  for (const store of SYNCED_STORES) {
    const rows = await db.getAll(store);
    for (let from = 0; from < rows.length; from += CHUNK) {
      await db.transaction((ctx) => {
        for (const row of rows.slice(from, from + CHUNK)) {
          if (!row.stamp) {
            ctx.put(store, row);
            continue;
          }
          ctx.queue(store, row);
        }
      });
    }
  }
}

/** Forgets the server and the session on this device. Changes already in the outbox stay there. */
export async function disconnect() {
  adapter = null;
  await db.transaction((ctx) => {
    ctx.remove('settings', 'syncConfig');
    ctx.remove('settings', 'syncSession');
  });
  setStatus({ state: 'idle', lastError: null });
}

function useAdapter(config, session) {
  const save = (next) => db.setSetting('syncSession', next);
  adapter = config.backend === 'cloudflare' ? new CloudflareAdapter(config, session, save) : new SupabaseAdapter(config, session, save);
}

/* ---------- Running a sync ---------- */

/** Runs one sync. Concurrent calls share the run, and a call made during a run starts another one afterwards. */
export function syncNow() {
  if (!adapter) return Promise.resolve(null);
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = run().finally(() => {
    inFlight = null;
    if (again) {
      again = false;
      syncNow();
    }
  });
  return inFlight;
}

async function run() {
  if (!navigator.onLine) {
    setStatus({ state: 'idle' });
    return null;
  }
  setStatus({ state: 'syncing' });
  try {
    await adapter.auth();
    await pushAll();
    await pullAll();
    await publishSnapshot();
    attempts = 0;
    setStatus({ state: 'idle', lastSyncAt: new Date().toISOString(), lastError: null, pending: await refreshPending() });
    return getStatus();
  } catch (err) {
    console.warn('[sync] run failed', err);
    if (err instanceof SyncError && err.code === 'auth') {
      setStatus({ state: 'auth', lastError: err.message, pending: await refreshPending() });
      return null;
    }
    attempts += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 9));
    clearTimeout(retryTimer);
    retryTimer = setTimeout(syncNow, delay);
    setStatus({ state: 'error', lastError: err?.message ?? String(err), pending: await refreshPending() });
    return null;
  }
}

/** Sends the outbox in batches. An entry leaves the outbox only after the server has confirmed it. */
async function pushAll() {
  for (;;) {
    const rows = await db.getAll('outbox', { index: 'status', query: 'pending', limit: PUSH_BATCH });
    if (!rows.length) return;
    const ops = rows.map((row) => ({ opId: row.opId, stamp: row.stamp, store: row.store, op: row.op, key: row.key, record: row.record }));
    const held = new Set(await adapter.push(ops));
    if (!rows.every((row) => held.has(row.opId))) throw new Error('The server did not confirm every change. Will retry.');
    await db.transaction((ctx) => {
      for (const row of rows) ctx.remove('outbox', row.seq);
    });
  }
}

const savedCursor = async () => (await db.get('syncState', 'cursor'))?.value ?? null;

/** Applies a page of ops and stores the new cursor in the same transaction, so a crash never skips a change. */
async function applyPage(ops, cursor) {
  for (const op of ops) db.observe(op.stamp);
  const result = await db.replicate(async (ctx) => {
    const merged = await replication.applyOps(ctx, ops);
    merged.issues.push(...(await replication.recalcBatches(ctx, merged.batches)));
    if (cursor !== null) ctx.put('syncState', { key: 'cursor', value: cursor });
    return merged;
  });
  noteIssues(result.issues);
  return result;
}

const SALES_LEDGER = ['sales', 'saleItems', 'returns', 'returnItems', 'ledgerEntries', 'practices', 'practiceVoids'];
const needsRollups = (touched) => SALES_LEDGER.some((store) => touched.has(store));

function noteIssues(issues) {
  if (!issues.length) return;
  setStatus({ issues: [...status.issues, ...issues].slice(-MAX_ISSUES) });
}

async function pullAll() {
  let cursor = await savedCursor();
  if (cursor === null) {
    await loadSnapshot();
    cursor = await savedCursor();
  }
  let rebuild = false;
  for (;;) {
    const page = await adapter.pull(cursor, PULL_PAGE);
    if (!page.ops.length) break;
    const result = await applyPage(page.ops, page.cursor);
    rebuild = rebuild || needsRollups(result.touched);
    cursor = page.cursor;
    if (page.ops.length < PULL_PAGE) break;
  }
  if (rebuild) await rebuildRollups();
}

/** First sync on a device: loads the newest snapshot, so the device does not replay the whole history. */
async function loadSnapshot() {
  const latest = await adapter.latestSnapshot();
  let rebuild = false;
  if (latest) {
    for (const store of [...SYNCED_STORES, 'tombstones']) {
      for (let part = 0; ; part += 1) {
        const rows = await adapter.readSnapshot(latest.id, store, part);
        if (!rows.length) break;
        const result = await applyPage(replication.snapshotOps(store, rows), null);
        rebuild = rebuild || needsRollups(result.touched);
      }
    }
  }
  await db.transaction((ctx) => ctx.put('syncState', { key: 'cursor', value: latest?.cursor ?? 0 }));
  if (rebuild) await rebuildRollups();
}

/**
 * Publishes a snapshot when the server has moved far ahead of the last one (or when forced). Only with an empty outbox.
 * Returns true when a snapshot was published.
 */
export async function publishSnapshot({ force = false } = {}) {
  // Some servers keep no snapshots (the Cloudflare one): a device then replays the op log from the start.
  if (!adapter || adapter.snapshots === false) return false;
  const cursor = (await savedCursor()) ?? 0;
  const latest = await adapter.latestSnapshot();
  if (!force && cursor - (latest?.cursor ?? 0) < SNAPSHOT_AFTER_OPS) return false;
  if (await refreshPending()) return false;
  const id = db.newId();
  const stores = await replication.snapshotStores();
  for (const [store, rows] of Object.entries(stores)) {
    for (let part = 0, from = 0; from < rows.length; part += 1, from += SNAPSHOT_CHUNK) {
      await adapter.writeSnapshot(id, cursor, store, part, rows.slice(from, from + SNAPSHOT_CHUNK));
    }
  }
  await adapter.completeSnapshot(id, cursor);
  return true;
}

/* ---------- Triggers ---------- */

let writeDebounce = null;

/** After a local change: wait a few seconds for more, then send. Also ask the service worker for a Background Sync. */
function scheduleAfterWrite() {
  clearTimeout(writeDebounce);
  writeDebounce = setTimeout(syncNow, WRITE_DEBOUNCE_MS);
  navigator.serviceWorker?.ready
    .then((registration) => registration.sync?.register('shifa-sync'))
    .catch(() => {});
}

/** Wires the engine to the app. Call once at boot. Starts a sync if a server is configured. */
export async function init() {
  const config = await getConfig();
  const session = await db.getSetting('syncSession', null);
  if (config && session) useAdapter(config, session);
  await refreshPending();

  on('data:changed', ({ stores }) => {
    refreshPending();
    if (adapter && stores.some((store) => SYNCED_STORES.includes(store))) scheduleAfterWrite();
  });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => emit('sync:status', getStatus()));
  setInterval(() => {
    if (adapter && navigator.onLine) syncNow();
  }, PERIODIC_MS);
  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.type === 'sync-now') syncNow();
  });
  if (adapter) syncNow();
}
