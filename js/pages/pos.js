// New Sale (#/pos). Product grid on the left (desktop) or first (phone), cart on the right, or a sheet on phones.
// Keyboard: type to search, Enter adds one pack, Shift+Enter adds one loose unit, "3*name" adds three.
//   F2 search, F4 pay, Ctrl+Enter complete (in the pay sheet), Esc closes sheets.
import * as anim from '../core/anim.js';
import * as events from '../core/events.js';
import * as i18n from '../core/i18n.js';
import * as ui from '../core/ui.js';
import { esc, icon } from '../core/ui.js';
import { parseRupees, percentOf, format } from '../core/money.js';
import { todayISO } from '../core/dates.js';
import { saleCards, alternativesInStock, cardForBarcode } from '../services/pos.js';
import { batchRows } from '../services/stock.js';
import { createSale, holdCart, listHeldCarts, resumeCart, discardHeldCart, restoreHeldCart } from '../services/sales.js';
import { listGroups } from '../services/products.js';
import { listCustomers, createCustomer } from '../services/parties.js';
import { addDemand } from '../services/demand.js';
import { getSettings } from '../services/settings.js';
import { paymentAccounts, accountName } from '../services/ledger.js';
import { buildReceipt, receiptHtml, receiptText } from '../services/receipt.js';
import { printInBrowser, printToBluetooth, connectBluetoothPrinter, printerConnected, bluetoothSupported } from '../services/printing.js';
import { whatsappLink } from '../services/demand.js';
import { openScanDialog } from './_medicine-dialogs.js';

const t = i18n.t;
export const route = '/pos';
export const title = 'nav.newSale';

const STATUS_TONE = { in: 'ok', low: 'warn', out: 'danger' };
const SVC_KEYS = [
  'insufficientStock', 'batchExpired', 'walkInCredit', 'overpaid', 'tenderedTooLow', 'patientDoctorRequired',
  'discountTooLarge', 'looseNotAllowed', 'priceEditNotAllowed', 'productInactive', 'emptyCart', 'emptyTotal', 'invalidAccount',
];

let $host = null;
let unsubscribe = null;
let state = blankState();
let cards = [];
let groups = [];
let customers = [];
let settings = {};
let paymentOptions = []; // bank and wallet accounts that can take part of a sale
let uidSeq = 0;
let searchTimer = null;
// Dialogs opened by this page. They close when the user leaves the page.
const openDialogs = new Set();

function showDialog(options) {
  const dialog = ui.openModal(options);
  openDialogs.add(dialog);
  return dialog;
}

function blankState() {
  return {
    lines: [],
    customer: '',
    discountKind: 'amount',
    discount: '',
    tax: '',
    note: '',
    patient: '',
    doctor: '',
    mode: 'pack',
    query: '',
    group: '',
    panel: null, // { card, alternatives } when an out-of-stock medicine was asked for
    lastSale: null,
  };
}

const paisa = (text) => {
  const n = parseRupees(String(text ?? '').trim());
  return n === null ? 0 : n;
};

/* ---------- Cart maths (display; the service computes the final numbers) ---------- */

const unitsOf = (line) => (line.mode === 'loose' ? line.qty : line.qty * line.card.unitsPerPack);
const lineGross = (line) => (line.mode === 'loose' ? line.qty * line.loosePrice : line.qty * line.packPrice);
const lineAmount = (line) => Math.max(0, lineGross(line) - line.lineDiscount);
const subtotal = () => state.lines.reduce((total, line) => total + lineAmount(line), 0);

function discountAmount() {
  const sub = subtotal();
  if (state.discountKind === 'percent') return percentOf(sub, Math.min(100, Math.max(0, Number(state.discount) || 0)));
  return Math.min(sub, paisa(state.discount));
}

// A typed tax wins. Otherwise, when sales tax is on in settings, the rate applies to the amount after discount.
const taxAmount = () => {
  if (String(state.tax ?? '').trim() !== '') return paisa(state.tax);
  if (settings.taxEnabled) return percentOf(subtotal() - discountAmount(), Number(settings.taxRate) || 0);
  return 0;
};
const totalAmount = () => subtotal() - discountAmount() + taxAmount();
const rupees = (value) => format(value, { symbol: false });
const money = (value) => `<span class="money" data-count="${value}" data-format="money-plain">${esc(rupees(value))}</span>`;

const needsDetails = () => state.lines.some((line) => ['rx', 'controlled'].includes(line.card.class));

/* ---------- Search and the product grid ---------- */

function parseQuery(raw) {
  const text = String(raw ?? '').trim();
  const match = /^(\d+)\s*[*x×]\s*(.+)$/i.exec(text);
  if (match) return { qty: Math.max(1, Number(match[1])), query: match[2].trim() };
  return { qty: 1, query: text };
}

function cardHtml(card) {
  const status = card.status;
  const expiry = card.nearestExpiry ? t('pos.expiresOn', { date: card.nearestExpiry.split('-').reverse().join('/') }) : '';
  const price = card.mrpPerPack ? money(card.salePricePerPack || card.mrpPerPack) : `<span class="badge badge--warn">${esc(t('med.noPrice'))}</span>`;
  return `
    <button type="button" class="pos-card${status === 'out' ? ' is-out' : ''}" data-card="${esc(card.id)}" tabindex="-1" ${status === 'out' && card.trackStock !== false ? 'aria-disabled="true"' : ''}>
      <span class="pc-top">
        <span class="pc-name">${esc(card.name)}${card.nameUr ? ` <span class="pc-urdu" lang="ur">${esc(card.nameUr)}</span>` : ''}</span>
        <span class="badge badge--${STATUS_TONE[status]}">${esc(t(`pos.status.${status}`))}</span>
      </span>
      <span class="pc-meta muted small">${esc([card.strength, card.company].filter(Boolean).join(' · '))}</span>
      <span class="pc-bottom">
        <span class="pc-stock small">${esc(card.packs)} ${esc(t(`sold.${card.soldAs}`).toLowerCase())}${card.looseUnits ? ` + ${esc(card.looseUnits)}` : ''}</span>
        ${price}
      </span>
      <span class="pc-foot muted small">${[card.rack ? t('pos.rack', { rack: card.rack }) : '', expiry].filter(Boolean).map(esc).join(' · ')}</span>
    </button>`;
}

function paintCatalog() {
  const grid = $host.find('.pos-grid');
  const panel = $host.find('.pos-panel');
  if (state.panel) {
    panel.html(outOfStockPanel(state.panel)).prop('hidden', false);
  } else {
    panel.html('').prop('hidden', true);
  }
  grid.html(cards.map(cardHtml).join(''));
  $host.find('.pos-none').prop('hidden', cards.length > 0 || Boolean(state.panel));
  $host.find('.pos-none').text(state.query ? t('pos.noResults', { query: state.query }) : '');
}

function outOfStockPanel(panel) {
  const alts = panel.alternatives.map(cardHtml).join('');
  return `
    <div class="pos-oos">
      <p><strong>${esc(t('pos.notOnShelf', { name: panel.card.name }))}</strong></p>
      <div class="row">
        <button type="button" class="btn btn-primary btn-sm" data-order="${esc(panel.card.id)}">${esc(t('pos.addToOrder'))}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-dismiss>×</button>
      </div>
      ${panel.alternatives.length ? `<p class="muted small">${esc(t('pos.alternatives'))}</p><div class="pos-grid pos-grid--inner">${alts}</div>` : ''}
    </div>`;
}

let refreshSeq = 0;

async function refreshCards(text = state.query) {
  const seq = (refreshSeq += 1);
  const parsed = parseQuery(text);
  const list = await saleCards({ query: parsed.query, group: state.group, today: todayISO() });
  if (seq !== refreshSeq) return; // a newer search started while this one ran: its result wins
  cards = list;
  paintCatalog();
}

/* ---------- Cart ---------- */

function lineHtml(line) {
  const card = line.card;
  const loose = card.looseSelling;
  const batchOptions = [
    `<option value="">${esc(t('pos.batchAuto'))}</option>`,
    ...(line.batches ?? []).map((b) => `<option value="${esc(b.batchId)}"${line.batchId === b.batchId ? ' selected' : ''}>${esc(b.batchNo)} · ${esc(b.expiry.split('-').reverse().join('/'))} · ${esc(b.units)}</option>`),
  ].join('');
  const priceField = settings.allowPriceEdit !== false
    ? `<label class="pl-field"><span>${esc(t(line.mode === 'loose' ? 'pos.loosePrice' : 'pos.packPrice'))}</span>
         <input type="text" inputmode="decimal" data-price="${esc(line.uid)}" value="${esc(((line.mode === 'loose' ? line.loosePrice : line.packPrice) / 100).toFixed(2))}"></label>`
    : '';
  return `
    <li class="pos-line" data-key="${esc(line.uid)}">
      <div class="pl-head">
        <span class="pl-name"><strong>${esc(card.name)}</strong> <span class="muted small">${esc(card.strength)}</span></span>
        <button type="button" class="icon-btn pl-remove" data-remove="${esc(line.uid)}" aria-label="${esc(t('pos.remove'))}">${icon('close')}</button>
      </div>
      <div class="pl-controls">
        <div class="stepper" role="group">
          <button type="button" class="btn btn-ghost btn-sm" data-step="${esc(line.uid)}" data-delta="-1" aria-label="−">−</button>
          <span class="pl-qty" aria-live="polite">${esc(line.qty)}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-step="${esc(line.uid)}" data-delta="1" aria-label="+">+</button>
        </div>
        ${
          loose
            ? `<div class="seg seg--small" role="radiogroup" data-indicator>
                <span class="seg-indicator" aria-hidden="true"></span>
                <button type="button" class="seg-option" role="radio" data-mode-line="${esc(line.uid)}" data-mode="pack" aria-checked="${line.mode === 'pack'}">${esc(t(`sold.${card.soldAs}`))}</button>
                <button type="button" class="seg-option" role="radio" data-mode-line="${esc(line.uid)}" data-mode="loose" aria-checked="${line.mode === 'loose'}">${esc(card.unitName)}</button>
              </div>`
            : ''
        }
        <span class="pl-total">${money(lineAmount(line))}</span>
      </div>
      <div class="pl-fields">
        ${priceField}
        <label class="pl-field"><span>${esc(t('pos.lineDiscount'))}</span>
          <input type="text" inputmode="decimal" data-linedisc="${esc(line.uid)}" value="${line.lineDiscount ? (line.lineDiscount / 100).toFixed(2) : ''}"></label>
        <label class="pl-field"><span>${esc(t('pos.batch'))}</span><select data-batch="${esc(line.uid)}">${batchOptions}</select></label>
      </div>
    </li>`;
}

function paintCart({ animate = false } = {}) {
  const list = $host.find('.pos-lines');
  const render = () => {
    list.html(state.lines.map(lineHtml).join(''));
    $host.find('.pos-empty').prop('hidden', state.lines.length > 0);
  };
  if (animate) anim.flip(list[0], render);
  else render();
  paintTotals();
}

function paintTotals() {
  const count = state.lines.reduce((total, line) => total + line.qty, 0);
  $host.find('.pos-count').text(String(state.lines.length));
  $host.find('.pos-items').text(String(count));
  $host.find('.pos-subtotal').html(money(subtotal()));
  $host.find('.pos-discount-value').html(money(discountAmount()));
  $host.find('.pos-tax-value').html(money(taxAmount()));
  $host.find('.pos-total').html(money(totalAmount()));
  $host.find('.pos-bar-total').html(money(totalAmount()));
  $host.find('.pos-rx').prop('hidden', !needsDetails());
  $host.find('[data-pay]').prop('disabled', state.lines.length === 0);
  anim.scanCounts($host[0]);
  // Lines show their totals in place. Refresh only the changed ones.
  state.lines.forEach((line) => {
    $host.find(`[data-key="${line.uid}"] .pl-total`).html(money(lineAmount(line)));
  });
  anim.scanCounts($host[0]);
  const items = String(state.lines.reduce((total, line) => total + line.qty, 0));
  $host.find('.pos-bar-count, .pos-cart-count').text(items);
}

async function addToCart(card, { mode = state.mode, qty = 1, fromEl = null } = {}) {
  if (card.trackStock !== false && card.status === 'out') {
    const alternatives = await alternativesInStock(card.id, { today: todayISO() });
    state.panel = { card, alternatives };
    paintCatalog();
    return false;
  }
  if (mode === 'loose' && !card.looseSelling) {
    ui.toast(t('svc.looseNotAllowed', { product: card.name }), { type: 'error' });
    return false;
  }
  const same = state.lines.find((l) => l.card.id === card.id && l.mode === mode);
  if (same) {
    same.qty += qty;
  } else {
    const batches = await batchRows({ productId: card.id, today: todayISO(), withStockOnly: true });
    state.lines.push({
      uid: `l${(uidSeq += 1)}`,
      card,
      mode,
      qty,
      packPrice: card.salePricePerPack,
      loosePrice: card.looseUnitPrice,
      lineDiscount: 0,
      batchId: null,
      batches: batches.filter((b) => b.bucket !== 'expired'),
    });
  }
  state.panel = null;
  paintCart({ animate: true });
  if (fromEl) {
    const target = $host.find('.pos-bar-count:visible, .pos-cart-count:visible')[0];
    if (target) anim.flyToCart(fromEl, target);
  }
  ui.toast(t('pos.added', { name: card.name }), { timeout: 1400 });
  return true;
}

// Enter presses are queued so that fast typing and scanners never overlap two adds.
let searchQueue = Promise.resolve();

const afterSearch = (fn) => {
  searchQueue = searchQueue.then(fn);
};

function enterInSearch(loose) {
  // The box is cleared at once, so keys typed while the line is added start from an empty box.
  const typed = state.query;
  state.query = '';
  $host.find('.pos-search').val('');
  searchQueue = searchQueue.then(() => addFromSearch(typed, loose));
}

async function addFromSearch(typed, loose) {
  const parsed = parseQuery(typed);
  // Its own list for the text that was typed, so a refresh started while typing cannot change the pick.
  const list = await saleCards({ query: parsed.query, group: state.group, today: todayISO() });
  if (!list.length) {
    // Nothing on the list: keep the name for the order list.
    if (parsed.query) {
      state.panel = { card: { id: '', name: parsed.query, trackStock: false }, alternatives: [] };
      paintCatalog();
    }
    return;
  }
  await addToCart(list[0], { mode: loose ? 'loose' : state.mode, qty: parsed.qty });
  await refreshCards();
}

/* ---------- Pay ---------- */

// Rx and controlled medicines need the patient and doctor. They are asked for on the pay sheet,
// so the cashier reaches them straight after F4 instead of tabbing through the product grid.
const detailsRequired = () => needsDetails() && settings.rxRequiresPatientDoctor;

function payBody() {
  const total = totalAmount();
  return `
    <form class="pay-form" novalidate>
      <p class="pay-total" aria-live="polite"><span class="muted">${esc(t('pos.total'))}</span> <strong>${money(total)}</strong></p>
      ${detailsRequired() ? `<div class="form-grid">
        <div class="float-field"><input name="patient" autocomplete="off" placeholder=" " value="${esc(state.patient)}"><label>${esc(t('pos.patient'))} *</label></div>
        <div class="float-field"><input name="doctor" autocomplete="off" placeholder=" " value="${esc(state.doctor)}"><label>${esc(t('pos.doctor'))} *</label></div>
      </div>` : ''}
      <div class="pay-quick" role="group">
        <button type="button" class="chip" data-exact>${esc(t('pay.exact'))}</button>
        <button type="button" class="chip" data-quick="500">500</button>
        <button type="button" class="chip" data-quick="1000">1000</button>
        <button type="button" class="chip" data-quick="5000">5000</button>
      </div>
      <div class="form-grid">
        <div class="float-field"><input name="tendered" inputmode="decimal" placeholder=" " autocomplete="off"><label>${esc(t('pay.tendered'))}</label></div>
        <label class="field"><span>${esc(t('pay.account'))}</span>
          <select name="account">${paymentOptions.map((a) => `<option value="${esc(a.code)}">${esc(accountName(a))}</option>`).join('')}</select>
        </label>
        <div class="float-field"><input name="other" inputmode="decimal" placeholder=" " autocomplete="off"><label>${esc(t('pay.other'))}</label></div>
      </div>
      <div class="pay-summary">
        <p><span>${esc(t('pay.change'))}</span> <strong class="pay-change">${esc(rupees(0))}</strong></p>
        <p><span>${esc(t('pay.onAccount'))}</span> <strong class="pay-account">${esc(rupees(total))}</strong></p>
      </div>
      <p class="form-error pay-error" role="alert" hidden></p>
      <div class="form-footer">
        <button type="submit" class="btn btn-primary btn-block" data-complete><span data-label-hide>${esc(t('pay.complete'))}</span></button>
      </div>
    </form>`;
}

function readPay($form) {
  const total = totalAmount();
  const tendered = paisa($form.find('[name="tendered"]').val());
  const other = paisa($form.find('[name="other"]').val());
  const otherAccount = $form.find('[name="account"]').val() || '';
  const cashApplied = Math.max(0, Math.min(tendered, total - other));
  const change = Math.max(0, tendered - cashApplied);
  const remaining = Math.max(0, total - cashApplied - other);
  return { total, tendered, other, otherAccount, cashApplied, change, remaining };
}

function paintPay($form) {
  const p = readPay($form);
  $form.find('.pay-change').text(rupees(p.change));
  $form.find('.pay-account').text(rupees(p.remaining));
  const $err = $form.find('.pay-error');
  if (p.remaining > 0 && !state.customer) {
    $err.text(t('pay.walkInRule')).prop('hidden', false);
  } else {
    $err.prop('hidden', true);
  }
}

async function completeSale($form, dialog) {
  const p = readPay($form);
  const $error = $form.find('.pay-error');
  const $button = $form.find('[data-complete]');
  if (detailsRequired()) {
    state.patient = $form.find('[name="patient"]').val().trim();
    state.doctor = $form.find('[name="doctor"]').val().trim();
    if (!state.patient || !state.doctor) {
      $error.text(t('svc.patientDoctorRequired')).prop('hidden', false);
      return;
    }
  }
  if (p.remaining > 0 && !state.customer) {
    $error.text(t('pay.walkInRule')).prop('hidden', false);
    return;
  }
  const payments = [
    { method: 'cash', amount: p.cashApplied },
    { method: paymentOptions.find((a) => a.code === p.otherAccount)?.kind === 'wallet' ? 'mobile' : 'bank', amount: p.other, accountCode: p.otherAccount },
  ].filter((x) => x.amount > 0);
  const payload = {
    customer: state.customer || null,
    items: state.lines.map((line) => ({
      productId: line.card.id,
      packs: line.mode === 'pack' ? line.qty : 0,
      looseUnits: line.mode === 'loose' ? line.qty : 0,
      packPrice: line.packPrice,
      loosePrice: line.loosePrice,
      lineDiscount: line.lineDiscount,
      batchId: line.batchId || null,
    })),
    tax: taxAmount(),
    payments,
    tendered: p.tendered || p.cashApplied,
    patient: state.patient,
    doctor: state.doctor,
    note: state.note,
  };
  if (state.discountKind === 'percent') payload.discountPercent = Number(state.discount) || 0;
  else payload.discount = paisa(state.discount);

  anim.buttonState($button, 'loading');
  try {
    const sale = await createSale(payload);
    anim.buttonState($button, 'success');
    dialog.close();
    await showSuccess(sale);
  } catch (err) {
    anim.buttonState($button, 'idle');
    const key = SVC_KEYS.includes(err.code) ? `svc.${err.code}` : 'svc.default';
    $error.text(t(key, err.vars)).prop('hidden', false);
    anim.shake($error[0]);
    if (!SVC_KEYS.includes(err.code)) console.error('[pos] sale failed', err);
  }
}

function openPay() {
  if (!state.lines.length) return;
  const $body = $(payBody());
  const $form = $body.is('form') ? $body : $body.find('form');
  let dialog = null;
  $form.find('[data-exact]').on('click', () => {
    $form.find('[name="tendered"]').val(((readPay($form).total - paisa($form.find('[name="other"]').val())) / 100).toFixed(2));
    paintPay($form);
  });
  $form.find('[data-quick]').on('click', function quick() {
    $form.find('[name="tendered"]').val(this.dataset.quick);
    paintPay($form);
  });
  $form.find('input').on('input', () => paintPay($form));
  $form.on('submit', (event) => {
    event.preventDefault();
    completeSale($form, dialog);
  });
  $form.on('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      completeSale($form, dialog);
    }
  });
  dialog = showDialog({ title: t('pay.title'), body: $form, actions: [] });
  paintPay($form);
  const missing = detailsRequired() ? ['patient', 'doctor'].find((name) => !state[name].trim()) : null;
  $form.find(`[name="${missing ?? 'tendered'}"]`).trigger('focus');
}

/* ---------- Success ---------- */

async function showSuccess(sale) {
  const model = await buildReceipt(sale.id);
  state.lastSale = model;
  // Auto-print: send the receipt to the chosen printer as soon as the sale completes.
  if (settings.printAutoPrint) {
    if (settings.printMethod === 'bluetooth') {
      if (printerConnected()) printToBluetooth(model, { copies: settings.printCopies }).catch((err) => console.error('[pos] auto print failed', err));
    } else {
      printInBrowser(model, { copies: settings.printCopies });
    }
  }
  const btBtn = bluetoothSupported()
    ? `<button type="button" class="btn btn-soft" data-bt>${esc(t(printerConnected() ? 'success.printBluetooth' : 'success.connectPrinter'))}</button>`
    : '';
  const $body = $(`
    <div class="success">
      <svg class="success-check" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54"/><path d="M36 62 L54 80 L86 44"/></svg>
      <p class="success-number">${esc(model.number)}</p>
      <div class="receipt-preview">${receiptHtml(model)}</div>
      <div class="success-actions">
        <button type="button" class="btn btn-primary" data-print>${esc(t('success.print'))}</button>
        ${btBtn}
        <a class="btn btn-soft" data-wa target="_blank" rel="noopener">${esc(t('success.whatsapp'))}</a>
        <button type="button" class="btn btn-ghost" data-new>${esc(t('success.newSale'))}</button>
      </div>
    </div>`);
  const dialog = showDialog({ title: t('success.title'), body: $body, actions: [] });
  $body.find('[data-print]').on('click', () => printInBrowser(model, { copies: settings.printCopies }));
  $body.find('[data-bt]').on('click', async () => {
    try {
      if (!printerConnected()) await connectBluetoothPrinter();
      await printToBluetooth(model, { copies: settings.printCopies });
      ui.toast(t('success.printBluetooth'), { type: 'success' });
    } catch (err) {
      console.error('[pos] bluetooth print failed', err);
      ui.toast(t('errors.generic'), { type: 'error' });
    }
  });
  $body.find('[data-wa]').attr('href', whatsappLink(receiptText(model), model.raw.customerPhone ?? ''));
  $body.find('[data-new]').on('click', () => {
    dialog.close();
    newSale();
  });
  anim.animate($body.find('.success-check')[0], [{ opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'none' }], { duration: 300 });
}

function newSale() {
  const keep = { mode: state.mode, group: state.group };
  state = { ...blankState(), ...keep };
  $host.find('.pos-search').val('');
  paintCart();
  refreshCards();
  $host.find('.pos-search')[0]?.focus();
}

/* ---------- Holds ---------- */

async function holdCurrent() {
  if (!state.lines.length) return;
  await holdCart({
    customer: state.customer,
    items: state.lines.map((l) => ({
      productId: l.card.id,
      card: l.card,
      mode: l.mode,
      qty: l.qty,
      packPrice: l.packPrice,
      loosePrice: l.loosePrice,
      lineDiscount: l.lineDiscount,
      batchId: l.batchId,
    })),
    discount: state.discountKind === 'amount' ? paisa(state.discount) : 0,
    discountPercent: state.discountKind === 'percent' ? Number(state.discount) || 0 : null,
    tax: taxAmount(),
    patient: state.patient,
    doctor: state.doctor,
    note: state.note,
  });
  ui.toast(t('pos.hold'), { type: 'success', timeout: 1400 });
  newSale();
  await refreshHolds();
}

async function refreshHolds() {
  const held = await listHeldCarts();
  $host.find('[data-holds]').text(t('pos.holds', { count: held.length }));
}

async function openHolds() {
  const held = await listHeldCarts();
  const $body = $(`<div class="stack">${held.length ? held.map((h) => `
    <div class="hold-row" data-hold="${esc(h.id)}">
      <span>${esc(new Date(h.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))} · ${h.items.length} · ${h.customer ? '' : esc(t('pos.walkIn'))}</span>
      <span class="row"><button type="button" class="btn btn-primary btn-sm" data-resume="${esc(h.id)}">${esc(t('pos.resume'))}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-discard="${esc(h.id)}">${esc(t('pos.discard'))}</button></span>
    </div>`).join('') : `<p class="muted">${esc(t('pos.noHolds'))}</p>`}</div>`);
  const dialog = showDialog({ title: t('pos.holds', { count: held.length }), body: $body, actions: [] });
  $body.on('click', '[data-resume]', async (event) => {
    const cart = await resumeCart(event.currentTarget.getAttribute('data-resume'));
    state.lines = [...state.lines, ...cart.items.map((item) => ({
      uid: `l${(uidSeq += 1)}`,
      card: item.card,
      mode: item.mode,
      qty: item.qty,
      packPrice: item.packPrice,
      loosePrice: item.loosePrice,
      lineDiscount: item.lineDiscount ?? 0,
      batchId: item.batchId ?? null,
      batches: [],
    }))];
    if (!state.customer) state.customer = cart.customer ?? '';
    state.patient = state.patient || cart.patient || '';
    state.doctor = state.doctor || cart.doctor || '';
    state.note = state.note || cart.note || '';
    dialog.close();
    paintCart({ animate: true });
    await refreshHolds();
  });
  $body.on('click', '[data-discard]', async (event) => {
    const cart = await discardHeldCart(event.currentTarget.getAttribute('data-discard'));
    dialog.close();
    await refreshHolds();
    ui.toast(t('undo.discarded'), {
      action: {
        label: t('btn.undo'),
        run: async () => {
          await restoreHeldCart(cart);
          await refreshHolds();
        },
      },
    });
  });
}

/* ---------- Customers ---------- */

function customerOptions() {
  return [
    `<option value="">${esc(t('pos.walkIn'))}</option>`,
    ...customers.map((c) => `<option value="${esc(c.id)}"${state.customer === c.id ? ' selected' : ''}>${esc(c.name)}${c.phone ? ` · ${esc(c.phone)}` : ''}</option>`),
  ].join('');
}

function openNewCustomer() {
  const $body = $(`
    <form class="med-form" novalidate>
      <div class="float-field"><input name="name" placeholder=" " autocomplete="off" required><label>${esc(t('pos.customerName'))} *</label></div>
      <div class="float-field"><input name="phone" inputmode="tel" placeholder=" " autocomplete="off"><label>${esc(t('pos.customerPhone'))}</label></div>
      <p class="form-error" role="alert" hidden></p>
      <div class="form-footer"><button type="submit" class="btn btn-primary">${esc(t('btn.save'))}</button></div>
    </form>`);
  const $form = $body.is('form') ? $body : $body.find('form');
  const dialog = showDialog({ title: t('pos.newCustomer'), body: $form, actions: [] });
  $form.on('submit', async (event) => {
    event.preventDefault();
    try {
      const row = await createCustomer({ name: $form.find('[name="name"]').val(), phone: $form.find('[name="phone"]').val() });
      customers = await listCustomers();
      state.customer = row.id;
      dialog.close();
      $host.find('[data-customer]').html(customerOptions());
    } catch {
      $form.find('.form-error').text(t('errors.required')).prop('hidden', false);
    }
  });
}

/* ---------- Camera scanning ---------- */

async function openCameraScan() {
  const canScan = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
  if (!canScan) {
    openScanDialog({ onCode: (code) => scanCode(code) });
    return;
  }
  const $body = $(`<div class="stack"><video class="scan-video" playsinline muted></video><p class="muted small">${esc(t('scan.hint'))}</p></div>`);
  let stream = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    stream?.getTracks().forEach((track) => track.stop());
  };
  const dialog = showDialog({ title: t('scan.title'), body: $body, actions: [], onClose: stop });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $body.find('video')[0];
    video.srcObject = stream;
    await video.play();
    const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'qr_code', 'upc_a'] });
    const loop = async () => {
      if (stopped) return;
      try {
        const found = await detector.detect(video);
        if (found.length) {
          dialog.close();
          scanCode(found[0].rawValue);
          return;
        }
      } catch {
        /* a frame may not be ready yet */
      }
      setTimeout(loop, 250);
    };
    loop();
  } catch (err) {
    console.error('[pos] camera unavailable', err);
    dialog.close();
    ui.toast(t('pos.scanUnsupported'), { type: 'error' });
  }
}

async function scanCode(code) {
  const card = await cardForBarcode(code, { today: todayISO() });
  if (!card) {
    ui.toast(t('scan.notFound'), { type: 'error' });
    return;
  }
  await addToCart(card, { mode: state.mode });
}

/* ---------- Wiring ---------- */

function bind() {
  const $search = $host.find('.pos-search');
  $search.on('input', () => {
    state.query = $search.val();
    state.panel = null;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshCards, 20);
  });
  $search.on('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(searchTimer);
      enterInSearch(event.shiftKey);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      $host.find('.pos-grid .pos-card').first().trigger('focus');
    } else if (event.key === 'Escape') {
      state.query = '';
      $search.val('');
      state.panel = null;
      refreshCards();
    }
  });
  $host.on('click', '[data-card]', async (event) => {
    const card = cards.find((c) => c.id === event.currentTarget.getAttribute('data-card'));
    if (!card) return;
    const added = await addToCart(card, { mode: state.mode, qty: parseQuery(state.query).qty, fromEl: event.currentTarget });
    if (added) {
      state.query = '';
      $search.val('');
      refreshCards();
    }
  });
  $host.on('click', '[data-order]', async (event) => {
    const panel = state.panel;
    await addDemand({ productId: panel?.card?.id || null, name: panel?.card?.name ?? '', packs: 1, reason: 'not_found' });
    ui.toast(t('pos.addToOrder'), { type: 'success' });
    state.panel = null;
    paintCatalog();
  });
  $host.on('click', '[data-dismiss]', () => {
    state.panel = null;
    paintCatalog();
  });
  $host.on('click', '[data-mode-global]', (event) => {
    state.mode = event.currentTarget.getAttribute('data-mode-global');
    $host.find('[data-mode-global]').attr('aria-checked', 'false');
    event.currentTarget.setAttribute('aria-checked', 'true');
    anim.moveIndicator($host.find('.pos-mode'), event.currentTarget);
    $search.trigger('focus');
  });
  $host.on('click', '[data-group]', (event) => {
    state.group = event.currentTarget.getAttribute('data-group');
    $host.find('[data-group]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    refreshCards();
  });
  $host.on('click', '[data-step]', (event) => {
    const line = state.lines.find((l) => l.uid === event.currentTarget.getAttribute('data-step'));
    if (!line) return;
    line.qty = Math.max(1, line.qty + Number(event.currentTarget.getAttribute('data-delta')));
    paintCart();
  });
  $host.on('click', '[data-mode-line]', (event) => {
    const line = state.lines.find((l) => l.uid === event.currentTarget.getAttribute('data-mode-line'));
    if (!line) return;
    line.mode = event.currentTarget.getAttribute('data-mode');
    paintCart();
  });
  $host.on('click', '[data-remove]', (event) => {
    state.lines = state.lines.filter((l) => l.uid !== event.currentTarget.getAttribute('data-remove'));
    paintCart({ animate: true });
    $search.trigger('focus');
  });
  $host.on('change', '[data-price]', (event) => {
    const line = state.lines.find((l) => l.uid === event.currentTarget.getAttribute('data-price'));
    if (!line) return;
    const value = paisa(event.currentTarget.value);
    if (line.mode === 'loose') line.loosePrice = value;
    else line.packPrice = value;
    paintTotals();
  });
  $host.on('change', '[data-linedisc]', (event) => {
    const line = state.lines.find((l) => l.uid === event.currentTarget.getAttribute('data-linedisc'));
    if (!line) return;
    line.lineDiscount = Math.min(paisa(event.currentTarget.value), lineGross(line));
    paintTotals();
  });
  $host.on('change', '[data-batch]', (event) => {
    const line = state.lines.find((l) => l.uid === event.currentTarget.getAttribute('data-batch'));
    if (line) line.batchId = event.currentTarget.value || null;
  });
  $host.on('input change', '[data-discount], [data-tax], [data-note], [data-patient], [data-doctor]', (event) => {
    const el = event.currentTarget;
    if (el.hasAttribute('data-discount')) state.discount = el.value;
    if (el.hasAttribute('data-tax')) state.tax = el.value;
    if (el.hasAttribute('data-note')) state.note = el.value;
    if (el.hasAttribute('data-patient')) state.patient = el.value;
    if (el.hasAttribute('data-doctor')) state.doctor = el.value;
    paintTotals();
  });
  $host.on('change', '[data-discount-kind]', (event) => {
    state.discountKind = event.currentTarget.value;
    paintTotals();
  });
  $host.on('change', '[data-customer]', (event) => {
    state.customer = event.currentTarget.value;
  });
  $host.on('click', '[data-new-customer]', openNewCustomer);
  $host.on('click', '[data-hold]', holdCurrent);
  $host.on('click', '[data-holds]', openHolds);
  $host.on('click', '[data-pay]', openPay);
  $host.on('click', '[data-scan]', openCameraScan);
  $host.on('click', '[data-sheet]', () => $host.find('.pos-root').toggleClass('is-sheet-open'));

  // Keyboard: F2 search, F4 pay, Esc closes the cart sheet.
  const onKey = (event) => {
    if (!$host.closest('body').length) return;
    if (event.key === 'F2') {
      event.preventDefault();
      $search.trigger('focus');
    } else if (event.key === 'F4') {
      event.preventDefault();
      afterSearch(openPay); // a line typed just before F4 must be in the cart first
    } else if (event.key === 'Escape') {
      $host.find('.pos-root').removeClass('is-sheet-open');
    }
  };
  document.addEventListener('keydown', onKey);
  unsubscribe = () => {
    document.removeEventListener('keydown', onKey);
  };
}

function shell() {
  return `
    <div class="pos-root">
      <section class="pos-catalog" aria-label="${esc(t('pos.title'))}">
        <div class="pos-tools">
          <label class="search-box pos-search-box">
            <span class="sr-only">${esc(t('pos.search'))}</span>
            <input type="search" class="pos-search" placeholder="${esc(t('pos.search'))}" autocomplete="off" autofocus>
          </label>
          <button type="button" class="btn btn-ghost" data-scan>${esc(t('pos.scan'))}</button>
        </div>
        <div class="pos-filters">
          <div class="chip-row" role="group" data-groups>
            <button type="button" class="chip" data-group="" aria-pressed="true">${esc(t('pos.allGroups'))}</button>
            ${groups.map((g) => `<button type="button" class="chip" data-group="${esc(g)}" aria-pressed="false">${esc(g)}</button>`).join('')}
          </div>
          <div class="seg pos-mode" role="radiogroup" data-indicator>
            <span class="seg-indicator" aria-hidden="true"></span>
            <button type="button" class="seg-option" role="radio" data-mode-global="pack" aria-checked="true">${esc(t('pos.modePack'))}</button>
            <button type="button" class="seg-option" role="radio" data-mode-global="loose" aria-checked="false">${esc(t('pos.modeLoose'))}</button>
          </div>
        </div>
        <p class="muted small pos-keys">${esc(t('pos.keys'))}</p>
        <div class="pos-panel" hidden></div>
        <div class="pos-grid"></div>
        <p class="muted pos-none" hidden></p>
      </section>

      <aside class="pos-cart" aria-label="${esc(t('pos.total'))}">
        <div class="pos-sheet-handle" data-sheet></div>
        <div class="pos-cart-head">
          <h2>${esc(t('pos.total'))} <span class="badge pos-cart-count">0</span></h2>
          <div class="row">
            <button type="button" class="btn btn-ghost btn-sm" data-hold>${esc(t('pos.hold'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-holds>${esc(t('pos.holds', { count: 0 }))}</button>
          </div>
        </div>
        <div class="field">
          <label>${esc(t('pos.customer'))}</label>
          <div class="row">
            <select data-customer class="pos-customer">${customerOptions()}</select>
            <button type="button" class="btn btn-soft btn-sm" data-new-customer>+</button>
          </div>
        </div>
        <p class="muted pos-empty">${esc(t('pos.cartEmpty'))}</p>
        <ul class="pos-lines"></ul>
        <details class="pos-extras">
          <summary>${esc(t('pos.discount'))} · ${esc(t('pos.tax'))} · ${esc(t('pos.note'))}</summary>
          <div class="form-grid">
            <div class="field"><label>${esc(t('pos.discount'))}</label>
              <div class="row"><input type="text" inputmode="decimal" data-discount placeholder="0">
              <select data-discount-kind><option value="amount">${esc(t('pos.discountAmount'))}</option><option value="percent">${esc(t('pos.discountPercent'))}</option></select></div></div>
            <div class="field"><label>${esc(t('pos.tax'))}</label><input type="text" inputmode="decimal" data-tax placeholder="0"></div>
            <div class="field"><label>${esc(t('pos.note'))}</label><input type="text" data-note></div>
          </div>
        </details>
        <div class="pos-rx" hidden>
          <div class="form-grid">
            <div class="field"><label>${esc(t('pos.patient'))} *</label><input type="text" data-patient></div>
            <div class="field"><label>${esc(t('pos.doctor'))} *</label><input type="text" data-doctor></div>
          </div>
        </div>
        <dl class="pos-totals" aria-live="polite">
          <div><dt>${esc(t('pos.subtotal'))}</dt><dd class="pos-subtotal"></dd></div>
          <div><dt>${esc(t('pos.discount'))}</dt><dd class="pos-discount-value"></dd></div>
          <div><dt>${esc(t('pos.tax'))}</dt><dd class="pos-tax-value"></dd></div>
          <div class="pos-grand"><dt>${esc(t('pos.total'))}</dt><dd class="pos-total"></dd></div>
        </dl>
        <button type="button" class="btn btn-primary btn-block pos-pay" data-pay disabled>${esc(t('pos.pay'))} <span class="kbd">F4</span></button>
      </aside>

      <div class="pos-bar" role="region" aria-label="${esc(t('pos.total'))}">
        <button type="button" class="btn btn-ghost" data-sheet>${esc(t('pos.title'))} · <span class="pos-bar-count">0</span></button>
        <span class="pos-bar-total"></span>
        <button type="button" class="btn btn-primary" data-pay disabled>${esc(t('pos.pay'))}</button>
      </div>
    </div>`;
}

export async function render($root) {
  $root.html('<div class="pos-host"></div>');
  $host = $root.children('.pos-host');
  state = blankState();
  groups = await listGroups();
  customers = await listCustomers();
  settings = await getSettings();
  paymentOptions = await paymentAccounts({ includeCash: false });
  $host.html(shell());
  bind();
  await refreshCards();
  paintCart();
  await refreshHolds();
  $host.find('.pos-search')[0]?.focus();
  unsubscribe2 = events.on('data:changed', ({ stores }) => {
    if (stores.some((s) => ['products', 'batches', 'stockMovements'].includes(s))) refreshCards();
  });
}

let unsubscribe2 = null;

export function destroy() {
  unsubscribe?.();
  unsubscribe2?.();
  unsubscribe = null;
  unsubscribe2 = null;
  clearTimeout(searchTimer);
  for (const dialog of openDialogs) dialog.close();
  openDialogs.clear();
  $host = null;
  cards = [];
}

// Exported for the tests and the keyboard timing check.
export const _internal = { parseQuery, lineAmount, subtotal, discountAmount, totalAmount };
