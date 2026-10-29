// Backup and restore. One JSON file holds every business store, the schema version, the time it was made, a
// SHA-256 checksum of the data, and no passwords. The file is gzip-compressed when the browser can (CompressionStream).
//
// Export:  collectStores() → JSON text → checksum → file. Records the time as lastBackupAt on this device.
// Restore: read the file (gunzip if needed) → check format, schema version and checksum → show the counts →
//          replaceStores() in one transaction. Nothing changes until every check has passed.
//
// Kept on each device and never taken from a backup: the device ID, the session and the last backup time.
// Also not backed up: the owner's password (users) and the outbox.
import * as db from '../core/db.js';
import { emit } from '../core/events.js';
import { APP_VERSION } from '../core/version.js';
import { ServiceError } from './errors.js';

export const BACKUP_FORMAT = 'shifa-pos-backup';
/** Never in a backup: passwords (users), the pending sends (outbox) and this device's sync cursor (syncState). */
const EXCLUDED_STORES = ['users', 'outbox', 'syncState'];
/** Device-only settings: this device's identity, sign-in, backup time and sync connection. */
const LOCAL_SETTINGS = ['deviceId', 'session', 'lastBackupAt', 'syncConfig', 'syncSession'];
/** Backups from schema 3 (before sync) still restore. They simply carry no tombstones or stamps. */
const OLDEST_BACKUP_SCHEMA = 3;

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Every store that goes into a backup, with its rows in key order. */
export async function collectStores() {
  const stores = {};
  for (const name of db.storeNames().filter((n) => !EXCLUDED_STORES.includes(n)).sort()) {
    let rows = await db.getAll(name);
    if (name === 'settings') rows = rows.filter((row) => !LOCAL_SETTINGS.includes(row.key));
    stores[name] = rows;
  }
  return stores;
}

const countsOf = (stores) => Object.fromEntries(Object.entries(stores).map(([name, rows]) => [name, rows.length]));

/** The backup as JSON text. The checksum covers the stores part exactly as it is written. */
export async function buildBackupText({ now = new Date() } = {}) {
  const stores = await collectStores();
  const checksum = await sha256Hex(JSON.stringify(stores));
  return JSON.stringify({
    format: BACKUP_FORMAT,
    schemaVersion: db.DB_VERSION,
    app: APP_VERSION,
    createdAt: now.toISOString(),
    deviceId: await db.getSetting('deviceId', ''),
    counts: countsOf(stores),
    checksum,
    stores,
  });
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export const canCompress = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** The file to save or share: gzip when supported, else plain JSON. Also records the backup time. */
export async function buildBackupFile({ now = new Date() } = {}) {
  const text = await buildBackupText({ now });
  const stamp = now.toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const compressed = canCompress();
  const bytes = compressed ? await gzip(text) : new TextEncoder().encode(text);
  await db.setSetting('lastBackupAt', now.toISOString());
  return new File([bytes], `shifa-backup-${stamp}.json${compressed ? '.gz' : ''}`, {
    type: compressed ? 'application/gzip' : 'application/json',
  });
}

/** Reads a backup file (plain or gzip) into a parsed object. Throws ServiceError('notBackup') when it is not one. */
export async function readBackupFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  let text;
  try {
    text = isGzip ? await gunzip(bytes) : new TextDecoder().decode(bytes);
  } catch {
    throw new ServiceError('notBackup');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ServiceError('notBackup');
  }
  if (!parsed || parsed.format !== BACKUP_FORMAT || typeof parsed.stores !== 'object') throw new ServiceError('notBackup');
  return parsed;
}

/**
 * Checks a parsed backup and returns its summary: when it was made, the record counts and the device it came from.
 * Throws ServiceError('backupSchema') when the schema version differs, and ServiceError('backupChecksum') when the
 * data does not match its checksum (the file was damaged or edited).
 */
export async function validateBackup(parsed) {
  if (!(parsed.schemaVersion >= OLDEST_BACKUP_SCHEMA && parsed.schemaVersion <= db.DB_VERSION)) {
    throw new ServiceError('backupSchema', { found: parsed.schemaVersion, expected: db.DB_VERSION });
  }
  const checksum = await sha256Hex(JSON.stringify(parsed.stores));
  if (checksum !== parsed.checksum) throw new ServiceError('backupChecksum');
  return {
    createdAt: parsed.createdAt,
    app: parsed.app,
    deviceId: parsed.deviceId ?? '',
    counts: countsOf(parsed.stores),
    total: Object.values(countsOf(parsed.stores)).reduce((sum, n) => sum + n, 0),
  };
}

/**
 * Replaces the data with the backup. The backup must be validated first. Stores the backup does not hold
 * (users, outbox) are left alone, except the outbox, which is emptied because its entries belong to the old data.
 */
export async function restoreBackup(parsed) {
  const rows = { ...parsed.stores, outbox: [] };
  await db.replaceStores(rows, { keepSettings: LOCAL_SETTINGS });
  emit('data:changed', { stores: Object.keys(rows) });
  return validateBackup(parsed);
}
