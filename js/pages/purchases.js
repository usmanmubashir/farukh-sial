// Purchases: stock-in documents by period, with search (number or supplier), a status filter, summary tiles
// and a detail sheet. "New purchase" opens the purchase screen. A purchase can be returned from its sheet.
import * as events from '../core/events.js';
import { debounce } from '../core/resilience.js';
import { navigate } from '../core/router.js';
import { esc, money } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { formatDate } from '../core/dates.js';
import { downloadText, rupeesForCsv, toCsv } from '../core/csv.js';
import { listPurchases, getPurchaseWithItems } from '../services/purchases.js';
import { listReturns } from '../services/returns.js';
import * as shared from './_doc-shared.js';

export const route = '/purchases';
export const title = 'nav.purchases';

let $host = null;
let unsubscribe = null;
let state = { period: 'month', from: '', to: '', status: 'all', query: '' };
let rows = [];
let names = null;

const statusOf = (purchase) => (purchase.balance > 0 ? 'due' : 'paid');

function supplierName(purchase) {
  return names?.supplier.get(purchase.supplierId)?.name ?? t('doc.walkIn');
}

function visibleRows() {
  const q = state.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (state.status === 'all' || statusOf(row) === state.status) &&
      (!q || row.number.toLowerCase().includes(q) || supplierName(row).toLowerCase().includes(q)),
  );
}

function tilesHtml(shown) {
  const sum = (key) => shown.reduce((total, row) => total + (row[key] ?? 0), 0);
  return shared.statTiles([
    [t('purch.tile.documents'), `<span data-count="${shown.length}">${shown.length}</span>`],
    [t('purch.tile.total'), money(sum('total'))],
    [t('purch.tile.paid'), money(sum('paid'))],
    [t('purch.tile.due'), money(sum('balance'))],
  ]);
}

function rowHtml(row) {
  const status = statusOf(row);
  return `
    <tr data-id="${esc(row.id)}">
      <td data-label="${esc(t('purch.col.date'))}">${esc(formatDate(row.date))}</td>
      <td data-label="${esc(t('purch.col.number'))}"><button type="button" class="link-btn doc-open" data-id="${esc(row.id)}">${esc(row.number)}</button></td>
      <td data-label="${esc(t('purch.col.supplier'))}">${esc(supplierName(row))}</td>
      <td class="num" data-label="${esc(t('purch.col.total'))}">${money(row.total)}</td>
      <td class="num" data-label="${esc(t('purch.col.paid'))}">${money(row.paid)}</td>
      <td class="num" data-label="${esc(t('purch.col.due'))}">${money(row.balance)}</td>
      <td data-label="${esc(t('purch.col.status'))}">${shared.badge(t(`purch.status.${status}`), status === 'due' ? 'warn' : 'ok')}</td>
    </tr>`;
}

function paint() {
  const shown = visibleRows();
  $host.find('.doc-tiles-wrap').html(tilesHtml(shown));
  $host.find('.doc-count').text(t('purch.count', { count: shown.length }));
  $host.find('tbody').html(shown.length ? shown.map(rowHtml).join('') : shared.emptyRow(7, t('purch.none')));
}

async function load() {
  rows = await listPurchases(shared.rangeOf(state));
  names = await shared.partyNames();
  if (!$host) return;
  paint();
}

function shell() {
  return `
    ${shared.pageHead(
      t('purch.title'),
      `<button type="button" class="btn btn-ghost" data-action="csv">${esc(t('doc.csv'))}</button>
       <button type="button" class="btn btn-primary" data-action="new">${esc(t('purch.new'))}</button>`,
    )}
    ${shared.periodBar(state)}
    <div class="doc-filters">
      ${shared.searchField(t('purch.search'), 'doc-search')}
      ${shared.chipGroup('status', [['all', t('doc.all')], ['due', t('purch.status.due')], ['paid', t('purch.status.paid')]], state.status, t('purch.status.label'))}
    </div>
    <div class="doc-tiles-wrap"></div>
    <div class="table-wrap">
      <table class="table table-cards">
        <thead><tr>
          <th>${esc(t('purch.col.date'))}</th><th>${esc(t('purch.col.number'))}</th><th>${esc(t('purch.col.supplier'))}</th>
          <th class="num">${esc(t('purch.col.total'))}</th><th class="num">${esc(t('purch.col.paid'))}</th>
          <th class="num">${esc(t('purch.col.due'))}</th><th>${esc(t('purch.col.status'))}</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>`;
}

async function openDetail(id) {
  const purchase = await getPurchaseWithItems(id);
  const returns = await listReturns({ type: 'purchase' });
  const sent = returns.filter((r) => r.purchaseId === id);
  const itemRows = purchase.items
    .map(
      (item) => `
      <tr>
        <td data-label="${esc(t('purch.col.medicine'))}">${esc(item.productName)}</td>
        <td data-label="${esc(t('purch.col.batch'))}">${esc(item.batchNo)}</td>
        <td data-label="${esc(t('purch.col.expiry'))}">${esc(formatDate(item.expiry))}</td>
        <td class="num" data-label="${esc(t('purch.col.packs'))}">${item.packs}${item.returnedPacks ? ` <span class="muted small">(−${item.returnedPacks})</span>` : ''}</td>
        <td class="num" data-label="${esc(t('purch.col.cost'))}">${money(item.costPerPack)}</td>
        <td class="num" data-label="${esc(t('purch.col.amount'))}">${money(item.amount)}</td>
      </tr>`,
    )
    .join('');
  const $body = $(`
    <div class="stack doc-sheet">
      <p class="muted small">${esc(formatDate(purchase.date))} · ${esc(supplierName(purchase))}</p>
      <div class="table-wrap"><table class="table table-cards">
        <thead><tr>
          <th>${esc(t('purch.col.medicine'))}</th><th>${esc(t('purch.col.batch'))}</th><th>${esc(t('purch.col.expiry'))}</th>
          <th class="num">${esc(t('purch.col.packs'))}</th><th class="num">${esc(t('purch.col.cost'))}</th><th class="num">${esc(t('purch.col.amount'))}</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
      </table></div>
      <dl class="doc-totals">
        <div><dt>${esc(t('purch.col.total'))}</dt><dd>${money(purchase.total)}</dd></div>
        <div><dt>${esc(t('purch.col.paid'))}</dt><dd>${money(purchase.paid)}</dd></div>
        <div><dt>${esc(t('purch.col.due'))}</dt><dd>${money(purchase.balance)}</dd></div>
        ${purchase.returnedValue ? `<div><dt>${esc(t('purch.returned'))}</dt><dd>${money(purchase.returnedValue)}</dd></div>` : ''}
      </dl>
      ${sent.length ? `<p class="muted small">${esc(t('purch.returnsMade', { count: sent.length, numbers: sent.map((r) => r.number).join(', ') }))}</p>` : ''}
      <div class="row">
        <button type="button" class="btn btn-primary" data-return>${esc(t('purch.returnItems'))}</button>
      </div>
    </div>`);
  const dialog = shared.openDetail({ title: purchase.number, body: $body });
  $body.find('[data-return]').on('click', () => {
    dialog.close();
    navigate(`/returns/new?purchase=${encodeURIComponent(id)}`);
  });
}

function exportCsv() {
  const columns = [
    { label: t('purch.col.date'), value: (r) => r.date },
    { label: t('purch.col.number'), value: (r) => r.number },
    { label: t('purch.col.supplier'), value: (r) => supplierName(r) },
    { label: t('purch.col.total'), value: (r) => rupeesForCsv(r.total) },
    { label: t('purch.col.paid'), value: (r) => rupeesForCsv(r.paid) },
    { label: t('purch.col.due'), value: (r) => rupeesForCsv(r.balance) },
    { label: t('purch.col.status'), value: (r) => t(`purch.status.${statusOf(r)}`) },
  ];
  downloadText(`purchases-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(columns, visibleRows()));
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
  $host.on('click', '[data-status]', (event) => {
    state.status = event.currentTarget.getAttribute('data-status');
    $host.find('[data-status]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    paint();
  });
  $host.on('click', '.doc-open', (event) => openDetail(event.currentTarget.getAttribute('data-id')));
  $host.on('click', '[data-action]', (event) => {
    const action = event.currentTarget.getAttribute('data-action');
    if (action === 'new') navigate('/purchases/new');
    if (action === 'csv') exportCsv();
  });
}

export async function render($root) {
  state = { period: 'month', from: '', to: '', status: 'all', query: '' };
  $root.html('<div class="doc-root"></div>');
  $host = $root.children('.doc-root');
  $host.html(shell());
  bind();
  await load();
  unsubscribe = events.on('data:changed', ({ stores }) => {
    if (stores.some((s) => ['purchases', 'purchaseItems', 'returns', 'suppliers'].includes(s))) load();
  });
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
  $host = null;
  rows = [];
}
