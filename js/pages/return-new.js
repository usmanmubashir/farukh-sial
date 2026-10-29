// Return flow. Opened from a sale (?sale=id) or a purchase (?purchase=id), never from nothing.
// Pick the items and quantities, choose how the money goes back, and see which batch the stock returns to.
//   Sale: cash back now, or the amount is credited to the customer's account (adjust against udhaar).
//   Purchase: cash back now, or the amount reduces what is owed to the supplier (supplier credit).
// Walk-in sales and purchases without a supplier can only be refunded in cash.
import * as ui from '../core/ui.js';
import { esc, money } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { formatDate } from '../core/dates.js';
import { format, parseRupees, roundHalfAway } from '../core/money.js';
import * as anim from '../core/anim.js';
import { navigate } from '../core/router.js';
import { getSaleWithItems } from '../services/sales.js';
import { getPurchaseWithItems } from '../services/purchases.js';
import { createSaleReturn, createPurchaseReturn } from '../services/returns.js';
import * as shared from './_doc-shared.js';

export const route = '/returns/new';
export const title = 'ret.new';

let $host = null;
let doc = null; // the original sale or purchase, with items
let kind = ''; // 'sale' | 'purchase'
let rows = []; // one per item that still has something to return
let method = 'cash';
let refundText = '';
let refundTouched = false;
let reason = '';
let partyName = ''; // customer or supplier name, for the heading
let busy = false;

const rupees = (paisa) => format(paisa, { symbol: false });
const paisaOf = (text) => parseRupees(String(text ?? '').trim()) ?? 0;

/** Units taken from each batch, in the order the sale took them (FEFO), limited to what is still out. */
function restoreSplit(item, units) {
  const parts = [];
  let left = units;
  for (const a of item.allocations ?? []) {
    if (left <= 0) break;
    const available = a.units - (a.returnedUnits ?? 0);
    const take = Math.min(available, left);
    if (take <= 0) continue;
    parts.push({ batchNo: a.batchNo, units: take });
    left -= take;
  }
  return parts;
}

/** Gross value of a sale return, the same way the service computes it. */
function saleValue(item, units) {
  if (!item.units || !doc.subtotal) return 0;
  return roundHalfAway(((item.amount * units) / item.units) * (doc.total / doc.subtotal));
}

function totals() {
  const gross = rows.reduce((sum, row) => sum + row.value, 0);
  const refund = refundTouched ? Math.min(paisaOf(refundText), gross) : defaultRefund(gross);
  return { gross, refund, credit: Math.max(0, gross - refund) };
}

function defaultRefund(gross) {
  return method === 'cash' ? gross : 0;
}

/** Methods offered for this document. */
function methods() {
  if (kind === 'sale') {
    return doc.customerId ? ['cash', 'account'] : ['cash'];
  }
  return doc.supplierId ? ['cash', 'supplier'] : ['cash'];
}

function methodLabel(key) {
  if (key === 'account') return t('ret.method.account');
  if (key === 'supplier') return t('ret.method.supplier');
  return t('ret.method.cash');
}

/* ---------- Painting ---------- */

function rowHtml(row) {
  const restores = row.restores.length
    ? row.restores
        .map((r) => (kind === 'sale'
          ? t('ret.restoreUnits', { batch: r.batchNo, units: r.units })
          : t('ret.restorePacks', { batch: r.batchNo, packs: r.packs })))
        .join(', ')
    : '';
  return `
    <tr data-key="${esc(row.key)}">
      <td data-label="${esc(t('ret.col.medicine'))}"><span class="pl-name"><strong>${esc(row.name)}</strong></span>
        <span class="muted small">${esc(row.meta)}</span></td>
      <td class="num" data-label="${esc(t('ret.col.bought'))}">${esc(row.soldText)}</td>
      <td class="num" data-label="${esc(t('ret.col.remaining'))}">${esc(row.remainingText)}</td>
      <td data-label="${esc(t('ret.col.returnQty'))}"><input class="cell-input" type="number" min="0" max="${row.remaining}" inputmode="numeric" data-qty value="${esc(row.qty)}" aria-label="${esc(t('ret.col.returnQty'))}"></td>
      <td class="num" data-label="${esc(t('ret.col.value'))}"><span data-value>${esc(rupees(row.value))}</span></td>
      <td class="muted small" data-label="${esc(t('ret.col.restores'))}"><span data-restores>${esc(restores)}</span></td>
    </tr>`;
}

function refreshRow(key) {
  const row = rows.find((r) => r.key === key);
  if (!row) return;
  const units = Number(row.qty) || 0;
  if (kind === 'sale') {
    row.value = units > 0 ? saleValue(row.item, units) : 0;
    row.restores = units > 0 ? restoreSplit(row.item, units) : [];
  } else {
    row.value = (Number(row.qty) || 0) * row.item.costPerPack;
    row.restores = (Number(row.qty) || 0) > 0 ? [{ batchNo: row.item.batchNo, packs: Number(row.qty) }] : [];
  }
  const $row = $host.find(`tr[data-key="${key}"]`);
  $row.find('[data-value]').text(rupees(row.value));
  $row.find('[data-restores]').text(
    row.restores
      .map((r) => (kind === 'sale' ? t('ret.restoreUnits', { batch: r.batchNo, units: r.units }) : t('ret.restorePacks', { batch: r.batchNo, packs: r.packs })))
      .join(', '),
  );
  paintTotals();
}

function paintMethods() {
  const options = methods();
  if (!options.includes(method)) method = 'cash';
  $host.find('[data-method]').each(function paint() {
    const key = this.getAttribute('data-method');
    this.hidden = !options.includes(key);
    this.setAttribute('aria-checked', String(key === method));
    this.classList.toggle('is-on', key === method);
  });
}

function paintTotals() {
  const { gross, refund, credit } = totals();
  $host.find('.ret-gross').html(money(gross));
  $host.find('.ret-credit').html(money(credit));
  if (!refundTouched) $host.find('[name="refund"]').val(rupees(refund));
  const creditLabel = kind === 'sale' ? t('ret.creditCustomer') : t('ret.creditSupplier');
  $host.find('.ret-credit-label').text(creditLabel);
  $host.find('.ret-save').prop('disabled', busy || gross <= 0);
}

function shell() {
  const isSale = kind === 'sale';
  const party = partyName || (isSale ? t('doc.walkIn') : t('purch.noSupplier'));
  const head = isSale
    ? `${t('sales.title')} · ${doc.number} · ${formatDate(doc.date)}`
    : `${t('purch.title')} · ${doc.number} · ${formatDate(doc.date)}`;
  return `
    ${shared.pageHead(t('ret.new'), `<button type="button" class="btn btn-ghost" data-action="back">${esc(t('ret.back'))}</button>`)}
    <p class="muted small">${esc(head)}${party ? ` · ${esc(party)}` : ''}</p>
    <form class="ret-form" novalidate>
      <section class="card">
        <h3 class="doc-legend">${esc(t('ret.items'))}</h3>
        <p class="muted small">${esc(isSale ? t('ret.helpSale') : t('ret.helpPurchase'))}</p>
        <div class="table-wrap">
          <table class="table table-cards">
            <thead><tr>
              <th>${esc(t('ret.col.medicine'))}</th><th class="num">${esc(t('ret.col.bought'))}</th><th class="num">${esc(t('ret.col.remaining'))}</th>
              <th>${esc(t('ret.col.returnQty'))}</th><th class="num">${esc(t('ret.col.value'))}</th><th>${esc(t('ret.col.restores'))}</th>
            </tr></thead>
            <tbody>${rows.map(rowHtml).join('')}</tbody>
          </table>
        </div>
        ${rows.length === 0 ? `<p class="muted">${esc(t('ret.nothingLeft'))}</p>` : ''}
      </section>

      <section class="card">
        <h3 class="doc-legend">${esc(t('ret.refund'))}</h3>
        <div class="seg ret-methods" role="radiogroup" aria-label="${esc(t('ret.refund'))}">
          <button type="button" class="seg-option" role="radio" data-method="cash" aria-checked="true">${esc(methodLabel('cash'))}</button>
          <button type="button" class="seg-option" role="radio" data-method="account" aria-checked="false" hidden>${esc(methodLabel('account'))}</button>
          <button type="button" class="seg-option" role="radio" data-method="supplier" aria-checked="false" hidden>${esc(methodLabel('supplier'))}</button>
        </div>
        <p class="muted small">${esc(t('ret.methodHelp'))}</p>
        <div class="form-grid">
          <div class="float-field">
            <input name="refund" inputmode="decimal" placeholder=" " autocomplete="off">
            <label>${esc(t('ret.cashNow'))}</label>
          </div>
          <div class="float-field">
            <input name="reason" placeholder=" " autocomplete="off" value="${esc(reason)}">
            <label>${esc(t('ret.reasonLabel'))}</label>
          </div>
        </div>
      </section>

      <section class="card">
        <dl class="doc-totals">
          <div><dt>${esc(t('ret.col.value'))}</dt><dd class="ret-gross"></dd></div>
          <div><dt><span class="ret-credit-label"></span></dt><dd class="ret-credit"></dd></div>
        </dl>
        <p class="form-error ret-error" role="alert" hidden></p>
        <div class="form-footer row">
          <button type="button" class="btn btn-ghost" data-action="back">${esc(t('ret.cancel'))}</button>
          <button type="submit" class="btn btn-primary ret-save">${esc(t('ret.save'))}</button>
        </div>
      </section>
    </form>`;
}

/* ---------- Loading ---------- */

function rowsFromSale(sale) {
  return sale.items
    .filter((item) => item.units - (item.returnedUnits ?? 0) > 0)
    .map((item) => ({
      key: item.id,
      item,
      name: item.productName,
      meta: item.strength ?? '',
      soldText: t('ret.unitsOf', { units: item.units }),
      remaining: item.units - (item.returnedUnits ?? 0),
      remainingText: t('ret.unitsOf', { units: item.units - (item.returnedUnits ?? 0) }),
      qty: '',
      value: 0,
      restores: [],
    }));
}

function rowsFromPurchase(purchase) {
  return purchase.items
    .filter((item) => item.packs - (item.returnedPacks ?? 0) > 0)
    .map((item) => ({
      key: item.id,
      item,
      name: item.productName,
      meta: item.batchNo,
      soldText: t('ret.packsOf', { packs: item.packs }),
      remaining: item.packs - (item.returnedPacks ?? 0),
      remainingText: t('ret.packsOf', { packs: item.packs - (item.returnedPacks ?? 0) }),
      qty: '',
      value: 0,
      restores: [],
    }));
}

async function load(query) {
  partyName = '';
  if (query?.sale) {
    kind = 'sale';
    doc = await getSaleWithItems(query.sale);
    rows = rowsFromSale(doc);
    if (doc.status === 'void') return 'saleVoided';
    if (doc.customerId) partyName = (await shared.partyNames()).customer.get(doc.customerId)?.name ?? '';
  } else if (query?.purchase) {
    kind = 'purchase';
    doc = await getPurchaseWithItems(query.purchase);
    rows = rowsFromPurchase(doc);
    if (doc.supplierId) partyName = (await shared.partyNames()).supplier.get(doc.supplierId)?.name ?? '';
  } else {
    return 'emptyReturn';
  }
  return '';
}

/* ---------- Save ---------- */

async function save() {
  if (busy) return;
  const $error = $host.find('.ret-error');
  const picked = rows.filter((row) => (Number(row.qty) || 0) > 0);
  if (picked.length === 0) {
    $error.text(t('ret.err.none')).prop('hidden', false);
    anim.shake($host.find('.ret-form')[0]);
    return;
  }
  const bad = picked.find((row) => Number(row.qty) > row.remaining);
  if (bad) {
    $error.text(t('ret.err.tooMany', { name: bad.name, max: bad.remaining })).prop('hidden', false);
    anim.shake($host.find('.ret-form')[0]);
    return;
  }
  const { refund } = totals();
  const reasonText = $host.find('[name="reason"]').val().trim();
  busy = true;
  paintTotals();
  try {
    if (kind === 'sale') {
      await createSaleReturn({
        saleId: doc.id,
        items: picked.map((row) => ({ saleItemId: row.key, units: Number(row.qty) })),
        refund,
        reason: reasonText,
      });
    } else {
      await createPurchaseReturn({
        purchaseId: doc.id,
        items: picked.map((row) => ({ purchaseItemId: row.key, packs: Number(row.qty) })),
        refund,
        reason: reasonText,
      });
    }
    ui.toast(t('ret.saved'), { type: 'success' });
    navigate('/returns');
  } catch (err) {
    $error.text(shared.errorText(err)).prop('hidden', false);
    if (!shared.SERVICE_CODES.includes(err?.code)) console.error('[return] save failed', err);
    anim.shake($host.find('.ret-form')[0]);
  } finally {
    busy = false;
    paintTotals();
  }
}

/* ---------- Wiring ---------- */

function bind() {
  $host.on('input', '[data-qty]', (event) => {
    const key = event.currentTarget.closest('tr').getAttribute('data-key');
    const row = rows.find((r) => r.key === key);
    if (row) row.qty = event.currentTarget.value;
    refreshRow(key);
  });
  $host.on('click', '[data-method]', (event) => {
    if (event.currentTarget.hidden) return;
    method = event.currentTarget.getAttribute('data-method');
    refundTouched = false;
    paintMethods();
    paintTotals();
  });
  $host.on('input', '[name="refund"]', (event) => {
    refundTouched = true;
    refundText = event.currentTarget.value;
    paintTotals();
  });
  $host.on('click', '[data-action="back"]', () => navigate(kind === 'sale' ? '/sales' : '/purchases'));
  $host.on('submit', '.ret-form', (event) => {
    event.preventDefault();
    save();
  });
}

export async function render($root, params, query = {}) {
  doc = null;
  rows = [];
  method = 'cash';
  refundText = '';
  refundTouched = false;
  reason = '';
  busy = false;
  $root.html('<div class="doc-root ret-root"></div>');
  $host = $root.children('.doc-root');
  const problem = await load(query);
  if (problem) {
    $host.html(`
      <section class="card empty-state">
        <h2>${esc(t('ret.new'))}</h2>
        <p class="muted">${esc(t(`svc.${problem}`))}</p>
        <button type="button" class="btn btn-primary" data-go="/returns">${esc(t('ret.back'))}</button>
      </section>`);
    $host.on('click', '[data-go]', () => navigate('/returns'));
    return;
  }
  $host.html(shell());
  bind();
  paintMethods();
  paintTotals();
}

export function destroy() {
  $host = null;
  doc = null;
  rows = [];
}
