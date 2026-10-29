// App bootstrap: opens the database, wires the shell (nav, header, drawer, language, motion) and starts the router.
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
 *   guard: 'setup' (first run only) | 'guest' (signed out only) | 'auth' (default, needs a session) | 'public'
 *   chrome: false hides the app shell (sidebar, header, bottom bar)
 *   nav: listed in the sidebar. bottom: also in the mobile bar. dev: only on local development hosts.
 */
const ROUTES = [
  { path: '/setup', guard: 'setup', chrome: false, load: page('setup') },
  { path: '/login', guard: 'guest', chrome: false, load: page('login') },
  { path: '/dashboard', nav: true, bottom: true, icon: 'home', load: page('dashboard') },
  { path: '/sales', nav: true, bottom: true, centre: true, icon: 'cart', load: page('sales') },
  { path: '/purchases', nav: true, bottom: true, icon: 'purchase', load: page('purchases') },
  { path: '/returns', nav: true, icon: 'returns', load: page('returns') },
  { path: '/products', nav: true, bottom: true, icon: 'products', load: page('products') },
  { path: '/stock', nav: true, icon: 'stock', load: page('stock') },
  { path: '/customers', nav: true, icon: 'customers', load: page('customers') },
  { path: '/suppliers', nav: true, icon: 'suppliers', load: page('suppliers') },
  { path: '/ledger', nav: true, icon: 'ledger', load: page('ledger') },
  { path: '/vouchers', nav: true, icon: 'vouchers', load: page('vouchers') },
  { path: '/demand', nav: true, icon: 'demand', load: page('demand') },
  { path: '/reports', nav: true, icon: 'reports', load: page('reports') },
  { path: '/backup', nav: true, icon: 'backup', load: page('backup') },
  { path: '/settings', nav: true, icon: 'settings', load: page('settings') },
  { path: '/styleguide', guard: 'public', dev: true, chrome: true, load: page('styleguide') },
];

/** Bottom bar order: left to right, with the Sell button in the centre. */
const BOTTOM_ORDER = ['/dashboard', '/products', '/sales', '/purchases'];

const DEV_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const isDevHost = () => DEV_HOSTS.includes(location.hostname) || location.hostname.endsWith('.localhost');

const router = createRouter({ routes: ROUTES, notFound: page('notfound'), view: $('#view') });
let activePath = null;
let wasSyncing = false;

const navKey = (route) => `nav.${route.path.slice(1)}`;
const routeFor = (path) => ROUTES.find((route) => route.path === path);

/** Access rules for every route, run before the page loads. */
async function accessGuard(to) {
  if (to.path === '/') return '/dashboard';
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
  const links = ROUTES.filter((route) => route.nav);
  const link = (route, cls) =>
    `<a class="${cls}" href="#${route.path}" data-path="${route.path}">${ui.icon(route.icon)}<span>${ui.esc(i18n.t(navKey(route)))}</span></a>`;

  $('#nav-list').html(
    `<li class="nav-indicator" aria-hidden="true"></li>` +
      links.map((route) => `<li>${link(route, 'nav-link')}</li>`).join(''),
  );

  const bottom = BOTTOM_ORDER.map((path) => routeFor(path))
    .filter(Boolean)
    .map((route) => {
      if (!route.centre) return `<li>${link(route, 'bottom-link')}</li>`;
      return (
        `<li><a class="bottom-link bottom-link--center" href="#${route.path}" data-path="${route.path}">` +
        `<span class="sell-orb">${ui.icon(route.icon)}</span><span>${ui.esc(i18n.t(navKey(route)))}</span></a></li>`
      );
    });
  bottom.push(
    `<li><button type="button" class="bottom-menu" data-action="open-menu">${ui.icon('menu')}<span>${ui.esc(i18n.t('nav.more'))}</span></button></li>`,
  );
  $('#bottom-list').html(bottom.join(''));
  highlightNav();
}

function renderNet(online) {
  $('#net-status').text(i18n.t(online ? 'net.online' : 'net.offline')).toggleClass('is-offline', !online);
  $('#offline-banner').prop('hidden', online);
}

/** The status pill pulses while changes are waiting to sync, and flashes green when they are all sent. */
function renderSync(pending) {
  const syncing = pending > 0;
  const $pill = $('#net-status');
  $pill.toggleClass('is-syncing', syncing);
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
  $('#logout-btn').prop('hidden', !chrome || !store.get('session'));
  $('#page-title').text(module?.title ? i18n.t(module.title) : '');
  highlightNav();
  setDrawer(false);
}

async function logout() {
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
    label: i18n.t(navKey(route)),
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
            hint: [product.generic, product.company].filter(Boolean).join(' · '),
            run: () => navigate('/products'),
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
    i18n.apply(document);
    router.refresh();
  });
  store.subscribe('online', renderNet);
  store.subscribe('pharmacyName', (name) => $('#pharmacy-name').text(name || ''));
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
  $(document).on('keydown', (event) => {
    if (event.key === 'Escape') setDrawer(false);
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
