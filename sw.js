// Offline shell service worker.
// VERSION must match js/core/version.js. Each release changes it, so every device fetches the new shell once.
// Install caches the whole shell under that version. Activate deletes older shells.
// A new version waits (it does not take over mid-sale): the page shows "New version available" and asks it to
// take over with SKIP_WAITING when the owner taps Reload.
// Fonts from Google are cached at runtime. Other same-origin files not in the list are cached as they are fetched.
// Background Sync: the page registers the 'shifa-sync' tag after each change. This worker wakes an open window to sync.
// scripts/audit-shell.mjs checks that the list below matches the files on disk.
const VERSION = '1.2.0'; // The Pages workflow appends the commit SHA here, so each deploy gets a new cache.
const SHELL_CACHE = `shifa-shell-${VERSION}`;
const FONT_CACHE = 'shifa-fonts-v1';
const SYNC_TAG = 'shifa-sync';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/animations.css',
  './css/base.css',
  './css/components.css',
  './css/dark.css',
  './css/layout.css',
  './css/pages.css',
  './css/print.css',
  './css/tokens.css',
  './fonts/inter-latin-400-normal.woff2',
  './fonts/inter-latin-500-normal.woff2',
  './fonts/inter-latin-600-normal.woff2',
  './fonts/inter-latin-700-normal.woff2',
  './fonts/noto-nastaliq-urdu-400.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg',
  './js/app.js',
  './js/core/anim.js',
  './js/core/auth.js',
  './js/core/chart.js',
  './js/core/csv.js',
  './js/core/dates.js',
  './js/core/db.js',
  './js/core/donut.js',
  './js/core/events.js',
  './js/core/i18n.js',
  './js/core/money.js',
  './js/core/numbers.js',
  './js/core/resilience.js',
  './js/core/router.js',
  './js/core/store.js',
  './js/core/sync-supabase.js',
  './js/core/sync.js',
  './js/core/ui.js',
  './js/core/version.js',
  './js/core/virtual.js',
  './js/i18n/demo-en.js',
  './js/i18n/demo-ur.js',
  './js/i18n/docs-en.js',
  './js/i18n/docs-ur.js',
  './js/i18n/en.js',
  './js/i18n/mix-en.js',
  './js/i18n/mix-ur.js',
  './js/i18n/parties-en.js',
  './js/i18n/parties-ur.js',
  './js/i18n/practice-en.js',
  './js/i18n/practice-screen-en.js',
  './js/i18n/practice-screen-ur.js',
  './js/i18n/practice-ur.js',
  './js/i18n/quality-en.js',
  './js/i18n/quality-ur.js',
  './js/i18n/reports-en.js',
  './js/i18n/reports-ur.js',
  './js/i18n/screens-en.js',
  './js/i18n/screens-ur.js',
  './js/i18n/settings-en.js',
  './js/i18n/settings-ur.js',
  './js/i18n/sync-en.js',
  './js/i18n/sync-ur.js',
  './js/i18n/ur.js',
  './js/pages/_doc-shared.js',
  './js/pages/_form.js',
  './js/pages/_medicine-dialogs.js',
  './js/pages/_medicine-form.js',
  './js/pages/_medicine-shared.js',
  './js/pages/_mix-card.js',
  './js/pages/_party.js',
  './js/pages/_report-defs.js',
  './js/pages/_stub.js',
  './js/pages/_sync-sheet.js',
  './js/pages/accounts.js',
  './js/pages/backup.js',
  './js/pages/batchtrace.js',
  './js/pages/customer-detail.js',
  './js/pages/customers.js',
  './js/pages/dashboard.js',
  './js/pages/demand.js',
  './js/pages/expiry.js',
  './js/pages/login.js',
  './js/pages/notfound.js',
  './js/pages/pos.js',
  './js/pages/practice-list.js',
  './js/pages/practice.js',
  './js/pages/products.js',
  './js/pages/purchase-new.js',
  './js/pages/purchases.js',
  './js/pages/reports.js',
  './js/pages/return-new.js',
  './js/pages/returns.js',
  './js/pages/rxregister.js',
  './js/pages/sales.js',
  './js/pages/settings.js',
  './js/pages/setup.js',
  './js/pages/stock.js',
  './js/pages/styleguide.js',
  './js/pages/supplier-detail.js',
  './js/pages/suppliers.js',
  './js/pages/vouchers.js',
  './js/services/backup.js',
  './js/services/dashboard.js',
  './js/services/demand.js',
  './js/services/demo.js',
  './js/services/errors.js',
  './js/services/ledger.js',
  './js/services/numbering.js',
  './js/services/parties.js',
  './js/services/pos.js',
  './js/services/practice.js',
  './js/services/printing.js',
  './js/services/products.js',
  './js/services/purchases.js',
  './js/services/receipt.js',
  './js/services/replication.js',
  './js/services/reports.js',
  './js/services/returns.js',
  './js/services/rollups.js',
  './js/services/sales.js',
  './js/services/seed-medicines.js',
  './js/services/settings.js',
  './js/services/stock.js',
  './js/services/trace.js',
  './vendor/jquery.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('shifa-shell-') && key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') {
    event.respondWith(cacheFirst(FONT_CACHE, request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(shellFirst(request));
});

self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) client.postMessage({ type: 'sync-now' });
    }),
  );
});

/** Answers from the shell cache first. Anything not cached is fetched, and a page navigation falls back to the app. */
async function shellFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    if (request.mode === 'navigate') {
      const app = await cache.match('./index.html');
      if (app) return app;
    }
    throw err;
  }
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}
