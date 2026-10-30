// Home screen: greeting, today's hero card, nudges, attention rings, big action tiles, overview,
// a seven-day chart (or table), top medicines, expiring soon and recent sales.
import * as anim from '../core/anim.js';
import * as events from '../core/events.js';
import * as i18n from '../core/i18n.js';
import { formatDate, todayISO } from '../core/dates.js';
import { esc, icon } from '../core/ui.js';
import { getDashboard } from '../services/dashboard.js';

export const route = '/dashboard';
export const title = 'nav.home';

const TILES = [
  { key: 'sell', path: '/pos', accent: 'green', icon: 'cart' },
  { key: 'buy', path: '/purchases', accent: 'blue', icon: 'purchase' },
  { key: 'expiry', path: '/expiry', accent: 'orange', icon: 'clock' },
  { key: 'stock', path: '/stock', accent: 'teal', icon: 'stock' },
  { key: 'orderList', path: '/demand', accent: 'purple', icon: 'order' },
  { key: 'batchTrace', path: '/trace', accent: 'cyan', icon: 'batch' },
  { key: 'rxRegister', path: '/rx', accent: 'pink', icon: 'rx' },
  { key: 'customers', path: '/customers', accent: 'amber', icon: 'customers' },
  { key: 'practice', path: '/practice', accent: 'practice', icon: 'pulse' },
];

const MORE = [
  { key: 'medicines', path: '/products', icon: 'products' },
  { key: 'sales', path: '/sales', icon: 'receipt' },
  { key: 'purchases', path: '/purchases', icon: 'purchase' },
  { key: 'suppliers', path: '/suppliers', icon: 'suppliers' },
  { key: 'returns', path: '/returns', icon: 'returns' },
  { key: 'cashBook', path: '/vouchers', icon: 'bank' },
  { key: 'practiceList', path: '/practice-list', icon: 'receipt' },
  { key: 'reports', path: '/reports', icon: 'reports' },
  { key: 'settings', path: '/settings', icon: 'settings' },
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

function hero(d) {
  return `
    <section class="dash-hero hero" data-anim="rise">
      <span class="capsule" style="--x:6%;--y:14%;--rot:-18deg;--t:7s"></span>
      <span class="capsule capsule--half" style="--x:30%;--y:66%;--rot:22deg;--t:9s"></span>
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
  return `
    <section class="dash-block" data-anim="rise">
      <h2>${esc(i18n.t('tiles.title'))}</h2>
      <div class="tile-grid">
        ${TILES.map(
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
  return `
    <section class="dash-block" data-anim="rise">
      <h2>${esc(i18n.t('more.title'))}</h2>
      <div class="more-grid">
        ${MORE.map((m) => `<a class="more-item" href="#${m.path}">${icon(m.icon)}<span>${esc(i18n.t(`more.${m.key}`))}</span></a>`).join('')}
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
  return `
    <section class="dash-lists" data-anim="rise">
      <div class="card"><div class="block-head"><h2>${esc(i18n.t('top.title'))}</h2></div>${top}</div>
      <div class="card"><div class="block-head"><h2>${esc(i18n.t('expiringSoon.title'))}</h2><a class="small" href="#/expiry">${esc(i18n.t('seeAll'))}</a></div>${expiring}</div>
      <div class="card"><div class="block-head"><h2>${esc(i18n.t('recent.title'))}</h2><a class="small" href="#/sales">${esc(i18n.t('seeAll'))}</a></div>${recent}</div>
    </section>`;
}

function markup(d) {
  return `
    <div class="dash" data-anim="rise">
      <header class="dash-greet">
        <p class="muted">${esc(greeting(d.greetingHour))}</p>
        <h1>${esc(d.pharmacyName || i18n.t('nav.home'))}</h1>
        <p class="muted small">${esc(i18n.t('greet.sub', { pharmacy: d.pharmacyName || '' }))}</p>
      </header>
      ${hero(d)}
      ${backupNudge(d)}
      ${attention(d)}
      ${tiles()}
      ${more()}
      ${overview(d)}
      ${chart(d)}
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
}

export async function render($root) {
  // Work inside a child element: handlers bound to #view itself would pile up across visits.
  $root.html('<div class="dash-root"></div>');
  $host = $root.children('.dash-root');
  bindViewToggle();
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
  clearTimeout(timer);
  unsubscribe?.();
  unsubscribe = null;
  $host = null;
}
