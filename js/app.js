// App bootstrap: opens the database, wires the shell (nav, header, drawer, language) and starts the router.
import * as db from './core/db.js';
import * as i18n from './core/i18n.js';
import * as store from './core/store.js';
import * as events from './core/events.js';
import { createRouter, navigate } from './core/router.js';
import * as auth from './core/auth.js';
import * as sync from './core/sync.js';
import * as ui from './core/ui.js';
import { seedDefaultAccounts } from './services/ledger.js';

const page = (name) => () => import(`./pages/${name}.js`);

/**
 * Route table.
 *   guard: 'setup' (first run only) | 'guest' (signed out only) | 'auth' (default, needs a session) | 'public'
 *   chrome: false hides the app shell (sidebar, header, bottom bar)
 *   nav: listed in the sidebar; bottom: also listed in the mobile bottom bar
 */
const ROUTES = [
  { path: '/setup', guard: 'setup', chrome: false, load: page('setup') },
  { path: '/login', guard: 'guest', chrome: false, load: page('login') },
  { path: '/dashboard', nav: true, bottom: true, icon: 'home', load: page('dashboard') },
  { path: '/sales', nav: true, bottom: true, icon: 'cart', load: page('sales') },
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
];

const router = createRouter({ routes: ROUTES, notFound: page('notfound'), view: $('#view') });
let activePath = null;

const navKey = (route) => `nav.${route.path.slice(1)}`;

/** Access rules for every route, run before the page loads. */
async function accessGuard(to) {
  if (to.path === '/') return '/dashboard';

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

function highlightNav() {
  $('[data-path]').each(function markActive() {
    const isActive = this.getAttribute('data-path') === activePath;
    if (isActive) this.setAttribute('aria-current', 'page');
    else this.removeAttribute('aria-current');
  });
}

function renderNav() {
  const links = ROUTES.filter((route) => route.nav);
  const link = (route, cls) =>
    `<a class="${cls}" href="#${route.path}" data-path="${route.path}">${ui.icon(route.icon)}<span>${ui.esc(i18n.t(navKey(route)))}</span></a>`;

  $('#nav-list').html(links.map((route) => `<li>${link(route, 'nav-link')}</li>`).join(''));

  const bottom = links.filter((route) => route.bottom).map((route) => `<li>${link(route, 'bottom-link')}</li>`);
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

function bindShell() {
  store.subscribe('lang', () => {
    renderNav();
    i18n.apply(document);
    router.refresh();
  });
  store.subscribe('online', renderNet);
  store.subscribe('pharmacyName', (name) => $('#pharmacy-name').text(name || ''));
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
  });
  $('.skip-link').on('click', (event) => {
    event.preventDefault();
    $('#view')[0].focus();
  });
  $('#lang-btn').on('click', () => i18n.setLang(store.get('lang') === 'en' ? 'ur' : 'en'));
  $('#logout-btn').on('click', logout);
}

async function boot() {
  i18n.init();
  ui.initTheme();
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
