// Robustness in one place: the app-wide error boundary with a local error log, double-submit protection,
// and debounce for search fields. Nothing here changes business data.
import * as db from './db.js';
import * as i18n from './i18n.js';
import * as ui from './ui.js';

const MAX_LOG_ROWS = 200;
const TOAST_GAP_MS = 4000;
const REPEAT_WINDOW_MS = 800;

/** Writes an error to the local error log (IndexedDB, device only). Keeps the newest 200 rows. Never throws. */
export async function logError(err, context = '') {
  try {
    await db.transaction(async (ctx) => {
      ctx.put('errorLog', {
        id: db.newId(),
        at: new Date().toISOString(),
        context,
        name: String(err?.name ?? 'Error'),
        code: String(err?.code ?? ''),
        message: String(err?.message ?? err).slice(0, 500),
        stack: String(err?.stack ?? '').slice(0, 2000),
      });
      const rows = await ctx.getAll('errorLog');
      if (rows.length > MAX_LOG_ROWS) {
        rows.sort((a, b) => a.at.localeCompare(b.at));
        for (const row of rows.slice(0, rows.length - MAX_LOG_ROWS)) ctx.remove('errorLog', row.id);
      }
    });
  } catch {
    /* the log must never make an error worse */
  }
}

/** The error log, newest first. For a support screen or a copy-to-clipboard report. */
export const readErrorLog = async () => (await db.getAll('errorLog')).sort((a, b) => b.at.localeCompare(a.at));

let lastToastAt = 0;

function report(err, where) {
  console.error(`[app] ${where}`, err);
  logError(err, where);
  // A burst of errors shows one message, not a stack of toasts.
  if (Date.now() - lastToastAt < TOAST_GAP_MS) return;
  lastToastAt = Date.now();
  const message = err?.code === 'storageFull' ? i18n.t('errors.storageFull') : i18n.t('errors.unexpected');
  ui.toast(message, { type: 'error', timeout: 7000 });
}

/** Catches uncaught errors and unhandled promise rejections anywhere in the app. Call once at boot. */
export function installErrorBoundary() {
  window.addEventListener('error', (event) => report(event.error ?? event.message, 'window'));
  window.addEventListener('unhandledrejection', (event) => report(event.reason, 'promise'));
}

/**
 * Stops a second submit of the same form, or a second click on a primary action, within a short window.
 * The first one runs; repeats from a double tap or Enter held down are dropped before any handler sees them.
 */
export function guardDoubleSubmit() {
  const lastSubmit = new WeakMap();
  document.addEventListener(
    'submit',
    (event) => {
      const now = Date.now();
      if (now - (lastSubmit.get(event.target) ?? 0) < REPEAT_WINDOW_MS) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      lastSubmit.set(event.target, now);
    },
    true,
  );

  const lastClick = new WeakMap();
  document.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest?.('button.btn-primary[data-action]');
      if (!button) return;
      const now = Date.now();
      if (now - (lastClick.get(button) ?? 0) < REPEAT_WINDOW_MS) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      lastClick.set(button, now);
    },
    true,
  );
}

/** Returns fn wrapped so it runs once `ms` after the last call. The wrapper has a cancel() method. */
export function debounce(fn, ms = 200) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}
