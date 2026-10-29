// Offline shell. Precaches the whole app on first visit, so it opens with no connection.
// Requests for the shell are answered from the cache. Other same-origin GETs are cached as they are fetched.
// When you ship a change, bump CACHE so every device fetches the new files.
const CACHE = 'shifa-shell-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
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
  './js/app.js',
  './js/core/anim.js',
  './js/core/auth.js',
  './js/core/dates.js',
  './js/core/db.js',
  './js/core/events.js',
  './js/core/i18n.js',
  './js/core/money.js',
  './js/core/router.js',
  './js/core/store.js',
  './js/core/sync.js',
  './js/core/ui.js',
  './js/i18n/en.js',
  './js/i18n/screens-en.js',
  './js/i18n/screens-ur.js',
  './js/i18n/ur.js',
  './js/pages/_form.js',
  './js/pages/_medicine-dialogs.js',
  './js/pages/_medicine-form.js',
  './js/pages/_medicine-shared.js',
  './js/pages/_stub.js',
  './js/pages/backup.js',
  './js/pages/batchtrace.js',
  './js/pages/cashbook.js',
  './js/pages/customers.js',
  './js/pages/dashboard.js',
  './js/pages/demand.js',
  './js/pages/expiry.js',
  './js/pages/ledger.js',
  './js/pages/login.js',
  './js/pages/newsale.js',
  './js/pages/notfound.js',
  './js/pages/pos.js',
  './js/pages/products.js',
  './js/pages/purchases.js',
  './js/pages/reports.js',
  './js/pages/returns.js',
  './js/pages/rxregister.js',
  './js/pages/sales.js',
  './js/pages/settings.js',
  './js/pages/setup.js',
  './js/pages/stock.js',
  './js/pages/styleguide.js',
  './js/pages/suppliers.js',
  './js/pages/vouchers.js',
  './js/services/dashboard.js',
  './js/services/demand.js',
  './js/services/errors.js',
  './js/services/ledger.js',
  './js/services/numbering.js',
  './js/services/parties.js',
  './js/services/pos.js',
  './js/services/printing.js',
  './js/services/products.js',
  './js/services/purchases.js',
  './js/services/receipt.js',
  './js/services/returns.js',
  './js/services/sales.js',
  './js/services/seed-medicines.js',
  './js/services/settings.js',
  './js/services/stock.js',
  './vendor/jquery.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
