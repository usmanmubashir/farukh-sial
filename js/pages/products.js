// Medicines: searchable list with filter chips, groups, barcode entry, the new/edit form and the popular seed.
import * as anim from '../core/anim.js';
import { debounce } from '../core/resilience.js';
import * as i18n from '../core/i18n.js';
import * as ui from '../core/ui.js';
import { esc, icon, money } from '../core/ui.js';
import * as events from '../core/events.js';
import { listWithStock, importProducts } from '../services/products.js';
import { popularMedicines } from '../services/seed-medicines.js';
import { chipRow, matchesFilter, matchesQuery, medCount, stockLine } from './_medicine-shared.js';
import { openMedicineForm } from './_medicine-form.js';
import { openGroupsDialog, openScanDialog } from './_medicine-dialogs.js';

const t = i18n.t;

export const route = '/products';
export const title = 'nav.products';

let $host = null;
let rows = [];
let filter = 'all';
let query = '';
let unsubscribe = null;

function rowHtml(row) {
  const status = [];
  if (!row.active) status.push(`<span class="badge">${esc(t('filter.inactive'))}</span>`);
  if (row.class !== 'otc' && row.class !== 'general') status.push(`<span class="badge badge--accent">${esc(t(`class.${row.class}`))}</span>`);
  if (row.storage === 'fridge') status.push(`<span class="badge badge--info">${esc(t('storage.fridge'))}</span>`);
  if (row.units <= 0 && row.trackStock !== false) status.push(`<span class="badge badge--danger">${esc(t('filter.out'))}</span>`);
  else if (row.reorderLevel > 0 && row.units < row.reorderLevel * row.unitsPerPack) status.push(`<span class="badge badge--warn">${esc(t('filter.low'))}</span>`);
  // money() already returns escaped markup.
  const price = row.mrpPerPack ? money(row.mrpPerPack) : `<span class="badge badge--warn">${esc(t('med.noPrice'))}</span>`;
  const meta = [row.strength, t(`type.${row.form}`), row.company].filter(Boolean).join(' · ');
  return `
    <li class="med-row" data-key="${esc(row.id)}">
      <button type="button" class="med-open" data-id="${esc(row.id)}">
        <span class="med-main">
          <span class="med-name">${esc(row.name)}${row.nameUr ? ` <span class="med-urdu" lang="ur">${esc(row.nameUr)}</span>` : ''}</span>
          <span class="med-meta muted small">${esc(meta)}</span>
          <span class="med-tags">${status.join('')}</span>
        </span>
        <span class="med-side">
          <span class="med-stock">${esc(stockLine(row))}</span>
          ${price}
        </span>
      </button>
    </li>`;
}

function visibleRows() {
  return rows.filter((row) => matchesFilter(row, filter) && matchesQuery(row, query));
}

function paintList() {
  const list = $host.find('.med-list');
  const shown = visibleRows();
  list.html(shown.map(rowHtml).join(''));
  $host.find('.med-count').text(medCount(shown.length));
  $host.find('.med-none').prop('hidden', rows.length > 0);
  $host.find('.med-nomatch').prop('hidden', rows.length === 0 || shown.length > 0);
}

function shell() {
  return `
    <div class="page-head">
      <div>
        <h2>${esc(t('med.title'))}</h2>
        <p class="muted small med-count"></p>
      </div>
      <div class="row">
        <button type="button" class="btn btn-ghost" data-action="scan">${esc(t('med.scan'))}</button>
        <button type="button" class="btn btn-ghost" data-action="groups">${esc(t('med.groups'))}</button>
        <button type="button" class="btn btn-primary" data-action="add">${esc(t('med.add'))}</button>
      </div>
    </div>
    <label class="search-box">
      <span class="sr-only">${esc(t('med.search'))}</span>
      <input type="search" class="med-search" placeholder="${esc(t('med.search'))}" autocomplete="off">
    </label>
    <div class="chip-row" role="group" aria-label="${esc(t('med.title'))}">${chipRow(filter)}</div>
    <ul class="med-list" aria-label="${esc(t('med.title'))}"></ul>
    <p class="muted med-nomatch" hidden>${esc(t('med.noMatch'))}</p>
    <section class="empty-state med-none" hidden>
      <div class="empty-blob">${icon('products')}</div>
      <h2>${esc(t('med.empty.title'))}</h2>
      <p class="muted">${esc(t('med.empty.text'))}</p>
      <div class="row">
        <button type="button" class="btn btn-primary" data-action="add">${esc(t('med.add'))}</button>
        <button type="button" class="btn btn-soft" data-action="popular">${esc(t('med.addPopular'))}</button>
      </div>
    </section>`;
}

async function load() {
  rows = await listWithStock({ includeInactive: true });
  if (!$host) return;
  paintList();
}

function bind() {
  const searchPaintList = debounce(() => paintList(), 150);
  $host.on('input', '.med-search', (event) => {
    query = event.currentTarget.value;
    searchPaintList();
  });
  $host.on('click', '[data-filter]', (event) => {
    filter = event.currentTarget.getAttribute('data-filter');
    $host.find('[data-filter]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    // The list glides into its new contents. FLIP needs keys, so the rows are re-keyed as they paint.
    anim.flip($host.find('.med-list')[0], paintList);
  });
  $host.on('click', '.med-open', (event) => {
    const row = rows.find((r) => r.id === event.currentTarget.getAttribute('data-id'));
    if (row) openMedicineForm({ product: row, onSaved: load });
  });
  $host.on('click', '[data-action]', async (event) => {
    const action = event.currentTarget.getAttribute('data-action');
    if (action === 'add') openMedicineForm({ onSaved: load });
    if (action === 'groups') openGroupsDialog({ onChange: () => {} });
    if (action === 'scan') {
      openScanDialog({
        onProduct: (product) => openMedicineForm({ product: rows.find((r) => r.id === product.id) ?? product, onSaved: load }),
        onCode: () => ui.toast(t('scan.notFound'), { type: 'error' }),
      });
    }
    if (action === 'popular') {
      const result = await importProducts(popularMedicines());
      ui.toast(t('med.imported', result), { type: 'success' });
      await load();
    }
  });
}

export async function render($root) {
  $root.html('<div class="med-root"></div>');
  $host = $root.children('.med-root');
  $host.html(shell());
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
}
