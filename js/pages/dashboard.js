// Home screen: greeting, today's hero card, nudges, attention rings, big action tiles, overview,
// a seven-day chart (or table), top medicines, expiring soon and recent sales.
import * as anim from '../core/anim.js';
import * as mix from './_mix-card.js';
import * as events from '../core/events.js';
import * as i18n from '../core/i18n.js';
import * as store from '../core/store.js';
import { canOpen } from '../core/access.js';
import { formatDate, todayISO } from '../core/dates.js';
import { esc, icon } from '../core/ui.js';
import { getDashboard } from '../services/dashboard.js';

export const route = '/dashboard';
export const title = 'nav.home';

/** Whether the signed-in user may see figures from a section. Each block shows only what its section owns. */
const can = (section) => canOpen(store.get('access'), section);

const TILES = [
  { key: 'sell', path: '/pos', section: 'pos', accent: 'green', icon: 'cart' },
  { key: 'buy', path: '/purchases', section: 'purchases', accent: 'blue', icon: 'purchase' },
  { key: 'expiry', path: '/expiry', section: 'expiry', accent: 'orange', icon: 'clock' },
  { key: 'stock', path: '/stock', section: 'stock', accent: 'teal', icon: 'stock' },
  { key: 'orderList', path: '/demand', section: 'demand', accent: 'purple', icon: 'order' },
  { key: 'batchTrace', path: '/trace', section: 'trace', accent: 'cyan', icon: 'batch' },
  { key: 'rxRegister', path: '/rx', section: 'rx', accent: 'pink', icon: 'rx' },
  { key: 'customers', path: '/customers', section: 'customers', accent: 'amber', icon: 'customers' },
  { key: 'practice', path: '/practice', section: 'practice', accent: 'practice', icon: 'pulse' },
];

const MORE = [
  { key: 'medicines', path: '/products', section: 'products', icon: 'products' },
  { key: 'sales', path: '/sales', section: 'sales', icon: 'receipt' },
  { key: 'purchases', path: '/purchases', section: 'purchases', icon: 'purchase' },
  { key: 'suppliers', path: '/suppliers', section: 'suppliers', icon: 'suppliers' },
  { key: 'returns', path: '/returns', section: 'returns', icon: 'returns' },
  { key: 'cashBook', path: '/vouchers', section: 'vouchers', icon: 'bank' },
  { key: 'practiceList', path: '/practice-list', section: 'practice-list', icon: 'receipt' },
  { key: 'reports', path: '/reports', section: 'reports', icon: 'reports' },
  { key: 'settings', path: '/settings', section: 'settings', icon: 'settings' },
];

const RING_LENGTH = 2 * Math.PI * 28;
let $host = null;
let unsubscribe = null;
let timer = null;
let view = 'chart';

const money = (paisa) => `<span class="money" data-count="${paisa}" data-format="money">${esc(i18n.t('currency.symbol'))} 0</span>`;
const count = (n, format = 'int') => `<span data-count="${n}" data-format="${format}">0</span>`;
const short = (paisa) => `${i18n.t('currency.symbol')} ${Math.round(paisa / 100).toLocaleString('en-US')}`;

function greeting(hour) {
  if (hour < 12) return i18n.t('greet.morning');
  if (hour < 17) return i18n.t('greet.afternoon');
  return i18n.t('greet.evening');
}

function ring(value, max, tone) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  const offset = RING_LENGTH * (1 - share);
  return `
    <svg class="ring ring--${tone}" viewBox="0 0 64 64" aria-hidden="true">
      <circle class="ring-track" cx="32" cy="32" r="28"/>
      <circle class="ring-arc" cx="32" cy="32" r="28" stroke-dasharray="${RING_LENGTH}" stroke-dashoffset="${RING_LENGTH}"
        data-target-offset="${offset}"/>
    </svg>`;
}

/* Decorative nature scene behind the hero: sun, drifting clouds, hills, swaying trees, birds and falling leaves.
   Pure SVG, animated by the CSS in pages.css. Hidden from assistive tech. */
const HERO_SCENE = `<svg class="hero-scene" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="hs-sun"><stop offset="0" stop-color="#fef3c7" stop-opacity="0.9"/><stop offset="1" stop-color="#fef3c7" stop-opacity="0"/></radialGradient>
        </defs>
        <circle class="sc-sun" cx="318" cy="56" r="58" fill="url(#hs-sun)"/>
        <circle cx="318" cy="56" r="20" fill="#fef3c7"/>
        <g class="sc-cloud" style="animation-delay:-10s"><ellipse cx="60" cy="52" rx="26" ry="9" fill="#fff" opacity="0.85"/><ellipse cx="78" cy="46" rx="17" ry="11" fill="#fff" opacity="0.85"/><ellipse cx="46" cy="49" rx="13" ry="8" fill="#fff" opacity="0.85"/></g>
        <g class="sc-cloud" style="animation-duration:52s;animation-delay:-30s"><ellipse cx="200" cy="34" rx="18" ry="6" fill="#fff" opacity="0.6"/><ellipse cx="212" cy="30" rx="11" ry="7" fill="#fff" opacity="0.6"/></g>
        <path d="M0 150C60 118 120 120 180 142S300 116 400 136V200H0Z" fill="#34d399" opacity="0.35"/>
        <path d="M0 170C70 146 150 150 210 168S340 152 400 162V200H0Z" fill="#047857" opacity="0.55"/>
        <g class="sc-tree"><rect x="68" y="150" width="4" height="22" fill="#064e3b"/><circle cx="70" cy="144" r="13" fill="#065f46"/></g>
        <g class="sc-tree" style="animation-delay:-2s"><rect x="95" y="158" width="3" height="14" fill="#064e3b"/><circle cx="96.5" cy="154" r="9" fill="#047857"/></g>
        <g class="sc-tree" style="animation-delay:-3.5s"><rect x="346" y="156" width="4" height="16" fill="#064e3b"/><circle cx="348" cy="150" r="11" fill="#065f46"/></g>
        <g class="sc-bird" style="animation-delay:-6s"><path d="M60 40q3-3 6 0q3-3 6 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></g>
        <g class="sc-bird" style="animation-duration:30s;animation-delay:-16s"><path d="M60 62q2.5-2.5 5 0q2.5-2.5 5 0" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></g>
        <ellipse class="sc-leaf" cx="30" cy="0" rx="3" ry="2" fill="#bbf7d0" style="animation-duration:16s;animation-delay:-11s"/>
        <ellipse class="sc-leaf" cx="96" cy="0" rx="4" ry="2" fill="#fde68a" style="animation-duration:13s;animation-delay:-2s"/>
        <ellipse class="sc-leaf" cx="150" cy="0" rx="3" ry="2" fill="#fbcfe8" style="animation-duration:15s;animation-delay:-7s"/>
        <ellipse class="sc-leaf" cx="210" cy="0" rx="4" ry="2" fill="#bbf7d0" style="animation-duration:11s;animation-delay:-4s"/>
        <ellipse class="sc-leaf" cx="265" cy="0" rx="3" ry="2" fill="#fde68a" style="animation-duration:14s;animation-delay:-9s"/>
        <ellipse class="sc-leaf" cx="330" cy="0" rx="4" ry="2" fill="#fbcfe8" style="animation-duration:12s;animation-delay:-5s"/>
      </svg>`;

function hero(d) {
  return `
    <section class="dash-hero hero" data-anim="rise">
      ${HERO_SCENE}
      <div class="dash-hero-top">
        <span class="hero-kicker">${esc(i18n.t('hero.today'))}</span>
        <span class="hero-date">${esc(formatDate(d.today))}</span>
      </div>
      <p class="hero-amount-label">${esc(i18n.t('hero.sales'))}</p>
      <p class="hero-amount">${money(d.hero.salesTotal)}</p>
      <div class="hero-grid">
        <div><span>${esc(i18n.t('hero.invoices'))}</span><strong>${count(d.hero.invoices)}</strong></div>
        <div><span>${esc(i18n.t('hero.profit'))}</span><strong>${money(d.hero.profit)}</strong></div>
        <div><span>${esc(i18n.t('hero.cashIn'))}</span><strong>${money(d.hero.cashIn)}</strong></div>
        <div><span>${esc(i18n.t('hero.cashOut'))}</span><strong>${money(d.hero.cashOut)}</strong></div>
      </div>
      <div class="hero-actions">
        <a class="btn hero-btn hero-btn--solid" href="#/pos">${esc(i18n.t('hero.newSale'))}</a>
        <a class="btn hero-btn" href="#/purchases/new">${esc(i18n.t('hero.newPurchase'))}</a>
      </div>
    </section>`;
}

function backupNudge(d) {
  const last = d.backup.lastBackupAt;
  const reminder = Number(d.backup.reminderDays) || 0;
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  // Shown when there has never been a backup, or when the weekly (or chosen) reminder is due.
  if (last && !(reminder > 0 && days >= reminder)) return '';
  const text = last ? i18n.t('backup.overdue', { days }) : i18n.t('backup.text');
  return `
    <section class="nudge" data-anim="rise" role="status">
      ${icon('backup')}
      <div><strong>${esc(i18n.t('backup.title'))}</strong><p class="small">${esc(text)}</p></div>
      <a class="btn btn-soft btn-sm" href="#/backup">${esc(i18n.t('backup.button'))}</a>
    </section>`;
}

function attention(d) {
  const a = d.attention;
  const total = Math.max(1, a.productCount);
  const item = (value, labelKey, tone, max, path) => `
    <a class="attn" href="#${path}">
      ${ring(value, max, tone)}
      <span class="attn-num">${count(value)}</span>
      <span class="attn-label">${esc(i18n.t(labelKey))}</span>
    </a>`;
  return `
    <section class="dash-block" data-anim="rise">
      <h2>${esc(i18n.t('attention.title'))}</h2>
      <div class="attn-grid">
        ${item(a.expired, 'attention.expired', 'danger', total, '/expiry')}
        ${item(a.expiring30, 'attention.expiring', 'warn', total, '/expiry')}
        ${item(a.lowOrOut, 'attention.low', 'info', total, '/stock')}
        ${item(a.orderList, 'attention.order', 'brand', Math.max(10, a.orderList), '/demand')}
      </div>
    </section>`;
}

function tiles() {
  const shown = TILES.filter((t) => can(t.section));
  if (!shown.length) return '';
  return `
    <section class="dash-block" data-anim="rise">
      <h2>${esc(i18n.t('tiles.title'))}</h2>
      <div class="tile-grid">
        ${shown.map(
          (t) => `
          <a class="tile" data-accent="${t.accent}" data-tilt href="#${t.path}">
            <span class="tile-icon">${icon(t.icon)}</span>
            <span class="tile-title">${esc(i18n.t(`tile.${t.key}`))}</span>
            <span class="tile-sub tile-urdu" lang="ur">${esc(i18n.t(`tile.${t.key}.sub`))}</span>
          </a>`,
        ).join('')}
      </div>
    </section>`;
}

function more() {
  const shown = MORE.filter((m) => can(m.section));
  if (!shown.length) return '';
  return `
    <section class="dash-block" data-anim="rise">
      <h2>${esc(i18n.t('more.title'))}</h2>
      <div class="more-grid">
        ${shown.map((m) => `<a class="more-item" href="#${m.path}">${icon(m.icon)}<span>${esc(i18n.t(`more.${m.key}`))}</span></a>`).join('')}
      </div>
    </section>`;
}

function overview(d) {
  const o = d.overview;
  const card = (labelKey, value) => `<div class="card stat"><span class="stat-label">${esc(i18n.t(labelKey))}</span><span class="stat-value">${money(value)}</span></div>`;
  return `
    <section class="dash-block" data-anim="rise">
      <h2>${esc(i18n.t('overview.title'))}</h2>
      <div class="stat-grid">
        ${card('overview.receivable', o.receivable)}
        ${card('overview.payable', o.payable)}
        ${card('overview.stockValue', o.stockCost)}
        ${card('overview.cash', o.cashHeld)}
      </div>
    </section>`;
}

function chart(d) {
  const max = Math.max(1, ...d.week.map((w) => w.total));
  const bars = d.week
    .map((w, i) => `<div class="chart-bar" style="--h:${Math.max(4, (w.total / max) * 100)}%;--i:${i}" data-value="${esc(short(w.total))}" title="${esc(formatDate(w.day))}"></div>`)
    .join('');
  const rows = d.week
    .map((w) => `<tr><td data-label="${esc(i18n.t('chart.day'))}">${esc(formatDate(w.day))}</td><td class="num" data-label="${esc(i18n.t('chart.sales'))}">${esc(short(w.total))}</td><td class="num" data-label="${esc(i18n.t('chart.bills'))}">${w.count}</td></tr>`)
    .join('');
  return `
    <section class="dash-block card" data-anim="rise">
      <div class="block-head">
        <h2>${esc(i18n.t('chart.title'))}</h2>
        <div class="seg" role="radiogroup" data-indicator>
          <span class="seg-indicator" aria-hidden="true"></span>
          <button type="button" class="seg-option" role="radio" data-view="chart" aria-checked="${view === 'chart'}">${esc(i18n.t('chart.asChart'))}</button>
          <button type="button" class="seg-option" role="radio" data-view="table" aria-checked="${view === 'table'}">${esc(i18n.t('chart.asTable'))}</button>
        </div>
      </div>
      <div class="chart" data-panel="chart" ${view === 'table' ? 'hidden' : ''}>${bars}</div>
      <div class="table-wrap" data-panel="table" ${view === 'chart' ? 'hidden' : ''}>
        <table class="table table-cards"><thead><tr><th>${esc(i18n.t('chart.day'))}</th><th class="num">${esc(i18n.t('chart.sales'))}</th><th class="num">${esc(i18n.t('chart.bills'))}</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
    </section>`;
}

function lists(d) {
  const top = d.topMedicines.length
    ? `<ol class="plain-list">${d.topMedicines.map((m) => `<li><span>${esc(m.name)}</span>${money(m.amount)}</li>`).join('')}</ol>`
    : `<p class="muted small">${esc(i18n.t('top.empty'))}</p>`;
  const expiring = d.expiringSoon.length
    ? `<ul class="plain-list">${d.expiringSoon
        .map(
          (b) => `<li><span>${esc(b.productName)} <span class="muted small">${esc(b.batchNo)}</span></span>
            <span class="badge ${b.bucket === 'expired' ? 'badge--danger' : 'badge--warn'}">${esc(
              b.bucket === 'expired' ? i18n.t('daysAgo', { days: Math.abs(b.days) }) : i18n.t('daysLeft', { days: b.days }),
            )}</span></li>`,
        )
        .join('')}</ul>`
    : `<p class="muted small">${esc(i18n.t('expiringSoon.empty'))}</p>`;
  const recent = d.recentSales.length
    ? `<ul class="plain-list">${d.recentSales
        .map((s) => `<li><span>${esc(s.number)} <span class="muted small">${esc(formatDate(s.date))}</span></span>${money(s.total)}</li>`)
        .join('')}</ul>`
    : `<p class="muted small">${esc(i18n.t('recent.empty'))}</p>`;
  const cards = [
    can('sales') && `<div class="card"><div class="block-head"><h2>${esc(i18n.t('top.title'))}</h2></div>${top}</div>`,
    can('expiry') && `<div class="card"><div class="block-head"><h2>${esc(i18n.t('expiringSoon.title'))}</h2><a class="small" href="#/expiry">${esc(i18n.t('seeAll'))}</a></div>${expiring}</div>`,
    can('sales') && `<div class="card"><div class="block-head"><h2>${esc(i18n.t('recent.title'))}</h2><a class="small" href="#/sales">${esc(i18n.t('seeAll'))}</a></div>${recent}</div>`,
  ].filter(Boolean);
  if (!cards.length) return '';
  return `
    <section class="dash-lists" data-anim="rise">${cards.join('')}</section>`;
}

function markup(d) {
  return `
    <div class="dash" data-anim="rise">
      <header class="dash-greet">
        <p class="muted">${esc(greeting(d.greetingHour))}</p>
        <h1>${esc(d.pharmacyName || i18n.t('nav.home'))}</h1>
        <p class="muted small">${esc(i18n.t('greet.sub', { pharmacy: d.pharmacyName || '' }))}</p>
      </header>
      ${can('sales') ? hero(d) : ''}
      ${can('backup') ? backupNudge(d) : ''}
      ${can('expiry') || can('stock') || can('demand') ? attention(d) : ''}
      ${can('sales') && can('practice') ? mix.html() : ''}
      ${tiles()}
      ${more()}
      ${can('vouchers') ? overview(d) : ''}
      ${can('sales') ? chart(d) : ''}
      ${lists(d)}
    </div>`;
}

/** Draws the rings and counts the numbers. Called after every render. */
function animateIn() {
  if (!$host) return;
  anim.scanCounts($host[0]);
  anim.syncIndicators($host[0]);
  requestAnimationFrame(() => {
    if (!$host) return; // the page was left before the frame ran
    $host.find('.ring-arc').each(function drawRing() {
      this.style.transition = 'stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1)';
      this.style.strokeDashoffset = this.dataset.targetOffset;
    });
  });
}

function bindViewToggle() {
  $host.on('click', '[data-view]', (event) => {
    view = event.currentTarget.getAttribute('data-view');
    $host.find('[data-panel="chart"]').prop('hidden', view === 'table');
    $host.find('[data-panel="table"]').prop('hidden', view === 'chart');
  });
}

async function load() {
  const data = await getDashboard({ today: todayISO() });
  if (!$host) return;
  $host.html(markup(data));
  animateIn();
  await mix.mount($host);
}

export async function render($root) {
  // Work inside a child element: handlers bound to #view itself would pile up across visits.
  $root.html('<div class="dash-root"></div>');
  $host = $root.children('.dash-root');
  bindViewToggle();
  mix.bind($host);
  $host.html(
    `<div class="skeleton skeleton-card" aria-hidden="true"></div><div class="stack">${'<div class="skeleton skeleton-line"></div>'.repeat(3)}</div>`,
  );
  await load();
  // Keep the numbers current: a sale or a purchase elsewhere refreshes this screen shortly after.
  unsubscribe = events.on('data:changed', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load().catch((err) => console.error('[dashboard] refresh failed', err)), 350);
  });
}

export function destroy() {
  mix.destroy();
  clearTimeout(timer);
  unsubscribe?.();
  unsubscribe = null;
  $host = null;
}
