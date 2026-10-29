// Batch trace, for recalls. Type a batch number or a medicine name. For each matching batch the screen shows
// where it came from (purchase and supplier), how much is on the shelf, and every customer who bought from it,
// with the date and the quantity. Print or export the same list as CSV.
import { esc, money } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { formatDate } from '../core/dates.js';
import { downloadText, toCsv } from '../core/csv.js';
import { traceBatches } from '../services/trace.js';
import { printPage } from '../services/printing.js';
import * as db from '../core/db.js';
import * as shared from './_doc-shared.js';

export const route = '/trace';
export const title = 'nav.batchTrace';

let $host = null;
let results = [];
let query = '';
let timer = null;
let pharmacyName = '';

function expiryBadge(batch) {
  if (batch.days < 0) return shared.badge(t('trace.expired'), 'danger');
  if (batch.days <= 90) return shared.badge(t('trace.soon'), 'warn');
  return shared.badge(t('trace.ok'), 'ok');
}

function batchHtml(batch) {
  const stock = `${batch.packs} ${t('doc.packs')}${batch.looseUnits ? ` + ${batch.looseUnits} ${t('doc.loose')}` : ''}`;
  const bought = batch.purchases.length
    ? batch.purchases
        .map(
          (p) => `<tr>
            <td data-label="${esc(t('trace.col.date'))}">${esc(p.date ? formatDate(p.date) : '')}</td>
            <td data-label="${esc(t('trace.col.number'))}">${esc(p.number)}</td>
            <td data-label="${esc(t('trace.col.supplier'))}">${esc(p.supplier || t('doc.walkIn'))}</td>
            <td class="num" data-label="${esc(t('trace.col.packs'))}">${esc(p.packs)}</td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="muted">${esc(t('trace.noPurchase'))}</td></tr>`;
  const sold = batch.sales.length
    ? batch.sales
        .map(
          (s) => `<tr>
            <td data-label="${esc(t('trace.col.date'))}">${esc(formatDate(s.date))}</td>
            <td data-label="${esc(t('trace.col.invoice'))}">${esc(s.number)}</td>
            <td data-label="${esc(t('trace.col.customer'))}">${esc(s.customer || t('doc.walkIn'))}</td>
            <td data-label="${esc(t('trace.col.phone'))}">${esc(s.phone)}</td>
            <td class="num" data-label="${esc(t('trace.col.qty'))}">${esc(s.net)}${s.returned ? ` <span class="muted small">(${esc(t('trace.returned', { units: s.returned }))})</span>` : ''}</td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="5" class="muted">${esc(t('trace.noSales'))}</td></tr>`;
  const units = batch.sales.reduce((sum, s) => sum + s.net, 0);
  return `
    <section class="card trace-batch">
      <header class="trace-head">
        <div>
          <h3 class="doc-legend">${esc(batch.productName)} ${esc(batch.strength)}</h3>
          <p class="muted small">${esc(t('trace.batchLine', { batch: batch.batchNo }))} · ${esc(t('trace.expiry'))} ${esc(formatDate(batch.expiry))} ${expiryBadge(batch)}</p>
        </div>
        <dl class="trace-facts">
          <div><dt>${esc(t('trace.onHand'))}</dt><dd>${esc(stock)}</dd></div>
          <div><dt>${esc(t('trace.soldOut'))}</dt><dd>${esc(t('trace.unitsCount', { units, count: batch.sales.length }))}</dd></div>
        </dl>
      </header>
      <h4 class="trace-sub">${esc(t('trace.fromPurchases'))}</h4>
      <div class="table-wrap"><table class="table table-cards">
        <thead><tr><th>${esc(t('trace.col.date'))}</th><th>${esc(t('trace.col.number'))}</th><th>${esc(t('trace.col.supplier'))}</th><th class="num">${esc(t('trace.col.packs'))}</th></tr></thead>
        <tbody>${bought}</tbody>
      </table></div>
      <h4 class="trace-sub">${esc(t('trace.toCustomers'))}</h4>
      <div class="table-wrap"><table class="table table-cards">
        <thead><tr><th>${esc(t('trace.col.date'))}</th><th>${esc(t('trace.col.invoice'))}</th><th>${esc(t('trace.col.customer'))}</th><th>${esc(t('trace.col.phone'))}</th><th class="num">${esc(t('trace.col.qty'))}</th></tr></thead>
        <tbody>${sold}</tbody>
      </table></div>
    </section>`;
}

function paint() {
  const $out = $host.find('.trace-results');
  if (!query.trim()) {
    $out.html(`<p class="muted">${esc(t('trace.intro'))}</p>`);
    $host.find('.doc-count').text('');
    return;
  }
  if (results.length === 0) {
    $out.html(`<section class="card empty-state"><p class="muted">${esc(t('trace.none', { query: query.trim() }))}</p></section>`);
    $host.find('.doc-count').text(t('trace.countNone'));
    return;
  }
  $out.html(results.map(batchHtml).join(''));
  $host.find('.doc-count').text(t('trace.count', { count: results.length }));
}

async function search() {
  results = await traceBatches(query);
  pharmacyName = pharmacyName || (await db.getSetting('pharmacyName', ''));
  if (!$host) return;
  paint();
  $host.find('[data-action]').prop('disabled', results.length === 0);
}

/** One row per sale line, for the CSV file and the printout. */
function lineRows() {
  return results.flatMap((batch) =>
    batch.sales.map((sale) => ({
      batchNo: batch.batchNo,
      medicine: `${batch.productName} ${batch.strength}`.trim(),
      expiry: batch.expiry,
      supplier: batch.purchases.map((p) => p.supplier).filter(Boolean).join('; '),
      date: sale.date,
      invoice: sale.number,
      customer: sale.customer,
      phone: sale.phone,
      net: sale.net,
    })),
  );
}

function exportCsv() {
  const columns = [
    { label: t('trace.csv.batch'), value: (r) => r.batchNo },
    { label: t('trace.csv.medicine'), value: (r) => r.medicine },
    { label: t('trace.csv.expiry'), value: (r) => r.expiry },
    { label: t('trace.csv.supplier'), value: (r) => r.supplier },
    { label: t('trace.csv.date'), value: (r) => r.date },
    { label: t('trace.csv.invoice'), value: (r) => r.invoice },
    { label: t('trace.csv.customer'), value: (r) => r.customer || t('doc.walkIn') },
    { label: t('trace.csv.phone'), value: (r) => r.phone },
    { label: t('trace.csv.units'), value: (r) => r.net },
  ];
  downloadText(`batch-trace-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(columns, lineRows()));
}

function printTrace() {
  const body = lineRows()
    .map(
      (r) => `<tr>
        <td>${esc(r.batchNo)}</td><td>${esc(r.medicine)}</td><td>${esc(formatDate(r.expiry))}</td>
        <td>${esc(r.supplier)}</td><td>${esc(formatDate(r.date))}</td><td>${esc(r.invoice)}</td>
        <td>${esc(r.customer || t('doc.walkIn'))}</td><td>${esc(r.phone)}</td><td>${esc(r.net)}</td>
      </tr>`,
    )
    .join('');
  printPage(`
    <div class="doc">
      <h1>${esc(t('trace.printTitle'))}</h1>
      <p>${esc(pharmacyName)} · ${esc(t('trace.printQuery', { query }))} · ${esc(formatDate(new Date().toISOString().slice(0, 10)))}</p>
      <table>
        <thead><tr>
          <th>${esc(t('trace.csv.batch'))}</th><th>${esc(t('trace.csv.medicine'))}</th><th>${esc(t('trace.csv.expiry'))}</th>
          <th>${esc(t('trace.csv.supplier'))}</th><th>${esc(t('trace.csv.date'))}</th><th>${esc(t('trace.csv.invoice'))}</th>
          <th>${esc(t('trace.csv.customer'))}</th><th>${esc(t('trace.csv.phone'))}</th><th>${esc(t('trace.csv.units'))}</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`);
}

function shell(initial) {
  return `
    ${shared.pageHead(
      t('trace.title'),
      `<button type="button" class="btn btn-ghost" data-action="print">${esc(t('doc.print'))}</button>
       <button type="button" class="btn btn-ghost" data-action="csv">${esc(t('doc.csv'))}</button>`,
    )}
    <form class="trace-search" role="search" novalidate>
      <label class="search-box trace-box">
        <span class="sr-only">${esc(t('trace.searchLabel'))}</span>
        <input type="search" class="trace-input" value="${esc(initial)}" placeholder="${esc(t('trace.searchPlaceholder'))}" autocomplete="off" autofocus>
      </label>
    </form>
    <div class="trace-results"></div>`;
}

function bind() {
  $host.on('input', '.trace-input', (event) => {
    query = event.currentTarget.value;
    clearTimeout(timer);
    timer = setTimeout(search, 180);
  });
  $host.on('submit', '.trace-search', (event) => {
    event.preventDefault();
    clearTimeout(timer);
    search();
  });
  $host.on('click', '[data-action="csv"]', exportCsv);
  $host.on('click', '[data-action="print"]', printTrace);
}

export async function render($root, params, queryParams = {}) {
  query = String(queryParams.q ?? '');
  results = [];
  $root.html('<div class="doc-root trace-root"></div>');
  $host = $root.children('.doc-root');
  $host.html(shell(query));
  bind();
  paint();
  if (query) await search();
  $host.find('.trace-input').trigger('focus');
}

export function destroy() {
  clearTimeout(timer);
  timer = null;
  $host = null;
  results = [];
}
