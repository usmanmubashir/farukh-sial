// Practice history (#/practice-list). Every practice in a date range, newest first. Voided practices are hidden unless
// asked for (struck through and excluded from totals). Opening a row shows its items and costs; the owner can void it
// there, with a reason. Pages call services only.
import * as i18n from '../core/i18n.js';
import * as ui from '../core/ui.js';
import { esc, icon } from '../core/ui.js';
import * as anim from '../core/anim.js';
import { format } from '../core/money.js';
import { formatDate, formatDateTime, todayISO } from '../core/dates.js';
import { getPractice, listPractices, practiceTotals, voidPractice } from '../services/practice.js';

export const route = '/practice-list';
export const title = 'nav.practiceList';

const t = i18n.t;
const ROW_LIMIT = 500;

let $host = null;
let filter = null;

const rupees = (paisa) => format(paisa, { symbol: false });
const money = (paisa) => `<span class="money" data-count="${esc(paisa)}" data-format="money-plain">${esc(rupees(paisa))}</span>`;

/** Start and end (YYYY-MM-DD) of a preset, relative to today. */
function rangeFor(preset) {
  const today = todayISO();
  const [year, month] = today.split('-').map(Number);
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (preset === 'month') return { from: iso(year, month, 1), to: today };
  if (preset === 'quarter') {
    const back = new Date(year, month - 1 - 2, 1);
    return { from: iso(back.getFullYear(), back.getMonth() + 1, 1), to: today };
  }
  return { from: today, to: today };
}

function shellHtml() {
  const preset = filter.preset;
  return `
    <div class="practice-root practice-list" data-accent="practice">
      <header class="practice-head">
        <div class="practice-title">
          <span class="practice-mark" aria-hidden="true">${icon('pulse')}</span>
          <div>
            <h2>${esc(t('nav.practiceList'))}</h2>
            <p class="muted small">${esc(t('practiceList.subtitle'))}</p>
          </div>
        </div>
        <a class="btn btn-soft btn-sm" href="#/practice">${esc(t('practice.backToPractice'))}</a>
      </header>
      <section class="pl-filters" aria-label="${esc(t('practiceList.filters'))}">
        <label class="field"><span>${esc(t('practiceList.range'))}</span>
          <select name="preset">
            <option value="today"${preset === 'today' ? ' selected' : ''}>${esc(t('practiceList.today'))}</option>
            <option value="month"${preset === 'month' ? ' selected' : ''}>${esc(t('practiceList.thisMonth'))}</option>
            <option value="quarter"${preset === 'quarter' ? ' selected' : ''}>${esc(t('practiceList.last3Months'))}</option>
            <option value="custom"${preset === 'custom' ? ' selected' : ''}>${esc(t('practiceList.custom'))}</option>
          </select>
        </label>
        <label class="field"><span>${esc(t('practiceList.from'))}</span><input name="from" type="date" value="${esc(filter.from)}"></label>
        <label class="field"><span>${esc(t('practiceList.to'))}</span><input name="to" type="date" value="${esc(filter.to)}"></label>
        <label class="pl-check"><input name="voided" type="checkbox"${filter.voided ? ' checked' : ''}> <span>${esc(t('practiceList.showVoided'))}</span></label>
      </section>
      <section class="pl-kpis" aria-live="polite"></section>
      <p class="pl-error" role="alert" hidden></p>
      <div class="pl-table-wrap">
        <table class="table pl-table">
          <thead><tr>
            <th scope="col">${esc(t('practiceList.number'))}</th>
            <th scope="col">${esc(t('practiceList.when'))}</th>
            <th scope="col">${esc(t('practiceList.patient'))}</th>
            <th scope="col" class="num">${esc(t('practiceList.charged'))}</th>
            <th scope="col" class="num">${esc(t('practiceList.cost'))}</th>
            <th scope="col" class="num">${esc(t('practiceList.profit'))}</th>
          </tr></thead>
          <tbody class="pl-rows"></tbody>
          <tfoot class="pl-totals-bottom"></tfoot>
        </table>
      </div>
    </div>`;
}

function kpiHtml(totals) {
  const margin = totals.margin === null ? '—' : `${Math.round(totals.margin * 1000) / 10}%`;
  return [
    [t('practiceList.kpiCount'), esc(totals.count)],
    [t('practiceList.kpiCharged'), money(totals.charged)],
    [t('practiceList.kpiCost'), money(totals.cost)],
    [t('practiceList.kpiProfit'), money(totals.profit)],
    [t('practiceList.kpiMargin'), esc(margin)],
  ].map(([label, value]) => `<div class="pl-kpi"><span class="muted small">${esc(label)}</span><strong>${value}</strong></div>`).join('');
}

function totalsRowHtml(label, totals, cls = '') {
  return `<tr class="${cls}"><th scope="row" colspan="3">${esc(label)}</th>
    <td class="num">${money(totals.charged)}</td><td class="num">${money(totals.cost)}</td>
    <td class="num ${totals.profit < 0 ? 'is-loss' : 'is-profit'}">${money(totals.profit)}</td></tr>`;
}

function rowHtml(p) {
  const profitClass = p.voided ? '' : p.profit < 0 ? 'is-loss' : 'is-profit';
  return `
    <tr class="pl-row${p.voided ? ' is-voided' : ''}" data-id="${esc(p.id)}" tabindex="0" aria-label="${esc(t('practiceList.openRow', { number: p.number }))}">
      <th scope="row">${esc(p.number)}${p.voided ? ` <span class="badge badge--danger">${esc(t('practiceList.voidedBadge'))}</span>` : ''}</th>
      <td>${esc(formatDateTime(new Date(p.dateTime).getTime()))}</td>
      <td>${esc(p.patientName || t('practice.noPatient'))}</td>
      <td class="num">${money(p.chargedAmount)}</td>
      <td class="num">${money(p.costTotal)}</td>
      <td class="num ${profitClass}">${money(p.profit)}</td>
    </tr>`;
}

async function load() {
  const range = filter.preset === 'custom' ? { from: filter.from, to: filter.to } : rangeFor(filter.preset);
  if (range.from > range.to) {
    $host.find('.pl-error').prop('hidden', false).text(t('practiceList.badRange'));
    return;
  }
  $host.find('.pl-error').prop('hidden', true).text('');
  filter.from = range.from;
  filter.to = range.to;
  const [rows, totals] = await Promise.all([
    listPractices({ from: range.from, to: range.to, includeVoided: filter.voided }),
    practiceTotals({ from: range.from, to: range.to }),
  ]);
  $host.find('.pl-kpis').html(kpiHtml(totals));
  const shown = rows.slice(0, ROW_LIMIT);
  $host.find('.pl-rows').html(shown.length
    ? shown.map(rowHtml).join('')
    : `<tr><td colspan="6" class="muted">${esc(t('practiceList.empty'))}</td></tr>`);
  const active = rows.filter((p) => !p.voided);
  const sum = (key) => active.reduce((total, p) => total + p[key], 0);
  const bottom = { charged: sum('chargedAmount'), cost: sum('costTotal'), profit: sum('profit') };
  $host.find('.pl-totals-bottom').html(shown.length ? totalsRowHtml(t('practiceList.totals'), bottom, 'pl-total-row') : '');
  if (rows.length > ROW_LIMIT) {
    $host.find('.pl-rows').append(`<tr><td colspan="6" class="muted small">${esc(t('practiceList.limited', { shown: ROW_LIMIT, total: rows.length }))}</td></tr>`);
  }
  anim.scanCounts($host[0]);
}

async function openDetail(id) {
  const p = await getPractice(id);
  const items = p.items.map((i) => `<tr><td>${esc(i.productName)} <span class="muted small">${esc(i.strength ?? '')}</span></td>
      <td>${esc(i.batchNo)}</td><td class="num">${esc(i.qtyUnits)}</td><td class="num">${money(i.lineList)}</td><td class="num">${money(i.lineCost)}</td></tr>`).join('');
  const voidBlock = p.voided
    ? `<p class="pl-voided-note">${esc(t('practiceList.voidedOn', { date: formatDate(p.void.voidDate), reason: p.void.reason }))}</p>`
    : `<form class="pl-void" data-void>
         <label class="field"><span>${esc(t('practiceList.voidReason'))}</span><input name="reason" required autocomplete="off"></label>
         <button type="submit" class="btn btn-danger">${esc(t('practiceList.voidButton'))}</button>
         <p class="muted small">${esc(t('practiceList.voidNote'))}</p>
       </form>`;
  const $body = $(`
    <div class="pl-detail">
      <dl class="doc-totals">
        <div><dt>${esc(t('practiceList.charged'))}</dt><dd>${money(p.chargedAmount)}</dd></div>
        <div><dt>${esc(t('practiceList.cost'))}</dt><dd>${money(p.costTotal)}</dd></div>
        <div><dt>${esc(t('practiceList.profit'))}</dt><dd class="${p.profit < 0 ? 'is-loss' : 'is-profit'}">${money(p.profit)}</dd></div>
        <div><dt>${esc(t('practiceList.calculated'))}</dt><dd>${money(p.calculatedTotal)}</dd></div>
      </dl>
      <div class="table-wrap"><table class="table"><thead><tr>
        <th>${esc(t('practiceList.medicine'))}</th><th>${esc(t('practiceList.batch'))}</th><th class="num">${esc(t('practiceList.units'))}</th>
        <th class="num">${esc(t('practiceList.listPrice'))}</th><th class="num">${esc(t('practiceList.cost'))}</th>
      </tr></thead><tbody>${items}</tbody></table></div>
      ${voidBlock}
    </div>`);
  const dialog = ui.openModal({ title: p.number, body: $body, actions: [{ label: t('btn.close') }] });
  $body.on('submit', '[data-void]', async (event) => {
    event.preventDefault();
    const reason = String($body.find('[name="reason"]').val() ?? '').trim();
    if (!reason) {
      ui.toast(t('practiceList.reasonNeeded'), { type: 'error' });
      return;
    }
    try {
      await voidPractice(p.id, { reason });
      dialog?.close?.();
      ui.toast(t('practiceList.voided', { number: p.number }), { type: 'success' });
      await load();
    } catch (err) {
      console.warn('[practice-list] void failed', err);
      ui.toast(t('errors.generic'), { type: 'error' });
    }
  });
}

function bind() {
  $host.on('change', '[name="preset"]', (event) => {
    filter.preset = event.currentTarget.value;
    load();
  });
  $host.on('change', '[name="from"], [name="to"]', (event) => {
    filter.preset = 'custom';
    filter[event.currentTarget.name] = event.currentTarget.value;
    $host.find('[name="preset"]').val('custom');
    load();
  });
  $host.on('change', '[name="voided"]', (event) => {
    filter.voided = event.currentTarget.checked;
    load();
  });
  $host.on('click', '.pl-row', (event) => openDetail(event.currentTarget.getAttribute('data-id')));
  $host.on('keydown', '.pl-row', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDetail(event.currentTarget.getAttribute('data-id'));
    }
  });
}

export async function render($root) {
  filter = { preset: 'today', from: todayISO(), to: todayISO(), voided: false };
  $root.html(shellHtml());
  $host = $root.children('.practice-list');
  bind();
  await load();
}

export function destroy() {
  $host = null;
  filter = null;
}
