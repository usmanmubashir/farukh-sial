// Stock: four totals, search and filters, and one expandable row per medicine. The row shows its batches,
// an "Add / adjust" dialog (add a batch, or change a batch's quantity with a reason) and the adjustment history.
import * as anim from '../core/anim.js';
import { debounce } from '../core/resilience.js';
import * as i18n from '../core/i18n.js';
import * as ui from '../core/ui.js';
import { esc, money } from '../core/ui.js';
import { formatDate, todayISO } from '../core/dates.js';
import * as events from '../core/events.js';
import { listWithStock } from '../services/products.js';
import { addBatch, adjust, adjustmentHistory, batchRows } from '../services/stock.js';
import { chipRow, matchesFilter, matchesQuery, medCount, stockLine } from './_medicine-shared.js';

const t = i18n.t;

export const route = '/stock';
export const title = 'nav.stock';

let $host = null;
let rows = [];
let batchesAll = [];
let filter = 'all';
let query = '';
let openIds = new Set();
let unsubscribe = null;

const batchesOf = (productId) => batchesAll.filter((b) => b.productId === productId);

function totals() {
  const active = rows.filter((r) => r.active !== false);
  const cost = batchesAll.reduce((n, b) => n + b.costValue, 0);
  const retail = batchesAll.reduce((n, b) => n + b.retailValue, 0);
  const lowOut = active.filter((r) => matchesFilter(r, 'low') || matchesFilter(r, 'out')).length;
  return { medicines: active.length, cost, retail, lowOut };
}

function statsHtml() {
  const s = totals();
  const tile = (label, value, money_ = false) => `
    <div class="card stat">
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-value">${money_ ? money(value) : `<span data-count="${value}">0</span>`}</span>
    </div>`;
  return `
    <div class="stat-grid">
      ${tile(t('stock.medicines'), s.medicines)}
      ${tile(t('stock.value'), s.cost, true)}
      ${tile(t('stock.retail'), s.retail, true)}
      ${tile(t('stock.lowOut'), s.lowOut)}
    </div>`;
}

function batchTable(productId) {
  const list = batchesOf(productId);
  if (!list.length) return `<p class="muted small">${esc(t('stock.noBatches'))}</p>`;
  const bucketClass = (b) => (b.bucket === 'expired' ? 'badge--danger' : b.bucket === 'd30' ? 'badge--warn' : 'badge--ok');
  const body = list
    .map(
      (b) => `
      <tr>
        <td data-label="${esc(t('stock.colBatch'))}">${esc(b.batchNo)}</td>
        <td data-label="${esc(t('stock.colExpiry'))}"><span class="badge ${bucketClass(b)}">${esc(formatDate(b.expiry))}</span></td>
        <td class="num" data-label="${esc(t('stock.colStock'))}">${esc(b.packs)}${b.looseUnits ? ` + ${b.looseUnits}` : ''}</td>
        <td class="num" data-label="${esc(t('stock.colValue'))}">${money(b.costValue)}</td>
      </tr>`,
    )
    .join('');
  return `
    <div class="table-wrap">
      <table class="table table-cards">
        <thead><tr><th>${esc(t('stock.colBatch'))}</th><th>${esc(t('stock.colExpiry'))}</th><th class="num">${esc(t('stock.colStock'))}</th><th class="num">${esc(t('stock.colValue'))}</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

async function historyHtml(productId) {
  const items = await adjustmentHistory(productId);
  if (!items.length) return `<p class="muted small">${esc(t('stock.noHistory'))}</p>`;
  return `<ul class="plain-list">${items
    .map((i) => `<li><span>${esc(i.note || '—')} <span class="muted small">${esc(formatDate(i.date))}</span></span><span class="badge ${i.units < 0 ? 'badge--danger' : 'badge--ok'}">${i.units > 0 ? '+' : ''}${esc(i.units)}</span></li>`)
    .join('')}</ul>`;
}

async function rowHtml(row) {
  const open = openIds.has(row.id);
  const value = batchesOf(row.id).reduce((n, b) => n + b.costValue, 0);
  return `
    <li class="stock-row" data-key="${esc(row.id)}">
      <button type="button" class="stock-head" aria-expanded="${open}" data-toggle="${esc(row.id)}">
        <span class="med-main">
          <span class="med-name">${esc(row.name)}</span>
          <span class="med-meta muted small">${esc([row.strength, row.company].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="med-side">
          <span class="med-stock">${esc(stockLine(row))}</span>
          <span class="muted small">${money(value)}</span>
        </span>
      </button>
      <div class="stock-body" ${open ? '' : 'hidden'} data-body="${esc(row.id)}">
        <div class="row stock-actions">
          <button type="button" class="btn btn-primary btn-sm" data-dialog="${esc(row.id)}">${esc(t('stock.addAdjust'))}</button>
        </div>
        <div data-batches>${open ? batchTable(row.id) : ''}</div>
        <h3 class="stock-sub">${esc(t('stock.history'))}</h3>
        <div data-history>${open ? await historyHtml(row.id) : ''}</div>
      </div>
    </li>`;
}

async function paintList() {
  const shown = rows.filter((r) => matchesFilter(r, filter) && matchesQuery(r, query));
  const parts = [];
  for (const row of shown) parts.push(await rowHtml(row));
  $host.find('.stock-list').html(parts.join(''));
  $host.find('.stock-none').prop('hidden', shown.length > 0);
  $host.find('.stock-count').text(medCount(shown.length));
}

async function load() {
  const [products, batches] = await Promise.all([listWithStock({ includeInactive: true }), batchRows({ withStockOnly: false, today: todayISO() })]);
  rows = products;
  batchesAll = batches.filter((b) => b.units > 0);
  if (!$host) return;
  $host.find('.stock-stats').html(statsHtml());
  $host.find('[data-count]').each(function count() {
    anim.countUp(this, Number(this.dataset.count), { format: 'int' });
  });
  await paintList();
}

/** Add a batch, or change a batch's quantity with a reason. */
function openStockDialog(product, onDone) {
  const stockBatches = batchesOf(product.id);
  const pickOptions = stockBatches.map((b) => `<option value="${esc(b.batchId)}">${esc(b.batchNo)} · ${esc(formatDate(b.expiry))} · ${esc(b.packs)}</option>`).join('');
  const $body = $(`
    <div class="stack">
      <div class="seg" role="radiogroup" data-indicator>
        <span class="seg-indicator" aria-hidden="true"></span>
        <button type="button" class="seg-option" role="radio" data-mode="batch" aria-checked="true">${esc(t('stock.modeBatch'))}</button>
        <button type="button" class="seg-option" role="radio" data-mode="adjust" aria-checked="false">${esc(t('stock.modeAdjust'))}</button>
      </div>
      <form class="med-form stack" novalidate>
        <div data-pane="batch" class="stack">
          <div class="form-grid">
            <div class="float-field"><input name="batchNo" placeholder=" " autocomplete="off" required><label>${esc(t('form.batchNo'))} *</label></div>
            <div class="float-field"><input name="expiry" placeholder=" " autocomplete="off" required><label>${esc(t('form.expiry'))} *</label></div>
            <div class="float-field"><input name="packs" type="number" inputmode="numeric" placeholder=" " required><label>${esc(t('form.packs'))} *</label></div>
            <div class="float-field"><input name="cost" inputmode="decimal" value="${(product.costPerPack / 100).toFixed(2)}" placeholder=" "><label>${esc(t('form.costPrice'))}</label></div>
            <div class="float-field"><input name="mrp" inputmode="decimal" value="${(product.mrpPerPack / 100).toFixed(2)}" placeholder=" "><label>${esc(t('form.mrp'))}</label></div>
          </div>
        </div>
        <div data-pane="adjust" class="stack" hidden>
          <div class="field"><label for="sd-batch">${esc(t('stock.batchPick'))}</label>
            <select id="sd-batch" name="batchId">${pickOptions || `<option value="">${esc(t('stock.noneSelected'))}</option>`}</select></div>
          <div class="float-field"><input name="delta" type="number" inputmode="numeric" placeholder=" " required><label>${esc(t('stock.delta'))} *</label></div>
          <div class="float-field"><input name="reason" placeholder=" " autocomplete="off" required><label>${esc(t('stock.reason'))} *</label></div>
          <p class="hint small">${esc(t('stock.reasonHelp'))}</p>
        </div>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" data-submit><span data-label-hide>${esc(t('stock.addBatchSave'))}</span></button>
        </div>
      </form>
    </div>`);
  let mode = 'batch';
  const $form = $body.find('form');
  const $error = $body.find('.form-error');
  const $submit = $body.find('[data-submit]');
  const label = () => $submit.find('[data-label-hide]').text(t(mode === 'batch' ? 'stock.addBatchSave' : 'stock.adjustSave'));

  $body.on('click', '[data-mode]', (event) => {
    mode = event.currentTarget.getAttribute('data-mode');
    $body.find('[data-pane="batch"]').prop('hidden', mode !== 'batch');
    $body.find('[data-pane="adjust"]').prop('hidden', mode !== 'adjust');
    label();
  });

  $form.on('submit', async (event) => {
    event.preventDefault();
    $error.prop('hidden', true);
    try {
      if (mode === 'batch') {
        const packs = Number($form.find('[name="packs"]').val());
        await addBatch({
          productId: product.id,
          batchNo: $form.find('[name="batchNo"]').val(),
          expiry: $form.find('[name="expiry"]').val(),
          packs,
          costPerPack: Math.round(Number($form.find('[name="cost"]').val() || 0) * 100),
          mrp: Math.round(Number($form.find('[name="mrp"]').val() || 0) * 100),
        });
      } else {
        const batchId = $form.find('[name="batchId"]').val();
        const delta = Number($form.find('[name="delta"]').val());
        if (!batchId || !Number.isInteger(delta) || delta === 0) throw new Error('invalid');
        await adjust({ productId: product.id, batchId, units: delta * product.unitsPerPack, reason: $form.find('[name="reason"]').val() });
      }
      ui.toast(t('stock.saved'), { type: 'success' });
      dialog.close();
      onDone?.();
    } catch (err) {
      console.error('[stock] save failed', err);
      $error.text(t('stock.saveFailed')).prop('hidden', false);
      anim.shake($error[0]);
    }
  });

  const dialog = ui.openModal({ title: `${product.name}`, body: $body, actions: [] });
  label();
}

function bind() {
  const searchPaintList = debounce(() => paintList(), 150);
  $host.on('input', '.stock-search', (event) => {
    query = event.currentTarget.value;
    searchPaintList();
  });
  $host.on('click', '[data-filter]', (event) => {
    filter = event.currentTarget.getAttribute('data-filter');
    $host.find('[data-filter]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    paintList();
  });
  $host.on('click', '[data-toggle]', async (event) => {
    const id = event.currentTarget.getAttribute('data-toggle');
    if (openIds.has(id)) openIds.delete(id);
    else openIds.add(id);
    await paintList();
  });
  $host.on('click', '[data-dialog]', (event) => {
    const product = rows.find((r) => r.id === event.currentTarget.getAttribute('data-dialog'));
    if (product) openStockDialog(product, load);
  });
}

export async function render($root) {
  $root.html('<div class="stock-root"></div>');
  $host = $root.children('.stock-root');
  $host.html(`
    <div class="page-head"><div><h2>${esc(t('stock.title'))}</h2><p class="muted small stock-count"></p></div></div>
    <div class="stock-stats"></div>
    <label class="search-box"><span class="sr-only">${esc(t('med.search'))}</span>
      <input type="search" class="stock-search" placeholder="${esc(t('med.search'))}" autocomplete="off"></label>
    <div class="chip-row" role="group">${chipRow(filter)}</div>
    <ul class="stock-list"></ul>
    <p class="muted stock-none" hidden>${esc(t('med.noMatch'))}</p>`);
  bind();
  await load();
  unsubscribe = events.on('data:changed', ({ stores }) => {
    if (stores.some((s) => ['products', 'batches', 'stockMovements'].includes(s))) load();
  });
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
  $host = null;
  rows = [];
  batchesAll = [];
  openIds = new Set();
}
