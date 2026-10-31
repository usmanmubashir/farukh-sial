// Shift history for audit: every shift in a period, with its duration, cashier, opening, expected, counted and variance.
// Discrepancies can be listed alone. Opening a shift shows its full figures and can print its Z-report. Only the owner
// can correct the counted cash of a closed shift, and every correction is kept with its reason.
import * as ui from '../core/ui.js';
import { esc } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { format, parseRupees } from '../core/money.js';
import { periodRange, todayISO, formatDateTime } from '../core/dates.js';
import * as store from '../core/store.js';
import { printHtml } from '../services/printing.js';
import * as shifts from '../services/shifts.js';
import { errorText } from './_doc-shared.js';
import { reportHtml } from './_shift-report.js';

export const route = '/shift-history';
export const title = 'nav.shiftHistory';

let $host = null;
let state = { period: 'month', onlyDiscrepancies: false };

const isOwner = () => store.get('access')?.role === 'owner';
const signed = (paisa) => `${paisa > 0 ? '+' : ''}${format(paisa, { symbol: false })}`;
const duration = (shift) => {
  if (!shift.closedAt) return t('shift.stillOpen');
  const minutes = Math.round((Date.parse(shift.closedAt) - Date.parse(shift.openedAt)) / 60000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
};

function periodBar() {
  const presets = ['today', 'week', 'month', 'year', 'all'];
  return `<div class="chip-row" role="group" aria-label="${esc(t('doc.period'))}">${presets
    .map((p) => `<button type="button" class="chip" data-period="${p}" aria-pressed="${state.period === p}">${esc(t(`rpt.period.${p === 'week' ? 'week' : p}`))}</button>`)
    .join('')}</div>`;
}

async function listHtml() {
  const range = periodRange(state.period, { today: todayISO() });
  let rows = await shifts.listShifts({ from: range.from, to: range.to });
  const all = rows;
  if (state.onlyDiscrepancies) rows = rows.filter((s) => s.status === 'closed' && s.variance !== 0);
  const closed = all.filter((s) => s.status === 'closed');
  const shorts = closed.filter((s) => s.variance < 0).reduce((total, s) => total + s.variance, 0);
  const overs = closed.filter((s) => s.variance > 0).reduce((total, s) => total + s.variance, 0);
  const disc = closed.filter((s) => s.variance !== 0).length;
  const body = rows.length
    ? rows
        .map(
          (s) => `
        <tr data-shift="${esc(s.id)}" tabindex="0" class="shift-row">
          <td>${esc(s.number)}</td>
          <td>${esc(formatDateTime(Date.parse(s.openedAt)))}</td>
          <td>${esc(duration(s))}</td>
          <td>${esc(s.openedBy || '-')}</td>
          <td class="num">${esc(format(s.openingCash, { symbol: false }))}</td>
          <td class="num">${s.expected === null ? '-' : esc(format(s.expected, { symbol: false }))}</td>
          <td class="num">${s.counted === null ? '-' : esc(format(s.counted, { symbol: false }))}</td>
          <td class="num ${s.variance && s.variance < 0 ? 'is-loss' : ''}">${s.variance === null ? '-' : esc(signed(s.variance))}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td colspan="8" class="muted">${esc(t('shift.noShifts'))}</td></tr>`;
  return `
    <div class="stat-grid">
      <div class="card stat"><span class="stat-label">${esc(t('shift.kpiShifts'))}</span><span class="stat-value">${esc(String(all.length))}</span></div>
      <div class="card stat"><span class="stat-label">${esc(t('shift.kpiDiscrepancies'))}</span><span class="stat-value">${esc(String(disc))}</span></div>
      <div class="card stat"><span class="stat-label">${esc(t('shift.kpiShort'))}</span><span class="stat-value is-loss">${esc(format(shorts, { symbol: false }))}</span></div>
      <div class="card stat"><span class="stat-label">${esc(t('shift.kpiOver'))}</span><span class="stat-value">${esc(format(overs, { symbol: false }))}</span></div>
    </div>
    <div class="doc-filters">${periodBar()}
      <label class="pl-check"><input type="checkbox" id="sh-only-disc"${state.onlyDiscrepancies ? ' checked' : ''}> <span>${esc(t('shift.onlyDiscrepancies'))}</span></label>
    </div>
    <div class="table-wrap">
      <table class="table table-cards">
        <thead><tr>
          <th>${esc(t('shift.colNumber'))}</th><th>${esc(t('shift.colOpened'))}</th><th>${esc(t('shift.colDuration'))}</th>
          <th>${esc(t('shift.cashier'))}</th><th class="num">${esc(t('shift.opening'))}</th><th class="num">${esc(t('shift.expected'))}</th>
          <th class="num">${esc(t('shift.counted'))}</th><th class="num">${esc(t('shift.variance'))}</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

async function paint() {
  if (!$host) return;
  $host.html(await listHtml());
}

async function openShift(id) {
  const summary = await shifts.shiftSummary(id);
  const sh = summary.shift;
  const html = reportHtml(summary, { title: t('shift.zReport'), closed: sh.status === 'closed' });
  const corrections = (sh.corrections ?? [])
    .map((c) => `<tr><td>${esc(formatDateTime(Date.parse(c.at)))}</td><td>${esc(c.by || '-')}</td><td class="num">${esc(format(c.from ?? 0, { symbol: false }))}</td><td class="num">${esc(format(c.to, { symbol: false }))}</td><td>${esc(c.reason)}</td></tr>`)
    .join('');
  const body = $(`${html}${corrections ? `<h4>${esc(t('shift.corrections'))}</h4><table class="table"><thead><tr><th>${esc(t('shift.colOpened'))}</th><th>${esc(t('shift.cashier'))}</th><th class="num">${esc(t('shift.from'))}</th><th class="num">${esc(t('shift.to'))}</th><th>${esc(t('shift.reasonLabel'))}</th></tr></thead><tbody>${corrections}</tbody></table>` : ''}`);
  const actions = [{ label: t('shift.printZ'), variant: 'primary', onClick: () => { printHtml(html, { width: 80 }); return false; } }];
  if (sh.status === 'closed' && isOwner()) actions.push({ label: t('shift.correct'), variant: 'ghost', onClick: () => { correctDialog(sh); return false; } });
  actions.push({ label: t('shift.close') });
  ui.openModal({ title: `${sh.number}`, body, actions });
}

function correctDialog(shift) {
  const body = $(`
    <form class="form" id="sh-correct" novalidate>
      <p class="muted small">${esc(t('shift.correctHelp'))}</p>
      <label class="field"><span>${esc(t('shift.correctTo'))}</span><input name="counted" inputmode="decimal" value="${esc(format(shift.counted, { symbol: false }))}"></label>
      <label class="field"><span>${esc(t('shift.reasonLabel'))}</span><input name="reason" autocomplete="off"></label>
      <p class="form-error" role="alert" hidden></p>
    </form>`);
  const modal = ui.openModal({
    title: t('shift.correct'),
    body,
    actions: [
      { label: t('btn.cancel'), variant: 'ghost' },
      {
        label: t('shift.saveCorrection'),
        variant: 'primary',
        onClick: async () => {
          const counted = parseRupees(body.find('[name="counted"]').val());
          try {
            if (counted === null || counted < 0) throw new Error(t('shift.badAmount'));
            await shifts.correctShiftCount(shift.id, { counted, reason: body.find('[name="reason"]').val() });
            ui.toast(t('shift.corrected'), { type: 'success' });
            modal.close();
            await paint();
          } catch (err) {
            body.find('.form-error').text(err.code ? errorText(err) : err.message).prop('hidden', false);
          }
          return false;
        },
      },
    ],
  });
}

export async function render($root) {
  $root.html('<div class="shift-hist-root"></div>');
  $host = $root.children('.shift-hist-root');
  $host.on('click', '[data-period]', (event) => {
    state.period = event.currentTarget.getAttribute('data-period');
    paint();
  });
  $host.on('change', '#sh-only-disc', (event) => {
    state.onlyDiscrepancies = event.currentTarget.checked;
    paint();
  });
  $host.on('click', '.shift-row', (event) => openShift(event.currentTarget.getAttribute('data-shift')));
  $host.on('keydown', '.shift-row', (event) => {
    if (event.key === 'Enter') openShift(event.currentTarget.getAttribute('data-shift'));
  });
  await paint();
}

export function destroy() {
  $host = null;
}
