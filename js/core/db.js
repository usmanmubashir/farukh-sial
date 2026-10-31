// IndexedDB layer. The only module that talks to IndexedDB directly.
// Writes go through transaction(), which queues synced rows in the outbox inside the same transaction.
// Changes that arrive from another device go through replicate(): they are stored as they are, without
// a new stamp and without going back into the outbox.
import { emit } from './events.js';

const DEFAULT_DB_NAME = 'shifa-pos';
let dbName = DEFAULT_DB_NAME;

/** Business rows: every write is also queued in the outbox for sync. */
export const SYNCED_STORES = [
  'products', 'batches', 'stockMovements', 'customers', 'suppliers',
  'sales', 'saleItems', 'purchases', 'purchaseItems', 'returns', 'returnItems',
  'accounts', 'ledgerEntries', 'vouchers', 'demandList', 'rxRegister',
  // Practice (schema 6): immutable documents, append-only voids, kits.
  'practices', 'practiceItems', 'practiceVoids', 'practiceKits',
  // Staff and owner sign-in records (hash and salt only). They sync so every device of the pharmacy can sign in.
  'users',
];

/**
 * Device-local stores. Never synced: passwords (users) and sessions stay on this device.
 * tombstones is sync state: one row per deleted synced row, so an older copy arriving later cannot bring it back.
 * It is included in backups and snapshots.
 */
export const LOCAL_STORES = ['settings', 'counters', 'outbox', 'syncState', 'dailySales', 'dailyProducts', 'dailyLedger', 'dailyPractice', 'tombstones', 'errorLog', 'shifts', 'shiftMovements'];

const ALL_STORES = [...SYNCED_STORES, ...LOCAL_STORES];

/** Primary key field per store. Everything else uses "id". */
const KEY_FIELD = {
  settings: 'key', counters: 'key', syncState: 'key', outbox: 'seq',
  dailySales: 'date', dailyProducts: 'key', dailyLedger: 'key', dailyPractice: 'date',
};

/** The primary key of a row in a store (the field KEY_FIELD names, or "id"). */
export const keyOf = (store, row) => row[KEY_FIELD[store] ?? 'id'];

/** Synced stores as they were at schema version 4. Used only by the version 4 migration. */
const SYNCED_STORES_V4 = [
  'products', 'batches', 'stockMovements', 'customers', 'suppliers',
  'sales', 'saleItems', 'purchases', 'purchaseItems', 'returns', 'returnItems',
  'accounts', 'ledgerEntries', 'vouchers', 'demandList', 'rxRegister',
];

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
  // v2: Rx and controlled dispensing register (written by sales, read by the Rx register screen).
  (db) => {
    const rx = db.createObjectStore('rxRegister', { keyPath: 'id' });
    rx.createIndex('saleId', 'saleId');
    rx.createIndex('date', 'date');
    rx.createIndex('productId', 'productId');
  },
  // v3: daily rollups for reports (local, derived, rebuilt from the source rows when missing).
  // dailySales: one row per day. dailyProducts: one row per day and medicine. dailyLedger: cash account per day and kind.
  (db) => {
    db.createObjectStore('dailySales', { keyPath: 'date' });
    const products = db.createObjectStore('dailyProducts', { keyPath: 'key' });
    products.createIndex('date', 'date');
    const ledger = db.createObjectStore('dailyLedger', { keyPath: 'key' });
    ledger.createIndex('account', 'accountCode');
  },
  // v4: sync. Every synced row carries a stamp (its last change); deletes leave a tombstone with the stamp of the delete.
  // Rows and outbox entries written before this version get stamps from their own times, so they order correctly.
  (db, tx) => {
    db.createObjectStore('tombstones', { keyPath: 'id' });
    // The stores that existed at version 4. Frozen here: a migration must not read today's list, which grows.
    for (const name of SYNCED_STORES_V4) {
      stampExisting(tx.objectStore(name), (row) => ({ stamp: legacyStamp(row.updatedAt, 0) }));
    }
    stampExisting(tx.objectStore('outbox'), (row) => ({ opId: legacyStamp(row.createdAt, row.seq), stamp: legacyStamp(row.createdAt, row.seq) }));
  },
  // v5: local error log (written by the error boundary, never synced, never in backups).
  (db) => {
    const log = db.createObjectStore('errorLog', { keyPath: 'id' });
    log.createIndex('at', 'at');
  },
  // v6: Practice. Medicine given to a patient at the owner's own charge, kept apart from sales.
  // practices: one immutable document per practice. practiceItems: one row per batch allocation.
  // practiceVoids: append-only void events (at most one per practice, enforced by the unique index).
  // practiceKits: saved item sets. dailyPractice: local daily rollup, rebuilt from practices and voids.
  (db) => {
    const practices = db.createObjectStore('practices', { keyPath: 'id' });
    practices.createIndex('number', 'number', { unique: true });
    practices.createIndex('date', 'date');
    const items = db.createObjectStore('practiceItems', { keyPath: 'id' });
    items.createIndex('practiceId', 'practiceId');
    items.createIndex('productId', 'productId');
    items.createIndex('batchId', 'batchId');
    const voids = db.createObjectStore('practiceVoids', { keyPath: 'id' });
    voids.createIndex('practiceId', 'practiceId', { unique: true });
    const kits = db.createObjectStore('practiceKits', { keyPath: 'id' });
    kits.createIndex('name', 'nameKey');
    db.createObjectStore('dailyPractice', { keyPath: 'date' });
  },
  // v7: Shifts (cash drawer). shifts: one row per shift on this device. shiftMovements: cash moved during a shift.
  // ledgerEntries gets a shiftId index, so one shift's cash can be read directly.
  (db, transaction) => {
    const shifts = db.createObjectStore('shifts', { keyPath: 'id' });
    shifts.createIndex('status', 'status');
    shifts.createIndex('openedAt', 'openedAt');
    const movements = db.createObjectStore('shiftMovements', { keyPath: 'id' });
    movements.createIndex('shiftId', 'shiftId');
    transaction.objectStore('ledgerEntries').createIndex('shiftId', 'shiftId');
  },
];

/** The migration list, exported so the upgrade path can be tested from v1 (tests/migration.html). */
export const MIGRATIONS = migrations;

/** Thrown when the browser refuses a write because the device is out of storage. */
export class StorageFullError extends Error {
  constructor() {
    super('Storage is full');
    this.name = 'StorageFullError';
    this.code = 'storageFull';
  }
}

/** Stamp for a change made before stamps existed: its own time, then its position, device 'legacy'. */
function legacyStamp(iso, position) {
  const wall = Date.parse(iso) || 0;
  return `${String(wall).padStart(15, '0')}.${String(position).padStart(6, '0')}.legacy`;
}

/** Adds the fields from fields(row) to every row of the store that lacks a stamp. Runs inside the upgrade. */
function stampExisting(store, fields) {
  store.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (!cursor) return;
    const row = cursor.value;
    if (!row.stamp) cursor.update({ ...row, ...fields({ ...row, seq: cursor.primaryKey }) });
    cursor.continue();
  };
}

export const DB_VERSION = migrations.length;

let dbPromise = null;

/** Test hook: point the layer at another database. Must run before the first open(). */
export function useDatabase(name) {
  if (dbPromise) throw new Error('useDatabase() must run before the database is opened');
  dbName = name;
}

/** Every store name the app keeps (synced and device-local). */
export const storeNames = () => [...ALL_STORES];

/**
 * Replaces the rows of the given stores in one transaction, for a restore. rows: { storeName: [row, …] }.
 * Stores not named are left alone. The settings rows named in keepSettings stay as they are on this device
 * (device identity, session, last backup time). Writes bypass the outbox: a restore is not a change to sync.
 * Either every store is replaced or none is.
 */
export async function replaceStores(rows, { keepSettings = [] } = {}) {
  const db = await open();
  const kept = await Promise.all(keepSettings.map((key) => request(db.transaction('settings', 'readonly').objectStore('settings').get(key))));
  const names = Object.keys(rows);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    for (const name of names) {
      const store = tx.objectStore(name);
      store.clear();
      const list = name === 'settings'
        ? [...rows.settings.filter((row) => !keepSettings.includes(row.key)), ...kept.filter(Boolean)]
        : rows[name];
      for (const row of list) store.put(row);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('restore aborted'));
  });
}

/** Empties the named stores in one transaction. Used to rebuild derived data (the report rollups). */
export async function clearStores(names) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    for (const name of names) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Closes the connection and deletes the database. Test hook for clean runs. */
export async function destroyDatabase() {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
    dbPromise = null;
  }
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/** Opens (and upgrades) the database once per page. */
export function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('IndexedDB is not available in this browser'));
        return;
      }
      const request = indexedDB.open(dbName, DB_VERSION);
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

/**
 * Streams rows through a cursor, calling fn(row) for each one in key order. Memory stays small on big stores.
 * fn must be synchronous: the read transaction closes as soon as the cursor is waiting for a callback to finish.
 * Use it for reports over tens of thousands of rows, with the index and key range doing the filtering.
 */
export async function each(store, { index, query, direction = 'next' } = {}, fn) {
  const db = await open();
  const source = db.transaction(store, 'readonly').objectStore(store);
  const cursorSource = index ? source.index(index) : source;
  return new Promise((resolve, reject) => {
    const req = cursorSource.openCursor(query ?? null, direction);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      fn(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
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

/* ---------- Sync clock (hybrid logical clock) ---------- */
// A stamp orders every change: wall-clock milliseconds, a counter for changes in the same millisecond, then the
// device id as the final tie-break. Stamps are fixed-width, so comparing two of them as strings gives their order.

const clock = { wall: 0, counter: 0, device: 'device' };

/** Sets the id that ends every stamp from this device. Called as soon as the device id is known. */
export function setDeviceId(id) {
  clock.device = id;
}

/** A new stamp for a local change. Each one is larger than every stamp this device has made or seen. */
export function stamp() {
  const now = Date.now();
  if (now > clock.wall) {
    clock.wall = now;
    clock.counter = 0;
  } else {
    clock.counter += 1;
  }
  return `${String(clock.wall).padStart(15, '0')}.${String(clock.counter).padStart(6, '0')}.${clock.device}`;
}

/** Moves the clock past a stamp received from another device, so the next local change sorts after it. */
export function observe(remote) {
  const [wallText, counterText] = String(remote).split('.');
  const remoteWall = Number(wallText) || 0;
  const remoteCounter = Number(counterText) || 0;
  const wall = Math.max(clock.wall, remoteWall, Date.now());
  let counter = 0;
  if (wall === clock.wall && wall === remoteWall) counter = Math.max(clock.counter, remoteCounter);
  else if (wall === clock.wall) counter = clock.counter;
  else if (wall === remoteWall) counter = remoteCounter;
  clock.wall = wall;
  clock.counter = counter;
}

/** Key of a tombstone row: one per deleted synced row. */
export const tombstoneId = (store, key) => `${store}:${key}`;

/* ---------- Writes ---------- */

/** Records a synced change in the outbox. Called inside the same transaction as the write. */
function enqueue(tx, entry) {
  tx.objectStore('outbox').add({ ...entry, status: 'pending', createdAt: new Date().toISOString(), attempts: 0 });
}

/**
 * The writes a transaction can make. Local mode stamps synced rows and queues them. Replicate mode stores rows
 * exactly as they are given, so the record that arrives from another device is what this device keeps.
 */
function createContext(tx, { replicating }) {
  const touched = new Set();
  const ctx = { error: null };

  ctx.get = (store, key) => request(tx.objectStore(store).get(key));
  ctx.getAll = (store, options) => request(readAll(tx.objectStore(store), options));

  ctx.put = (store, record) => {
    if (replicating) {
      tx.objectStore(store).put(record);
      touched.add(store);
      return record;
    }
    const field = KEY_FIELD[store] ?? 'id';
    const row = { ...record, updatedAt: new Date().toISOString() };
    if (row[field] === undefined) {
      if (field !== 'id') throw new TypeError(`"${store}" rows need a "${field}" value`);
      row.id = newId();
    }
    const synced = SYNCED_STORES.includes(store);
    if (synced) {
      row.stamp = stamp();
      tx.objectStore('tombstones').delete(tombstoneId(store, row.id));
    }
    tx.objectStore(store).put(row);
    touched.add(store);
    if (synced) enqueue(tx, { opId: row.stamp, stamp: row.stamp, store, op: 'put', key: row.id, record: row });
    return row;
  };

  ctx.clear = (store) => {
    tx.objectStore(store).clear();
    touched.add(store);
  };

  ctx.remove = (store, key) => {
    tx.objectStore(store).delete(key);
    touched.add(store);
    if (replicating || !SYNCED_STORES.includes(store)) return;
    const deletedAt = stamp();
    tx.objectStore('tombstones').put({ id: tombstoneId(store, key), store, key, stamp: deletedAt });
    enqueue(tx, { opId: deletedAt, stamp: deletedAt, store, op: 'delete', key });
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

  /** Queues an existing row as a put, unchanged: its stamp is the op id. Used by the first connect (see sync.queueExisting). */
  ctx.queue = (store, row) => enqueue(tx, { opId: row.stamp, stamp: row.stamp, store, op: 'put', key: keyOf(store, row), record: row });

  ctx.touched = touched;
  return ctx;
}

/** Runs work in one readwrite transaction. Resolves with work's result after the commit. */
function run(work, { replicating }) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(ALL_STORES, 'readwrite');
        const ctx = createContext(tx, { replicating });

        const committed = new Promise((done, fail) => {
          tx.oncomplete = () => done();
          tx.onabort = () => {
            const cause = ctx.error ?? tx.error;
            fail(cause?.name === 'QuotaExceededError' ? new StorageFullError() : cause ?? new Error('IndexedDB transaction aborted'));
          };
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

/**
 * The single write path. `work(ctx)` runs inside one readwrite transaction.
 * Inside `work` only await IndexedDB requests (ctx.get, ctx.getAll, ctx.nextNumber).
 * Throwing from `work` aborts everything, including outbox entries.
 * Resolves with work's return value after the commit.
 */
export function transaction(work) {
  return run(work, { replicating: false });
}

/**
 * The write path for changes received from other devices (sync). Rows are stored as they are and nothing is
 * queued, so a change is never sent back. The caller decides what wins (see services/replication.js).
 */
export function replicate(work) {
  return run(work, { replicating: true });
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
