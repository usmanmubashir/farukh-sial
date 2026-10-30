// Staff accounts and their section access. Only the owner can manage users; every write checks that first,
// so the rule holds even when a screen is reached some other way. The owner account itself is never changed here
// (its password is changed in Settings, where the current password is asked for).
import * as db from '../core/db.js';
import * as auth from '../core/auth.js';
import { AuthError, OWNER_ID, roleOf } from '../core/auth.js';
import { sanitizeSections } from '../core/access.js';

const USERNAME_RULE = /^[a-z0-9._-]{3,32}$/;

/** Throws ownerOnly unless the signed-in user is the owner. Returns the signed-in user. */
async function requireOwner() {
  const me = await auth.currentUser();
  if (me?.role !== 'owner') throw new AuthError('ownerOnly');
  return me;
}

/** What the screens may show: never the hash or the salt. */
const summary = (record) => ({
  id: record.id,
  username: record.username,
  role: roleOf(record),
  active: record.active !== false,
  sections: sanitizeSections(record.sections),
  createdAt: record.createdAt ?? null,
});

async function staffRecord(id) {
  const record = await db.get('users', id);
  if (!record) throw new AuthError('notFound');
  if (record.id === OWNER_ID) throw new AuthError('ownerProtected');
  return record;
}

/** Every account on this device: the owner first, then staff by username. */
export async function listUsers() {
  await requireOwner();
  const rows = (await db.getAll('users')).map(summary);
  return rows.sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === 'owner' ? -1 : 1));
}

/**
 * Adds a staff account. username: 3 to 32 letters, digits, dot, dash or underscore (kept in lower case).
 * sections: the sections it may open; at least one is needed.
 */
export async function createUser({ username, password, confirm, sections }) {
  await requireOwner();
  const name = String(username ?? '').trim().toLowerCase();
  if (!USERNAME_RULE.test(name)) throw new AuthError('usernameInvalid');
  const granted = sanitizeSections(sections);
  if (!granted.length) throw new AuthError('noSections');
  auth.checkNewPassword(password, confirm);
  if ((await db.getAll('users')).some((record) => record.username === name)) throw new AuthError('usernameTaken');

  const secret = await auth.hashPassword(password);
  const now = Date.now();
  const id = db.newId();
  await db.transaction(async (ctx) => {
    ctx.put('users', { id, username: name, sections: granted, active: true, createdAt: now, updatedAt: now, ...secret });
  });
  return id;
}

/** Changes a staff account's sections and/or whether it is active. */
export async function updateUser(id, { sections, active } = {}) {
  await requireOwner();
  const record = await staffRecord(id);
  const patch = { ...record, updatedAt: Date.now() };
  if (sections !== undefined) {
    const granted = sanitizeSections(sections);
    if (!granted.length) throw new AuthError('noSections');
    patch.sections = granted;
  }
  if (active !== undefined) patch.active = Boolean(active);
  await db.transaction(async (ctx) => {
    ctx.put('users', patch);
  });
}

/** Sets a new password for a staff account. The owner does not need the old one. */
export async function resetPassword(id, { password, confirm }) {
  await requireOwner();
  const record = await staffRecord(id);
  auth.checkNewPassword(password, confirm);
  const secret = await auth.hashPassword(password);
  await db.transaction(async (ctx) => {
    ctx.put('users', { ...record, ...secret, updatedAt: Date.now() });
  });
}

/** Removes a staff account. Its device session, if any, ends at its next navigation. */
export async function deleteUser(id) {
  await requireOwner();
  await staffRecord(id);
  await db.transaction(async (ctx) => {
    ctx.remove('users', id);
  });
}
