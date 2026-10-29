// Motion system: Web Animations API helpers, count-ups, FLIP lists and pointer behaviours.
// Only transform and opacity are animated, except the decorative cases listed in docs/MOTION.md.
// Every helper checks reducedMotion(). When it is on, motion becomes a plain fade or nothing.
// This module does not import ui.js, so ui.js can depend on it.
import { format as formatMoney } from './money.js';

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function reducedMotion() {
  return (
    document.documentElement.classList.contains('reduce-motion') ||
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

const node = (el) => (el && el.jquery ? el[0] : el);
const finePointer = () => globalThis.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;

/** Under reduced motion only opacity survives. Returns null when there is nothing left to animate. */
function fadeOnly(list) {
  if (!reducedMotion()) return list;
  const fades = list.filter((frame) => frame.opacity !== undefined).map((frame) => ({ opacity: frame.opacity }));
  return fades.length ? fades : null;
}

/* ---------- Core ---------- */

/** Animates an element with keyframes. Resolves when done, or after a cap so navigation never waits on it. */
export function animate(el, frames, options = {}) {
  const target = node(el);
  const list = fadeOnly(frames);
  if (!target || typeof target.animate !== 'function' || !list) return Promise.resolve();
  const duration = options.duration ?? 240;
  const animation = target.animate(list, { easing: EASE_OUT, ...options, duration });
  // A hidden tab may not advance an animation, so the wait is capped.
  const cap = new Promise((resolve) => setTimeout(resolve, duration + 100));
  return Promise.race([animation.finished.catch(() => undefined), cap]);
}

/** Page transition in: rise 8px and fade. */
export const enter = (el) =>
  animate(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 240 });

/** Page transition out: fade and slide up 8px. */
export const leave = (el) =>
  animate(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: 160 });

/** Called by the router after a page renders: staggers, counters and indicators. */
export function prepare(root) {
  rise(root);
  scanCounts(root);
  syncIndicators(root);
}

/** Children of [data-anim="rise"] rise in one after another (45ms apart, first 12 only). */
export function rise(root) {
  const scope = node(root);
  if (!scope) return;
  const items = [...scope.querySelectorAll('[data-anim="rise"] > *')].slice(0, 12);
  items.forEach((el, i) => {
    const list = fadeOnly([
      { opacity: 0, transform: 'translateY(14px) scale(0.985)' },
      { opacity: 1, transform: 'none' },
    ]);
    if (!list || typeof el.animate !== 'function') return;
    el.animate(list, { duration: 420, delay: i * 45, easing: EASE_OUT, fill: 'both' });
  });
}

/* ---------- Numbers ---------- */

const groupThousands = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const FORMATTERS = {
  int: (v) => groupThousands(v),
  money: (v) => formatMoney(Math.round(v)),
  'money-plain': (v) => formatMoney(Math.round(v), { symbol: false }),
  percent: (v) => `${v.toFixed(1)}%`,
};

const counting = new WeakMap();

/** Counts from the element's previous value to `to`. A short roll marks each change. */
export function countUp(el, to, { format = 'int', duration = 900 } = {}) {
  const target = node(el);
  if (!target) return;
  const from = Number(target.dataset.value ?? 0);
  const fmt = FORMATTERS[format] ?? FORMATTERS.int;
  target.dataset.value = String(to);
  if (reducedMotion() || from === to) {
    target.textContent = fmt(to);
    return;
  }
  cancelAnimationFrame(counting.get(target) ?? 0);
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - p) ** 4;
    target.textContent = fmt(from + (to - from) * eased);
    if (p < 1) counting.set(target, requestAnimationFrame(step));
    else counting.delete(target);
  };
  counting.set(target, requestAnimationFrame(step));
  if (target.animate) {
    target.animate([{ opacity: 0.4, transform: 'translateY(-30%)' }, { opacity: 1, transform: 'none' }], {
      duration: 260,
      easing: EASE_OUT,
    });
  }
}

/** Counts every [data-count] element inside root. data-format: int (default), money, money-plain, percent. */
export function scanCounts(root) {
  node(root)?.querySelectorAll('[data-count]').forEach((el) => {
    countUp(el, Number(el.dataset.count), { format: el.dataset.format });
  });
}

/* ---------- Lists ---------- */

/**
 * FLIP: children with data-key glide from their old positions to their new ones.
 * Call with a mutate() that adds, removes or reorders the children. New children fade and rise in.
 */
export function flip(container, mutate) {
  const scope = node(container);
  const before = new Map();
  scope.querySelectorAll(':scope > [data-key]').forEach((el) => before.set(el.dataset.key, el.getBoundingClientRect()));
  mutate();
  if (reducedMotion()) return;
  scope.querySelectorAll(':scope > [data-key]').forEach((el) => {
    const first = before.get(el.dataset.key);
    if (first) {
      const dy = first.top - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: EASE_OUT });
    } else {
      el.animate([{ opacity: 0, transform: 'translateY(-8px) scale(0.97)' }, { opacity: 1, transform: 'none' }], {
        duration: 320,
        easing: EASE_OUT,
      });
    }
  });
}

/** Removes an element with a fade and a vertical collapse. */
export function removeWithMotion(el) {
  const target = node(el);
  return animate(target, [
    { opacity: 1, transform: 'scaleY(1)' },
    { opacity: 0, transform: 'scaleY(0.6)' },
  ], { duration: 220 }).then(() => target.remove());
}

/* ---------- Commerce moments ---------- */

/** A thumbnail arcs from the product to the cart. The badge pops when it lands. */
export function flyToCart(fromEl, toEl) {
  const from = node(fromEl).getBoundingClientRect();
  const to = node(toEl).getBoundingClientRect();
  const thumb = document.createElement('div');
  thumb.className = 'fly-thumb';
  thumb.style.left = `${from.left + from.width / 2 - 22}px`;
  thumb.style.top = `${from.top + from.height / 2 - 22}px`;
  document.body.appendChild(thumb);
  if (reducedMotion() || typeof thumb.animate !== 'function') {
    thumb.remove();
    popBadge(toEl);
    return Promise.resolve();
  }
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const animation = thumb.animate(
    [
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 120}px) scale(0.9) rotate(120deg)`, opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.3) rotate(240deg)`, opacity: 0.6 },
    ],
    { duration: 680, easing: EASE_OUT },
  );
  return animation.finished
    .catch(() => undefined)
    .finally(() => {
      thumb.remove();
      popBadge(toEl);
    });
}

export function popBadge(el) {
  return animate(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], {
    duration: 360,
    easing: EASE_SPRING,
  });
}

export function shake(el) {
  return animate(el, [
    { transform: 'translateX(0)' },
    { transform: 'translateX(-7px)' },
    { transform: 'translateX(6px)' },
    { transform: 'translateX(-4px)' },
    { transform: 'translateX(2px)' },
    { transform: 'translateX(0)' },
  ], { duration: 380 });
}

/** Marks a .field or .float-field valid (animated tick) or invalid (shake). */
export function markField(fieldEl, state) {
  const el = node(fieldEl);
  if (!el) return;
  el.classList.toggle('is-invalid', state === 'invalid');
  el.classList.toggle('is-valid', state === 'valid');
  if (state === 'invalid') shake(el);
}

/** Button states: 'loading' (spinner in place of the label), 'success' (check), 'idle'. */
export function buttonState(button, state) {
  const el = node(button);
  if (!el) return;
  el.classList.toggle('is-loading', state === 'loading');
  el.classList.toggle('is-success', state === 'success');
  el.setAttribute('aria-busy', String(state === 'loading'));
  if (state === 'success') setTimeout(() => el.classList.remove('is-success'), 1400);
}

/** Full-screen success: an SVG check draws itself, the receipt slides out, confetti falls. Click or Escape closes it. */
export function celebrate({ title, lines = [], total = '' } = {}) {
  const root = document.createElement('div');
  root.className = 'celebrate';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', title ?? '');
  root.innerHTML = `
    <div class="celebrate-inner">
      <svg class="celebrate-check" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="54"/>
        <path d="M36 62 L54 80 L86 44"/>
      </svg>
      <h2>${esc(title)}</h2>
      <div class="celebrate-receipt">
        ${lines.map(([label, value]) => `<div class="row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`).join('')}
        ${total ? `<div class="row"><strong>${esc(total)}</strong></div>` : ''}
      </div>
    </div>`;

  if (!reducedMotion()) {
    const colours = ['#fcd34d', '#5eead4', '#f9a8d4', '#93c5fd', '#c4b5fd', '#86efac'];
    for (let i = 0; i < 28; i += 1) {
      const pill = document.createElement('span');
      pill.className = 'confetti';
      pill.style.setProperty('--x', `${Math.random() * 100}%`);
      pill.style.setProperty('--c', colours[i % colours.length]);
      pill.style.setProperty('--delay', `${Math.round(Math.random() * 400)}ms`);
      pill.style.setProperty('--t', `${Math.round(2200 + Math.random() * 1400)}ms`);
      pill.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 160)}px`);
      pill.style.setProperty('--rot', `${Math.round(360 + Math.random() * 540)}deg`);
      root.appendChild(pill);
    }
  }

  document.body.appendChild(root);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    const fade = root.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 220 });
    if (fade) fade.onfinish = () => root.remove();
    else root.remove();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  root.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  setTimeout(close, 4000);
  return close;
}

/* ---------- Indicators (segmented control, tabs, sidebar) ---------- */

/** Moves a sliding indicator under `target`. Sets --ind-x and --ind-w on the container. */
export function moveIndicator(container, target) {
  const scope = node(container);
  const item = node(target);
  if (!scope || !item) return;
  const rtl = getComputedStyle(scope).direction === 'rtl';
  const x = rtl ? -(scope.clientWidth - item.offsetLeft - item.offsetWidth) : item.offsetLeft;
  scope.style.setProperty('--ind-x', `${x}px`);
  scope.style.setProperty('--ind-w', `${item.offsetWidth}px`);
}

export function syncIndicators(root) {
  node(root)?.querySelectorAll('.seg, .tabs').forEach((container) => {
    const active = container.querySelector('[aria-checked="true"], [aria-selected="true"]');
    if (active) moveIndicator(container, active);
  });
}

/* ---------- Pointer behaviours (installed once) ---------- */

let installed = false;

/** Wires ripples, tilt, magnetic hover and segmented/tab selection. Call once at boot. */
export function install() {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerout', onPointerOut, { passive: true });
  document.addEventListener('click', onClick);
}

function onPointerDown(event) {
  if (reducedMotion()) return;
  const host = event.target.closest?.('.btn, .chip, .tile, .nav-link, .bottom-link, .bottom-menu');
  if (!host || host.disabled) return;
  const rect = host.getBoundingClientRect();
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.left = `${event.clientX - rect.left}px`;
  span.style.top = `${event.clientY - rect.top}px`;
  host.appendChild(span);
  span.addEventListener('animationend', () => span.remove());
}

function onPointerMove(event) {
  if (!finePointer() || reducedMotion()) return;
  const tile = event.target.closest?.('.tile');
  if (tile) {
    const r = tile.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width;
    const y = (event.clientY - r.top) / r.height;
    tile.style.setProperty('--rx', `${((0.5 - y) * 10).toFixed(2)}deg`);
    tile.style.setProperty('--ry', `${((x - 0.5) * 12).toFixed(2)}deg`);
  }
  const magnet = event.target.closest?.('[data-magnetic]');
  if (magnet) {
    const r = magnet.getBoundingClientRect();
    const dx = (event.clientX - (r.left + r.width / 2)) * 0.25;
    const dy = (event.clientY - (r.top + r.height / 2)) * 0.25;
    magnet.style.setProperty('--mx', `${clamp(dx, -8, 8).toFixed(1)}px`);
    magnet.style.setProperty('--my', `${clamp(dy, -8, 8).toFixed(1)}px`);
  }
}

function onPointerOut(event) {
  const left = event.target.closest?.('.tile, [data-magnetic]');
  if (!left || left.contains(event.relatedTarget)) return;
  left.style.removeProperty('--rx');
  left.style.removeProperty('--ry');
  left.style.removeProperty('--mx');
  left.style.removeProperty('--my');
}

function onClick(event) {
  const option = event.target.closest?.('.seg-option, .tab');
  if (!option) return;
  const container = option.closest('.seg, .tabs');
  if (!container) return;
  const attr = option.classList.contains('tab') ? 'aria-selected' : 'aria-checked';
  container.querySelectorAll(`[${attr}]`).forEach((el) => el.setAttribute(attr, 'false'));
  option.setAttribute(attr, 'true');
  moveIndicator(container, option);
}
