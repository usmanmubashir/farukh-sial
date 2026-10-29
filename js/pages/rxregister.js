// Rx register. One line for every Rx or controlled medicine sold: date, invoice, patient, doctor, medicine,
// batch and quantity. Filter by period, class and text. Print it on A4 for the inspector, or export as CSV.
import * as events from '../core/events.js';
import { debounce } from '../core/resilience.js';
import { esc } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { formatDate } from '../core/dates.js';
import { downloadText, toCsv } from '../core/csv.js';
import { listRxRegister } from '../services/sales.js';
import { printPage } from '../services/printing.js';
import * as db from '../core/db.js';
import * as shared from './_doc-shared.js';

export const route = '/rx';
export const title = 'nav.rxRegister';

let $host = null;
let unsubscribe = null;
let state = { period: 'month', from: '', to: '', cls: 'all', query: '' };
let rows = [];
let pharmacyName = '';

const CLASS_TONE = { rx: 'accent', controlled: 'danger' };

function visibleRows() {
  const q = state.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (state.cls === 'all' || row.class === state.cls) &&
      (!q ||
        [row.patient, row.doctor, row.productName, row.saleNumber, (row.batches ?? []).join(' ')]
          .some((value) => String(value ?? '').toLowerCase().includes(q))),
  );
}

function tilesHtml(shown) {
  const patients = new Set(shown.map((row) => String(row.patient ?? '').trim().toLowerCase()).filter(Boolean));
  const count = (cls) => shown.filter((row) => row.class === cls).length;
  return shared.statTiles([
    [t('rx.tile.entries'), `<span data-count="${shown.length}">${shown.length}</span>`],
    [t('rx.tile.rx'), String(count('rx'))],
    [t('rx.tile.controlled'), String(count('controlled'))],
    [t('rx.tile.patients'), String(patients.size)],
  ]);
}

function rowHtml(row) {
  return `
    <tr>
      <td data-label="${esc(t('rx.col.date'))}">${esc(formatDate(row.date))}</td>
      <td data-label="${esc(t('rx.col.invoice'))}">${esc(row.saleNumber)}</td>
      <td data-label="${esc(t('rx.col.patient'))}">${esc(row.patient)}</td>
      <td data-label="${esc(t('rx.col.doctor'))}">${esc(row.doctor)}</td>
      <td data-label="${esc(t('rx.col.medicine'))}">${esc(row.productName)} <span class="muted small">${esc(row.strength ?? '')}</span></td>
      <td data-label="${esc(t('rx.col.batch'))}">${esc((row.batches ?? []).join(', '))}</td>
      <td class="num" data-label="${esc(t('rx.col.qty'))}">${esc(row.units)}</td>
      <td data-label="${esc(t('rx.col.class'))}">${shared.badge(t(`class.${row.class}`), CLASS_TONE[row.class] ?? '')}</td>
    </tr>`;
}

function paint() {
  const shown = visibleRows();
  $host.find('.doc-tiles-wrap').html(tilesHtml(shown));
  $host.find('.doc-count').text(t('rx.count', { count: shown.length }));
  $host.find('tbody').html(shown.length ? shown.map(rowHtml).join('') : shared.emptyRow(8, t('rx.none')));
}

async function load() {
  rows = (await listRxRegister(shared.rangeOf(state))).sort(
    (a, b) => b.date.localeCompare(a.date) || String(b.saleNumber).localeCompare(String(a.saleNumber)),
  );
  pharmacyName = await db.getSetting('pharmacyName', '');
  if (!$host) return;
  paint();
}

function periodText() {
  const range = shared.rangeOf(state);
  if (range.from === '' && range.to === shared.OPEN_END) return t('rx.periodAll');
  return t('rx.periodRange', {
    from: range.from ? formatDate(range.from) : '',
    to: range.to === shared.OPEN_END ? '' : formatDate(range.to),
  });
}

function exportCsv() {
  const columns = [
    { label: t('rx.col.date'), value: (r) => r.date },
    { label: t('rx.col.invoice'), value: (r) => r.saleNumber },
    { label: t('rx.col.patient'), value: (r) => r.patient ?? '' },
    { label: t('rx.col.doctor'), value: (r) => r.doctor ?? '' },
    { label: t('rx.col.medicine'), value: (r) => r.productName },
    { label: t('rx.col.strength'), value: (r) => r.strength ?? '' },
    { label: t('rx.col.batch'), value: (r) => (r.batches ?? []).join('; ') },
    { label: t('rx.col.qty'), value: (r) => r.units },
    { label: t('rx.col.class'), value: (r) => t(`class.${r.class}`) },
  ];
  downloadText(`rx-register-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(columns, visibleRows()));
}

function printRegister() {
  const shown = visibleRows();
  const body = shown
    .map(
      (r) => `<tr>
        <td>${esc(formatDate(r.date))}</td><td>${esc(r.saleNumber)}</td><td>${esc(r.patient)}</td><td>${esc(r.doctor)}</td>
        <td>${esc(r.productName)} ${esc(r.strength ?? '')}</td><td>${esc((r.batches ?? []).join(', '))}</td>
        <td>${esc(r.units)}</td><td>${esc(t(`class.${r.class}`))}</td>
      </tr>`,
    )
    .join('');
  printPage(`
    <div class="doc">
      <h1>${esc(t('rx.printTitle'))}</h1>
      <p>${esc(pharmacyName)} · ${esc(periodText())} · ${esc(t('rx.printCount', { count: shown.length }))}</p>
      <table>
        <thead><tr>
          <th>${esc(t('rx.col.date'))}</th><th>${esc(t('rx.col.invoice'))}</th><th>${esc(t('rx.col.patient'))}</th>
          <th>${esc(t('rx.col.doctor'))}</th><th>${esc(t('rx.col.medicine'))}</th><th>${esc(t('rx.col.batch'))}</th>
          <th>${esc(t('rx.col.qty'))}</th><th>${esc(t('rx.col.class'))}</th>
        </tr></thead>
        <tbody>${body || `<tr><td colspan="8">${esc(t('rx.none'))}</td></tr>`}</tbody>
      </table>
      <div class="sign">
        <span>${esc(t('rx.signPharmacist'))}</span>
        <span>${esc(t('rx.signDate'))}</span>
      </div>
    </div>`);
}

function shell() {
  return `
    ${shared.pageHead(
      t('rx.title'),
      `<button type="button" class="btn btn-ghost" data-action="print">${esc(t('doc.print'))}</button>
       <button type="button" class="btn btn-ghost" data-action="csv">${esc(t('doc.csv'))}</button>`,
    )}
    ${shared.periodBar(state)}
    <div class="doc-filters">
      ${shared.searchField(t('rx.search'), 'doc-search')}
      ${shared.chipGroup(
        'cls',
        [['all', t('doc.all')], ['rx', t('class.rx')], ['controlled', t('class.controlled')]],
        state.cls,
        t('rx.classLabel'),
      )}
    </div>
    <div class="doc-tiles-wrap"></div>
    <div class="table-wrap">
      <table class="table table-cards">
        <thead><tr>
          <th>${esc(t('rx.col.date'))}</th><th>${esc(t('rx.col.invoice'))}</th><th>${esc(t('rx.col.patient'))}</th>
          <th>${esc(t('rx.col.doctor'))}</th><th>${esc(t('rx.col.medicine'))}</th><th>${esc(t('rx.col.batch'))}</th>
          <th class="num">${esc(t('rx.col.qty'))}</th><th>${esc(t('rx.col.class'))}</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>`;
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
  $host.on('click', '[data-cls]', (event) => {
    state.cls = event.currentTarget.getAttribute('data-cls');
    $host.find('[data-cls]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    paint();
  });
  $host.on('click', '[data-action="print"]', printRegister);
  $host.on('click', '[data-action="csv"]', exportCsv);
}

export async function render($root) {
  state = { period: 'month', from: '', to: '', cls: 'all', query: '' };
  $root.html('<div class="doc-root rx-root"></div>');
  $host = $root.children('.doc-root');
  $host.html(shell());
  bind();
  await load();
  unsubscribe = events.on('data:changed', ({ stores }) => {
    if (stores.some((s) => ['sales', 'rxRegister', 'customers'].includes(s))) load();
  });
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
  $host = null;
  rows = [];
}
