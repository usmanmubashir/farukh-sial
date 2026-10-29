// Page and element transitions with the Web Animations API.
// Every animation is skipped when the user prefers reduced motion.
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
const node = (el) => (el && el.jquery ? el[0] : el);

export function animate(el, frames, options = {}) {
  const target = node(el);
  if (!target || typeof target.animate !== 'function' || reducedMotion()) return Promise.resolve();
  const duration = options.duration ?? 200;
  const animation = target.animate(frames, {
    duration,
    easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    ...options,
  });
  // Navigation must never wait on an animation. A hidden tab may not advance it, so cap the wait.
  const cap = new Promise((resolve) => setTimeout(resolve, duration + 100));
  return Promise.race([animation.finished.catch(() => undefined), cap]);
}

export const enter = (el) =>
  animate(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220 });

export const leave = (el) => animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 });
