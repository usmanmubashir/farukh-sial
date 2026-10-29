// Outbox sync. Synced writes are queued in the outbox inside the same transaction (db.js).
// flush() hands pending rows to the active adapter and removes the ones it acknowledges.
//
// Adapter contract: { name, push(rows) → Promise<number[]> } where the array holds the acknowledged outbox seq values.
// The default is offline (nothing is sent). A Supabase REST adapter comes in a later milestone.
import * as db from './db.js';
import { SYNCED_STORES } from './db.js';
import { emit, on } from './events.js';
import { set as setState } from './store.js';

export const offlineAdapter = {
  name: 'offline',
  async push() {
    return [];
  },
};

let adapter = offlineAdapter;
let timer = null;
let inFlight = null;

export function useAdapter(next) {
  adapter = next ?? offlineAdapter;
}

/** True when a real sync server is configured. With only the offline adapter nothing is ever sent. */
export const syncActive = () => adapter !== offlineAdapter;

export async function refreshPending() {
  const pending = await db.count('outbox', { index: 'status', query: 'pending' });
  setState('syncPending', pending);
  return pending;
}

/** Sends pending rows through the adapter. Concurrent calls share one run. Resolves with the number of rows acknowledged. */
export function flush() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (adapter === offlineAdapter || !navigator.onLine) return 0;
    const rows = await db.getAll('outbox', { index: 'status', query: 'pending', limit: 200 });
    if (!rows.length) return 0;
    const acked = await adapter.push(rows);
    if (acked.length) {
      await db.transaction((ctx) => {
        for (const seq of acked) ctx.remove('outbox', seq);
      });
    }
    return acked.length;
  })()
    .catch((err) => {
      console.warn('[sync] flush failed, will retry', err);
      return 0;
    })
    .finally(() => {
      inFlight = null;
      emit('sync:flushed');
      refreshPending();
    });
  return inFlight;
}

function scheduleFlush() {
  clearTimeout(timer);
  timer = setTimeout(flush, 1500);
}

/** Wires the outbox to data changes and to reconnection. Call once at boot. */
export function init() {
  on('data:changed', ({ stores }) => {
    refreshPending();
    if (stores.some((store) => SYNCED_STORES.includes(store))) scheduleFlush();
  });
  window.addEventListener('online', () => flush());
  refreshPending();
}
