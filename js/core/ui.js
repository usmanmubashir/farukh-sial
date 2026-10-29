// Shared UI helpers: escaping, icons, toasts, modal dialogs, busy bar and theme.
import { t } from './i18n.js';
import { format } from './money.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const THEME_KEY = 'shifa.theme';
const THEMES = ['auto', 'light', 'dark'];

let busyCount = 0;
let modalSeq = 0;

/** HTML-escapes any value. Use it on every piece of user data placed in a template string. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** Money as an HTML span (LTR, tabular digits). */
export function money(paisa, options) {
  return `<span class="money">${esc(format(paisa, options))}</span>`;
}

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h9.9a1 1 0 0 0 1-.8L22 7H6"/>',
  purchase: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  returns: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  products: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  stock: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/>',
  customers: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  suppliers: '<path d="M3 7h13v10H3zM16 10h3l2 3v4h-5z"/><circle cx="7" cy="18" r="1.5"/><circle cx="18" cy="18" r="1.5"/>',
  ledger: '<path d="M4 4h12l4 4v12H4z"/><path d="M8 12h8M8 16h8M8 8h4"/>',
  vouchers: '<path d="M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 0 0-4V4H3z"/>',
  demand: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  backup: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

/** Inline SVG icon (decorative). */
export function icon(name) {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Shows a message for a few seconds. Returns a function that dismisses it early. */
export function toast(message, { type = 'info', timeout = 3500 } = {}) {
  const $item = $(
    `<div class="toast toast-${type}" role="status"><span class="toast-msg"></span><button type="button" class="toast-close">×</button></div>`,
  );
  $item.find('.toast-msg').text(message);
  $item
    .find('.toast-close')
    .attr('aria-label', t('a11y.toastClose'))
    .on('click', remove);
  $('#toast-root').append($item);

  let timer = timeout > 0 ? setTimeout(remove, timeout) : null;
  function remove() {
    clearTimeout(timer);
    $item.remove();
  }

  // Swipe sideways to dismiss. Short swipes spring back.
  const item = $item[0];
  let startX = null;
  item.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    startX = event.clientX;
    clearTimeout(timer);
    item.setPointerCapture?.(event.pointerId);
    item.classList.add('is-dragging');
  });
  item.addEventListener('pointermove', (event) => {
    if (startX === null) return;
    item.style.transform = `translateX(${event.clientX - startX}px)`;
    item.style.opacity = String(Math.max(0.2, 1 - Math.abs(event.clientX - startX) / 220));
  });
  const release = (event) => {
    if (startX === null) return;
    const dx = event.clientX - startX;
    startX = null;
    item.classList.remove('is-dragging');
    if (Math.abs(dx) > 90) {
      const dir = dx > 0 ? 1 : -1;
      item.animate([{ transform: item.style.transform, opacity: item.style.opacity }, { transform: `translateX(${dir * 420}px)`, opacity: 0 }], {
        duration: 200,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      }).onfinish = remove;
    } else {
      item.animate([{ transform: item.style.transform }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
      item.style.transform = '';
      item.style.opacity = '';
      if (timeout > 0) timer = setTimeout(remove, 1500);
    }
  };
  item.addEventListener('pointerup', release);
  item.addEventListener('pointercancel', release);
  return remove;
}

function trapFocus(event, container) {
  const items = [
    ...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ].filter((el) => !el.disabled);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Opens a modal dialog. body: a string (shown as text) or an element/jQuery object.
 * actions: [{ label, variant: 'primary' | 'danger' | 'ghost', onClick }]. A click closes the dialog
 * unless onClick returns false. Escape and the backdrop also close it.
 */
export function openModal({ title, body, actions = [], onClose } = {}) {
  const id = (modalSeq += 1);
  const previous = document.activeElement;
  const $modal = $(`
    <div class="modal-backdrop">
      <div class="modal card" role="dialog" aria-modal="true" aria-labelledby="modal-title-${id}" tabindex="-1">
        <span class="sheet-handle" aria-hidden="true"></span>
        <header class="modal-head">
          <h2 class="modal-title" id="modal-title-${id}"></h2>
          <button type="button" class="btn btn-ghost icon-btn modal-x"></button>
        </header>
        <div class="modal-body"></div>
        <div class="modal-actions"></div>
      </div>
    </div>`);
  const $dialog = $modal.find('.modal');

  $modal.find('.modal-title').text(title ?? '');
  $modal
    .find('.modal-x')
    .attr('aria-label', t('a11y.modalClose'))
    .html(icon('close'))
    .on('click', () => close());

  const $body = $modal.find('.modal-body');
  if (body && (body.jquery || body instanceof Element)) {
    $body.append(body);
  } else if (body != null) {
    $body.text(String(body));
  }

  const $actions = $modal.find('.modal-actions');
  for (const action of actions) {
    $('<button type="button" class="btn"></button>')
      .addClass(action.variant ? `btn-${action.variant}` : '')
      .text(action.label)
      .on('click', () => {
        if (action.onClick?.() !== false) close();
      })
      .appendTo($actions);
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    $(document).off(`keydown.modal${id}`);
    $modal.remove();
    onClose?.();
    previous?.focus?.();
  }

  $modal.on('click', (event) => {
    if (event.target === $modal[0]) close();
  });
  $(document).on(`keydown.modal${id}`, (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') trapFocus(event, $dialog[0]);
  });

  $('#modal-root').append($modal);
  $dialog[0].focus();
  attachSheetDrag($dialog[0], close);
  return { close };
}

/**
 * On phones the dialog is a bottom sheet. Dragging its handle down past 120px closes it,
 * and a short drag springs back. Desktop dialogs are not affected.
 */
function attachSheetDrag(sheet, close) {
  const handle = sheet.querySelector('.sheet-handle') ?? sheet.querySelector('.modal-head');
  if (!handle) return;
  let startY = null;
  handle.addEventListener('pointerdown', (event) => {
    if (!globalThis.matchMedia?.('(max-width: 639px)').matches) return;
    startY = event.clientY;
    handle.setPointerCapture?.(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (startY === null) return;
    sheet.style.transform = `translateY(${Math.max(0, event.clientY - startY)}px)`;
  });
  const release = (event) => {
    if (startY === null) return;
    const dy = Math.max(0, event.clientY - startY);
    startY = null;
    if (dy > 120) {
      sheet.style.transform = '';
      close();
      return;
    }
    sheet.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
      duration: 320,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
    sheet.style.transform = '';
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
}

/** Yes/no dialog. Resolves true only when the user confirms. */
export function confirmDialog({ title, message, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: message,
      actions: [
        { label: t('btn.cancel'), variant: 'ghost', onClick: () => resolve(false) },
        {
          label: confirmLabel ?? t('btn.confirm'),
          variant: danger ? 'danger' : 'primary',
          onClick: () => resolve(true),
        },
      ],
      onClose: () => resolve(false),
    });
  });
}

/** Shows the top loading bar while work is in progress. Calls nest. */
export function setBusy(on) {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  $('#loading-bar').toggleClass('is-busy', busyCount > 0);
}

export function getTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.includes(saved) ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

export function setTheme(mode) {
  const next = THEMES.includes(mode) ? mode : 'auto';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
  document.documentElement.dataset.theme = next;
}

export function initTheme() {
  setTheme(getTheme());
}

/** Shimmering placeholder lines for an async region. */
export function skeleton(lines = 3) {
  const rows = Array.from({ length: lines }, (_, i) => `<div class="skeleton skeleton-line" style="width:${100 - i * 12}%"></div>`);
  return `<div class="stack" aria-hidden="true">${rows.join('')}</div>`;
}

/** Empty state with the dashed morphing blob. Returns markup. */
export function emptyState({ iconName = 'products', title, text = '', actionLabel = '', actionHref = '#/dashboard' } = {}) {
  return `
    <section class="empty-state">
      <div class="empty-blob">${icon(iconName)}</div>
      <h2>${esc(title)}</h2>
      ${text ? `<p class="muted">${esc(text)}</p>` : ''}
      ${actionLabel ? `<a class="btn btn-primary" href="${esc(actionHref)}">${esc(actionLabel)}</a>` : ''}
    </section>`;
}

/**
 * Command palette (Ctrl+K). source(query) returns [{ label, hint, run }] and may be async.
 * Arrow keys move, Enter runs the highlighted item, Escape or a backdrop click closes it.
 */
export function openPalette({ source, placeholder = '' } = {}) {
  const previous = document.activeElement;
  const $back = $(`
    <div class="palette-backdrop">
      <div class="palette glass" role="dialog" aria-modal="true" aria-label="${esc(placeholder)}">
        <input class="palette-input" type="search" role="combobox" aria-expanded="true" aria-controls="palette-list" autocomplete="off">
        <ul class="palette-list" id="palette-list" role="listbox"></ul>
      </div>
    </div>`);
  const $input = $back.find('input');
  const $list = $back.find('.palette-list');
  let items = [];
  let active = 0;
  let seq = 0;

  function highlight() {
    $list.children('.palette-item').each((i, el) => el.setAttribute('aria-selected', String(i === active)));
    $list.children('.palette-item').eq(active)[0]?.scrollIntoView?.({ block: 'nearest' });
  }

  async function render() {
    const mine = (seq += 1);
    const found = (await source($input.val() ?? '')) ?? [];
    if (mine !== seq) return;
    items = found;
    active = 0;
    $list.empty();
    if (!items.length) {
      $list.append(`<li class="palette-item muted">${esc(t('common.empty'))}</li>`);
      return;
    }
    items.forEach((item, i) => {
      $('<li class="palette-item" role="option"></li>')
        .append($('<span></span>').text(item.label), $('<span class="muted small"></span>').text(item.hint ?? ''))
        .on('click', () => choose(i))
        .appendTo($list);
    });
    highlight();
  }

  function close() {
    $back.remove();
    previous?.focus?.();
  }

  function choose(index) {
    const item = items[index];
    if (!item) return;
    close();
    item.run?.();
  }

  $input.attr('placeholder', placeholder).on('input', render);
  $input.on('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length) active = (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      highlight();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape') {
      close();
    }
  });
  $back.on('click', (event) => {
    if (event.target === $back[0]) close();
  });

  $('#modal-root').append($back);
  $input[0].focus();
  render();
  return { close };
}
