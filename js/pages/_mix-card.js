// Sales vs Practice card for the dashboard. A donut splits revenue (or profit, or count) between sales and practice for
// a chosen period. It shows a legend, a text table, and counts the numbers up. It owns its controls, and it survives the
// dashboard's own refreshes: the dashboard re-renders around it, then calls mount().
import * as i18n from '../core/i18n.js';
import { esc } from '../core/ui.js';
import * as anim from '../core/anim.js';
import { format } from '../core/money.js';
import { addDays, todayISO } from '../core/dates.js';
import { donutMarkup, percentText, startDonutSweep } from '../core/donut.js';
import { salesVsPractice } from '../services/dashboard.js';

const t = i18n.t;
const PERIODS = ['today', 'week', 'month', 'custom'];
const METRICS = ['revenue', 'profit', 'count'];
const THICKNESS = 26;

const state = {
  period: 'month',
  metric: 'revenue',
  view: 'chart',
  from: '',
  to: '',
  data: null,
  seq: 0,
  active: null, // the part being shown: set by hover, focus or a tap
  pinned: false, // a tap pinned it: hover no longer changes it
  error: null,
};

let $root = null;

/** The range a period means, as YYYY-MM-DD. Custom uses the two dates the owner typed. */
function rangeFor(period) {
  const today = todayISO();
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') return { from: addDays(today, -6), to: today };
  if (period === 'custom') return { from: state.from || `${today.slice(0, 8)}01`, to: state.to || today };
  return { from: `${today.slice(0, 8)}01`, to: today };
}

const periodLabel = () => t(`mix.period.${state.period}`);
const formatValue = (value) => (state.metric === 'count' ? String(value) : format(value, { symbol: false }));
const countAttr = (value) => (state.metric === 'count' ? 'int' : 'money-plain');
const keyOf = (el) => el.getAttribute('data-key') ?? el.getAttribute('data-mix-key');

/** The two parts for the current metric: [{ key, label, value }]. Profit can be negative; the donut draws its size. */
function partsOf(data) {
  const pick = (figures) => (state.metric === 'revenue' ? figures.revenue : state.metric === 'profit' ? figures.profit : figures.count);
  return [
    { key: 'sales', label: t('mix.sales'), value: pick(data.sales) },
    { key: 'practice', label: t('mix.practice'), value: pick(data.practice) },
  ];
}

/** Turns the parts into what the card shows: drawn sizes, shares and the total. */
function summarise(parts) {
  const drawn = parts.map((p) => ({ ...p, size: Math.abs(p.value) }));
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const sized = donutMarkup({
    slices: drawn,
    size: 200,
    thickness: THICKNESS,
    ariaLabel: t('mix.chartLabel', {
      period: periodLabel(),
      parts: drawn.map((p) => `${p.label} ${formatValue(p.value)}`).join(', '),
    }),
  });
  return { drawn, total, html: sized.html, shares: sized.shares };
}

function controlsHtml() {
  const period = PERIODS.map((key) => `<button type="button" class="mix-seg${state.period === key ? ' is-on' : ''}" data-mix-period="${key}" aria-pressed="${state.period === key}">${esc(t(`mix.period.${key}`))}</button>`).join('');
  const metric = METRICS.map((key) => `<button type="button" class="mix-seg${state.metric === key ? ' is-on' : ''}" data-mix-metric="${key}" aria-pressed="${state.metric === key}">${esc(t(`mix.metric.${key}`))}</button>`).join('');
  return `
    <div class="mix-controls">
      <div class="mix-group" role="group" aria-label="${esc(t('mix.periodLabel'))}">${period}</div>
      <div class="mix-group" role="group" aria-label="${esc(t('mix.metricLabel'))}">${metric}</div>
    </div>
    ${state.period === 'custom' ? `
    <div class="mix-range">
      <label class="field"><span>${esc(t('mix.from'))}</span><input type="date" name="mixFrom" value="${esc(state.from)}"></label>
      <label class="field"><span>${esc(t('mix.to'))}</span><input type="date" name="mixTo" value="${esc(state.to)}"></label>
    </div>` : ''}`;
}

function chartHtml(summary) {
  const { drawn, total, html, shares } = summary;
  const empty = drawn.every((p) => p.size === 0);
  const legend = drawn
    .map((p, i) => `
      <li><button type="button" class="mix-legend-item${state.active === p.key ? ' is-on' : ''}" data-mix-key="${p.key}">
        <span class="mix-swatch mix-swatch--${p.key}" aria-hidden="true"></span>
        <span class="mix-legend-label">${esc(p.label)}</span>
        <span class="mix-legend-value" data-count="${esc(p.value)}" data-format="${countAttr(p.value)}">${esc(formatValue(p.value))}</span>
        <span class="mix-legend-share">${esc(percentText(shares[i]))}</span>
      </button></li>`)
    .join('');
  const practice = drawn.find((p) => p.key === 'practice');
  const lossNote = state.metric === 'profit' && practice && practice.value < 0
    ? `<p class="mix-note" role="note">${esc(t('mix.lossNote', { amount: format(-practice.value, { symbol: false }) }))}</p>`
    : '';
  return `
    <div class="mix-chart">
      <div class="mix-donut" data-mix-donut>
        ${html}
        <div class="mix-center">
          <strong class="mix-total" data-count="${esc(total)}" data-format="${countAttr(total)}">${esc(formatValue(total))}</strong>
          <span class="mix-center-label">${esc(empty ? t('mix.empty') : periodLabel())}</span>
        </div>
        <div class="mix-tip" role="status" hidden></div>
      </div>
      <ul class="mix-legend" aria-label="${esc(t('mix.legendLabel'))}">${legend}</ul>
    </div>
    ${lossNote}`;
}

function tableHtml(summary) {
  const { drawn, total, shares } = summary;
  const rows = drawn
    .map((p, i) => `<tr><th scope="row"><span class="mix-swatch mix-swatch--${p.key}" aria-hidden="true"></span> ${esc(p.label)}</th>
      <td class="num" data-count="${esc(p.value)}" data-format="${countAttr(p.value)}">${esc(formatValue(p.value))}</td>
      <td class="num">${esc(percentText(shares[i]))}</td></tr>`)
    .join('');
  const totalShare = drawn.some((p) => p.size > 0) ? 1000 : 0;
  return `
    <div class="table-wrap"><table class="table mix-table">
      <caption class="sr-only">${esc(periodLabel())}</caption>
      <thead><tr><th scope="col">${esc(t('mix.part'))}</th><th scope="col" class="num">${esc(t('mix.value'))}</th><th scope="col" class="num">${esc(t('mix.share'))}</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th scope="row">${esc(t('mix.total'))}</th><td class="num" data-count="${esc(total)}" data-format="${countAttr(total)}">${esc(formatValue(total))}</td><td class="num">${esc(percentText(totalShare))}</td></tr></tfoot>
    </table></div>`;
}

function markup() {
  const head = `
    <div class="mix-head">
      <div>
        <h2 id="mix-title">${esc(t('mix.title'))}</h2>
        <p class="muted small">${esc(t('mix.sub'))}</p>
      </div>
      <button type="button" class="mix-seg" data-mix-view="${state.view === 'chart' ? 'table' : 'chart'}">${esc(t(state.view === 'chart' ? 'mix.showTable' : 'mix.showChart'))}</button>
    </div>`;
  if (state.error) return `${head}${controlsHtml()}<p class="mix-note" role="alert">${esc(state.error)}</p>`;
  if (!state.data) return `${head}${controlsHtml()}<div class="skeleton skeleton-card" aria-hidden="true"></div>`;
  const summary = summarise(partsOf(state.data));
  return `${head}${controlsHtml()}${state.view === 'chart' ? chartHtml(summary) : tableHtml(summary)}`;
}

/** Shows one part as active: its segment pops, the others fade, and its legend row is marked. */
function highlight(key) {
  state.active = key;
  if (!$root) return;
  $root.attr('data-active', key || null);
  $root.find('.mix-legend-item').each(function mark() {
    this.classList.toggle('is-on', this.getAttribute('data-mix-key') === key);
  });
  const $tip = $root.find('.mix-tip');
  if (!key || !state.data) {
    $tip.prop('hidden', true).text('');
    return;
  }
  const summary = summarise(partsOf(state.data));
  const i = summary.drawn.findIndex((p) => p.key === key);
  if (i < 0) return;
  $tip.prop('hidden', false).text(`${summary.drawn[i].label} · ${formatValue(summary.drawn[i].value)} · ${percentText(summary.shares[i])}`);
}

/** Re-renders the card. Keeps keyboard focus on the control the owner used, when it still exists. */
function render() {
  if (!$root) return;
  const focused = document.activeElement;
  let focusSelector = null;
  if (focused && $root[0].contains(focused)) {
    const attr = [...focused.attributes].find((a) => a.name.startsWith('data-mix-'));
    if (attr) focusSelector = `[${attr.name}="${attr.value}"]`;
  }
  $root.html(markup());
  if (focusSelector) $root.find(focusSelector).first().trigger('focus');
  anim.scanCounts($root[0]);
  if (state.view === 'chart' && state.data) {
    startDonutSweep($root.find('.mix-donut')[0], { instant: anim.reducedMotion() });
  }
  if (state.active) highlight(state.active);
}

async function load() {
  const seq = (state.seq += 1);
  if (state.period === 'custom' && state.from && state.to && state.from > state.to) {
    state.error = t('mix.badRange');
    render();
    return;
  }
  state.error = null;
  try {
    const data = await salesVsPractice(rangeFor(state.period));
    if (seq !== state.seq) return;
    state.data = data;
  } catch (err) {
    console.error('[mix] load failed', err);
    if (seq !== state.seq) return;
    state.error = t('errors.generic');
  }
  render();
}

/** Binds the card's controls on the dashboard's persistent root. Call once. */
export function bind($host) {
  $host.on('click', '[data-mix-period]', (event) => {
    state.period = event.currentTarget.getAttribute('data-mix-period');
    if (state.period === 'custom' && !state.from) {
      const range = rangeFor('month');
      state.from = range.from;
      state.to = range.to;
    }
    state.data = null;
    state.active = null;
    state.pinned = false;
    load();
  });
  $host.on('change', '[name="mixFrom"], [name="mixTo"]', (event) => {
    if (event.currentTarget.name === 'mixFrom') state.from = event.currentTarget.value;
    else state.to = event.currentTarget.value;
    state.data = null;
    load();
  });
  $host.on('click', '[data-mix-metric]', (event) => {
    state.metric = event.currentTarget.getAttribute('data-mix-metric');
    state.active = null;
    state.pinned = false;
    render();
  });
  $host.on('click', '[data-mix-view]', (event) => {
    state.view = event.currentTarget.getAttribute('data-mix-view');
    render();
  });
  // Hover and keyboard focus preview a part. A tap or click pins it; a second tap on the same part clears it.
  $host.on('mouseenter focus', '.mix-donut .donut-hit, .mix-legend-item', (event) => {
    if (!state.pinned) highlight(keyOf(event.currentTarget));
  });
  $host.on('mouseleave blur', '.mix-donut .donut-hit, .mix-legend-item', () => {
    if (!state.pinned) highlight(null);
  });
  $host.on('click', '.mix-donut .donut-hit, .mix-legend-item', (event) => {
    const key = keyOf(event.currentTarget);
    if (state.pinned && state.active === key) {
      state.pinned = false;
      highlight(null);
    } else {
      state.pinned = true;
      highlight(key);
    }
  });
  $host.on('keydown', '.mix-donut .donut-hit', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      $(event.currentTarget).trigger('click');
    }
  });
}

/** The card's placeholder for the dashboard. Its content is drawn by mount(). */
export function html() {
  return '<section class="dash-block mix-card" data-anim="rise" data-mix-root aria-labelledby="mix-title"></section>';
}

/** Attaches the card to the freshly rendered dashboard and loads its figures. */
export async function mount($host) {
  $root = $host.find('[data-mix-root]');
  if (!$root.length) return;
  $root.html(markup());
  await load();
}

/** Forgets the card when the dashboard is left. Controls keep their last choice for the next visit. */
export function destroy() {
  $root = null;
  state.data = null;
  state.error = null;
}
