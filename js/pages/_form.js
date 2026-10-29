// Small form helpers shared by the auth pages.
import { t } from '../core/i18n.js';
import { esc } from '../core/ui.js';
import { AuthError } from '../core/auth.js';

export function brand() {
  return `
    <div class="auth-brand">
      <span class="brand-mark" aria-hidden="true">+</span>
      <div>
        <strong class="brand-name">${esc(t('app.name'))}</strong>
        <div class="brand-sub">${esc(t('app.tagline'))}</div>
      </div>
    </div>`;
}

export function field({ id, name, label, type = 'text', autocomplete = 'off', hint = '' }) {
  const describedBy = hint ? ` aria-describedby="${id}-hint"` : '';
  return `
    <div class="field">
      <label for="${id}">${esc(t(label))}</label>
      <input id="${id}" name="${name}" type="${type}" autocomplete="${autocomplete}" required${describedBy}>
      ${hint ? `<span class="hint" id="${id}-hint">${esc(t(hint))}</span>` : ''}
    </div>`;
}

/** Shows an AuthError message, or a generic one for anything unexpected. */
export function showError($el, err) {
  if (err instanceof AuthError) {
    $el.text(t(`auth.err.${err.code}`, err.vars));
  } else {
    console.error(err);
    $el.text(t('errors.generic'));
  }
  $el.prop('hidden', false);
}
