// Returns: every sale return and purchase return by date and type. A return always starts from its original
// document, so the banner points there, and the list can open each return's detail sheet.
import * as events from '../core/events.js';
import { debounce } from '../core/resilience.js';
import { navigate } from '../core/router.js';
import { esc, money } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { formatDate } from '../core/dates.js';
import { downloadText, rupeesForCsv, toCsv } from '../core/csv.js';
import { listReturns, getReturnWithItems } from '../services/returns.js';
import { listSales } from '../services/sales.js';
import { listPurchases } from '../services/purchases.js';
import * as shared from './_doc-shared.js';

export const route = '/returns';
export const title = 'nav.returns';

let $host = null;
let unsubscribe = null;
let state = { period: 'month', from: '', to: '', type: 'all', query: '' };
let rows = [];
let names = null;
let originals = new Map(); // document id → { number, partyId }

const partyOf = (row) =>
  row.type === 'sale'
    ? names?.customer.get(row.customerId)?.name ?? t('doc.walkIn')
    : names?.supplier.get(row.supplierId)?.name ?? t('doc.walkIn');

function visibleRows() {
  const q = state.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (state.type === 'all' || row.type === state.type) &&
      (!q || row.number.toLowerCase().includes(q) || (originals.get(row.saleId ?? row.purchaseId)?.number ?? '').toLowerCase().includes(q) || partyOf(row).toLowerCase().includes(q)),
  );
}

function tilesHtml(shown) {
  const sum = (key) => shown.reduce((total, row) => total + (row[key] ?? 0), 0);
  return shared.statTiles([
    [t('ret.tile.count'), `<span data-count="${shown.length}">${shown.length}</span>`],
    [t('ret.tile.value'), money(sum('gross'))],
    [t('ret.tile.refund'), money(sum('refund'))],
    [t('ret.tile.credit'), money(sum('credit'))],
  ]);
}

function rowHtml(row) {
  const original = originals.get(row.saleId ?? row.purchaseId)?.number ?? '';
  const isSale = row.type === 'sale';
  return `
    <tr data-id="${esc(row.id)}">
      <td data-label="${esc(t('ret.col.date'))}">${esc(formatDate(row.date))}</td>
      <td data-label="${esc(t('ret.col.number'))}"><button type="button" class="link-btn doc-open" data-id="${esc(row.id)}">${esc(row.number)}</button></td>
      <td data-label="${esc(t('ret.col.type'))}">${shared.badge(t(`ret.type.${row.type}`), isSale ? 'info' : 'accent')}</td>
      <td data-label="${esc(t('ret.col.original'))}">${esc(original)}</td>
      <td data-label="${esc(t('ret.col.party'))}">${esc(partyOf(row))}</td>
      <td class="num" data-label="${esc(t('ret.col.value'))}">${money(row.gross)}</td>
      <td class="num" data-label="${esc(t('ret.col.refund'))}">${money(row.refund)}</td>
      <td class="num" data-label="${esc(t('ret.col.credit'))}">${money(row.credit)}</td>
    </tr>`;
}

function paint() {
  const shown = visibleRows();
  $host.find('.doc-tiles-wrap').html(tilesHtml(shown));
  $host.find('.doc-count').text(t('ret.count', { count: shown.length }));
  $host.find('tbody').html(shown.length ? shown.map(rowHtml).join('') : shared.emptyRow(8, t('ret.none')));
}

async function load() {
  const range = shared.rangeOf(state);
  rows = await listReturns({ ...range, type: '' });
  names = await shared.partyNames();
  const [sales, purchases] = await Promise.all([listSales({}), listPurchases({})]);
  originals = new Map([
    ...sales.map((s) => [s.id, { number: s.number }]),
    ...purchases.map((p) => [p.id, { number: p.number }]),
  ]);
  if (!$host) return;
  paint();
}

function shell() {
  return `
    ${shared.pageHead(t('ret.title'), '')}
    <div class="banner banner-info doc-banner" role="note">
      <p>${esc(t('ret.banner'))}</p>
      <div class="row">
        <button type="button" class="btn btn-soft btn-sm" data-go="/sales">${esc(t('ret.goSales'))}</button>
        <button type="button" class="btn btn-soft btn-sm" data-go="/purchases">${esc(t('ret.goPurchases'))}</button>
      </div>
    </div>
    ${shared.periodBar(state)}
    <div class="doc-filters">
      ${shared.searchField(t('ret.search'), 'doc-search')}
      ${shared.chipGroup(
        'type',
        [['all', t('doc.all')], ['sale', t('ret.type.sale')], ['purchase', t('ret.type.purchase')]],
        state.type,
        t('ret.type.label'),
      )}
      <button type="button" class="btn btn-ghost btn-sm" data-action="csv">${esc(t('doc.csv'))}</button>
    </div>
    <div class="doc-tiles-wrap"></div>
    <div class="table-wrap">
      <table class="table table-cards">
        <thead><tr>
          <th>${esc(t('ret.col.date'))}</th><th>${esc(t('ret.col.number'))}</th><th>${esc(t('ret.col.type'))}</th>
          <th>${esc(t('ret.col.original'))}</th><th>${esc(t('ret.col.party'))}</th>
          <th class="num">${esc(t('ret.col.value'))}</th><th class="num">${esc(t('ret.col.refund'))}</th><th class="num">${esc(t('ret.col.credit'))}</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>`;
}

async function openDetail(id) {
  const doc = await getReturnWithItems(id);
  const original = originals.get(doc.saleId ?? doc.purchaseId)?.number ?? '';
  const itemRows = doc.items
    .map(
      (item) => `
      <tr>
        <td data-label="${esc(t('ret.col.medicine'))}">${esc(item.productName)}</td>
        <td data-label="${esc(t('ret.col.qty'))}">${esc(doc.type === 'sale' ? t('ret.units', { units: item.units }) : t('ret.packs', { packs: item.packs }))}</td>
        <td class="num" data-label="${esc(t('ret.col.value'))}">${money(item.amount)}</td>
      </tr>`,
    )
    .join('');
  const $body = $(`
    <div class="stack doc-sheet">
      <p class="muted small">${esc(formatDate(doc.date))} · ${esc(partyOf(doc))} · ${esc(t('ret.originalLabel'))}: ${esc(original)}</p>
      <div class="table-wrap"><table class="table table-cards">
        <thead><tr><th>${esc(t('ret.col.medicine'))}</th><th>${esc(t('ret.col.qty'))}</th><th class="num">${esc(t('ret.col.value'))}</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table></div>
      <dl class="doc-totals">
        <div><dt>${esc(t('ret.col.value'))}</dt><dd>${money(doc.gross)}</dd></div>
        <div><dt>${esc(t('ret.col.refund'))}</dt><dd>${money(doc.refund)}</dd></div>
        <div><dt>${esc(t('ret.col.credit'))}</dt><dd>${money(doc.credit)}</dd></div>
      </dl>
      ${doc.reason ? `<p class="small">${esc(t('ret.reason'))}: ${esc(doc.reason)}</p>` : ''}
    </div>`);
  shared.openDetail({ title: doc.number, body: $body });
}

function exportCsv() {
  const columns = [
    { label: t('ret.col.date'), value: (r) => r.date },
    { label: t('ret.col.number'), value: (r) => r.number },
    { label: t('ret.col.type'), value: (r) => t(`ret.type.${r.type}`) },
    { label: t('ret.col.original'), value: (r) => originals.get(r.saleId ?? r.purchaseId)?.number ?? '' },
    { label: t('ret.col.party'), value: (r) => partyOf(r) },
    { label: t('ret.col.value'), value: (r) => rupeesForCsv(r.gross) },
    { label: t('ret.col.refund'), value: (r) => rupeesForCsv(r.refund) },
    { label: t('ret.col.credit'), value: (r) => rupeesForCsv(r.credit) },
    { label: t('ret.col.reason'), value: (r) => r.reason ?? '' },
  ];
  downloadText(`returns-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(columns, visibleRows()));
}

function bind() {
  $host.on('click', '[data-period]', (event) => {
    $host.find('[data-period]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    state.period = event.currentTarget.getAttribute('data-period');
    $host.find('[name="from"], [name="to"]').val('');
    Object.assign(state, { from: '', to: '' });
    load();
  });
  $host.on('change', '[name="from"], [name="to"]', () => {
    $host.find('[data-period]').attr('aria-pressed', 'false');
    Object.assign(state, shared.readPeriod($host), { period: 'custom' });
    load();
  });
  const searchPaint = debounce(() => paint(), 150);
  $host.on('input', '.doc-search', (event) => {
    state.query = event.currentTarget.value;
    searchPaint();
  });
  $host.on('click', '[data-type]', (event) => {
    state.type = event.currentTarget.getAttribute('data-type');
    $host.find('[data-type]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    paint();
  });
  $host.on('click', '.doc-open', (event) => openDetail(event.currentTarget.getAttribute('data-id')));
  $host.on('click', '[data-go]', (event) => navigate(event.currentTarget.getAttribute('data-go')));
  $host.on('click', '[data-action="csv"]', exportCsv);
}

export async function render($root) {
  state = { period: 'month', from: '', to: '', type: 'all', query: '' };
  $root.html('<div class="doc-root"></div>');
  $host = $root.children('.doc-root');
  $host.html(shell());
  bind();
  await load();
  unsubscribe = events.on('data:changed', ({ stores }) => {
    if (stores.some((s) => ['returns', 'returnItems', 'sales', 'purchases', 'customers', 'suppliers'].includes(s))) load();
  });
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
  $host = null;
  rows = [];
  originals = new Map();
}
