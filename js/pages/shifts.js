// Cash drawer: open the shift with the float, record cash moved in or out, and close it with a blind count.
// The expected drawer is not shown to the cashier before the close. Users with the 'shift-audit' screen can see the
// X-report during the shift, and the Z-report after it.
import * as ui from '../core/ui.js';
import { esc, icon } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { format, parseRupees } from '../core/money.js';
import * as store from '../core/store.js';
import { canOpen } from '../core/access.js';
import { printHtml } from '../services/printing.js';
import * as shifts from '../services/shifts.js';
import { accountName, paymentAccounts } from '../services/ledger.js';
import { errorText } from './_doc-shared.js';
import { reportHtml } from './_shift-report.js';

export const route = '/shifts';
export const title = 'nav.shifts';

let $host = null;
let busy = false;

const canAudit = () => canOpen(store.get('access'), 'shift-audit');

function amountField(id, label, value = '') {
  return `<label class="field"><span>${esc(label)}</span><input id="${id}" name="${id}" inputmode="decimal" autocomplete="off" value="${esc(value)}"></label>`;
}

function openHtml() {
  return `
    <section class="card shift-card" aria-labelledby="shift-open-title">
      <h2 id="shift-open-title">${esc(t('shift.openTitle'))}</h2>
      <p class="muted small">${esc(t('shift.openHelp'))}</p>
      <form id="shift-open-form" class="form" novalidate>
        ${amountField('sh-float', t('shift.floatLabel'))}
        <label class="field"><span>${esc(t('shift.noteLabel'))}</span><input id="sh-open-note" autocomplete="off"></label>
        <p class="form-error" id="sh-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary">${icon('bank')} ${esc(t('shift.openButton'))}</button>
      </form>
    </section>`;
}

function movementsHtml(summary) {
  const rows = summary.movements.length
    ? summary.movements
        .map((m) => `<li><span>${esc(t(`shift.move.${m.type}`))} <span class="muted small">${esc(m.reason)}</span></span><strong>${esc(formatAmount(m.amount))}</strong></li>`)
        .join('')
    : `<li class="muted">${esc(t('shift.noMovements'))}</li>`;
  return `<ul class="plain-list shift-moves">${rows}</ul>`;
}

/** Paisa as text, without the currency symbol, for the lists on this screen. */
const formatAmount = (paisa) => format(paisa, { symbol: false });

async function openShiftHtml(summary) {
  const sh = summary.shift;
  const accounts = await paymentAccounts({ includeCash: false });
  const accountOptions = accounts.map((a) => `<option value="${esc(a.code)}">${esc(accountName(a))}</option>`).join('');
  return `
    <section class="card shift-card" aria-labelledby="shift-now-title">
      <div class="block-head">
        <div>
          <h2 id="shift-now-title">${esc(t('shift.openNow', { number: sh.number }))}</h2>
          <p class="muted small">${esc(t('shift.openedBy', { name: sh.openedBy || '-' }))} · ${esc(new Date(sh.openedAt).toLocaleString())}</p>
        </div>
        ${canAudit() ? `<button type="button" class="btn btn-soft" data-action="x-report">${esc(t('shift.xReport'))}</button>` : ''}
      </div>
      <p class="muted">${esc(t('shift.openingLine'))}: <strong>${esc(formatAmount(sh.openingCash))}</strong></p>
    </section>

    <section class="card shift-card" aria-labelledby="shift-move-title">
      <h3 id="shift-move-title">${esc(t('shift.movementsTitle'))}</h3>
      <form id="shift-move-form" class="form" novalidate>
        <label class="field"><span>${esc(t('shift.moveType'))}</span>
          <select id="sh-type" name="type">
            <option value="payIn">${esc(t('shift.move.payIn'))}</option>
            <option value="payOut">${esc(t('shift.move.payOut'))}</option>
            <option value="petty">${esc(t('shift.move.petty'))}</option>
            <option value="cashDrop">${esc(t('shift.move.cashDrop'))}</option>
          </select>
        </label>
        ${amountField('sh-amount', t('shift.amountLabel'))}
        <label class="field"><span>${esc(t('shift.reasonLabel'))}</span><input id="sh-reason" autocomplete="off"></label>
        <label class="field" id="sh-account-wrap" hidden><span>${esc(t('shift.dropTo'))}</span><select id="sh-account">${accountOptions}</select></label>
        <p class="form-error" id="sh-move-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary">${esc(t('shift.recordMovement'))}</button>
      </form>
      ${movementsHtml(summary)}
    </section>

    <section class="card shift-card" aria-labelledby="shift-close-title">
      <h3 id="shift-close-title">${esc(t('shift.closeTitle'))}</h3>
      <p class="muted small">${esc(t('shift.closeHelp'))}</p>
      <form id="shift-close-form" class="form" novalidate>
        ${amountField('sh-counted', t('shift.countedLabel'))}
        <label class="field"><span>${esc(t('shift.closingNoteLabel'))}</span><input id="sh-close-note" autocomplete="off"></label>
        <p class="form-error" id="sh-close-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-danger">${esc(t('shift.closeButton'))}</button>
      </form>
    </section>`;
}

async function paint() {
  if (!$host) return;
  const shift = await shifts.currentShift();
  if (!shift) {
    $host.html(openHtml());
    return;
  }
  const summary = await shifts.shiftSummary(shift.id);
  $host.html(await openShiftHtml(summary));
}

function showError(selector, err) {
  $host.find(selector).text(errorText(err)).prop('hidden', false);
}

async function openSubmit(event) {
  event.preventDefault();
  const amount = parseRupees($host.find('#sh-float').val());
  if (amount === null) {
    $host.find('#sh-error').text(t('shift.badAmount')).prop('hidden', false);
    return;
  }
  busy = true;
  try {
    await shifts.openShift({ openingCash: amount, note: $host.find('#sh-open-note').val() });
    ui.toast(t('shift.opened'), { type: 'success' });
    await paint();
  } catch (err) {
    showError('#sh-error', err);
  } finally {
    busy = false;
  }
}

async function moveSubmit(event) {
  event.preventDefault();
  const amount = parseRupees($host.find('#sh-amount').val());
  if (amount === null || amount <= 0) {
    $host.find('#sh-move-error').text(t('shift.badAmount')).prop('hidden', false);
    return;
  }
  const type = $host.find('#sh-type').val();
  busy = true;
  try {
    await shifts.addShiftMovement({ type, amount, reason: $host.find('#sh-reason').val(), payAccount: $host.find('#sh-account').val() });
    ui.toast(t('shift.movementSaved'), { type: 'success' });
    await paint();
  } catch (err) {
    showError('#sh-move-error', err);
  } finally {
    busy = false;
  }
}

async function closeSubmit(event) {
  event.preventDefault();
  const counted = parseRupees($host.find('#sh-counted').val());
  if (counted === null || counted < 0) {
    $host.find('#sh-close-error').text(t('shift.badAmount')).prop('hidden', false);
    return;
  }
  const ok = await ui.confirmDialog({ title: t('shift.closeConfirmTitle'), message: t('shift.closeConfirmText'), confirmLabel: t('shift.closeButton'), danger: true });
  if (!ok) return;
  busy = true;
  try {
    const closed = await shifts.closeShift({ counted, note: $host.find('#sh-close-note').val() });
    const summary = await shifts.shiftSummary(closed.id);
    showZReport(summary);
    await paint();
  } catch (err) {
    showError('#sh-close-error', err);
  } finally {
    busy = false;
  }
}

/** Shows the Z-report after a close, with a print button for the receipt printer. */
export function showZReport(summary) {
  const html = reportHtml(summary, { title: t('shift.zReport'), closed: true });
  ui.openModal({
    title: t('shift.zReport'),
    body: $(html),
    actions: [
      { label: t('shift.printZ'), variant: 'primary', onClick: () => { printHtml(html, { width: 80 }); return false; } },
      { label: t('shift.close') },
    ],
  });
}

async function xReport() {
  const shift = await shifts.currentShift();
  if (!shift) return;
  const summary = await shifts.shiftSummary(shift.id);
  const html = reportHtml(summary, { title: t('shift.xReport') });
  ui.openModal({ title: t('shift.xReport'), body: $(html), actions: [{ label: t('shift.printX'), variant: 'primary', onClick: () => { printHtml(html, { width: 80 }); return false; } }, { label: t('shift.close') }] });
}

export async function render($root) {
  // Work inside a child element: handlers bound to #view itself would pile up across visits.
  $root.html('<div class="shift-root"></div>');
  $host = $root.children('.shift-root');
  $host.on('submit', '#shift-open-form', (event) => {
    if (!busy) openSubmit(event);
    else event.preventDefault();
  });
  $host.on('submit', '#shift-move-form', (event) => {
    if (!busy) moveSubmit(event);
    else event.preventDefault();
  });
  $host.on('submit', '#shift-close-form', (event) => {
    if (!busy) closeSubmit(event);
    else event.preventDefault();
  });
  $host.on('change', '#sh-type', (event) => {
    $host.find('#sh-account-wrap').prop('hidden', event.currentTarget.value !== 'cashDrop');
  });
  $host.on('click', '[data-action="x-report"]', xReport);
  await paint();
}

export function destroy() {
  $host = null;
  busy = false;
}
