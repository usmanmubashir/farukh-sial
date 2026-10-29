// Shared pieces for the document screens (purchases, sales, returns, order list, batch trace, Rx register):
// the period bar, status chips, summary tiles, error text and the small helpers they all use.
import * as ui from '../core/ui.js';
import { esc } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { todayISO } from '../core/dates.js';
import { listCustomers, listSuppliers } from '../services/parties.js';

/** Upper bound for an open date range (dates are YYYY-MM-DD strings, so this sorts after all of them). */
export const OPEN_END = '￿';

/**
 * Turns the period choice into a date range for the services.
 * state: { period: 'today' | 'month' | 'all' | 'custom', from, to } (from/to are YYYY-MM-DD for 'custom').
 */
export function rangeOf({ period = 'month', from = '', to = '' } = {}, today = todayISO()) {
  if (period === 'today') return { from: today, to: today };
  if (period === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (period === 'custom') return { from: from || '', to: to || OPEN_END };
  return { from: '', to: OPEN_END };
}

/** Reads the period bar rendered by periodBar(). */
export function readPeriod($host) {
  const period = $host.find('[data-period][aria-pressed="true"]').attr('data-period') ?? 'month';
  return {
    period,
    from: $host.find('[name="from"]').val() || '',
    to: $host.find('[name="to"]').val() || '',
  };
}

/** Today / Month / All chips plus From and To dates. Picking a date switches the chips to 'custom'. */
export function periodBar(state) {
  const chip = (key, label) =>
    `<button type="button" class="chip" data-period="${key}" aria-pressed="${state.period === key}">${esc(label)}</button>`;
  return `
    <div class="doc-period">
      <div class="chip-row" role="group" aria-label="${esc(t('doc.period'))}">
        ${chip('today', t('doc.today'))}${chip('month', t('doc.month'))}${chip('all', t('doc.all'))}
      </div>
      <label class="doc-date">
        <span>${esc(t('doc.from'))}</span>
        <input type="date" name="from" value="${esc(state.from ?? '')}">
      </label>
      <label class="doc-date">
        <span>${esc(t('doc.to'))}</span>
        <input type="date" name="to" value="${esc(state.to ?? '')}">
      </label>
    </div>`;
}

/** Chips that choose one value from a list. group is the data attribute name, for example "status". */
export function chipGroup(group, items, active, label) {
  return `<div class="chip-row" role="group" aria-label="${esc(label)}">${items
    .map(
      ([key, text]) =>
        `<button type="button" class="chip" data-${group}="${esc(key)}" aria-pressed="${key === active}">${esc(text)}</button>`,
    )
    .join('')}</div>`;
}

/** Summary tiles, in the same style as the stock screen. values are already-formatted html. */
export function statTiles(tiles) {
  return `<div class="stat-grid doc-tiles">${tiles
    .map(
      ([label, value]) => `
    <div class="card stat">
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-value">${value}</span>
    </div>`,
    )
    .join('')}</div>`;
}

/** Small status badge. tone: 'ok' | 'warn' | 'danger' | 'info' | '' (neutral). */
export function badge(text, tone = '') {
  return `<span class="badge${tone ? ` badge--${tone}` : ''}">${esc(text)}</span>`;
}

export const SERVICE_CODES = [
  'emptyPurchase', 'expiredBatch', 'supplierRequiredForCredit', 'overpaid', 'invalidField', 'required', 'notFound',
  'productInactive', 'emptyReturn', 'returnExceedsSold', 'returnExceedsBought', 'refundExceedsReturn',
  'walkInRefundMustMatch', 'saleVoided', 'insufficientStock', 'batchExpired',
];

/** The message for a service error: its own text when the code is known, otherwise a generic one. */
export function errorText(err) {
  if (err && SERVICE_CODES.includes(err.code)) return t(`svc.${err.code}`, err.vars);
  return t('svc.default');
}

/** Name lookup for customers and suppliers, by id. */
export async function partyNames() {
  const [customers, suppliers] = await Promise.all([listCustomers(), listSuppliers()]);
  return {
    customer: new Map(customers.map((c) => [c.id, c])),
    supplier: new Map(suppliers.map((s) => [s.id, s])),
  };
}

/** Opens a read-only detail sheet (a drawer on desktop, a bottom sheet on phones). */
export function openDetail({ title, body, actions = [] }) {
  return ui.openModal({ title, body, actions });
}

/** Search box with a visible label for screen readers. */
export function searchField(placeholder, className, { autofocus = false } = {}) {
  return `<label class="search-box"><span class="sr-only">${esc(placeholder)}</span>
    <input type="search" class="${className}" placeholder="${esc(placeholder)}" autocomplete="off"${autofocus ? " autofocus" : ""}></label>`;
}

/** The page's header row: title, a count line and action buttons (already-rendered html). */
export function pageHead(title, actionsHtml = '') {
  return `
    <div class="page-head">
      <div><h2>${esc(title)}</h2><p class="muted small doc-count"></p></div>
      <div class="row">${actionsHtml}</div>
    </div>`;
}

/** Empty-table row, shown when a list has nothing to show. */
export function emptyRow(colspan, text) {
  return `<tr class="doc-empty"><td colspan="${colspan}" class="muted">${esc(text)}</td></tr>`;
}
