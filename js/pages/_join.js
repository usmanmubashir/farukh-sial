// Joining the pharmacy on the sync server from a device that has no data yet. Shared by the sign-in page (first visit).
// Only the username and password are needed: the server address is built in (js/core/config.js), and the pharmacy's
// name comes from the server when the device signs in. The owner's or a staff member's password is checked on the
// server, then the pharmacy's records are downloaded to this device.
import * as auth from '../core/auth.js';
import * as sync from '../core/sync.js';
import { t } from '../core/i18n.js';

// The last username used to join, kept on this device so the next visit needs only the password.
// The password itself is never stored.
const REMEMBER_KEY = 'shifa.joinUser';

export function remembered() {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}');
  } catch {
    return {};
  }
}

function remember(values) {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: values.username }));
  } catch {
    // Private windows may refuse storage: the join still works, it just is not remembered.
  }
}

/**
 * Downloads the pharmacy from the server. Throws with the sync engine's own message when that fails, so the owner
 * knows what to fix (the username, the password or the connection).
 */
export async function joinPharmacy({ username, password }) {
  await sync.joinPharmacy({ backend: 'cloudflare', username, password });
  if (!(await auth.isSetupDone())) {
    throw new Error(sync.getStatus().lastError ?? t('auth.joinNoData'));
  }
  const name = (await sync.getConfig())?.pharmacyName;
  if (name) await auth.setPharmacyName(name);
  remember({ username });
}
