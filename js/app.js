// App bootstrap: opens the database, wires the shell (grouped sidebar, header, avatar menu, bottom bar,
// language, motion) and starts the router.
import * as db from './core/db.js';
import * as i18n from './core/i18n.js';
import * as store from './core/store.js';
import * as events from './core/events.js';
import { createRouter, navigate } from './core/router.js';
import * as auth from './core/auth.js';
import { accessOf, canOpen } from './core/access.js';
import * as sync from './core/sync.js';
import * as ui from './core/ui.js';
import * as anim from './core/anim.js';
import { seedDefaultAccounts } from './services/ledger.js';
import { getSettings } from './services/settings.js';
import { setDigitStyle } from './core/numbers.js';
import { openSyncSheet } from './pages/_sync-sheet.js';
import { installErrorBoundary, guardDoubleSubmit } from './core/resilience.js';

const page = (name) => () => import(`./pages/${name}.js`);

/**
 * Route table.
 *   guard: 'setup' | 'guest' | 'auth' (default) | 'public'
 *   section: the access section a user needs to open the route (see core/access.js). No section: any signed-in user.
 *   chrome: false hides the shell. dev: only on local development hosts.
 *   nav: group key for the sidebar (daily, medicines, parties, accounts, admin). bottom: 'home' | 'stock' |
 *   'sell' (floating centre button) | 'expiry'. label: i18n key for the nav text (default nav.<name>).
 */
const ROUTES = [
  { path: '/setup', guard: 'setup', chrome: false, load: page('setup') },
  { path: '/login', guard: 'guest', chrome: false, load: page('login') },

  { path: '/forbidden', chrome: true, load: page('forbidden') },

  { path: '/dashboard', nav: 'daily', section: 'dashboard', label: 'nav.home', icon: 'home', bottom: 'home', load: page('dashboard') },
  { path: '/pos', nav: 'daily', section: 'pos', label: 'nav.newSale', icon: 'cart', bottom: 'sell', load: page('pos') },
  { path: '/practice', nav: 'daily', section: 'practice', label: 'nav.practice', icon: 'pulse', load: page('practice') },
  { path: '/practice-list', nav: 'daily', section: 'practice-list', label: 'nav.practiceList', icon: 'receipt', load: page('practice-list') },
  { path: '/sales', nav: 'daily', section: 'sales', icon: 'receipt', load: page('sales') },
  { path: '/purchases', nav: 'daily', section: 'purchases', icon: 'purchase', load: page('purchases') },
  { path: '/purchases/new', section: 'purchases', load: page('purchase-new') },
  { path: '/returns', nav: 'daily', section: 'returns', icon: 'returns', load: page('returns') },
  { path: '/returns/new', section: 'returns', load: page('return-new') },

  { path: '/products', nav: 'medicines', section: 'products', label: 'nav.products', icon: 'products', load: page('products') },
  { path: '/stock', nav: 'medicines', section: 'stock', icon: 'stock', bottom: 'stock', load: page('stock') },
  { path: '/expiry', nav: 'medicines', section: 'expiry', icon: 'clock', bottom: 'expiry', load: page('expiry') },
  { path: '/demand', nav: 'medicines', section: 'demand', label: 'nav.demand', icon: 'order', load: page('demand') },
  { path: '/trace', nav: 'medicines', section: 'trace', label: 'nav.batchTrace', icon: 'batch', load: page('batchtrace') },
  { path: '/rx', nav: 'medicines', section: 'rx', label: 'nav.rxRegister', icon: 'rx', load: page('rxregister') },

  { path: '/customers', nav: 'parties', section: 'customers', icon: 'customers', load: page('customers') },
  { path: '/customers/:id', section: 'customers', load: page('customer-detail') },
  { path: '/suppliers', nav: 'parties', section: 'suppliers', icon: 'suppliers', load: page('suppliers') },
  { path: '/suppliers/:id', section: 'suppliers', load: page('supplier-detail') },

  { path: '/vouchers', nav: 'accounts', section: 'vouchers', label: 'nav.cashBook', icon: 'bank', load: page('vouchers') },
  { path: '/accounts', nav: 'accounts', section: 'accounts', label: 'nav.ledger', icon: 'ledger', load: page('accounts') },
  { path: '/accounts/:code', section: 'accounts', load: page('accounts') },
  { path: '/reports/:key', section: 'reports', load: page('reports') },
  { path: '/reports', nav: 'accounts', section: 'reports', icon: 'reports', load: page('reports') },

  { path: '/backup', nav: 'admin', section: 'backup', label: 'nav.backup', icon: 'backup', load: page('backup') },
  { path: '/settings', nav: 'admin', section: 'settings', icon: 'settings', load: page('settings') },
  { path: '/users', nav: 'admin', section: 'users', label: 'nav.users', icon: 'customers', load: page('users') },

  { path: '/styleguide', guard: 'public', dev: true, chrome: true, load: page('styleguide') },
];

/** Sidebar groups, in order. */
const GROUPS = [
  ['daily', 'nav.group.daily'],
  ['medicines', 'nav.group.medicines'],
  ['parties', 'nav.group.parties'],
  ['accounts', 'nav.group.accounts'],
  ['admin', 'nav.group.admin'],
];

/** Mobile bottom bar, left to right: Home, Stock, floating Sell, Expiry, then More (opens the drawer). */
const BOTTOM = ['home', 'stock', 'sell', 'expiry'];

/**
 * Offline shell: the service worker caches the app. A new version waits until the owner taps Reload in the
 * "New version available" bar, so no screen changes under them mid-sale. Reloads only when a page was already
 * controlled, so the first install does not reload.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('sw.js');
      const offer = (worker) => {
        if (hadController) showUpdateBar(worker);
      };
      if (registration.waiting) offer(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
        });
      });
      setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
    } catch (err) {
      console.warn('[sw] registration failed', err);
    }
  });
}

function showUpdateBar(worker) {
  if ($('#update-bar').length) return;
  const $bar = $(`<div class="update-bar" id="update-bar" role="status"><span></span><button type="button" class="btn btn-primary btn-sm"></button></div>`);
  $bar.find('span').text(i18n.t('update.available'));
  $bar
    .find('button')
    .text(i18n.t('update.reload'))
    .on('click', () => worker.postMessage({ type: 'SKIP_WAITING' }));
  $('#app').append($bar);
}

/** The install button in the header. Shown only when the browser offers an install prompt. */
function bindInstall() {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    $('#install-btn').prop('hidden', false);
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    $('#install-btn').prop('hidden', true);
  });
  $('#install-btn').on('click', async () => {
    if (!deferred) return;
    const prompt = deferred;
    deferred = null;
    $('#install-btn').prop('hidden', true);
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
  });
}

const DEV_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const isDevHost = () => DEV_HOSTS.includes(location.hostname) || location.hostname.endsWith('.localhost');

const router = createRouter({ routes: ROUTES, notFound: page('notfound'), view: $('#view') });
let activePath = null;
let wasSyncing = false;

const labelKey = (route) => route.label ?? `nav.${route.path.slice(1)}`;

/** The first sidebar page the user may open. A user with no sections at all lands on the no-access page. */
function homeFor(access) {
  return ROUTES.find((route) => route.nav && canOpen(access, route.section))?.path ?? '/forbidden';
}

/**
 * Access rules for every route, run before the page loads. The user is read again from the users store here,
 * so a removed, disabled or re-permissioned account takes effect on its next navigation.
 */
async function accessGuard(to) {
  if (to.path === '/') return '/dashboard';
  if (to.path === '/new-sale') return '/pos';
  if (to.route?.dev) return isDevHost() ? undefined : '/dashboard';

  const guard = to.route?.guard ?? 'auth';
  if (!(await auth.isSetupDone())) return guard === 'setup' ? undefined : '/setup';
  if (guard === 'setup') return '/login';

  const signedIn = await auth.isAuthenticated();
  const user = signedIn ? await auth.currentUser() : null;
  if (signedIn && !user) await auth.logout();
  const access = accessOf(user);
  store.set('access', access);

  if (guard === 'auth' && !user) {
    return to.path === '/dashboard' ? '/login' : `/login?next=${encodeURIComponent(to.path)}`;
  }
  if (guard === 'guest' && user) return homeFor(access);
  if (!canOpen(access, to.route?.section)) {
    ui.toast(i18n.t('access.denied'), { type: 'error' });
    return homeFor(access);
  }
  return undefined;
}

/** Hides the avatar-menu entries the user cannot open (the Settings entry has data-section="settings"). */
function applyMenuAccess() {
  const access = store.get('access');
  $('#avatar-menu [data-section]').each(function hideIfDenied() {
    $(this).prop('hidden', !canOpen(access, this.getAttribute('data-section')));
  });
}

function setDrawer(open) {
  $('#sidebar').toggleClass('is-open', open);
  $('#scrim').prop('hidden', !open);
  $('#menu-btn').attr('aria-expanded', String(open));
}

/* ---------- Avatar menu ---------- */

function setAvatarMenu(open) {
  $('#avatar-menu').prop('hidden', !open);
  $('#avatar-btn').attr('aria-expanded', String(open));
}

function renderAvatar() {
  const session = store.get('session');
  const name = session?.username ?? '';
  const pharmacy = store.get('pharmacyName') || '';
  const source = pharmacy || name || '?';
  const initials = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  $('#avatar-initials').text(initials || '?');
  $('#avatar-who').text(name ? i18n.t('header.signedIn', { name }) : '');
}

/* ---------- Navigation ---------- */

/** The sidebar's sliding indicator follows the current item. */
function moveNavIndicator() {
  const list = $('#nav-list')[0];
  const current = list?.querySelector('.nav-link[aria-current="page"]')?.closest('li');
  if (!current) {
    $('#nav-list .nav-indicator').removeClass('is-ready');
    return;
  }
  list.style.setProperty('--ind-y', `${current.offsetTop}px`);
  list.style.setProperty('--ind-h', `${current.offsetHeight}px`);
  $('#nav-list .nav-indicator').addClass('is-ready');
}

function highlightNav() {
  $('[data-path]').each(function markActive() {
    const isActive = this.getAttribute('data-path') === activePath;
    if (isActive) this.setAttribute('aria-current', 'page');
    else this.removeAttribute('aria-current');
  });
  moveNavIndicator();
}

function renderNav() {
  const access = store.get('access');
  const allowed = (route) => canOpen(access, route.section);
  const link = (route, cls, inner = '') =>
    `<a class="${cls}" href="#${route.path}" data-path="${route.path}">${inner || ui.icon(route.icon)}<span>${ui.esc(i18n.t(labelKey(route)))}</span></a>`;

  const items = [
    `<li class="nav-indicator" aria-hidden="true"></li>`,
    ...GROUPS.flatMap(([group, titleKey]) => {
      const routes = ROUTES.filter((route) => route.nav === group && allowed(route));
      if (!routes.length) return [];
      return [
        `<li class="nav-group-title" role="presentation">${ui.esc(i18n.t(titleKey))}</li>`,
        ...routes.map((route) => `<li>${link(route, 'nav-link')}</li>`),
      ];
    }),
  ];
  $('#nav-list').html(items.join(''));

  const bottom = BOTTOM.map((key) => ROUTES.find((route) => route.bottom === key && allowed(route)))
    .filter(Boolean)
    .map((route) => {
      if (route.bottom !== 'sell') return `<li>${link(route, 'bottom-link')}</li>`;
      const orb = `<span class="sell-orb">${ui.icon('cart')}</span>`;
      const label = `<span>${ui.esc(i18n.t('nav.sell'))}</span>`;
      return `<li><a class="bottom-link bottom-link--center" href="#${route.path}" data-path="${route.path}">${orb}${label}</a></li>`;
    });
  bottom.push(`<li><button type="button" class="bottom-menu" data-action="open-menu">${ui.icon('menu')}<span>${ui.esc(i18n.t('more.title'))}</span></button></li>`);
  $('#bottom-list').html(bottom.join(''));
  applyMenuAccess();
  highlightNav();
}

/**
 * The status pill: Offline, Saved on this device (no server yet), Syncing (pulses), Synced (flashes green when a
 * sync finishes) or Sync error. Tapping it opens the sync sheet.
 */
function renderPill() {
  const online = store.get('online');
  const s = sync.getStatus();
  let state = 'synced';
  if (!online) state = 'offline';
  else if (!s.configured) state = s.pending ? 'saved' : 'online';
  else if (s.state === 'error' || s.state === 'auth') state = 'error';
  else if (s.state === 'syncing' || s.pending) state = 'syncing';

  const labels = {
    offline: 'net.offline',
    saved: 'header.savedHere',
    online: 'net.online',
    error: 'header.syncError',
    syncing: 'header.syncing',
    synced: 'header.synced',
  };
  const $pill = $('#net-status');
  $pill
    .text(i18n.t(labels[state]))
    .attr('data-state', state)
    .toggleClass('is-offline', state === 'offline')
    .toggleClass('is-error', state === 'error')
    .toggleClass('is-syncing', state === 'syncing');
  $('#offline-banner').prop('hidden', online);

  if (wasSyncing && state === 'synced') {
    $pill.removeClass('is-synced');
    $pill[0].offsetWidth; // restart the flash
    $pill.addClass('is-synced');
    setTimeout(() => $pill.removeClass('is-synced'), 950);
  }
  wasSyncing = state === 'syncing';
}

function onRouteAfter({ to, module }) {
  activePath = to.path;
  const chrome = to.route?.chrome !== false;
  $('#app').toggleClass('is-auth', !chrome);
  $('#avatar-wrap').prop('hidden', !chrome || !store.get('session'));
  $('#page-title').text(module?.title ? i18n.t(module.title) : '');
  highlightNav();
  setDrawer(false);
  setAvatarMenu(false);
}

async function logout() {
  setAvatarMenu(false);
  const ok = await ui.confirmDialog({
    title: i18n.t('modal.logoutTitle'),
    message: i18n.t('modal.logoutMessage'),
    confirmLabel: i18n.t('auth.logout'),
    danger: true,
  });
  if (!ok) return;
  await auth.logout();
  ui.toast(i18n.t('toast.loggedOut'));
  navigate('/login');
}

/** Ctrl+K / Cmd+K: jump to a page, or find a medicine by name, salt, company, barcode or code. */
function openCommandPalette() {
  const access = store.get('access');
  const pages = ROUTES.filter((route) => route.nav && canOpen(access, route.section)).map((route) => ({
    label: i18n.t(labelKey(route)),
    hint: route.path,
    run: () => navigate(route.path),
  }));
  ui.openPalette({
    placeholder: i18n.t('palette.placeholder'),
    source: async (query) => {
      const q = query.trim().toLowerCase();
      if (!q) return pages;
      const matches = pages.filter((item) => item.label.toLowerCase().includes(q));
      // Medicine matches are shown only to users who can open a section that lists medicines.
      const canSeeMedicines = canOpen(access, 'products') || canOpen(access, 'pos');
      if (q.length >= 2 && canSeeMedicines) {
        const { searchProducts } = await import('./services/products.js');
        const products = await searchProducts(q, { limit: 8 });
        matches.push(
          ...products.map((product) => ({
            label: product.name,
            hint: [product.strength, product.generic, product.company].filter(Boolean).join(' · '),
            run: () => navigate(`/products`),
          })),
        );
      }
      return matches;
    },
  });
}

function bindShell() {
  store.subscribe('digits', () => router.refresh());
  store.subscribe('lang', () => {
    renderNav();
    renderAvatar();
    renderPill();
    i18n.apply(document);
    router.refresh();
  });
  store.subscribe('online', renderPill);
  events.on('sync:status', renderPill);
  store.subscribe('pharmacyName', (name) => {
    $('#pharmacy-name').text(name || '');
    renderAvatar();
  });
  store.subscribe('session', renderAvatar);
  store.subscribe('access', renderNav);
  store.subscribe('syncPending', renderPill);
  $('#pharmacy-name').text(store.get('pharmacyName') || '');
  events.on('route:loading', (busy) => ui.setBusy(busy));
  events.on('route:after', onRouteAfter);

  window.addEventListener('online', () => store.set('online', true));
  window.addEventListener('offline', () => store.set('online', false));
  $('#net-status').on('click', openSyncSheet).attr('aria-label', i18n.t('header.syncStatusLabel'));
  bindInstall();
  renderPill();

  $('#menu-btn').on('click', () => setDrawer(true));
  $(document).on('click', '[data-action="open-menu"]', () => setDrawer(true));
  $('#scrim').on('click', () => setDrawer(false));
  $('#avatar-btn').on('click', (event) => {
    event.stopPropagation();
    setAvatarMenu($('#avatar-menu').prop('hidden'));
  });
  $('#avatar-menu').on('click', '[data-go]', (event) => {
    setAvatarMenu(false);
    navigate(event.currentTarget.getAttribute('data-go'));
  });
  $('#menu-lang').on('click', () => {
    setAvatarMenu(false);
    i18n.setLang(store.get('lang') === 'en' ? 'ur' : 'en');
  });
  $(document).on('click', (event) => {
    if (!$(event.target).closest('#avatar-wrap').length) setAvatarMenu(false);
  });
  $(document).on('keydown', (event) => {
    if (event.key === 'Escape') {
      setDrawer(false);
      setAvatarMenu(false);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openCommandPalette();
    }
  });
  $('.skip-link').on('click', (event) => {
    event.preventDefault();
    $('#view')[0].focus();
  });
  $('#lang-btn').on('click', () => i18n.setLang(store.get('lang') === 'en' ? 'ur' : 'en'));
  $('#logout-btn').on('click', logout);
  window.addEventListener('resize', moveNavIndicator);
}

async function boot() {
  installErrorBoundary();
  guardDoubleSubmit();
  ui.initReduceMotion();
  i18n.init();
  ui.initTheme();
  anim.install();
  registerServiceWorker();
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = ui.icon(el.dataset.icon);
  });
  i18n.apply(document);
  renderNav();

  await db.open();
  await auth.ensureDeviceId();
  // Independent reads: run together so the first screen waits for one round trip, not two.
  await Promise.all([seedDefaultAccounts(), auth.restoreSession()]);
  setDigitStyle((await getSettings()).numberDigits);
  // Ask once for durable storage, so the browser does not clear the records when space runs short.
  navigator.storage?.persist?.().catch(() => {});

  router.beforeEach(accessGuard);
  bindShell();
  renderAvatar();
  // Sync starts in the background. The first screen does not wait for it.
  sync.init();
  router.start();
  $('#app').removeClass('is-booting');
}

boot().catch((err) => {
  console.error('[app] boot failed', err);
  $('#app').removeClass('is-booting');
  $('#view').html(
    `<section class="card empty-state" role="alert"><h2>${ui.esc(i18n.t('errors.dbUnavailable'))}</h2><p class="muted small">${ui.esc(err?.message ?? err)}</p></section>`,
  );
});
