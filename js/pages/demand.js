// Order list. Medicines to buy, grouped by preferred supplier. Lines come from low stock (automatic), sale
// searches that found nothing, and manual entries. From here a supplier gets the order on WhatsApp, or the
// quantities go straight into a new purchase.
import * as events from '../core/events.js';
import * as ui from '../core/ui.js';
import { esc } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { todayISO } from '../core/dates.js';
import { navigate } from '../core/router.js';
import { listWithStock } from '../services/products.js';
import { listSuppliers } from '../services/parties.js';
import * as demand from '../services/demand.js';
import * as db from '../core/db.js';
import { matchesFilter, matchesQuery, stockLine } from './_medicine-shared.js';
import * as shared from './_doc-shared.js';

export const route = '/demand';
export const title = 'nav.demand';

const REASON_TONE = { low_stock: 'warn', not_found: 'info', manual: '' };

let $host = null;
let unsubscribe = null;
let rows = [];
let suppliers = [];
let products = [];
let pharmacyName = '';

const supplierName = (id) => suppliers.find((s) => s.id === id)?.name ?? '';

/** Groups: one per preferred supplier, then one for lines with no supplier yet. */
function groups() {
  const map = new Map();
  for (const row of rows) {
    const key = row.supplierId || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  const named = [...map.entries()]
    .filter(([key]) => key)
    .sort((a, b) => supplierName(a[0]).localeCompare(supplierName(b[0])));
  const unassigned = map.get('') ? [['', map.get('')]] : [];
  return [...named, ...unassigned];
}

function reasonBadge(row) {
  return shared.badge(t(`order.reason.${row.reason}`), REASON_TONE[row.reason] ?? '');
}

function rowHtml(row, supplierChoices) {
  return `
    <tr data-id="${esc(row.id)}">
      <td data-label="${esc(t('order.col.medicine'))}">
        <span class="pl-name"><strong>${esc(row.name)}</strong></span>
        ${reasonBadge(row)}
        <input class="cell-input order-note" data-note value="${esc(row.note ?? '')}" placeholder="${esc(t('order.notePlaceholder'))}" aria-label="${esc(t('order.col.note'))}" autocomplete="off">
      </td>
      <td data-label="${esc(t('order.col.qty'))}"><input class="cell-input order-qty" type="number" min="1" inputmode="numeric" data-packs value="${esc(row.packs)}" aria-label="${esc(t('order.col.qty'))}"></td>
      <td data-label="${esc(t('order.col.supplier'))}"><select class="cell-input" data-supplier aria-label="${esc(t('order.col.supplier'))}">${supplierChoices(row.supplierId)}</select></td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-remove aria-label="${esc(t('order.remove', { name: row.name }))}">×</button></td>
    </tr>`;
}

function supplierChoicesFor(current) {
  const none = `<option value="">${esc(t('order.noSupplier'))}</option>`;
  return none + suppliers
    .map((s) => `<option value="${esc(s.id)}"${s.id === current ? ' selected' : ''}>${esc(s.name)}</option>`)
    .join('');
}

function groupHtml([supplierId, list]) {
  const name = supplierId ? supplierName(supplierId) : t('order.unassigned');
  const phone = suppliers.find((s) => s.id === supplierId)?.phone ?? '';
  const text = demand.formatSupplierOrder({ pharmacyName, supplierName: name, date: todayISO(), rows: list });
  const ids = list.map((row) => row.id).join(',');
  const receive = `/purchases/new?demand=${encodeURIComponent(ids)}${supplierId ? `&supplier=${encodeURIComponent(supplierId)}` : ''}`;
  return `
    <section class="card order-group" aria-label="${esc(name)}">
      <div class="order-group-head">
        <div>
          <h3 class="doc-legend">${esc(name)}</h3>
          <p class="muted small">${esc(t('order.lines', { count: list.length }))}</p>
        </div>
        <div class="row">
          <a class="btn btn-soft btn-sm" href="${esc(demand.whatsappLink(text, phone))}" target="_blank" rel="noopener" data-wa>${esc(t('order.sendWhatsapp'))}</a>
          <button type="button" class="btn btn-primary btn-sm" data-receive="${esc(receive)}">${esc(t('order.receive'))}</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table table-cards">
          <thead><tr>
            <th>${esc(t('order.col.medicine'))}</th><th>${esc(t('order.col.qty'))}</th><th>${esc(t('order.col.supplier'))}</th><th><span class="sr-only">${esc(t('order.remove', { name: '' }))}</span></th>
          </tr></thead>
          <tbody>${list.map((row) => rowHtml(row, supplierChoicesFor)).join('')}</tbody>
        </table>
      </div>
    </section>`;
}

function paint() {
  const list = $host.find('.order-groups');
  list.html(rows.length ? groups().map(groupHtml).join('') : '');
  $host.find('.order-empty').prop('hidden', rows.length > 0);
  $host.find('.doc-count').text(t('order.count', { count: rows.length }));
}

function paintPicker(query) {
  const q = query.trim();
  const $results = $host.find('.order-results');
  if (!q) {
    $results.empty();
    return;
  }
  const hits = products
    .filter((p) => matchesFilter(p, 'all') && matchesQuery(p, q))
    .slice(0, 8);
  $results.html(
    hits.length
      ? hits
          .map(
            (p) => `
          <div class="order-hit">
            <span><span class="med-name">${esc(p.name)}</span> <span class="muted small">${esc([p.strength, p.company].filter(Boolean).join(' · '))} · ${esc(stockLine(p))}</span></span>
            <button type="button" class="btn btn-soft btn-sm" data-add="${esc(p.id)}">${esc(t('order.addOne'))}</button>
          </div>`,
          )
          .join('')
      : `<p class="muted small">${esc(t('order.noMatch', { query: q }))}</p>`,
  );
}

async function load() {
  rows = await demand.listOpen();
  [suppliers, products] = await Promise.all([listSuppliers(), listWithStock({ includeInactive: false })]);
  pharmacyName = await db.getSetting('pharmacyName', '');
  if (!$host) return;
  paint();
  paintPicker($host.find('.order-search').val() ?? '');
}

function shell() {
  return `
    ${shared.pageHead(
      t('order.title'),
      `<button type="button" class="btn btn-ghost" data-action="low">${esc(t('order.addLow'))}</button>
       <button type="button" class="btn btn-primary" data-action="toggle-add" aria-expanded="false">${esc(t('order.add'))}</button>`,
    )}
    <section class="card order-add" hidden>
      ${shared.searchField(t('order.searchPlaceholder'), 'order-search')}
      <div class="order-results"></div>
      <form class="order-name-form inline-form" novalidate>
        <input name="name" placeholder="${esc(t('order.namePlaceholder'))}" autocomplete="off" aria-label="${esc(t('order.namePlaceholder'))}">
        <button type="submit" class="btn btn-soft">${esc(t('order.addByName'))}</button>
      </form>
    </section>
    <div class="order-groups"></div>
    <section class="empty-state order-empty" hidden>
      <h2>${esc(t('order.empty.title'))}</h2>
      <p class="muted">${esc(t('order.empty.text'))}</p>
    </section>`;
}

async function addProduct(productId) {
  await demand.addManual(productId, 1);
  ui.toast(t('order.added'), { type: 'success', timeout: 1600 });
  $host.find('.order-search').val('');
  paintPicker('');
}

function bind() {
  $host.on('click', '[data-action]', async (event) => {
    const action = event.currentTarget.getAttribute('data-action');
    if (action === 'toggle-add') {
      const $panel = $host.find('.order-add');
      const open = $panel.prop('hidden');
      $panel.prop('hidden', !open);
      event.currentTarget.setAttribute('aria-expanded', String(open));
      if (open) $panel.find('.order-search').trigger('focus');
    }
    if (action === 'low') {
      const added = await demand.autoAddLowStock();
      ui.toast(t('order.lowAdded', { count: added }), { type: 'success' });
    }
  });
  $host.on('input', '.order-search', (event) => paintPicker(event.currentTarget.value));
  $host.on('keydown', '.order-search', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = $host.find('.order-results [data-add]').first().attr('data-add');
      if (first) addProduct(first);
    }
  });
  $host.on('click', '[data-add]', (event) => addProduct(event.currentTarget.getAttribute('data-add')));
  $host.on('submit', '.order-name-form', async (event) => {
    event.preventDefault();
    const $input = $host.find('.order-name-form [name="name"]');
    const name = $input.val().trim();
    if (!name) return;
    await demand.addDemand({ name, packs: 1, reason: 'manual' });
    $input.val('');
    ui.toast(t('order.added'), { type: 'success', timeout: 1600 });
  });
  $host.on('change', '[data-packs]', async (event) => {
    const id = event.currentTarget.closest('tr').getAttribute('data-id');
    try {
      await demand.updateDemand(id, { packs: event.currentTarget.value });
    } catch (err) {
      ui.toast(shared.errorText(err), { type: 'error' });
    }
  });
  $host.on('change', '[data-note]', async (event) => {
    const id = event.currentTarget.closest('tr').getAttribute('data-id');
    await demand.updateDemand(id, { note: event.currentTarget.value });
  });
  $host.on('change', '[data-supplier]', async (event) => {
    const id = event.currentTarget.closest('tr').getAttribute('data-id');
    await demand.updateDemand(id, { supplierId: event.currentTarget.value });
  });
  $host.on('click', '[data-remove]', async (event) => {
    const id = event.currentTarget.closest('tr').getAttribute('data-id');
    await demand.removeDemand(id);
  });
  $host.on('click', '[data-receive]', (event) => navigate(event.currentTarget.getAttribute('data-receive')));
}

export async function render($root) {
  $root.html('<div class="doc-root order-root"></div>');
  $host = $root.children('.doc-root');
  $host.html(shell());
  bind();
  await load();
  unsubscribe = events.on('data:changed', ({ stores }) => {
    if (stores.some((s) => ['demandList', 'products', 'batches', 'stockMovements', 'suppliers'].includes(s))) load();
  });
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
  $host = null;
  rows = [];
}

