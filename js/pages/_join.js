// Joining a pharmacy that already exists on the sync server, from a device that has no data yet. Shared by the sign-in
// page (first visit) and the Setup page. The owner's or a staff member's username and password are checked on the
// server, then the pharmacy's records are downloaded to this device.
import * as auth from '../core/auth.js';
import * as sync from '../core/sync.js';
import { t } from '../core/i18n.js';

// The server address and username of the last join, kept on this device so the next visit needs only the password.
// The password itself is never stored.
const REMEMBER_KEY = 'shifa.joinServer';

export function remembered() {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}');
  } catch {
    return {};
  }
}

function remember(values) {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ url: values.url, username: values.username }));
  } catch {
    // Private windows may refuse storage: the join still works, it just is not remembered.
  }
}

/**
 * Downloads the pharmacy from the server. Throws with the sync engine's own message when that fails, so the owner
 * knows what to fix (the address, the username or the connection).
 */
export async function joinPharmacy({ pharmacyName, url, username, password }) {
  await auth.setPharmacyName(pharmacyName);
  await sync.joinPharmacy({ backend: 'cloudflare', url, username, password });
  if (!(await auth.isSetupDone())) {
    throw new Error(sync.getStatus().lastError ?? t('auth.joinNoData'));
  }
  remember({ url, username });
}
