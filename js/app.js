// App bootstrap: opens the database, wires the shell (grouped sidebar, header, avatar menu, bottom bar,
// language, motion) and starts the router.
import * as db from './core/db.js';
import * as i18n from './core/i18n.js';
import * as store from './core/store.js';
import * as events from './core/events.js';
import { createRouter, navigate } from './core/router.js';
import * as auth from './core/auth.js';
import * as sync from './core/sync.js';
import * as ui from './core/ui.js';
import * as anim from './core/anim.js';
import { seedDefaultAccounts } from './services/ledger.js';

const page = (name) => () => import(`./pages/${name}.js`);

/**
 * Route table.
 *   guard: 'setup' | 'guest' | 'auth' (default) | 'public'
 *   chrome: false hides the shell. dev: only on local development hosts.
 *   nav: group key for the sidebar (daily, medicines, parties, accounts, admin). bottom: 'home' | 'stock' |
 *   'sell' (floating centre button) | 'expiry'. label: i18n key for the nav text (default nav.<name>).
 */
const ROUTES = [
  { path: '/setup', guard: 'setup', chrome: false, load: page('setup') },
  { path: '/login', guard: 'guest', chrome: false, load: page('login') },

  { path: '/dashboard', nav: 'daily', label: 'nav.home', icon: 'home', bottom: 'home', load: page('dashboard') },
  { path: '/pos', nav: 'daily', label: 'nav.newSale', icon: 'cart', bottom: 'sell', load: page('pos') },
  { path: '/sales', nav: 'daily', icon: 'receipt', load: page('sales') },
  { path: '/purchases', nav: 'daily', icon: 'purchase', load: page('purchases') },
  { path: '/returns', nav: 'daily', icon: 'returns', load: page('returns') },

  { path: '/products', nav: 'medicines', label: 'nav.products', icon: 'products', load: page('products') },
  { path: '/stock', nav: 'medicines', icon: 'stock', bottom: 'stock', load: page('stock') },
  { path: '/expiry', nav: 'medicines', icon: 'clock', bottom: 'expiry', load: page('expiry') },
  { path: '/demand', nav: 'medicines', label: 'nav.demand', icon: 'order', load: page('demand') },
  { path: '/batch-trace', nav: 'medicines', label: 'nav.batchTrace', icon: 'batch', load: page('batchtrace') },
  { path: '/rx-register', nav: 'medicines', label: 'nav.rxRegister', icon: 'rx', load: page('rxregister') },

  { path: '/customers', nav: 'parties', icon: 'customers', load: page('customers') },
  { path: '/suppliers', nav: 'parties', icon: 'suppliers', load: page('suppliers') },

  { path: '/cash-book', nav: 'accounts', label: 'nav.cashBook', icon: 'bank', load: page('cashbook') },
  { path: '/ledger', nav: 'accounts', label: 'nav.ledger', icon: 'ledger', load: page('ledger') },
  { path: '/reports', nav: 'accounts', icon: 'reports', load: page('reports') },

  { path: '/backup', nav: 'admin', label: 'nav.backup', icon: 'backup', load: page('backup') },
  { path: '/settings', nav: 'admin', icon: 'settings', load: page('settings') },

  { path: '/vouchers', load: page('vouchers') },
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

/** Offline shell: the service worker caches the app; this registers it once the page has loaded. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('[sw] registration failed', err));
  });
}

const DEV_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const isDevHost = () => DEV_HOSTS.includes(location.hostname) || location.hostname.endsWith('.localhost');

const router = createRouter({ routes: ROUTES, notFound: page('notfound'), view: $('#view') });
let activePath = null;
let wasSyncing = false;

const labelKey = (route) => route.label ?? `nav.${route.path.slice(1)}`;

/** Access rules for every route, run before the page loads. */
async function accessGuard(to) {
  if (to.path === '/') return '/dashboard';
  if (to.path === '/new-sale') return '/pos';
  if (to.route?.dev) return isDevHost() ? undefined : '/dashboard';

  const guard = to.route?.guard ?? 'auth';
  if (!(await auth.isSetupDone())) return guard === 'setup' ? undefined : '/setup';
  if (guard === 'setup') return '/login';

  const signedIn = await auth.isAuthenticated();
  if (guard === 'auth' && !signedIn) {
    return to.path === '/dashboard' ? '/login' : `/login?next=${encodeURIComponent(to.path)}`;
  }
  if (guard === 'guest' && signedIn) return '/dashboard';
  return undefined;
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
  const link = (route, cls, inner = '') =>
    `<a class="${cls}" href="#${route.path}" data-path="${route.path}">${inner || ui.icon(route.icon)}<span>${ui.esc(i18n.t(labelKey(route)))}</span></a>`;

  const items = [
    `<li class="nav-indicator" aria-hidden="true"></li>`,
    ...GROUPS.flatMap(([group, titleKey]) => {
      const routes = ROUTES.filter((route) => route.nav === group);
      if (!routes.length) return [];
      return [
        `<li class="nav-group-title" role="presentation">${ui.esc(i18n.t(titleKey))}</li>`,
        ...routes.map((route) => `<li>${link(route, 'nav-link')}</li>`),
      ];
    }),
  ];
  $('#nav-list').html(items.join(''));

  const bottom = BOTTOM.map((key) => ROUTES.find((route) => route.bottom === key))
    .filter(Boolean)
    .map((route) => {
      if (route.bottom !== 'sell') return `<li>${link(route, 'bottom-link')}</li>`;
      const orb = `<span class="sell-orb">${ui.icon('cart')}</span>`;
      const label = `<span>${ui.esc(i18n.t('nav.sell'))}</span>`;
      return `<li><a class="bottom-link bottom-link--center" href="#${route.path}" data-path="${route.path}">${orb}${label}</a></li>`;
    });
  bottom.push(`<li><button type="button" class="bottom-menu" data-action="open-menu">${ui.icon('menu')}<span>${ui.esc(i18n.t('more.title'))}</span></button></li>`);
  $('#bottom-list').html(bottom.join(''));
  highlightNav();
}

function renderNet(online) {
  $('#net-status').text(i18n.t(online ? 'net.online' : 'net.offline')).toggleClass('is-offline', !online);
  $('#offline-banner').prop('hidden', online);
}

/** The status pill says "Syncing" and pulses while changes wait to be sent, and flashes green when all are sent. */
function renderSync(pending) {
  // Changes wait in the outbox while no sync server is configured. That is not "syncing".
  const syncing = pending > 0 && sync.syncActive();
  const $pill = $('#net-status');
  $pill.toggleClass('is-syncing', syncing);
  if (syncing && store.get('online')) $pill.text(i18n.t('header.syncing'));
  else renderNet(store.get('online'));
  if (wasSyncing && !syncing) {
    $pill.removeClass('is-synced');
    $pill[0].offsetWidth; // restart the flash
    $pill.addClass('is-synced');
    setTimeout(() => $pill.removeClass('is-synced'), 950);
  }
  wasSyncing = syncing;
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
  const pages = ROUTES.filter((route) => route.nav).map((route) => ({
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
      if (q.length >= 2) {
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
  store.subscribe('lang', () => {
    renderNav();
    renderAvatar();
    i18n.apply(document);
    router.refresh();
  });
  store.subscribe('online', (online) => {
    renderNet(online);
    renderSync(store.get('syncPending'));
  });
  store.subscribe('pharmacyName', (name) => {
    $('#pharmacy-name').text(name || '');
    renderAvatar();
  });
  store.subscribe('session', renderAvatar);
  store.subscribe('syncPending', renderSync);
  $('#pharmacy-name').text(store.get('pharmacyName') || '');
  events.on('route:loading', (busy) => ui.setBusy(busy));
  events.on('route:after', onRouteAfter);

  window.addEventListener('online', () => store.set('online', true));
  window.addEventListener('offline', () => store.set('online', false));
  renderNet(navigator.onLine);

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
  await seedDefaultAccounts();
  await auth.restoreSession();

  router.beforeEach(accessGuard);
  bindShell();
  renderAvatar();
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
