// Practice screen (#/practice). Medicine given to a patient at the owner's own charge: the owner types the amount
// charged, and the calculated total is only the default. Not a sale: it has its own identity, its own history page,
// and its own ledger accounts. Pages call services only; nothing here touches the database directly.
import * as i18n from '../core/i18n.js';
import * as ui from '../core/ui.js';
import { esc, icon } from '../core/ui.js';
import * as anim from '../core/anim.js';
import { format } from '../core/money.js';
import { todayISO, formatDate } from '../core/dates.js';
import { navigate } from '../core/router.js';
import { debounce } from '../core/resilience.js';
import { getProfile, getSettings } from '../services/settings.js';
import { alternativesInStock, saleCards } from '../services/pos.js';
import { accountName, paymentAccounts } from '../services/ledger.js';
import { listCustomers } from '../services/parties.js';
import { printHtml } from '../services/printing.js';
import {
  createPractice,
  discardHeldPractice,
  holdPractice,
  lastActivePractice,
  listHeldPractices,
  listKits,
  practiceTotals,
  previewPractice,
  recentPatients,
  repeatItemsOf,
  resumeHeldPractice,
  restoreHeldPractice,
  saveKit,
  voidPractice,
} from '../services/practice.js';

export const route = '/practice';
export const title = 'nav.practice';

const t = i18n.t;
const UNDO_MS = 10000;
// Rs 100, 50, 10 in paisa, largest first: when two steps give the same amount, the larger step is the label shown.
const CHIP_STEPS = [10000, 5000, 1000];
const KNOWN_ERRORS = [
  'patientDoctorRequired', 'insufficientStock', 'looseNotAllowed', 'productInactive', 'emptyPractice',
  'backdatingNotAllowed', 'practiceCustomerRequired', 'invalidAmount', 'invalidField', 'notFound',
];

let $host = null;
let state = null;
let settings = null;
let accounts = [];
let customers = [];
let results = [];
let lastPreview = null;
let previewSeq = 0;
let searchSeq = 0;
let keyHandler = null;

const rupees = (paisa) => format(paisa, { symbol: false });
const money = (paisa) => `<span class="money" data-count="${esc(paisa)}" data-format="money-plain">${esc(rupees(paisa))}</span>`;

/** Rupees typed by the user → paisa. Empty → null (means "use the calculated total"). Bad input → NaN. */
function parseRupees(text) {
  const clean = String(text).replace(/[,\s]/g, '');
  if (clean === '') return null;
  const value = Number(clean);
  if (!Number.isFinite(value) || value < 0) return NaN;
  return Math.round(value * 100);
}

const blankState = () => ({
  query: '',
  items: [],
  charge: null,
  uid: 0,
  oos: null,
  alternatives: [],
});

const unitsText = (item) => (item.mode === 'loose' ? `${item.qty} ${item.card.unitName ?? 'unit'}` : `${item.qty} ${item.card.soldAs ?? 'pack'}`);
const listPriceOf = (item) => (item.mode === 'loose' ? item.qty * (item.card.looseUnitPrice ?? 0) : item.qty * item.card.salePricePerPack);

/** Calculated total: the list price of every line, before any change by the owner. Synchronous, from the cards. */
const calculatedTotal = () => state.items.reduce((total, item) => total + listPriceOf(item), 0);
const chargedAmount = () => (state.charge === null ? calculatedTotal() : state.charge);

function toServiceItems() {
  return state.items.map((item) => ({
    productId: item.productId,
    packs: item.mode === 'pack' ? item.qty : 0,
    looseUnits: item.mode === 'loose' ? item.qty : 0,
  }));
}

function errorMessage(err) {
  if (KNOWN_ERRORS.includes(err?.code)) {
    const text = t(`svc.${err.code}`, err.vars);
    if (text !== `svc.${err.code}`) return text;
  }
  return t('errors.generic');
}

/* ---------- Shell ---------- */

function shellHtml() {
  return `
    <div class="practice-root" data-accent="practice">
      <header class="practice-head">
        <div class="practice-title">
          <span class="practice-mark" aria-hidden="true">${icon('pulse')}</span>
          <div>
            <h2>${esc(t('nav.practice'))}</h2>
            <p class="muted small">${esc(t('practice.subtitle'))}</p>
          </div>
        </div>
        <div class="practice-insights" aria-live="polite"></div>
        <div class="practice-head-actions">
          <button type="button" class="btn btn-soft btn-sm" data-action="repeat">${esc(t('practice.repeatLast'))}</button>
          <button type="button" class="btn btn-soft btn-sm" data-action="kits">${esc(t('practice.kits'))}</button>
          <button type="button" class="btn btn-soft btn-sm" data-action="held">${esc(t('practice.held'))}</button>
          <a class="btn btn-ghost btn-sm" href="#/practice-list">${esc(t('practice.history'))}</a>
        </div>
      </header>
      <div class="practice-layout">
        <section class="practice-catalog" aria-label="${esc(t('practice.catalogLabel'))}">
          <label class="pr-label" for="pr-search">${esc(t('practice.searchLabel'))}</label>
          <div class="pr-search-row">
            <input id="pr-search" class="pr-search" type="search" autocomplete="off" autofocus
              placeholder="${esc(t('practice.searchPlaceholder'))}" aria-describedby="pr-hint">
            <span id="pr-hint" class="hint">${esc(t('practice.searchHint'))}</span>
          </div>
          <div class="pr-oos" hidden></div>
          <div class="pr-results" role="list"></div>
        </section>
        <aside class="practice-side" aria-label="${esc(t('practice.sideLabel'))}">
          <section class="pr-block">
            <h3>${esc(t('practice.items'))}</h3>
            <div class="pr-items"></div>
          </section>
          <section class="pr-block pr-totals"></section>
          <section class="pr-block pr-details"></section>
          <div class="pr-actions">
            <button type="button" class="btn btn-primary pr-save" data-action="save">${esc(t('practice.save'))} <kbd>Ctrl+Enter</kbd></button>
            <button type="button" class="btn btn-soft" data-action="hold">${esc(t('practice.hold'))}</button>
            <button type="button" class="btn btn-ghost" data-action="clear">${esc(t('practice.clear'))}</button>
          </div>
        </aside>
      </div>
    </div>`;
}

/* ---------- Catalogue ---------- */

function cardHtml(card) {
  const out = card.status === 'out';
  return `
    <button type="button" class="pr-card${out ? ' is-out' : ''}" role="listitem" data-card="${esc(card.id)}"
      aria-label="${esc(`${card.name} ${card.strength ?? ''}`.trim())}${out ? ` — ${esc(t('practice.outOfStock'))}` : ''}">
      <span class="pr-card-name">${esc(card.name)}</span>
      <span class="pr-card-meta muted small">${esc([card.strength, card.company].filter(Boolean).join(' · '))}</span>
      <span class="pr-card-foot">
        <span class="pr-card-stock small">${out ? esc(t('practice.outOfStock')) : esc(`${card.packs} ${card.soldAs ?? 'pack'}`)}</span>
        <span class="pr-card-price">${money(card.salePricePerPack)}</span>
      </span>
      ${card.nearestExpiry ? `<span class="pr-card-expiry small muted">${esc(t('practice.expires'))} ${esc(formatDate(card.nearestExpiry))}</span>` : ''}
    </button>`;
}

function paintCatalog() {
  $host.find('.pr-results').html(results.length
    ? results.map(cardHtml).join('')
    : `<p class="muted pr-empty">${esc(state.query.trim() ? t('practice.noMatch') : t('practice.startTyping'))}</p>`);
  paintOutOfStock();
}

function paintOutOfStock() {
  const $panel = $host.find('.pr-oos');
  if (!state.oos) {
    $panel.prop('hidden', true).empty();
    return;
  }
  const alternatives = state.alternatives.length
    ? state.alternatives.map((card) => `<button type="button" class="btn btn-soft btn-sm" data-card="${esc(card.id)}">${esc(card.name)} ${esc(card.strength ?? '')}</button>`).join('')
    : `<span class="muted small">${esc(t('practice.noAlternatives'))}</span>`;
  $panel.prop('hidden', false).html(`
    <p role="status"><strong>${esc(t('practice.notOnShelf', { name: state.oos.name }))}</strong></p>
    <p class="muted small">${esc(t('practice.alternativesHint'))}</p>
    <div class="pr-alt-row">${alternatives}</div>
    <button type="button" class="btn btn-ghost btn-sm" data-action="dismiss-oos">${esc(t('practice.dismiss'))}</button>`);
}

async function runSearch() {
  const seq = ++searchSeq;
  const query = state.query.trim();
  const found = await saleCards({ query, today: todayISO(), limit: 60 });
  if (seq !== searchSeq) return;
  results = found;
  paintCatalog();
}
const searchSoon = debounce(runSearch, 120);

/** Enter in the search box: add the first match that is on the shelf; an out-of-stock match opens the alternatives. */
async function addFromSearch() {
  const match = results.find((card) => card.status !== 'out') ?? results[0];
  if (!match) return;
  await addItem(match, 'pack', 1);
}

async function showOutOfStock(card) {
  state.oos = card;
  state.alternatives = await alternativesInStock(card.id, { today: todayISO() });
  paintOutOfStock();
}

/* ---------- Items ---------- */

async function addItem(card, mode = 'pack', qty = 1) {
  if (card.status === 'out') return showOutOfStock(card);
  if (mode === 'loose' && !card.looseSelling) {
    ui.toast(t('practice.noLoose', { name: card.name }), { type: 'info' });
    return;
  }
  const existing = state.items.find((item) => item.productId === card.id && item.mode === mode);
  if (existing) existing.qty += qty;
  else state.items.push({ uid: (state.uid += 1), productId: card.id, card, mode, qty });
  state.query = '';
  $host.find('.pr-search').val('');
  results = [];
  paintCatalog();
  afterItemsChanged();
  $host.find('.pr-search').trigger('focus');
}

function setQty(uid, qty) {
  const item = state.items.find((i) => i.uid === uid);
  if (!item) return;
  if (qty <= 0) state.items = state.items.filter((i) => i.uid !== uid);
  else item.qty = qty;
  afterItemsChanged();
}

function setMode(uid, mode) {
  const item = state.items.find((i) => i.uid === uid);
  if (!item || item.mode === mode) return;
  item.mode = mode;
  afterItemsChanged();
}

function afterItemsChanged() {
  paintItems();
  paintTotals();
  refreshPreview();
}

function paintItems() {
  const shortages = new Set((lastPreview?.shortages ?? []).map((s) => s.productId));
  const $items = $host.find('.pr-items');
  if (!state.items.length) {
    $items.html(`<p class="muted pr-empty">${esc(t('practice.noItems'))}</p>`);
    return;
  }
  $items.html(state.items
    .map((item) => `
      <div class="pr-line${shortages.has(item.productId) ? ' is-short' : ''}" data-uid="${item.uid}">
        <div class="pr-line-main">
          <span class="pr-line-name">${esc(item.card.name)} <span class="muted small">${esc(item.card.strength ?? '')}</span></span>
          <button type="button" class="icon-btn" data-remove="${item.uid}" aria-label="${esc(t('practice.remove', { name: item.card.name }))}">${icon('close')}</button>
        </div>
        <div class="pr-line-controls">
          <div class="pr-mode" role="group" aria-label="${esc(t('practice.unitLabel'))}">
            <button type="button" class="pr-chip${item.mode === 'pack' ? ' is-on' : ''}" data-mode="${item.uid}:pack" aria-pressed="${item.mode === 'pack'}">${esc(item.card.soldAs ?? 'pack')}</button>
            ${item.card.looseSelling ? `<button type="button" class="pr-chip${item.mode === 'loose' ? ' is-on' : ''}" data-mode="${item.uid}:loose" aria-pressed="${item.mode === 'loose'}">${esc(item.card.unitName ?? 'unit')}</button>` : ''}
          </div>
          <div class="pr-stepper">
            <button type="button" class="btn btn-soft btn-sm" data-step="${item.uid}:-1" aria-label="${esc(t('practice.less'))}">−</button>
            <span class="pr-qty" aria-live="polite">${esc(unitsText(item))}</span>
            <button type="button" class="btn btn-soft btn-sm" data-step="${item.uid}:1" aria-label="${esc(t('practice.more'))}">+</button>
          </div>
          <span class="pr-line-amount">${money(listPriceOf(item))}</span>
        </div>
        ${shortages.has(item.productId) ? `<p class="pr-line-warn small" role="status">${esc(t('practice.onlyAvailable', { available: lastPreview.shortages.find((s) => s.productId === item.productId).available }))}</p>` : ''}
      </div>`)
    .join(''));
  anim.scanCounts($items[0]);
}

/* ---------- Totals and indicators ---------- */

function chipsHtml(calc) {
  if (calc <= 0) return '';
  const rounded = CHIP_STEPS.map((step) => ({ value: Math.floor(calc / step) * step, key: `practice.chip.down${step / 100}` }));
  const chips = [
    ...rounded.filter((c, i, all) => c.value > 0 && all.findIndex((o) => o.value === c.value) === i),
    { value: Math.round(calc / 2), key: 'practice.chip.half' },
    { value: 0, key: 'practice.chip.free' },
  ];
  return chips.map((c) => `<button type="button" class="pr-chip pr-amount-chip" data-chip="${c.value}">${esc(t(c.key))}</button>`).join('');
}

/** The figures that change while the owner types a charge: chips, indicators, warning. */
function liveHtml() {
  const calc = calculatedTotal();
  const charged = chargedAmount();
  const cost = lastPreview?.costTotal ?? 0;
  const profit = charged - cost;
  const margin = charged > 0 ? Math.round((profit / charged) * 1000) / 10 : null;
  const warn = settings?.practiceWarnBelowCost && state.items.length && charged < cost;
  return `
    ${state.charge !== null ? `<button type="button" class="pr-chip" data-reset="1">${esc(t('practice.resetCalculated'))}</button>` : ''}
    <div class="pr-chips" role="group" aria-label="${esc(t('practice.quickAmounts'))}">${chipsHtml(calc)}</div>
    ${settings?.practiceShowCost !== false ? `
    <dl class="pr-figures pr-indicators">
      <div><dt>${esc(t('practice.costOfMedicines'))}</dt><dd>${money(cost)}</dd></div>
      <div class="${profit >= 0 ? 'is-profit' : 'is-loss'}"><dt>${esc(profit >= 0 ? t('practice.profit') : t('practice.loss'))}</dt><dd>${money(Math.abs(profit))}</dd></div>
      <div><dt>${esc(t('practice.margin'))}</dt><dd>${margin === null ? '—' : `${esc(margin)}%`}</dd></div>
    </dl>` : ''}
    ${warn ? `<p class="pr-warn" role="status">${esc(t('practice.atLoss', { amount: rupees(cost - charged) }))}</p>` : ''}`;
}

/** Repaints the live figures only. The charge field is left alone, so typing keeps its focus and caret. */
function paintLive() {
  const $live = $host.find('.pr-live');
  $live.html(liveHtml());
  anim.scanCounts($live[0]);
}

/** Full totals panel. Used when the items change, not while the owner types a charge. */
function paintTotals() {
  const calc = calculatedTotal();
  $host.find('.pr-totals').html(`
    <dl class="pr-figures">
      <div><dt>${esc(t('practice.calculated'))}</dt><dd>${money(calc)}</dd></div>
    </dl>
    <label class="pr-label" for="pr-charge">${esc(t('practice.charged'))}</label>
    <input id="pr-charge" class="pr-charge" type="text" inputmode="decimal" autocomplete="off" aria-describedby="pr-charge-hint"
      value="${esc(rupees(chargedAmount()))}">
    <p id="pr-charge-hint" class="hint">${esc(t('practice.chargeHint'))}</p>
    <div class="pr-live">${liveHtml()}</div>`);
  anim.scanCounts($host.find('.pr-totals')[0]);
}

async function refreshPreview() {
  const seq = ++previewSeq;
  if (!state.items.length) {
    lastPreview = null;
    paintTotals();
    return;
  }
  const preview = await previewPractice({ items: toServiceItems(), today: todayISO() });
  if (seq !== previewSeq) return;
  lastPreview = preview;
  paintItems();
  paintLive();
}

/* ---------- Details (optional) ---------- */

async function paintDetails() {
  const [patients] = await Promise.all([recentPatients(30)]);
  const payOptions = [
    ...accounts.map((a) => `<option value="${esc(a.code)}"${(settings.practiceDefaultAccount ?? '1000') === a.code ? ' selected' : ''}>${esc(accountName(a))}</option>`),
    `<option value="1100"${settings.practiceDefaultAccount === '1100' ? ' selected' : ''}>${esc(t('practice.onAccount'))}</option>`,
  ].join('');
  const customerOptions = customers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  const today = todayISO();
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  $host.find('.pr-details').html(`
    <datalist id="pr-patients">${patients.map((p) => `<option value="${esc(p.name)}">${esc(p.phone)}</option>`).join('')}</datalist>
    <div class="pr-grid2">
      <label class="field"><span>${esc(t('practice.patient'))}</span><input name="patientName" list="pr-patients" autocomplete="off" value="${esc(state.patientName ?? '')}"></label>
      <label class="field"><span>${esc(t('practice.phone'))}</span><input name="patientPhone" type="tel" inputmode="tel" autocomplete="off" value="${esc(state.patientPhone ?? '')}"></label>
      <label class="field"><span>${esc(t('practice.doctor'))}</span><input name="doctorRef" autocomplete="off" value="${esc(state.doctorRef ?? '')}"></label>
      <label class="field"><span>${esc(t('practice.payment'))}</span><select name="paymentAccountCode">${payOptions}</select></label>
      <label class="field"><span>${esc(t('practice.date'))}</span><input name="date" type="date" value="${today}"${settings.allowBackdating ? '' : ` max="${today}"`}></label>
      <label class="field"><span>${esc(t('practice.time'))}</span><input name="time" type="time" value="${time}"></label>
    </div>
    <label class="field" data-customer hidden><span>${esc(t('practice.customer'))}</span><select name="customerId"><option value="">${esc(t('practice.chooseCustomer'))}</option>${customerOptions}</select></label>
    <label class="field"><span>${esc(t('practice.note'))}</span><input name="note" autocomplete="off" value="${esc(state.note ?? '')}"></label>`);
  syncCustomerField();
}

function syncCustomerField() {
  const onAccount = $host.find('[name="paymentAccountCode"]').val() === '1100';
  $host.find('[data-customer]').prop('hidden', !onAccount);
}

function readDetails() {
  const read = (name) => String($host.find(`[name="${name}"]`).val() ?? '').trim();
  return {
    patientName: read('patientName'),
    patientPhone: read('patientPhone'),
    doctorRef: read('doctorRef'),
    note: read('note'),
    paymentAccountCode: read('paymentAccountCode') || '1000',
    customerId: read('customerId'),
    date: read('date') || todayISO(),
    time: read('time') || '12:00',
  };
}

/* ---------- Insights strip ---------- */

async function paintInsights() {
  const today = todayISO();
  const totals = await practiceTotals({ from: today, to: today });
  const $strip = $host.find('.practice-insights');
  $strip.html(`
    <span class="pr-insight"><span class="muted small">${esc(t('practice.todayCharged'))}</span><strong>${money(totals.charged)}</strong></span>`);
  anim.scanCounts($strip[0]);
}

/* ---------- Save ---------- */

async function save() {
  if (!state.items.length) {
    ui.toast(t('practice.noItemsToSave'), { type: 'info' });
    $host.find('.pr-search').trigger('focus');
    return;
  }
  const details = readDetails();
  if (details.paymentAccountCode === '1100' && !details.customerId) {
    ui.toast(t('svc.practiceCustomerRequired'), { type: 'error' });
    return;
  }
  const charge = state.charge;
  const snapshot = state.items.slice();
  const $button = $host.find('.pr-save');
  anim.buttonState($button, 'loading');
  try {
    const dateTime = new Date(`${details.date}T${details.time}:00`).toISOString();
    const practice = await createPractice({
      items: toServiceItems(),
      chargedAmount: charge === null ? undefined : charge,
      paymentAccountCode: details.paymentAccountCode,
      customerId: details.customerId || null,
      patientName: details.patientName,
      patientPhone: details.patientPhone,
      doctorRef: details.doctorRef,
      note: details.note,
      date: details.date,
      dateTime,
    });
    anim.buttonState($button, 'idle');
    resetDraft();
    await paintAfterChange();
    showSuccess(practice, snapshot);
    offerUndo(practice);
  } catch (err) {
    anim.buttonState($button, 'idle');
    console.warn('[practice] save failed', err);
    ui.toast(errorMessage(err), { type: 'error' });
  }
}

function resetDraft() {
  state = blankState();
  lastPreview = null;
  results = [];
  $host.find('.pr-search').val('');
  paintCatalog();
  paintItems();
  paintTotals();
}

async function paintAfterChange() {
  await paintInsights();
  await paintDetails();
}

function offerUndo(practice) {
  ui.toast(t('practice.saved', { number: practice.number }), {
    type: 'success',
    timeout: UNDO_MS,
    action: {
      label: t('practice.undo'),
      run: async () => {
        try {
          await voidPractice(practice.id, { reason: t('practice.undoReason') });
          ui.toast(t('practice.undone', { number: practice.number }), { type: 'info' });
          await paintInsights();
        } catch (err) {
          ui.toast(errorMessage(err), { type: 'error' });
        }
      },
    },
  });
}

/* ---------- Slip ---------- */

function slipRows(snapshot, showList) {
  return snapshot.map((item) => ({
    name: `${item.card.name} ${item.card.strength ?? ''}`.trim(),
    qty: unitsText(item),
    list: listPriceOf(item),
    showList,
  }));
}

function slipHtml(practice, snapshot, profile) {
  const showList = Boolean(settings.practicePrintListPrice);
  const width = Number(settings.receiptWidth) === 58 ? 58 : 80;
  const rows = slipRows(snapshot, showList);
  return `
    <div class="receipt receipt-${width}">
      <div class="r-center"><strong>${esc(profile.name)}</strong></div>
      ${profile.address ? `<div class="r-center r-sub">${esc(profile.address)}</div>` : ''}
      <div class="r-center"><strong>${esc(t('practice.slipTitle'))}</strong></div>
      <div class="r-row"><span>${esc(practice.number)}</span><span>${esc(formatDate(practice.date))}</span></div>
      ${practice.patientName ? `<div class="r-sub">${esc(t('practice.patient'))}: ${esc(practice.patientName)}</div>` : ''}
      ${practice.doctorRef ? `<div class="r-sub">${esc(t('practice.doctor'))}: ${esc(practice.doctorRef)}</div>` : ''}
      <hr>
      ${rows.map((row) => `<div class="r-item"><div class="r-row"><span>${esc(row.name)}</span>${row.showList ? `<span>${esc(rupees(row.list))}</span>` : ''}</div><div class="r-sub">${esc(row.qty)}</div></div>`).join('')}
      <hr>
      <div class="r-row"><strong>${esc(t('practice.slipCharged'))}</strong><strong>${esc(rupees(practice.chargedAmount))}</strong></div>
      ${profile.receiptFooter ? `<div class="r-center r-sub">${esc(profile.receiptFooter)}</div>` : ''}
      <div class="r-center r-sub">${esc(t('practice.slipFooter'))}</div>
    </div>`;
}

function slipText(practice, snapshot) {
  const lines = [`${practice.number} · ${formatDate(practice.date)}`];
  if (practice.patientName) lines.push(`${t('practice.patient')}: ${practice.patientName}`);
  for (const row of slipRows(snapshot, false)) lines.push(`${row.name}  ${row.qty}`);
  lines.push(`${t('practice.slipCharged')}: ${rupees(practice.chargedAmount)}`);
  return lines.join('\n');
}

function showSuccess(practice, snapshot) {
  const $body = $(`
    <div class="pr-success">
      <svg class="pr-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>
      <p class="pr-success-number">${esc(practice.number)}</p>
      <p class="muted">${esc(t('practice.savedFor', { amount: rupees(practice.chargedAmount) }))}</p>
    </div>`);
  ui.openModal({
    title: t('practice.savedTitle'),
    body: $body,
    actions: [
      { label: t('practice.printSlip'), onClick: () => { printSlip(practice, snapshot); return false; } },
      { label: t('practice.copySlip'), onClick: () => { copySlip(practice, snapshot); return false; } },
      { label: t('practice.newPractice'), variant: 'primary' },
    ],
  });
}

async function printSlip(practice, snapshot) {
  const profile = await getProfile();
  printHtml(slipHtml(practice, snapshot, profile), { width: Number(settings.receiptWidth) === 58 ? 58 : 80 });
}

async function copySlip(practice, snapshot) {
  try {
    await navigator.clipboard.writeText(slipText(practice, snapshot));
    ui.toast(t('practice.copied'), { type: 'success' });
  } catch {
    ui.toast(t('practice.copyFailed'), { type: 'error' });
  }
}

/* ---------- Holds, kits and repeat ---------- */

function draftForHold() {
  const details = readDetails();
  return {
    items: state.items.map((item) => ({ productId: item.productId, mode: item.mode, qty: item.qty, name: item.card.name })),
    charge: state.charge,
    patientName: details.patientName,
    patientPhone: details.patientPhone,
    doctorRef: details.doctorRef,
    note: details.note,
    customerId: details.customerId || null,
    paymentAccountCode: details.paymentAccountCode,
  };
}

async function holdDraft() {
  if (!state.items.length) {
    ui.toast(t('practice.noItemsToSave'), { type: 'info' });
    return;
  }
  await holdPractice(draftForHold());
  resetDraft();
  await paintDetails();
  ui.toast(t('practice.heldToast'), { type: 'success' });
  await paintHeldCount();
}

async function paintHeldCount() {
  const held = await listHeldPractices();
  $host.find('[data-action="held"]').text(`${t('practice.held')} (${held.length})`);
}

/** Loads a list of { productId, mode, qty } lines into the draft, using the medicine cards. */
async function loadLines(lines) {
  const cards = new Map((await saleCards({ query: '', today: todayISO(), limit: 5000 })).map((card) => [card.id, card]));
  for (const line of lines) {
    const card = cards.get(line.productId);
    if (!card) continue;
    const mode = line.mode === 'loose' && card.looseSelling ? 'loose' : 'pack';
    const existing = state.items.find((item) => item.productId === card.id && item.mode === mode);
    if (existing) existing.qty += line.qty;
    else state.items.push({ uid: (state.uid += 1), productId: card.id, card, mode, qty: line.qty });
  }
  afterItemsChanged();
}

async function openHeld() {
  const held = await listHeldPractices();
  const $body = $(`<div class="pr-held">${held.length
    ? held.map((h) => `
        <div class="pr-held-row" data-held="${esc(h.id)}">
          <div><strong>${esc(h.patientName || t('practice.noPatient'))}</strong>
            <span class="muted small">${esc(t('practice.heldLines', { count: h.items.length }))} · ${esc(formatDate(h.savedAt))}</span></div>
          <div class="pr-held-actions">
            <button type="button" class="btn btn-primary btn-sm" data-resume="${esc(h.id)}">${esc(t('practice.resume'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-discard="${esc(h.id)}">${esc(t('practice.discard'))}</button>
          </div>
        </div>`).join('')
    : `<p class="muted">${esc(t('practice.noHeld'))}</p>`}</div>`);
  const dialog = ui.openModal({ title: t('practice.held'), body: $body, actions: [{ label: t('btn.close') }] });
  $body.on('click', '[data-resume]', async (event) => {
    const entry = await resumeHeldPractice(event.currentTarget.getAttribute('data-resume'));
    if (state.items.length) await holdPractice(draftForHold());
    resetDraft();
    state.patientName = entry.patientName;
    state.patientPhone = entry.patientPhone;
    state.doctorRef = entry.doctorRef;
    state.note = entry.note;
    state.charge = entry.charge ?? null;
    await loadLines(entry.items);
    await paintDetails();
    dialog?.close?.();
    await paintHeldCount();
  });
  $body.on('click', '[data-discard]', async (event) => {
    const entry = await discardHeldPractice(event.currentTarget.getAttribute('data-discard'));
    await paintHeldCount();
    ui.toast(t('practice.heldDiscarded'), { action: { label: t('btn.undo'), run: async () => { await restoreHeldPractice(entry); await paintHeldCount(); } } });
    $(event.currentTarget).closest('.pr-held-row').remove();
  });
}

async function openKits() {
  const kits = await listKits();
  const $body = $(`<div class="pr-kits">${kits.length
    ? kits.map((k) => `
        <div class="pr-held-row">
          <div><strong>${esc(k.name)}</strong> <span class="muted small">${esc(t('practice.kitLines', { count: k.items.length }))}</span></div>
          <button type="button" class="btn btn-primary btn-sm" data-apply-kit="${esc(k.id)}">${esc(t('practice.applyKit'))}</button>
        </div>`).join('')
    : `<p class="muted">${esc(t('practice.noKits'))}</p>`}
    <hr><button type="button" class="btn btn-soft" data-save-kit>${esc(t('practice.saveAsKit'))}</button></div>`);
  const dialog = ui.openModal({ title: t('practice.kits'), body: $body, actions: [{ label: t('btn.close') }] });
  $body.on('click', '[data-apply-kit]', async (event) => {
    const kit = kits.find((k) => k.id === event.currentTarget.getAttribute('data-apply-kit'));
    await loadLines(kit.items.map((i) => ({ productId: i.productId, mode: i.looseUnits > 0 && !i.packs ? 'loose' : 'pack', qty: i.looseUnits > 0 && !i.packs ? i.looseUnits : i.packs })));
    dialog?.close?.();
    ui.toast(t('practice.kitApplied', { name: kit.name }), { type: 'success' });
  });
  $body.on('click', '[data-save-kit]', () => openSaveKit(dialog));
}

function openSaveKit(parentDialog) {
  if (!state.items.length) {
    ui.toast(t('practice.noItemsToSave'), { type: 'info' });
    return;
  }
  const $body = $(`<form class="pr-savekit"><label class="field"><span>${esc(t('practice.kitName'))}</span><input name="kitName" required autocomplete="off"></label></form>`);
  ui.openModal({
    title: t('practice.saveAsKit'),
    body: $body,
    actions: [
      {
        label: t('btn.save'),
        variant: 'primary',
        onClick: async () => {
          const name = String($body.find('[name="kitName"]').val() ?? '').trim();
          if (!name) return false;
          await saveKit({ name, items: toServiceItems() });
          parentDialog?.close?.();
          ui.toast(t('practice.kitSaved', { name }), { type: 'success' });
          return true;
        },
      },
      { label: t('btn.cancel') },
    ],
  });
}

async function repeatLast() {
  const last = await lastActivePractice();
  if (!last) {
    ui.toast(t('practice.noPrevious'), { type: 'info' });
    return;
  }
  await loadLines(await repeatItemsOf(last.id));
  ui.toast(t('practice.repeatLoaded', { number: last.number }), { type: 'success' });
}

/* ---------- Keyboard and binding ---------- */

function focusSearch() {
  $host.find('.pr-search').trigger('focus');
}

function onKeyDown(event) {
  if (!$host || document.querySelector('.modal')) return;
  if (event.key === 'F2') {
    event.preventDefault();
    focusSearch();
  } else if (event.key === 'F4') {
    event.preventDefault();
    $host.find('#pr-charge').trigger('focus').trigger('select');
  } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    save();
  }
}

function bind() {
  $host.on('input', '.pr-search', (event) => {
    state.query = event.currentTarget.value;
    searchSoon();
  });
  $host.on('keydown', '.pr-search', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchSoon.cancel();
      runSearch().then(addFromSearch);
    } else if (event.key === 'Escape') {
      event.currentTarget.value = '';
      state.query = '';
      results = [];
      paintCatalog();
    }
  });
  $host.on('click', '.pr-card[data-card], .pr-alt-row [data-card]', (event) => {
    const id = event.currentTarget.getAttribute('data-card');
    const card = results.find((c) => c.id === id) ?? state.alternatives.find((c) => c.id === id) ?? state.oos;
    if (!card) return;
    if (card.status === 'out') return showOutOfStock(card);
    state.oos = null;
    paintOutOfStock();
    return addItem(card, 'pack', 1);
  });
  $host.on('click', '[data-step]', (event) => {
    const [uid, delta] = event.currentTarget.getAttribute('data-step').split(':').map(Number);
    const item = state.items.find((i) => i.uid === uid);
    if (item) setQty(uid, item.qty + delta);
  });
  $host.on('click', '[data-mode]', (event) => {
    const [uid, mode] = event.currentTarget.getAttribute('data-mode').split(':');
    setMode(Number(uid), mode);
  });
  $host.on('click', '[data-remove]', (event) => setQty(Number(event.currentTarget.getAttribute('data-remove')), 0));
  $host.on('click', '[data-chip]', (event) => {
    state.charge = Number(event.currentTarget.getAttribute('data-chip'));
    $host.find('#pr-charge').val(rupees(state.charge));
    paintLive();
  });
  $host.on('click', '[data-reset]', () => {
    state.charge = null;
    $host.find('#pr-charge').val(rupees(calculatedTotal()));
    paintLive();
  });
  $host.on('input', '#pr-charge', (event) => {
    const value = parseRupees(event.currentTarget.value);
    if (Number.isNaN(value)) return;
    state.charge = value;
    paintIndicatorsOnly();
  });
  $host.on('change', '[name="paymentAccountCode"]', syncCustomerField);
  $host.on('click', '[data-action]', (event) => {
    const action = event.currentTarget.getAttribute('data-action');
    if (action === 'save') save();
    else if (action === 'hold') holdDraft();
    else if (action === 'clear') {
      resetDraft();
      paintDetails();
    } else if (action === 'repeat') repeatLast();
    else if (action === 'kits') openKits();
    else if (action === 'held') openHeld();
    else if (action === 'dismiss-oos') {
      state.oos = null;
      paintOutOfStock();
    }
  });
}

/** Repaints the figures without rewriting the charge field, so typing is never interrupted. */
function paintIndicatorsOnly() {
  paintLive();
}

export async function render($root) {
  state = blankState();
  settings = await getSettings();
  accounts = await paymentAccounts({ includeCash: true });
  customers = await listCustomers();
  $root.html(shellHtml());
  $host = $root.children('.practice-root');
  bind();
  keyHandler = onKeyDown;
  document.addEventListener('keydown', keyHandler);
  await Promise.all([paintInsights(), paintDetails(), paintHeldCount()]);
  paintCatalog();
  paintItems();
  paintTotals();
  focusSearch();
}

export function destroy() {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  searchSoon.cancel();
  $host = null;
  state = null;
  results = [];
  lastPreview = null;
}
