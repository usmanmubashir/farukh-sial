// IndexedDB layer. The only module that talks to IndexedDB directly.
// Writes go through transaction(), which queues synced rows in the outbox inside the same transaction.
import { emit } from './events.js';

const DB_NAME = 'shifa-pos';

/** Business rows: every write is also queued in the outbox for sync. */
export const SYNCED_STORES = [
  'products', 'batches', 'stockMovements', 'customers', 'suppliers',
  'sales', 'saleItems', 'purchases', 'purchaseItems', 'returns', 'returnItems',
  'accounts', 'ledgerEntries', 'vouchers', 'demandList',
];

/** Device-local stores. Never synced: passwords (users) and sessions stay on this device. */
export const LOCAL_STORES = ['settings', 'counters', 'outbox', 'syncState', 'users'];

const ALL_STORES = [...SYNCED_STORES, ...LOCAL_STORES];

/** Primary key field per store. Everything else uses "id". */
const KEY_FIELD = { settings: 'key', counters: 'key', syncState: 'key', outbox: 'seq' };

/**
 * Schema migrations. migrations[n] upgrades the database from version n to n + 1.
 * Never edit a shipped migration. Append a new one instead.
 */
const migrations = [
  // v1: initial schema.
  (db) => {
    const products = db.createObjectStore('products', { keyPath: 'id' });
    products.createIndex('name', 'nameKey');
    products.createIndex('generic', 'genericKey');
    products.createIndex('company', 'companyKey');
    products.createIndex('barcode', 'barcode');
    products.createIndex('code', 'code');

    const batches = db.createObjectStore('batches', { keyPath: 'id' });
    batches.createIndex('productId', 'productId');
    batches.createIndex('productExpiry', ['productId', 'expiry']);

    const movements = db.createObjectStore('stockMovements', { keyPath: 'id' });
    movements.createIndex('batchId', 'batchId');
    movements.createIndex('productId', 'productId');
    movements.createIndex('date', 'date');

    const customers = db.createObjectStore('customers', { keyPath: 'id' });
    customers.createIndex('name', 'nameKey');
    customers.createIndex('phone', 'phone');

    const suppliers = db.createObjectStore('suppliers', { keyPath: 'id' });
    suppliers.createIndex('name', 'nameKey');
    suppliers.createIndex('phone', 'phone');

    const sales = db.createObjectStore('sales', { keyPath: 'id' });
    sales.createIndex('date', 'date');
    sales.createIndex('customerDate', ['customerId', 'date']);
    sales.createIndex('number', 'number', { unique: true });

    const saleItems = db.createObjectStore('saleItems', { keyPath: 'id' });
    saleItems.createIndex('saleId', 'saleId');
    saleItems.createIndex('productId', 'productId');

    const purchases = db.createObjectStore('purchases', { keyPath: 'id' });
    purchases.createIndex('date', 'date');
    purchases.createIndex('supplierDate', ['supplierId', 'date']);
    purchases.createIndex('number', 'number', { unique: true });

    const purchaseItems = db.createObjectStore('purchaseItems', { keyPath: 'id' });
    purchaseItems.createIndex('purchaseId', 'purchaseId');
    purchaseItems.createIndex('productId', 'productId');

    const returns = db.createObjectStore('returns', { keyPath: 'id' });
    returns.createIndex('date', 'date');
    returns.createIndex('typeDate', ['type', 'date']);
    returns.createIndex('number', 'number', { unique: true });

    const returnItems = db.createObjectStore('returnItems', { keyPath: 'id' });
    returnItems.createIndex('returnId', 'returnId');
    returnItems.createIndex('productId', 'productId');

    const accounts = db.createObjectStore('accounts', { keyPath: 'id' });
    accounts.createIndex('code', 'code', { unique: true });

    const ledger = db.createObjectStore('ledgerEntries', { keyPath: 'id' });
    ledger.createIndex('accountDate', ['accountId', 'date']);
    ledger.createIndex('date', 'date');
    ledger.createIndex('doc', ['docType', 'docId']);

    const vouchers = db.createObjectStore('vouchers', { keyPath: 'id' });
    vouchers.createIndex('date', 'date');
    vouchers.createIndex('number', 'number', { unique: true });

    const demand = db.createObjectStore('demandList', { keyPath: 'id' });
    demand.createIndex('productId', 'productId');
    demand.createIndex('status', 'status');

    db.createObjectStore('settings', { keyPath: 'key' });
    db.createObjectStore('counters', { keyPath: 'key' });
    db.createObjectStore('syncState', { keyPath: 'key' });

    const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    outbox.createIndex('status', 'status');

    const users = db.createObjectStore('users', { keyPath: 'id' });
    users.createIndex('username', 'username', { unique: true });
  },
];

export const DB_VERSION = migrations.length;

let dbPromise = null;

/** Opens (and upgrades) the database once per page. */
export function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('IndexedDB is not available in this browser'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        for (let v = event.oldVersion; v < DB_VERSION; v += 1) {
          migrations[v](request.result, request.transaction);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => console.warn('[db] upgrade is waiting for other tabs to close');
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readAll(store, { index, query, limit } = {}) {
  const source = index ? store.index(index) : store;
  return source.getAll(query, limit);
}

/* ---------- Reads (own read-only transaction each) ---------- */

export async function get(store, key) {
  const db = await open();
  return request(db.transaction(store, 'readonly').objectStore(store).get(key));
}

export async function getAll(store, options) {
  const db = await open();
  return request(readAll(db.transaction(store, 'readonly').objectStore(store), options));
}

export async function count(store, { index, query } = {}) {
  const db = await open();
  const objectStore = db.transaction(store, 'readonly').objectStore(store);
  return request((index ? objectStore.index(index) : objectStore).count(query));
}

export async function getSetting(key, fallback) {
  const row = await get('settings', key);
  return row ? row.value : fallback;
}

/* ---------- Writes ---------- */

/** Records a synced change in the outbox. Called inside the same transaction as the write. */
function enqueue(tx, entry) {
  tx.objectStore('outbox').add({ ...entry, status: 'pending', createdAt: new Date().toISOString(), attempts: 0 });
}

function createContext(tx) {
  const touched = new Set();
  const ctx = { error: null };

  ctx.get = (store, key) => request(tx.objectStore(store).get(key));
  ctx.getAll = (store, options) => request(readAll(tx.objectStore(store), options));

  ctx.put = (store, record) => {
    const field = KEY_FIELD[store] ?? 'id';
    const row = { ...record, updatedAt: new Date().toISOString() };
    if (row[field] === undefined) {
      if (field !== 'id') throw new TypeError(`"${store}" rows need a "${field}" value`);
      row.id = newId();
    }
    tx.objectStore(store).put(row);
    touched.add(store);
    if (SYNCED_STORES.includes(store)) enqueue(tx, { store, op: 'put', key: row.id, record: row });
    return row;
  };

  ctx.remove = (store, key) => {
    tx.objectStore(store).delete(key);
    touched.add(store);
    if (SYNCED_STORES.includes(store)) enqueue(tx, { store, op: 'delete', key });
  };

  /** Atomic sequence per counter name, e.g. nextNumber('SALE') → 1, 2, 3... */
  ctx.nextNumber = async (name) => {
    const store = tx.objectStore('counters');
    const row = await request(store.get(name));
    const value = (row?.value ?? 0) + 1;
    store.put({ key: name, value });
    touched.add('counters');
    return value;
  };

  ctx.touched = touched;
  return ctx;
}

/**
 * The single write path. `work(ctx)` runs inside one readwrite transaction.
 * Inside `work` only await IndexedDB requests (ctx.get, ctx.getAll, ctx.nextNumber).
 * Throwing from `work` aborts everything, including outbox entries.
 * Resolves with work's return value after the commit.
 */
export function transaction(work) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(ALL_STORES, 'readwrite');
        const ctx = createContext(tx);

        const committed = new Promise((done, fail) => {
          tx.oncomplete = () => done();
          tx.onabort = () => fail(ctx.error ?? tx.error ?? new Error('IndexedDB transaction aborted'));
        });

        const finished = Promise.resolve().then(() => work(ctx));
        finished.catch((err) => {
          ctx.error = err;
          try {
            tx.abort();
          } catch {
            /* already finished */
          }
        });

        Promise.all([finished, committed]).then(
          ([result]) => {
            if (ctx.touched.size) emit('data:changed', { stores: [...ctx.touched] });
            resolve(result);
          },
          reject,
        );
      }),
  );
}

export function setSetting(key, value) {
  return transaction((ctx) => {
    ctx.put('settings', { key, value });
  });
}

export function removeSetting(key) {
  return transaction((ctx) => {
    ctx.remove('settings', key);
  });
}

/** RFC 4122 v4 id. Falls back when crypto.randomUUID is missing (plain http on a LAN). */
export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
