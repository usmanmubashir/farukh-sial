// Reports. #/reports is a card grid of every report, grouped. #/reports/<key> opens one report: its filters, an
// animated chart where it helps, a sticky totals row, and a virtual table so 50,000 rows stay smooth.
// Print and CSV use the same rows as the table, so a printout and a file always match the screen.
import * as events from '../core/events.js';
import { debounce } from '../core/resilience.js';
import * as ui from '../core/ui.js';
import { esc, icon, money } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { formatDate, periodRange, todayISO } from '../core/dates.js';
import { parseRupees } from '../core/money.js';
import { downloadText, rupeesForCsv, toCsv } from '../core/csv.js';
import { virtualList } from '../core/virtual.js';
import { barChart, animateBars } from '../core/chart.js';
import { hbarChart, lineChart, stackedBars } from '../core/trend.js';
import { openPracticeDetail } from './_practice-detail.js';
import * as db from '../core/db.js';
import { printPage } from '../services/printing.js';
import { listCustomers, listSuppliers } from '../services/parties.js';
import { OPEN_END } from '../services/reports.js';
import { ensureRollups, rollupsReady } from '../services/rollups.js';
import * as shared from './_doc-shared.js';
import { GROUPS, REPORTS, accountChoices } from './_report-defs.js';

export const route = '/reports';
export const title = 'nav.reports';

const ROW_HEIGHT = 40;
const PRINT_CHUNK = 2000;

let $host = null;
let unsubscribe = null;
let key = null;
let state = { period: 'month', from: '', to: '', search: '', party: '', account: '1000', by: 'day', days: 90, showVoided: false, source: 'both', rank: 'qty', topN: '20' };
// The period and filters each report was last left with, so coming back to it finds the same view.
const remembered = new Map();
let loaded = { rows: [], text: [], needs: '', totals: null, kpis: null, trend: null };
let visible = [];
let list = null;
let runId = 0;
let choices = { parties: [], accounts: [] };

const GROUP_ICON = { inventory: 'stock', sales: 'receipt', purchases: 'purchase', parties: 'customers', accounts: 'bank', practice: 'pulse' };
const REPORT_ICON = {
  stock: 'stock', batches: 'batch', expiry: 'clock', lowstock: 'order', dead: 'stock',
  daily: 'receipt', range: 'receipt', returns: 'returns', medicine: 'products', company: 'products', salt: 'products',
  purchases: 'purchase', purchaseReturns: 'returns', purchaseMedicine: 'products', supplier: 'suppliers',
  customerLedger: 'customers', supplierLedger: 'suppliers', receivables: 'customers', payables: 'suppliers',
  cashBook: 'bank', accountLedger: 'ledger', dailyClosing: 'bank', profit: 'reports',
  practice: 'pulse', 'practice-medicine': 'products', 'top-products': 'reports', 'slow-movers': 'clock', 'sales-vs-practice': 'bank',
};

/* ---------- Grid ---------- */

function gridHtml() {
  return `
    ${shared.pageHead(t('rpt.title'), '')}
    <p class="muted">${esc(t('rpt.intro'))}</p>
    ${GROUPS.map(
      (group) => `
      <section class="rpt-group" aria-labelledby="grp-${group.key}">
        <h3 class="rpt-group-title" id="grp-${group.key}">${icon(GROUP_ICON[group.key])} ${esc(t(`rpt.group.${group.key}`))}</h3>
        <div class="rpt-cards">
          ${group.reports
            .map(
              (rk) => `
            <a class="card card--interactive rpt-card" href="#/reports/${esc(rk)}">
              <span class="rpt-card-icon">${icon(REPORT_ICON[rk] ?? 'reports')}</span>
              <span class="rpt-card-title">${esc(t(`rpt.${rk}.title`))}</span>
              <span class="rpt-card-desc muted small">${esc(t(`rpt.${rk}.desc`))}</span>
            </a>`,
            )
            .join('')}
        </div>
      </section>`,
    ).join('')}`;
}

/* ---------- Cell rendering ---------- */

const rupeesInput = (paisa) => (paisa === null || paisa === undefined ? '' : (paisa / 100).toFixed(2));

function cellHtml(col, row) {
  const v = row[col.key];
  switch (col.type) {
    case 'money': return money(v ?? 0);
    case 'int': return esc(String(v ?? 0));
    case 'date': return esc(v ? formatDate(v) : '—');
    case 'pct': return esc(`${((v ?? 0) * 100).toFixed(1)}%`);
    case 'input':
      return `<input class="rpt-count" type="text" inputmode="decimal" data-date="${esc(row.date)}" value="${esc(rupeesInput(v))}" aria-label="${esc(t('rpt.col.counted'))} ${esc(formatDate(row.date))}">`;
    case 'rank': {
      const rank = Number(v ?? 0);
      return rank >= 1 && rank <= 3 ? `<span class="rank-badge rank-badge--${rank}" aria-label="${esc(t('rpt.rank.place', { rank }))}">${rank}</span>` : esc(String(rank));
    }
    default: return esc(v ?? '');
  }
}

function rowHtml(def, row) {
  // A row that opens a detail (a practice) is focusable and carries its id. A voided row is struck through.
  const link = def.rowDetail && row.id ? ` rpt-row-link" tabindex="0" data-row-id="${esc(row.id)}` : '';
  const voided = row.voided ? ' is-voided' : '';
  const cells = def.columns.map((col) => {
    const v = row[col.key];
    const loss = col.type === 'money' && typeof v === 'number' && v < 0 ? ' is-loss' : '';
    return `<span class="rpt-cell rpt-${col.type}${loss}" role="cell">${cellHtml(col, row)}</span>`;
  });
  return `<div class="rpt-row${voided}${link}" role="row">${cells.join('')}</div>`;
}

function colsStyle(def) {
  return `--rpt-cols: ${def.columns.map((c, i) => (i === 0 ? 'minmax(160px, 2fr)' : 'minmax(104px, 1fr)')).join(' ')}`;
}

function headHtml(def) {
  return `<div class="rpt-head" role="row">${def.columns.map((c) => `<span class="rpt-cell rpt-${c.type} rpt-th" role="columnheader">${esc(t(c.label))}</span>`).join('')}</div>`;
}

function totalsHtml(def, rows, override = null) {
  const cells = def.columns.map((col) => {
    if (!col.sum) return '';
    // A report can give its own totals (for example, practice totals leave voided practices out).
    const total = override && col.key in override ? override[col.key] : rows.reduce((sum, row) => sum + (row[col.key] ?? 0), 0);
    return col.type === 'money' ? money(total) : esc(String(total));
  });
  return `<div class="rpt-totals" role="row" aria-label="${esc(t('rpt.totals'))}">${cells.map((cell, i) => `<span class="rpt-cell rpt-${def.columns[i].type}" role="cell">${cell}</span>`).join('')}</div>`;
}

/* ---------- Filtering and painting ---------- */

function searchable(def, row) {
  if (!row.__text) {
    row.__text = (def.search ? [...(loaded.text ?? []), ...def.columns.filter((c) => c.type === 'text').map((c) => c.key)] : [])
      .map((k) => String(row[k] ?? ''))
      .join(' ')
      .toLowerCase();
  }
  return row.__text;
}

function applySearch(def) {
  const q = state.search.trim().toLowerCase();
  if (!q || !def.search) return loaded.rows;
  return loaded.rows.filter((row) => searchable(def, row).includes(q));
}

function labelOf(row) {
  if (row.date) return formatDate(row.date).slice(0, 5);
  return String(row.period ?? row.label ?? '');
}

function paint() {
  const def = REPORTS[key];
  visible = applySearch(def);
  const count = visible.length;
  $host.find('.rpt-count-line').text(t('rpt.count', { count }));
  list?.pin(headHtml(def) + totalsHtml(def, visible, loaded.totals));
  $host.find('.rpt-totals-bottom').html(def.bottomTotals && count > 0 ? totalsHtml(def, visible, loaded.totals) : '');
  $host.find('.rpt-kpis').html(kpisHtml(loaded.kpis));
  $host.find('.rpt-none').prop('hidden', count > 0);
  $host.find('.rpt-none').text(loaded.needs ? t(loaded.needs) : t('rpt.none'));
  if (loaded.trend) {
    $host.find('.rpt-chart').html(trendHtml(loaded.trend));
  } else {
    $host.find('.rpt-chart').html(def.chart && count > 0 ? barChart(
      visible.map((row) => ({ label: labelOf(row), value: row[def.chart.key] ?? 0, title: money_(row[def.chart.key] ?? 0) })),
      { ariaLabel: t(def.chart.label), format: money_ },
    ) : '');
    animateBars($host.find('.rpt-chart'));
  }
  $host.find('.rpt-loading').prop('hidden', true);
  list?.set(visible);
}

const money_ = (paisa) => new Intl.NumberFormat('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paisa / 100);

function remember() {
  remembered.set(key, {
    period: state.period, from: state.from, to: state.to,
    showVoided: state.showVoided, source: state.source, rank: state.rank, topN: state.topN,
  });
}

async function refresh() {
  const def = REPORTS[key];
  const run = (runId += 1);
  remember();
  if (def.period && state.period === 'custom' && state.from && state.to && state.from > state.to) {
    $host.find('.rpt-count-line').text(t('rpt.badRange'));
    $host.find('.rpt-none').prop('hidden', true);
    $host.find('.rpt-loading').prop('hidden', true);
    return;
  }
  $host.find('.rpt-count-line').text(t('rpt.loading'));
  $host.find('.rpt-loading').prop('hidden', false);
  const range = !def.period
    ? { from: '', to: OPEN_END }
    : def.periods === 'full' ? periodRange(state.period, { today: todayISO(), from: state.from, to: state.to }) : shared.rangeOf(state);
  const ctx = {
    ...range,
    today: todayISO(),
    party: state.party,
    account: state.account,
    by: state.by,
    days: Number(state.days) || 90,
    showVoided: state.showVoided,
    source: state.source,
    rank: state.rank,
    topN: state.topN === 'all' ? 0 : Number(state.topN) || 20,
  };
  let result;
  try {
    if (!(await rollupsReady())) {
      // The first time, the daily rollups are built from the existing sales. This happens once per database.
      if (run === runId) $host.find('.rpt-count-line').text(t('rpt.preparing'));
      await ensureRollups();
    }
    result = await def.load(ctx);
  } catch (err) {
    console.error('[reports] failed', err);
    if (run !== runId) return;
    $host.find('.rpt-count-line').text(t('errors.generic'));
    $host.find('.rpt-loading').prop('hidden', true);
    return;
  }
  if (run !== runId) return;
  loaded = {
    rows: result.rows,
    text: result.text ?? [],
    needs: result.needs ?? '',
    totals: result.totals ?? null,
    kpis: result.kpis ?? null,
    trend: result.trend ?? null,
  };
  paint();
}

/* ---------- Report page ---------- */

// Option chips for the practice reports: which sources to count, what to rank by, and how many to show.
const OPTIONS = { source: ['both', 'sales', 'practice'], rank: ['qty', 'revenue', 'profit'], topn: ['10', '20', '50', 'all'] };
const OPTION_STATE = { source: 'source', rank: 'rank', topn: 'topN' };
function optChips(name) {
  const stateKey = OPTION_STATE[name];
  return `<div class="chip-row" role="group" aria-label="${esc(t(`rpt.${name}.label`))}">${OPTIONS[name]
    .map((value) => `<button type="button" class="chip" data-opt-set="${stateKey}" data-val="${esc(value)}" aria-pressed="${String(state[stateKey]) === value}">${esc(t(`rpt.${name}.${value}`))}</button>`)
    .join('')}</div>`;
}

/** Links between the reports that share a page: top sellers and slow movers. */
function tabsHtml(extra) {
  const keys = extra.split(':')[1].split('|');
  return `<div class="chip-row" role="group" aria-label="${esc(t('rpt.tabs'))}">${keys
    .map((k) => `<a class="chip" href="#/reports/${esc(k)}" aria-current="${k === key ? 'page' : 'false'}">${esc(t(`rpt.${k}.title`))}</a>`)
    .join('')}</div>`;
}

/** Summary tiles above a report: money, counts, margins and text (the best and worst practice, the top seller). */
function kpisHtml(kpis) {
  if (!kpis || kpis.length === 0) return '';
  return `<div class="rpt-kpi-grid">${kpis
    .map((k) => `<div class="card stat"><span class="stat-label">${esc(k.label)}</span><span class="stat-value${k.tone ? ` is-${k.tone}` : ''}">${kpiValue(k)}</span></div>`)
    .join('')}</div>`;
}

function kpiValue(k) {
  if (k.value === null || k.value === undefined) return '—';
  if (k.type === 'money') return money(k.value);
  if (k.type === 'pct') return esc(`${(k.value * 100).toFixed(1)}%`);
  return esc(String(k.value));
}

/** The chart a report asks for: lines, stacked columns, or ranked bars. */
function trendHtml(trend) {
  const fmt = trend.format === 'int' ? (v) => String(v) : money_;
  if (trend.kind === 'line') return lineChart({ labels: trend.labels, series: trend.series, format: fmt, ariaLabel: trend.ariaLabel ?? t('rpt.trend') });
  if (trend.kind === 'stacked') return stackedBars({ periods: trend.periods, format: fmt, ariaLabel: trend.ariaLabel ?? '' });
  if (trend.kind === 'hbars') return hbarChart(trend.rows, { format: fmt, ariaLabel: trend.ariaLabel ?? '' });
  return '';
}

function filtersHtml(def) {
  const extras = def.extras ?? [];
  const parts = [];
  if (def.period) parts.push(def.periods === 'full' ? shared.periodBarFull(state) : shared.periodBar(state));
  if (def.search) parts.push(shared.searchField(t('rpt.search'), 'rpt-search'));
  for (const extra of extras) {
    if (extra === 'voided') {
      parts.push(`<label class="pl-check rpt-check"><input type="checkbox" data-opt="showVoided"${state.showVoided ? ' checked' : ''}> <span>${esc(t('rpt.showVoided'))}</span></label>`);
      continue;
    }
    if (extra === 'source' || extra === 'rank' || extra === 'topn') {
      parts.push(optChips(extra));
      continue;
    }
    if (extra.startsWith('tabs:')) {
      parts.push(tabsHtml(extra));
      continue;
    }
    if (extra.startsWith('party:')) {
      const kind = extra.split(':')[1];
      const options = choices.parties.filter((p) => p.kind === kind)
        .map((p) => `<option value="${esc(p.id)}"${p.id === state.party ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
      parts.push(`<label class="field rpt-pick"><span>${esc(t(`rpt.pick.${kind}`))}</span>
        <select class="rpt-party"><option value="">${esc(t('rpt.choose'))}</option>${options}</select></label>`);
    }
    if (extra.startsWith('account:')) {
      const options = choices.accounts.map((a) => `<option value="${esc(a.code)}"${a.code === state.account ? ' selected' : ''}>${esc(a.system ? t(a.key) : a.name)}</option>`).join('');
      parts.push(`<label class="field rpt-pick"><span>${esc(t('rpt.pick.account'))}</span><select class="rpt-account">${options}</select></label>`);
    }
    if (extra === 'by') {
      parts.push(shared.chipGroup('by', [['day', t('rpt.by.day')], ['month', t('rpt.by.month')]], state.by, t('rpt.by.label')));
    }
    if (extra === 'days') {
      parts.push(`<label class="field rpt-pick"><span>${esc(t('rpt.days'))}</span><input class="rpt-days" type="number" min="1" value="${esc(state.days)}" inputmode="numeric"></label>`);
    }
  }
  return parts.join('');
}

function pageHtml(def) {
  const columns = def.columns;
  return `
    ${shared.pageHead(t(`rpt.${key}.title`), `<a class="btn btn-ghost" href="#/reports">${esc(t('rpt.back'))}</a>
      <button type="button" class="btn btn-ghost" data-action="csv">${esc(t('doc.csv'))}</button>
      <button type="button" class="btn btn-primary" data-action="print">${esc(t('doc.print'))}</button>`)}
    <p class="muted small">${esc(t(`rpt.${key}.desc`))}${def.periodHint ? ` · ${esc(t(def.periodHint))}` : ''}</p>
    <div class="doc-filters rpt-filters">${filtersHtml(def)}</div>
    <p class="muted small rpt-count-line"></p>
    <div class="rpt-kpis"></div>
    <div class="rpt-loading skeleton-stack" aria-hidden="true"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div>
    <div class="rpt-chart"></div>
    <div class="rpt-table" style="${colsStyle(def)}" aria-label="${esc(t(`rpt.${key}.title`))}"></div>
    <div class="rpt-totals-bottom"></div>
    <p class="muted rpt-none" hidden></p>`;
}

async function openReport(reportKey) {
  key = reportKey;
  const def = REPORTS[key];
  if (!def) {
    $host.html(`<section class="card empty-state"><h2>${esc(t('rpt.notFound'))}</h2><a class="btn btn-primary" href="#/reports">${esc(t('rpt.back'))}</a></section>`);
    return;
  }
  // Practice options are per report: start from the defaults, then restore what this report was last left with.
  state = {
    ...state,
    search: '', period: def.defaultPeriod ?? 'month', from: '', to: '',
    showVoided: false, source: 'both', rank: 'qty', topN: '20',
    ...(remembered.get(reportKey) ?? {}),
  };
  if ((def.extras ?? []).some((e) => e.startsWith('party:'))) {
    const [customers, suppliers] = await Promise.all([listCustomers(), listSuppliers()]);
    choices.parties = [...customers.map((c) => ({ ...c, kind: 'customer' })), ...suppliers.map((s) => ({ ...s, kind: 'supplier' }))];
  }
  if ((def.extras ?? []).some((e) => e.startsWith('account:'))) {
    const all = (def.extras ?? []).some((e) => e === 'account:all');
    choices.accounts = await accountChoices(all);
    if (!choices.accounts.some((a) => a.code === state.account)) state.account = choices.accounts[0]?.code ?? '1000';
  }
  $host.html(pageHtml(def));
  list = virtualList($host.find('.rpt-table')[0], {
    rowHeight: ROW_HEIGHT,
    render: (row) => rowHtml(def, row),
  });
  await refresh();
}

/* ---------- Print and CSV ---------- */

function csvColumns(def) {
  return def.columns.map((col) => ({
    label: t(col.label),
    value: (row) => {
      const v = row[col.key];
      if (col.type === 'money') return rupeesForCsv(v ?? 0);
      if (col.type === 'input') return v === null || v === undefined ? '' : rupeesForCsv(v);
      if (col.type === 'pct') return ((v ?? 0) * 100).toFixed(1);
      if (col.type === 'date') return v ?? '';
      return v ?? '';
    },
  }));
}

function exportCsv() {
  const def = REPORTS[key];
  downloadText(`${key}-${todayISO()}.csv`, toCsv(csvColumns(def), visible));
}

async function printReport() {
  const def = REPORTS[key];
  const pharmacy = await db.getSetting('pharmacyName', '');
  const head = def.columns.map((c) => `<th>${esc(t(c.label))}</th>`).join('');
  const cellPrint = (col, row) => {
    const v = row[col.key];
    if (col.type === 'money') return esc(money_(v ?? 0));
    if (col.type === 'pct') return esc(`${((v ?? 0) * 100).toFixed(1)}%`);
    if (col.type === 'date') return esc(v ? formatDate(v) : '');
    if (col.type === 'input') return esc(rupeesInput(v));
    return esc(v ?? '');
  };
  // Build the rows in chunks, yielding between them, so a 50,000-row printout does not freeze the page.
  const parts = [];
  for (let i = 0; i < visible.length; i += PRINT_CHUNK) {
    parts.push(visible.slice(i, i + PRINT_CHUNK).map((row) => `<tr>${def.columns.map((c) => `<td>${cellPrint(c, row)}</td>`).join('')}</tr>`).join(''));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const totals = def.columns.map((c) => {
    if (!c.sum) return '<td></td>';
    const total = visible.reduce((s, row) => s + (row[c.key] ?? 0), 0);
    return `<td><strong>${esc(c.type === 'money' ? money_(total) : String(total))}</strong></td>`;
  }).join('');
  printPage(`
    <div class="doc">
      <h1>${esc(t(`rpt.${key}.title`))}</h1>
      <p>${esc(pharmacy)} · ${esc(t('rpt.printed', { date: formatDate(todayISO()) }))} · ${esc(t('rpt.count', { count: visible.length }))}</p>
      <table><thead><tr>${head}</tr></thead><tbody>${parts.join('')}<tr>${totals}</tr></tbody></table>
    </div>`);
}

/* ---------- Wiring ---------- */

function bind() {
  const searchPaint = debounce(() => paint(), 150);
  $host.on('input', '.rpt-search', (event) => {
    state.search = event.currentTarget.value;
    searchPaint();
  });
  $host.on('click', '[data-period]', (event) => {
    $host.find('[data-period]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    state.period = event.currentTarget.getAttribute('data-period');
    Object.assign(state, { from: '', to: '' });
    $host.find('[name="from"], [name="to"]').val('');
    refresh();
  });
  $host.on('change', '[name="from"], [name="to"]', () => {
    $host.find('[data-period]').attr('aria-pressed', 'false');
    Object.assign(state, shared.readPeriod($host), { period: 'custom' });
    refresh();
  });
  // Practice options: a chip sets its value; the checkbox shows or hides voided practices.
  $host.on('click', '[data-opt-set]', (event) => {
    state[event.currentTarget.getAttribute('data-opt-set')] = event.currentTarget.getAttribute('data-val');
    refresh();
  });
  $host.on('change', '[data-opt="showVoided"]', (event) => {
    state.showVoided = event.currentTarget.checked;
    refresh();
  });
  $host.on('click', '.rpt-row-link', (event) => openPracticeDetail(event.currentTarget.getAttribute('data-row-id'), { onChanged: refresh }));
  $host.on('keydown', '.rpt-row-link', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      openPracticeDetail(event.currentTarget.getAttribute('data-row-id'), { onChanged: refresh });
    }
  });
  $host.on('change', '.rpt-party', (event) => {
    state.party = event.currentTarget.value;
    refresh();
  });
  $host.on('change', '.rpt-account', (event) => {
    state.account = event.currentTarget.value;
    refresh();
  });
  $host.on('change', '.rpt-days', (event) => {
    state.days = Math.max(1, Number(event.currentTarget.value) || 90);
    refresh();
  });
  $host.on('click', '[data-by]', (event) => {
    state.by = event.currentTarget.getAttribute('data-by');
    $host.find('[data-by]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    refresh();
  });
  // Counted cash on the daily closing: saved as settings "closing.<date>" in paisa, then the difference is recalculated.
  $host.on('change', '.rpt-count', async (event) => {
    const input = event.currentTarget;
    const date = input.getAttribute('data-date');
    const text = input.value.trim();
    const paisa = text === '' ? null : parseRupees(text);
    if (text !== '' && (paisa === null || paisa < 0)) {
      ui.toast(t('rpt.err.counted'), { type: 'error' });
      return;
    }
    if (paisa === null) await db.removeSetting(`closing.${date}`);
    else await db.setSetting(`closing.${date}`, paisa);
    refresh();
  });
  $host.on('click', '[data-action="csv"]', exportCsv);
  $host.on('click', '[data-action="print"]', printReport);
}

export async function render($root, params = {}) {
  state = { period: 'month', from: '', to: '', search: '', party: '', account: '1000', by: 'day', days: 90 };
  $root.html('<div class="doc-root rpt-root"></div>');
  $host = $root.children('.doc-root');
  bind();
  if (!params.key) {
    key = null;
    $host.html(gridHtml());
  } else {
    await openReport(params.key);
  }
  unsubscribe = events.on('data:changed', ({ stores }) => {
    if (!key || !stores) return;
    refresh();
  });
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
  list?.destroy();
  list = null;
  $host = null;
  key = null;
  loaded = { rows: [], text: [], needs: '' };
  visible = [];
}
