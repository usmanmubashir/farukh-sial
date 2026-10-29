// New purchase. Search or scan a medicine, then fill one line per batch: batch number, expiry (MM/YY),
// packs, cost and MRP per pack. Supplier, amount paid and the rest owed to the supplier sit at the bottom.
// Opened from the order list (?demand=ids&supplier=id), the lines are filled with the ordered quantities.
import * as ui from '../core/ui.js';
import { esc, money } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { expiryFromInput } from '../core/dates.js';
import { format, parseRupees } from '../core/money.js';
import { navigate } from '../core/router.js';
import * as anim from '../core/anim.js';
import { listWithStock } from '../services/products.js';
import { listSuppliers, createSupplier } from '../services/parties.js';
import { createPurchase } from '../services/purchases.js';
import { listOpen, markOrdered } from '../services/demand.js';
import { paymentAccounts, accountName, ACCOUNT } from '../services/ledger.js';
import { openMedicineForm } from './_medicine-form.js';
import { matchesFilter, matchesQuery, stockLine } from './_medicine-shared.js';
import * as shared from './_doc-shared.js';

export const route = '/purchases/new';
export const title = 'purch.new';

let $host = null;
let products = [];
let suppliers = [];
let lines = [];
let uidSeq = 0;
let supplierId = '';
let paid = '';
let paidTouched = false;
let note = '';
let payFrom = ACCOUNT.cash;
let payAccounts = [];
let demandRows = []; // open order rows that this purchase may close: { id, productId }
let busy = false;

const rupees = (paisa) => format(paisa, { symbol: false });
const paisaOf = (text) => parseRupees(String(text ?? '').trim()) ?? 0;

/** Expiry as typed: digits only, with the slash after the month. */
function maskExpiry(value) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

const lineAmount = (line) => (Number(line.packs) || 0) * paisaOf(line.cost);
const totalOf = () => lines.reduce((sum, line) => sum + lineAmount(line), 0);
const paidOf = () => (paidTouched ? paisaOf(paid) : totalOf());

function productById(id) {
  return products.find((p) => p.id === id);
}

function addLine(productId, { packs = '' } = {}) {
  const product = productById(productId);
  if (!product) return null;
  const line = {
    uid: `p${(uidSeq += 1)}`,
    productId,
    name: product.name,
    meta: [product.strength, product.company].filter(Boolean).join(' · '),
    soldAs: product.soldAs,
    unitsPerPack: product.unitsPerPack,
    batchNo: '',
    expiry: '',
    packs: packs === '' ? '' : String(packs),
    cost: product.costPerPack ? rupees(product.costPerPack) : '',
    mrp: product.mrpPerPack ? rupees(product.mrpPerPack) : '',
  };
  lines.push(line);
  return line;
}

/* ---------- Painting ---------- */

function supplierOptions() {
  const none = `<option value="">${esc(t('purch.noSupplier'))}</option>`;
  return none + suppliers
    .map((s) => `<option value="${esc(s.id)}"${s.id === supplierId ? ' selected' : ''}>${esc(s.name)}</option>`)
    .join('');
}

function lineHtml(line) {
  return `
    <tr data-uid="${esc(line.uid)}">
      <td data-label="${esc(t('purch.col.medicine'))}">
        <span class="pl-name"><strong>${esc(line.name)}</strong></span>
        <span class="muted small">${esc(line.meta)}</span>
      </td>
      <td data-label="${esc(t('purch.col.batch'))}"><input class="cell-input" data-field="batchNo" value="${esc(line.batchNo)}" autocomplete="off" aria-label="${esc(t('purch.col.batch'))}"></td>
      <td data-label="${esc(t('purch.col.expiry'))}"><input class="cell-input" data-field="expiry" value="${esc(line.expiry)}" inputmode="numeric" placeholder="MM/YY" maxlength="5" autocomplete="off" aria-label="${esc(t('purch.col.expiry'))}"></td>
      <td data-label="${esc(t('purch.col.packs'))}"><input class="cell-input" data-field="packs" value="${esc(line.packs)}" type="number" min="1" inputmode="numeric" aria-label="${esc(t('purch.col.packs'))}"></td>
      <td data-label="${esc(t('purch.col.cost'))}"><input class="cell-input" data-field="cost" value="${esc(line.cost)}" inputmode="decimal" aria-label="${esc(t('purch.col.cost'))}"></td>
      <td data-label="${esc(t('purch.col.mrp'))}"><input class="cell-input" data-field="mrp" value="${esc(line.mrp)}" inputmode="decimal" aria-label="${esc(t('purch.col.mrp'))}"></td>
      <td class="num" data-label="${esc(t('purch.col.amount'))}"><span data-amount>${esc(rupees(lineAmount(line)))}</span></td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-remove aria-label="${esc(t('purch.removeLine', { name: line.name }))}">×</button></td>
    </tr>`;
}

function paintLines() {
  $host.find('.pur-lines tbody').html(lines.map(lineHtml).join(''));
  $host.find('.pur-empty').prop('hidden', lines.length > 0);
  $host.find('.pur-lines').prop('hidden', lines.length === 0);
  paintTotals();
}

function paintTotals() {
  const total = totalOf();
  const paidNow = paidOf();
  const owed = Math.max(0, total - paidNow);
  $host.find('.pur-total').html(money(total));
  $host.find('.pur-owed').html(money(owed));
  if (!paidTouched) $host.find('[name="paid"]').val(rupees(total));
  $host.find('.pur-owed-hint').text(owed > 0 && !supplierId ? t('purch.needSupplier') : t('purch.owedHint'));
  $host.find('.pur-owed-hint').toggleClass('is-warn', owed > 0 && !supplierId);
  $host.find('.pur-save').prop('disabled', busy);
}

function paintResults(query) {
  const $results = $host.find('.pur-results');
  const q = query.trim();
  if (!q) {
    $results.empty().prop('hidden', true);
    return;
  }
  const scored = products
    .filter((p) => matchesFilter(p, 'all') && matchesQuery(p, q))
    .map((p) => ({ p, s: p.barcode === q || String(p.code ?? '').toLowerCase() === q.toLowerCase() ? 2 : 1 }))
    .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
    .slice(0, 8)
    .map(({ p }) => p);
  if (scored.length === 0) {
    $results.html(`
      <p class="muted small">${esc(t('purch.noMatch', { query: q }))}</p>
      <button type="button" class="btn btn-soft" data-new-medicine="${esc(q)}">${esc(t('purch.createMedicine', { name: q }))}</button>`);
  } else {
    $results.html(scored
      .map(
        (p, i) => `
        <button type="button" class="pur-result${i === 0 ? ' is-top' : ''}" data-pick="${esc(p.id)}">
          <span class="med-name">${esc(p.name)}</span>
          <span class="muted small">${esc([p.strength, p.company].filter(Boolean).join(' · '))} · ${esc(stockLine(p))}</span>
        </button>`,
      )
      .join(''));
  }
  $results.prop('hidden', false);
}

function shell() {
  return `
    ${shared.pageHead(t('purch.new'), `<button type="button" class="btn btn-ghost" data-action="back">${esc(t('purch.backToList'))}</button>`)}
    <form class="pur-form" novalidate>
      <section class="card form-section">
        <h3 class="doc-legend">${esc(t('purch.supplier'))}</h3>
        <div class="pur-supplier-row">
          <label class="field">
            <span>${esc(t('purch.supplier'))}</span>
            <select name="supplier">${supplierOptions()}</select>
          </label>
          <button type="button" class="btn btn-soft" data-action="new-supplier">${esc(t('purch.newSupplier'))}</button>
        </div>
        <p class="muted small pur-supplier-note">${esc(t('purch.supplierHelp'))}</p>
      </section>

      <section class="card form-section">
        <h3 class="doc-legend">${esc(t('purch.findMedicine'))}</h3>
        ${shared.searchField(t('purch.searchPlaceholder'), 'pur-search', { autofocus: true })}
        <div class="pur-results" hidden></div>
      </section>

      <section class="card">
        <p class="muted pur-empty">${esc(t('purch.empty'))}</p>
        <div class="table-wrap pur-lines" hidden>
          <table class="table table-cards">
            <thead><tr>
              <th>${esc(t('purch.col.medicine'))}</th><th>${esc(t('purch.col.batch'))}</th><th>${esc(t('purch.col.expiry'))}</th>
              <th class="num">${esc(t('purch.col.packs'))}</th><th class="num">${esc(t('purch.col.cost'))}</th>
              <th class="num">${esc(t('purch.col.mrp'))}</th><th class="num">${esc(t('purch.col.amount'))}</th><th><span class="sr-only">${esc(t('purch.col.remove'))}</span></th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </section>

      <section class="card form-section">
        <h3 class="doc-legend">${esc(t('purch.payment'))}</h3>
        <dl class="doc-totals">
          <div><dt>${esc(t('purch.col.total'))}</dt><dd class="pur-total"></dd></div>
        </dl>
        <div class="form-grid">
          <div class="float-field">
            <input name="paid" inputmode="decimal" placeholder=" " autocomplete="off">
            <label>${esc(t('purch.paid'))}</label>
          </div>
          <label class="field">
            <span>${esc(t('purch.paidFrom'))}</span>
            <select name="payFrom">${payAccounts.map((a) => `<option value="${esc(a.code)}"${a.code === payFrom ? ' selected' : ''}>${esc(accountName(a))}</option>`).join('')}</select>
          </label>
          <div class="float-field">
            <input name="note" placeholder=" " autocomplete="off">
            <label>${esc(t('purch.note'))}</label>
          </div>
        </div>
        <dl class="doc-totals">
          <div><dt>${esc(t('purch.owed'))}</dt><dd class="pur-owed"></dd></div>
        </dl>
        <p class="muted small pur-owed-hint"></p>
        <p class="form-error pur-error" role="alert" hidden></p>
        <div class="form-footer row">
          <button type="button" class="btn btn-ghost" data-action="back">${esc(t('purch.cancel'))}</button>
          <button type="submit" class="btn btn-primary pur-save">${esc(t('purch.save'))}</button>
        </div>
      </section>
    </form>`;
}

/* ---------- Actions ---------- */

function focusLine(uid) {
  $host.find(`tr[data-uid="${uid}"] [data-field="batchNo"]`).trigger('focus');
}

function pick(productId) {
  const line = addLine(productId);
  if (!line) return;
  $host.find('.pur-search').val('');
  paintResults('');
  paintLines();
  focusLine(line.uid);
}

function addFromQuery() {
  const query = $host.find('.pur-search').val();
  const top = $host.find('.pur-result.is-top').attr('data-pick');
  if (top) pick(top);
  else if (query.trim()) ui.toast(t('purch.noMatch', { query: query.trim() }), { type: 'error' });
}

async function reloadProducts() {
  products = await listWithStock({ includeInactive: false });
}

async function newMedicine(name) {
  openMedicineForm({
    onSaved: async (saved) => {
      await reloadProducts();
      if (saved?.id) pick(saved.id);
      ui.toast(t('purch.medicineAdded', { name: saved?.name ?? name }), { type: 'success' });
    },
  });
}

function openNewSupplier() {
  const $form = $(`
    <form class="form stack" novalidate>
      <div class="float-field"><input name="name" placeholder=" " autocomplete="off" required><label>${esc(t('purch.supplierName'))} *</label></div>
      <div class="float-field"><input name="phone" inputmode="tel" placeholder=" " autocomplete="off"><label>${esc(t('purch.supplierPhone'))}</label></div>
      <p class="form-error" role="alert" hidden></p>
      <div class="form-footer"><button type="submit" class="btn btn-primary btn-block">${esc(t('purch.saveSupplier'))}</button></div>
    </form>`);
  const dialog = ui.openModal({ title: t('purch.newSupplier'), body: $form, actions: [] });
  $form.on('submit', async (event) => {
    event.preventDefault();
    const name = $form.find('[name="name"]').val().trim();
    if (!name) {
      $form.find('.form-error').text(t('purch.supplierNameNeeded')).prop('hidden', false);
      return;
    }
    const row = await createSupplier({ name, phone: $form.find('[name="phone"]').val().trim() });
    suppliers = await listSuppliers();
    supplierId = row.id;
    $host.find('[name="supplier"]').html(supplierOptions());
    paintTotals();
    dialog.close();
  });
  $form.find('[name="name"]').trigger('focus');
}

/** Checks each line before saving, so the message names the medicine. Returns an error text or ''. */
function checkLines() {
  if (lines.length === 0) return t('purch.err.empty');
  for (const line of lines) {
    if (!line.batchNo.trim()) return t('purch.err.batch', { name: line.name });
    if (!expiryFromInput(line.expiry)) return t('purch.err.expiry', { name: line.name });
    if (!(Number(line.packs) >= 1)) return t('purch.err.packs', { name: line.name });
  }
  return '';
}

async function save() {
  if (busy) return;
  const $error = $host.find('.pur-error');
  const problem = checkLines();
  if (problem) {
    $error.text(problem).prop('hidden', false);
    anim.shake($host.find('.pur-form')[0]);
    return;
  }
  busy = true;
  paintTotals();
  try {
    const items = lines.map((line) => ({
      productId: line.productId,
      batchNo: line.batchNo.trim(),
      expiry: line.expiry,
      packs: Number(line.packs),
      costPerPack: paisaOf(line.cost),
      mrp: paisaOf(line.mrp),
    }));
    const purchase = await createPurchase({ supplierId: supplierId || null, items, paid: paidOf(), payFrom, note });
    const bought = new Set(lines.map((line) => line.productId));
    for (const row of demandRows) {
      if (row.productId && bought.has(row.productId)) await markOrdered(row.id);
    }
    ui.toast(t('purch.saved', { number: purchase.number }), { type: 'success' });
    navigate('/purchases');
  } catch (err) {
    $error.text(shared.errorText(err)).prop('hidden', false);
    if (!shared.SERVICE_CODES.includes(err?.code)) console.error('[purchase] save failed', err);
    anim.shake($host.find('.pur-form')[0]);
  } finally {
    busy = false;
    paintTotals();
  }
}

/** Fills lines from the order list: ?demand=id1,id2 (and ?supplier=id). */
async function prefill(query) {
  const ids = String(query?.demand ?? '').split(',').filter(Boolean);
  if (query?.supplier) supplierId = query.supplier;
  if (ids.length === 0) return;
  const open = await listOpen();
  const chosen = open.filter((row) => ids.includes(row.id));
  demandRows = chosen.map((row) => ({ id: row.id, productId: row.productId }));
  const unlinked = [];
  for (const row of chosen) {
    if (row.productId && productById(row.productId)) addLine(row.productId, { packs: row.packs });
    else unlinked.push(row.name);
  }
  if (unlinked.length) ui.toast(t('purch.unlinked', { names: unlinked.join(', ') }), { type: 'info', timeout: 6000 });
}

/* ---------- Wiring ---------- */

function bind() {
  $host.on('input', '.pur-search', (event) => paintResults(event.currentTarget.value));
  $host.on('keydown', '.pur-search', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addFromQuery();
    }
    if (event.key === 'Escape') {
      $host.find('.pur-search').val('');
      paintResults('');
    }
  });
  $host.on('click', '[data-pick]', (event) => pick(event.currentTarget.getAttribute('data-pick')));
  $host.on('click', '[data-new-medicine]', (event) => newMedicine(event.currentTarget.getAttribute('data-new-medicine')));
  $host.on('click', '[data-remove]', (event) => {
    const uid = event.currentTarget.closest('tr').getAttribute('data-uid');
    lines = lines.filter((line) => line.uid !== uid);
    paintLines();
  });
  $host.on('input', '.pur-lines [data-field]', (event) => {
    const input = event.currentTarget;
    const uid = input.closest('tr').getAttribute('data-uid');
    const line = lines.find((l) => l.uid === uid);
    if (!line) return;
    const field = input.getAttribute('data-field');
    if (field === 'expiry') {
      input.value = maskExpiry(input.value);
    }
    line[field] = input.value;
    $(input).closest('tr').find('[data-amount]').text(rupees(lineAmount(line)));
    paintTotals();
  });
  $host.on('change', '[name="supplier"]', (event) => {
    supplierId = event.currentTarget.value;
    paintTotals();
  });
  $host.on('input', '[name="paid"]', (event) => {
    paidTouched = true;
    paid = event.currentTarget.value;
    paintTotals();
  });
  $host.on('change', '[name="payFrom"]', (event) => {
    payFrom = event.currentTarget.value;
  });
  $host.on('input', '[name="note"]', (event) => {
    note = event.currentTarget.value;
  });
  $host.on('click', '[data-action]', (event) => {
    const action = event.currentTarget.getAttribute('data-action');
    if (action === 'back') navigate('/purchases');
    if (action === 'new-supplier') openNewSupplier();
  });
  $host.on('submit', '.pur-form', (event) => {
    event.preventDefault();
    save();
  });
}

export async function render($root, params, query = {}) {
  products = [];
  lines = [];
  uidSeq = 0;
  supplierId = '';
  paid = '';
  paidTouched = false;
  note = '';
  demandRows = [];
  busy = false;
  $root.html('<div class="doc-root pur-root"></div>');
  $host = $root.children('.doc-root');
  [products, suppliers, payAccounts] = await Promise.all([listWithStock({ includeInactive: false }), listSuppliers(), paymentAccounts()]);
  payFrom = ACCOUNT.cash;
  await prefill(query);
  $host.html(shell());
  bind();
  paintLines();
}

export function destroy() {
  $host = null;
  products = [];
  lines = [];
  demandRows = [];
}

