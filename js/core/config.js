// Settings the app ships with. The sync server address is the pharmacy's Cloudflare Worker. It is not a secret, so it
// lives here: a new device only needs the username and password. Change it if the Worker is deployed elsewhere.
export const SYNC_SERVER = 'https://shifa-sync.musmanmubasheir.workers.dev';

/** The sync server this device uses: the address saved on the device (for testing), or the built-in one. */
export function syncServer() {
  try {
    return localStorage.getItem('shifa.syncServer') || SYNC_SERVER;
  } catch {
    return SYNC_SERVER;
  }
}
