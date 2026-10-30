// Sign-in, device identity and sessions. Users: the owner and any staff accounts the owner adds.
// Passwords: PBKDF2-SHA256 with a random 16-byte salt, stored in users (never synced, never backed up).
// Sessions: a settings row with the user id and an expiry (24h). An expired session forces a new login only while online.
// Access: the signed-in user's section access is set in the 'access' state (see core/access.js). It is re-read from
// the users store on every navigation, so a change made by the owner applies on the next page.
import * as db from './db.js';
import { set as setState } from './store.js';
import { accessOf, screensOf } from './access.js';

export const SESSION_HOURS = 24;
const PBKDF2_ITERATIONS = 310000;
const MIN_PASSWORD = 8;
const MAX_FAILURES = 5;
const LOCK_MS = 30000;
export const OWNER_ID = 'owner';

/** Error whose `code` maps to an "auth.err.<code>" translation key. */
export class AuthError extends Error {
  constructor(code, vars) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
    this.vars = vars;
  }
}

const encoder = new TextEncoder();
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// In-memory brute-force throttle. It resets on reload, which is acceptable for a single-owner device.
const failures = { count: 0, lockedUntil: 0 };

/** The role of a stored user: the owner record is always the owner, every other record is staff. */
export const roleOf = (record) => (record.id === OWNER_ID ? 'owner' : 'staff');

/** A new salted hash for a password: { salt, hash, iterations } as stored in users. */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(String(password), salt, PBKDF2_ITERATIONS);
  return { salt: toBase64(salt), hash: toBase64(hash), iterations: PBKDF2_ITERATIONS };
}

/** Throws passwordShort or passwordMismatch when a new password is not acceptable. */
export function checkNewPassword(password, confirm) {
  if (String(password ?? '').length < MIN_PASSWORD) throw new AuthError('passwordShort', { min: MIN_PASSWORD });
  if (password !== confirm) throw new AuthError('passwordMismatch');
}

export async function isSetupDone() {
  return Boolean(await db.get('users', OWNER_ID));
}

/** Creates the device id on first run. It never changes afterwards. */
/** The device id, created once. It also ends every sync stamp this device makes, so it is set on the database layer. */
export async function ensureDeviceId() {
  const existing = await db.getSetting('deviceId');
  const id = existing || db.newId();
  if (!existing) await db.setSetting('deviceId', id);
  db.setDeviceId(id);
  return id;
}

export const getDeviceId = () => db.getSetting('deviceId', '');
export const getPharmacyName = () => db.getSetting('pharmacyName', '');

/** Session length from the business settings (sessionHours), or the default. */
export async function sessionHours() {
  const hours = Number((await db.getSetting('business', {}))?.sessionHours);
  return Number.isFinite(hours) && hours >= 1 ? hours : SESSION_HOURS;
}

function setAccess(record) {
  setState('access', record ? accessOf({ role: roleOf(record), sections: screensOf(record) }) : null);
}

async function startSession(record, pharmacyName) {
  const now = Date.now();
  const session = {
    token: toBase64(crypto.getRandomValues(new Uint8Array(16))),
    userId: record.id,
    username: record.username,
    issuedAt: now,
    expiresAt: now + (await sessionHours()) * 3600000,
  };
  await db.setSetting('session', session);
  failures.count = 0;
  setState('session', { username: record.username, expiresAt: session.expiresAt });
  setState('pharmacyName', pharmacyName);
  setAccess(record);
}

/** First run: creates the owner and the pharmacy name, then signs in. */
export async function setupOwner({ pharmacyName, username, password, confirm }) {
  const name = String(pharmacyName ?? '').trim();
  const user = String(username ?? '').trim().toLowerCase();
  if (!name) throw new AuthError('pharmacyRequired');
  if (!user) throw new AuthError('usernameRequired');
  checkNewPassword(password, confirm);
  if (await isSetupDone()) throw new AuthError('alreadySetup');

  const record = { id: OWNER_ID, username: user, ...(await hashPassword(password)) };

  await db.transaction(async (ctx) => {
    if (await ctx.get('users', OWNER_ID)) throw new AuthError('alreadySetup');
    ctx.put('users', record);
    ctx.put('settings', { key: 'pharmacyName', value: name });
  });

  await startSession(record, name);
}

export async function login(username, password) {
  const now = Date.now();
  if (now < failures.lockedUntil) {
    throw new AuthError('locked', { seconds: Math.ceil((failures.lockedUntil - now) / 1000) });
  }

  const users = await db.getAll('users');
  const owner = users.find((u) => u.id === OWNER_ID);
  if (!owner) throw new AuthError('notSetup');

  // Derive even when the username is unknown, so the timing does not reveal which part failed.
  const typed = String(username ?? '').trim().toLowerCase();
  const record = users.find((u) => u.username === typed) ?? owner;
  const attempt = await derive(String(password ?? ''), fromBase64(record.salt), record.iterations);
  const ok = record.username === typed && sameBytes(attempt, fromBase64(record.hash));

  if (!ok) {
    failures.count += 1;
    if (failures.count >= MAX_FAILURES) {
      failures.lockedUntil = Date.now() + LOCK_MS;
      failures.count = 0;
    }
    throw new AuthError('wrongCredentials');
  }
  if (record.active === false) throw new AuthError('accountDisabled');

  await startSession(record, await getPharmacyName());
}

/** The signed-in user's stored record, or null when nobody is signed in or the account was removed or disabled. */
async function sessionRecord() {
  const session = await currentSession();
  if (!session) return null;
  // Sessions from before staff accounts existed carry no user id: they belong to the owner.
  const record = await db.get('users', session.userId ?? OWNER_ID);
  if (!record || record.active === false) return null;
  return record;
}

/**
 * Changes the signed-in user's own password. The current password must be given. The new one needs the minimum
 * length and a matching confirmation. A new salt is made every time.
 */
export async function changePassword({ current, password, confirm }) {
  const record = await sessionRecord();
  if (!record) throw new AuthError('notSetup');
  const attempt = await derive(String(current ?? ''), fromBase64(record.salt), record.iterations);
  if (!sameBytes(attempt, fromBase64(record.hash))) throw new AuthError('wrongCurrentPassword');
  checkNewPassword(password, confirm);
  const secret = await hashPassword(password);
  await db.transaction(async (ctx) => {
    ctx.put('users', { ...record, ...secret });
  });
}

/** The signed-in user: { id, username, role, sections } (lower-case username), or null. */
export async function currentUser() {
  const record = await sessionRecord();
  if (!record) return null;
  return { id: record.id, username: record.username, role: roleOf(record), sections: screensOf(record) };
}

/** The owner's username (lower case), for the account screen. */
export async function ownerUsername() {
  return (await db.get('users', OWNER_ID))?.username ?? '';
}

export async function logout() {
  await db.removeSetting('session');
  setState('session', null);
  setState('access', null);
}

export async function currentSession() {
  return db.getSetting('session', null);
}

/**
 * True when a user may use the app. An expired session counts as signed in only while offline,
 * so a pharmacy that loses its connection keeps working. Once online, the user signs in again.
 */
export async function isAuthenticated() {
  const session = await currentSession();
  if (!session) return false;
  if (Date.now() < session.expiresAt) return true;
  return !navigator.onLine;
}

/** Loads the pharmacy name, session summary and access into the UI store at boot. */
export async function restoreSession() {
  const session = await currentSession();
  setState('pharmacyName', await getPharmacyName());
  setState('session', session ? { username: session.username, expiresAt: session.expiresAt } : null);
  setAccess(session ? await sessionRecord() : null);
}
