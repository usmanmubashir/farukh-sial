// Charts for the reports, in plain SVG with no library:
//   lineChart: several series over the same days (charged, cost, profit).
//   stackedBars: one column per period, split into parts (sales and practice).
//   hbarChart: horizontal bars for a ranking (top sellers). Bars grow from the left with a transform, not a width.
// Each chart carries a text alternative (aria-label) and a <title> per mark, so hovering shows the figure.
import { esc } from './ui.js';

const W = 720;

/** Scales values to a height. Empty or all-zero input gives a flat chart. */
const scale = (max, value, height) => (max > 0 ? (Math.abs(value) / max) * height : 0);

/**
 * series: [{ key, label, values: [number] }] over the same labels. format(value) gives the tooltip text.
 * Returns the chart markup. Empty input returns ''.
 */
export function lineChart({ labels = [], series = [], height = 200, format = (v) => String(v), ariaLabel = '' } = {}) {
  if (labels.length === 0 || series.length === 0) return '';
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => Math.abs(v))));
  const pad = 26;
  const step = labels.length > 1 ? (W - pad * 2) / (labels.length - 1) : 0;
  const y = (value) => height - pad - (value / max) * (height - pad * 2);
  const paths = series.map((s) => {
    const points = s.values.map((v, i) => `${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`);
    const dots = s.values.map((v, i) => `<circle class="trend-dot trend-dot--${esc(s.key)}" cx="${(pad + i * step).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5">
      <title>${esc(`${labels[i]} · ${s.label}: ${format(v)}`)}</title></circle>`).join('');
    return `<polyline class="trend-line trend-line--${esc(s.key)}" points="${points.join(' ')}" fill="none"/>${dots}`;
  });
  const every = Math.max(1, Math.ceil(labels.length / 10));
  const axis = labels
    .map((label, i) => (i % every === 0 ? `<text class="chart-label" x="${(pad + i * step).toFixed(1)}" y="${height - 4}" text-anchor="middle">${esc(label)}</text>` : ''))
    .join('');
  const legend = series.map((s) => `<span class="trend-key"><span class="mix-swatch trend-swatch--${esc(s.key)}" aria-hidden="true"></span>${esc(s.label)}</span>`).join('');
  return `
    <figure class="trend">
      <svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(ariaLabel)}" focusable="false" class="trend-svg">
        <line class="chart-axis" x1="${pad}" x2="${W - pad}" y1="${height - pad}" y2="${height - pad}"/>
        ${paths.join('')}
        ${axis}
      </svg>
      <figcaption class="trend-legend">${legend}</figcaption>
    </figure>`;
}

/**
 * periods: [{ label, parts: [{ key, label, value }] }]. The column height is the total of the parts. Parts stack
 * from the baseline. Returns the chart markup. Empty input returns ''.
 */
export function stackedBars({ periods = [], height = 200, format = (v) => String(v), ariaLabel = '' } = {}) {
  if (periods.length === 0) return '';
  const totals = periods.map((p) => p.parts.reduce((sum, part) => sum + Math.max(0, part.value), 0));
  const max = Math.max(1, ...totals);
  const pad = 26;
  const slot = (W - pad * 2) / periods.length;
  const barWidth = Math.max(2, slot * 0.66);
  const every = Math.max(1, Math.ceil(periods.length / 12));
  const bars = periods.map((p, i) => {
    let base = height - pad;
    const x = pad + i * slot + (slot - barWidth) / 2;
    const segments = p.parts.map((part) => {
      const h = Math.max(0, scale(max, part.value, height - pad * 2));
      base -= h;
      return `<rect class="stack-part stack-part--${esc(part.key)}" x="${x.toFixed(1)}" y="${base.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" style="--delay:${i * 30}ms">
        <title>${esc(`${p.label} · ${part.label}: ${format(part.value)}`)}</title></rect>`;
    }).join('');
    const label = i % every === 0 ? `<text class="chart-label" x="${(pad + i * slot + slot / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle">${esc(p.label)}</text>` : '';
    return segments + label;
  });
  const legend = periods[0].parts.map((part) => `<span class="trend-key"><span class="mix-swatch mix-swatch--${esc(part.key)}" aria-hidden="true"></span>${esc(part.label)}</span>`).join('');
  return `
    <figure class="trend">
      <svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(ariaLabel)}" focusable="false" class="trend-svg">
        <line class="chart-axis" x1="${pad}" x2="${W - pad}" y1="${height - pad}" y2="${height - pad}"/>
        ${bars.join('')}
      </svg>
      <figcaption class="trend-legend">${legend}</figcaption>
    </figure>`;
}

/**
 * rows: [{ label, value }] already in rank order. Bars are scaled to the largest value. Returns the markup.
 * Each bar grows from the left with a transform (see the styles); reduced motion shows the bars at once.
 */
export function hbarChart(rows = [], { format = (v) => String(v), ariaLabel = '' } = {}) {
  if (rows.length === 0) return '';
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const items = rows.map((row, i) => {
    const share = Math.max(0, Math.min(100, (Math.abs(row.value) / max) * 100));
    return `<li class="hbar">
      <span class="hbar-rank">${esc(row.rank ?? i + 1)}</span>
      <span class="hbar-label">${esc(row.label)}</span>
      <span class="hbar-track" aria-hidden="true"><span class="hbar-fill${row.tone ? ` hbar-fill--${esc(row.tone)}` : ''}" style="--share:${(share / 100).toFixed(4)};--delay:${i * 40}ms"></span></span>
      <span class="hbar-value">${esc(format(row.value))}</span>
    </li>`;
  });
  return `<ol class="hbars" aria-label="${esc(ariaLabel)}">${items.join('')}</ol>`;
}
