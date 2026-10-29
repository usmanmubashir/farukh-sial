// Bar chart in plain SVG. Bars grow up from the baseline when `animateBars` is called after the chart is in the DOM.
// The growth is a CSS transition, switched off by prefers-reduced-motion (see pages.css).
import { esc } from './ui.js';

const WIDTH = 720;

/**
 * items: [{ label, value, title? }]. format(value) gives the label shown above a bar on hover (in <title>).
 * Returns html. Call animateBars(container) after inserting it.
 */
export function barChart(items, { height = 180, format = (v) => String(v), ariaLabel = '' } = {}) {
  if (items.length === 0) return '';
  const max = Math.max(1, ...items.map((item) => Math.abs(item.value)));
  const slot = WIDTH / items.length;
  const barWidth = Math.max(2, slot * 0.7);
  // Label every nth bar so the axis stays readable with a year of days.
  const every = Math.max(1, Math.ceil(items.length / 12));
  const bars = items
    .map((item, i) => {
      const h = Math.max(1, (Math.abs(item.value) / max) * (height - 22));
      const x = i * slot + (slot - barWidth) / 2;
      const y = height - 18 - h;
      const negative = item.value < 0 ? ' is-negative' : '';
      return `<rect class="chart-bar${negative}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" style="--delay:${Math.min(i * 22, 400)}ms"><title>${esc(item.label)}: ${esc(item.title ?? format(item.value))}</title></rect>`;
    })
    .join('');
  const labels = items
    .map((item, i) => (i % every === 0
      ? `<text class="chart-label" x="${(i * slot + slot / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle">${esc(item.label)}</text>`
      : ''))
    .join('');
  return `
    <svg class="chart" viewBox="0 0 ${WIDTH} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(ariaLabel)}">
      <line class="chart-base" x1="0" x2="${WIDTH}" y1="${height - 18}" y2="${height - 18}"></line>
      ${bars}
      ${labels}
    </svg>`;
}

/** Starts the bar growth. Safe to call on any container that holds a chart. */
export function animateBars(container) {
  const root = container?.jquery ? container[0] : container;
  if (!root) return;
  requestAnimationFrame(() => {
    root.querySelectorAll('.chart-bar').forEach((bar) => bar.classList.add('is-in'));
  });
}
