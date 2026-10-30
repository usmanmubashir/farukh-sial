// Donut chart in plain SVG, no library. Two parts:
//   shares(values): how much of the whole each part is, in tenths of a percent, rounded so the parts always add up to
//     exactly 1000 (100.0%). Largest-remainder rounding, so no slice is off by a tenth because of rounding.
//   donutMarkup(...): the SVG. Each segment is a circle with a dash pattern; its sweep is a stroke-dashoffset transition
//     that the caller starts after the chart is in the DOM (see startDonutSweep).
// The sweep animates stroke-dashoffset, which is what makes a donut draw in. It is switched off by reduced motion.
import { esc } from './ui.js';

export const SHARE_TOTAL = 1000;

/** Shares of the whole in tenths of a percent. Negative and empty values count as 0. All zero gives all zeros. */
export function shares(values) {
  const parts = values.map((v) => Math.max(0, Number(v) || 0));
  const total = parts.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return parts.map(() => 0);
  const exact = parts.map((v) => (v / total) * SHARE_TOTAL);
  const floors = exact.map(Math.floor);
  let left = SHARE_TOTAL - floors.reduce((sum, v) => sum + v, 0);
  // Give the leftover tenths to the largest remainders; ties go to the earlier slice.
  const order = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

/** Percent text for a share in tenths: 1000 → "100.0%". */
export const percentText = (tenths) => `${(tenths / 10).toFixed(1)}%`;

/**
 * SVG markup for a donut.
 * slices: [{ key, label, size }] where size is the drawn magnitude (absolute value). Their shares are computed here.
 * Returns { html, shares } so the caller can show the same numbers in the legend and the table.
 */
export function donutMarkup({ slices, size = 200, thickness = 26, ariaLabel = '' }) {
  const radius = (size - thickness) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const partShares = shares(slices.map((s) => s.size));
  const empty = partShares.every((s) => s === 0);
  let start = 0;
  const segments = slices.map((slice, i) => {
    const share = partShares[i];
    if (share === 0) return '';
    const length = (circumference * share) / SHARE_TOTAL;
    const rotation = -90 + (start * 360) / SHARE_TOTAL;
    start += share;
    return `<g class="donut-hit" data-key="${esc(slice.key)}" tabindex="0" role="button" aria-label="${esc(`${slice.label}: ${percentText(share)}`)}"
        transform="rotate(${rotation.toFixed(3)} ${center} ${center})">
        <circle class="donut-seg donut-seg--${esc(slice.key)}" cx="${center}" cy="${center}" r="${radius.toFixed(3)}"
          stroke-width="${thickness}" stroke-dasharray="${length.toFixed(3)} ${(circumference - length).toFixed(3)}"
          data-length="${length.toFixed(3)}" data-circumference="${circumference.toFixed(3)}"
          style="stroke-dashoffset:${length.toFixed(3)}"/>
      </g>`;
  });
  const html = `
    <svg class="donut${empty ? ' is-empty' : ''}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"
      aria-label="${esc(ariaLabel)}" focusable="false">
      <circle class="donut-track" cx="${center}" cy="${center}" r="${radius.toFixed(3)}" stroke-width="${thickness}"/>
      ${empty ? `<circle class="donut-empty-ring" cx="${center}" cy="${center}" r="${radius.toFixed(3)}" stroke-width="${thickness}"/>` : segments.join('')}
    </svg>`;
  return { html, shares: partShares };
}

/**
 * Starts the sweep: each segment's dash offset moves from its length to 0, one after another. Call after the chart is
 * in the DOM. With reduced motion (`instant` true) the segments are drawn at once.
 */
export function startDonutSweep(root, { instant = false } = {}) {
  const segments = [...(root?.querySelectorAll('.donut-seg') ?? [])];
  if (!segments.length) return;
  if (instant) {
    for (const seg of segments) seg.style.strokeDashoffset = '0';
    return;
  }
  requestAnimationFrame(() => {
    segments.forEach((seg, i) => {
      seg.style.transition = `stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 140}ms`;
      seg.style.strokeDashoffset = '0';
    });
  });
}
