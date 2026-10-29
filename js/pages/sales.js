// Sales: every invoice by period, with search (invoice number, customer or patient), a status filter, summary tiles
// and a detail sheet with items, payments, profit, reprint, WhatsApp share and "Return items".
import * as events from '../core/events.js';
import { debounce } from '../core/resilience.js';
import { navigate } from '../core/router.js';
import { esc, money } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { formatDate } from '../core/dates.js';
import { downloadText, rupeesForCsv, toCsv } from '../core/csv.js';
import { listSales, getSaleWithItems } from '../services/sales.js';
import { buildReceipt, receiptText } from '../services/receipt.js';
import { printInBrowser } from '../services/printing.js';
import { whatsappLink } from '../services/demand.js';
import * as shared from './_doc-shared.js';

export const route = '/sales';
export const title = 'nav.sales';

let $host = null;
let unsubscribe = null;
let state = { period: 'month', from: '', to: '', status: 'all', query: '' };
let rows = [];
let names = null;

/** paid | credit | returned | void. A voided sale is never shown as paid. */
function statusOf(sale) {
  if (sale.status === 'void') return 'void';
  if (sale.status === 'returned' || sale.status === 'partially_returned') return 'returned';
  if (sale.balance > 0) return 'credit';
  return 'paid';
}

const STATUS_TONE = { paid: 'ok', credit: 'warn', returned: 'info', void: 'danger' };

function customerName(sale) {
  return sale.customerId ? names?.customer.get(sale.customerId)?.name ?? '' : '';
}

function visibleRows() {
  const q = state.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (state.status === 'all' || statusOf(row) === state.status) &&
      (!q ||
        row.number.toLowerCase().includes(q) ||
        customerName(row).toLowerCase().includes(q) ||
        String(row.patient ?? '').toLowerCase().includes(q)),
  );
}

function tilesHtml(shown) {
  const live = shown.filter((row) => row.status !== 'void');
  const sum = (list, key) => list.reduce((total, row) => total + (row[key] ?? 0), 0);
  return shared.statTiles([
    [t('sales.tile.invoices'), `<span data-count="${live.length}">${live.length}</span>`],
    [t('sales.tile.total'), money(sum(live, 'total'))],
    [t('sales.tile.paid'), money(sum(live, 'paid'))],
    [t('sales.tile.credit'), money(sum(live, 'balance'))],
  ]);
}

function rowHtml(row) {
  const status = statusOf(row);
  const who = customerName(row) || t('doc.walkIn');
  return `
    <tr data-id="${esc(row.id)}">
      <td data-label="${esc(t('sales.col.date'))}">${esc(formatDate(row.date))}</td>
      <td data-label="${esc(t('sales.col.invoice'))}"><button type="button" class="link-btn doc-open" data-id="${esc(row.id)}">${esc(row.number)}</button></td>
      <td data-label="${esc(t('sales.col.customer'))}">${esc(who)}${row.patient ? `<span class="muted small"> · ${esc(row.patient)}</span>` : ''}</td>
      <td class="num" data-label="${esc(t('sales.col.total'))}">${money(row.total)}</td>
      <td class="num" data-label="${esc(t('sales.col.paid'))}">${money(row.paid)}</td>
      <td class="num" data-label="${esc(t('sales.col.balance'))}">${money(row.balance)}</td>
      <td data-label="${esc(t('sales.col.status'))}">${shared.badge(t(`sales.status.${status}`), STATUS_TONE[status])}</td>
    </tr>`;
}

function paint() {
  const shown = visibleRows();
  $host.find('.doc-tiles-wrap').html(tilesHtml(shown));
  $host.find('.doc-count').text(t('sales.count', { count: shown.length }));
  $host.find('tbody').html(shown.length ? shown.map(rowHtml).join('') : shared.emptyRow(7, t('sales.none')));
}

async function load() {
  rows = await listSales(shared.rangeOf(state));
  names = await shared.partyNames();
  if (!$host) return;
  paint();
}

function shell() {
  return `
    ${shared.pageHead(t('sales.title'), `<button type="button" class="btn btn-ghost" data-action="csv">${esc(t('doc.csv'))}</button>`)}
    ${shared.periodBar(state)}
    <div class="doc-filters">
      ${shared.searchField(t('sales.search'), 'doc-search')}
      ${shared.chipGroup(
        'status',
        [
          ['all', t('doc.all')],
          ['paid', t('sales.status.paid')],
          ['credit', t('sales.status.credit')],
          ['returned', t('sales.status.returned')],
          ['void', t('sales.status.void')],
        ],
        state.status,
        t('sales.status.label'),
      )}
    </div>
    <div class="doc-tiles-wrap"></div>
    <div class="table-wrap">
      <table class="table table-cards">
        <thead><tr>
          <th>${esc(t('sales.col.date'))}</th><th>${esc(t('sales.col.invoice'))}</th><th>${esc(t('sales.col.customer'))}</th>
          <th class="num">${esc(t('sales.col.total'))}</th><th class="num">${esc(t('sales.col.paid'))}</th>
          <th class="num">${esc(t('sales.col.balance'))}</th><th>${esc(t('sales.col.status'))}</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>`;
}

const PAYMENT_LABEL = { cash: 'pay.cash', card: 'pay.card', bank: 'pay.bank', mobile: 'pay.wallet' };

async function openDetail(id) {
  const sale = await getSaleWithItems(id);
  const status = statusOf(sale);
  const customer = sale.customerId ? names?.customer.get(sale.customerId) : null;
  const itemRows = sale.items
    .map((item) => {
      const qty = [item.packs ? `${item.packs} ${t('doc.packs')}` : '', item.looseUnits ? `${item.looseUnits} ${t('doc.loose')}` : '']
        .filter(Boolean)
        .join(' + ');
      const batches = (item.allocations ?? []).map((a) => a.batchNo).join(', ');
      return `
        <tr>
          <td data-label="${esc(t('sales.col.medicine'))}">${esc(item.productName)} <span class="muted small">${esc(item.strength ?? '')}</span></td>
          <td data-label="${esc(t('sales.col.qty'))}">${esc(qty)}${item.returnedUnits ? ` <span class="muted small">(${esc(t('sales.returnedUnits', { units: item.returnedUnits }))})</span>` : ''}</td>
          <td data-label="${esc(t('sales.col.batch'))}">${esc(batches)}</td>
          <td class="num" data-label="${esc(t('sales.col.amount'))}">${money(item.amount)}</td>
        </tr>`;
    })
    .join('');
  const payments = (sale.payments ?? [])
    .map((p) => `<li>${esc(t(PAYMENT_LABEL[p.method] ?? p.method))} <span class="num">${money(p.amount)}</span></li>`)
    .join('');
  const canReturn = status !== 'void' && sale.total - (sale.returnedTotal ?? 0) > 0;

  const $body = $(`
    <div class="stack doc-sheet">
      <p class="muted small">${esc(formatDate(sale.date))} · ${esc(customer?.name ?? t('doc.walkIn'))}
        ${sale.patient ? ` · ${esc(t('sales.patient'))}: ${esc(sale.patient)}` : ''}
        ${sale.doctor ? ` · ${esc(t('sales.doctor'))}: ${esc(sale.doctor)}` : ''}</p>
      <div class="table-wrap"><table class="table table-cards">
        <thead><tr>
          <th>${esc(t('sales.col.medicine'))}</th><th>${esc(t('sales.col.qty'))}</th><th>${esc(t('sales.col.batch'))}</th><th class="num">${esc(t('sales.col.amount'))}</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
      </table></div>
      <dl class="doc-totals">
        <div><dt>${esc(t('sales.subtotal'))}</dt><dd>${money(sale.subtotal)}</dd></div>
        ${sale.discount ? `<div><dt>${esc(t('sales.discount'))}</dt><dd>${money(sale.discount)}</dd></div>` : ''}
        ${sale.tax ? `<div><dt>${esc(t('sales.tax'))}</dt><dd>${money(sale.tax)}</dd></div>` : ''}
        <div><dt>${esc(t('sales.col.total'))}</dt><dd>${money(sale.total)}</dd></div>
        <div><dt>${esc(t('sales.col.paid'))}</dt><dd>${money(sale.paid)}</dd></div>
        <div><dt>${esc(t('sales.col.balance'))}</dt><dd>${money(sale.balance)}</dd></div>
        ${sale.returnedTotal ? `<div><dt>${esc(t('sales.returned'))}</dt><dd>${money(sale.returnedTotal)}</dd></div>` : ''}
        <div><dt>${esc(t('sales.profit'))}</dt><dd>${money(sale.profit)}</dd></div>
      </dl>
      ${payments ? `<div><h3 class="doc-legend">${esc(t('sales.payments'))}</h3><ul class="plain-list">${payments}</ul></div>` : ''}
      <div class="row doc-actions">
        <button type="button" class="btn btn-soft" data-reprint ${status === 'void' ? 'disabled' : ''}>${esc(t('sales.reprint'))}</button>
        <a class="btn btn-soft" data-wa target="_blank" rel="noopener">${esc(t('sales.whatsapp'))}</a>
        <button type="button" class="btn btn-primary" data-return ${canReturn ? '' : 'disabled'}>${esc(t('sales.returnItems'))}</button>
      </div>
    </div>`);
  const dialog = shared.openDetail({ title: sale.number, body: $body });

  const model = await buildReceipt(id);
  $body.find('[data-wa]').attr('href', whatsappLink(receiptText(model), customer?.phone ?? ''));
  $body.find('[data-reprint]').on('click', () => printInBrowser(model));
  $body.find('[data-return]').on('click', () => {
    dialog.close();
    navigate(`/returns/new?sale=${encodeURIComponent(id)}`);
  });
}

function exportCsv() {
  const columns = [
    { label: t('sales.col.date'), value: (r) => r.date },
    { label: t('sales.col.invoice'), value: (r) => r.number },
    { label: t('sales.col.customer'), value: (r) => customerName(r) || t('doc.walkIn') },
    { label: t('sales.col.patient'), value: (r) => r.patient ?? '' },
    { label: t('sales.col.doctor'), value: (r) => r.doctor ?? '' },
    { label: t('sales.col.total'), value: (r) => rupeesForCsv(r.total) },
    { label: t('sales.col.paid'), value: (r) => rupeesForCsv(r.paid) },
    { label: t('sales.col.balance'), value: (r) => rupeesForCsv(r.balance) },
    { label: t('sales.col.profit'), value: (r) => rupeesForCsv(r.profit) },
    { label: t('sales.col.status'), value: (r) => t(`sales.status.${statusOf(r)}`) },
  ];
  downloadText(`sales-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(columns, visibleRows()));
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
  $host.on('click', '[data-action="csv"]', exportCsv);
}

export async function render($root) {
  state = { period: 'month', from: '', to: '', status: 'all', query: '' };
  $root.html('<div class="doc-root"></div>');
  $host = $root.children('.doc-root');
  $host.html(shell());
  bind();
  await load();
  unsubscribe = events.on('data:changed', ({ stores }) => {
    if (stores.some((s) => ['sales', 'saleItems', 'returns', 'customers'].includes(s))) load();
  });
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
  $host = null;
  rows = [];
}

