// Owner login. After signing in, returns to ?next= when it is a safe in-app path.
import * as auth from '../core/auth.js';
import { t } from '../core/i18n.js';
import { esc } from '../core/ui.js';
import { navigate } from '../core/router.js';
import { brand, field, showError } from './_form.js';

export const route = '/login';
export const title = 'auth.loginTitle';

export function render($root, params, query = {}) {
  $root.html(`
    <div class="auth-shell">
      <section class="card auth-card" aria-labelledby="login-title">
        ${brand()}
        <h2 id="login-title">${esc(t(title))}</h2>
        <p class="muted">${esc(t('auth.loginSubtitle'))}</p>
        <form id="login-form" class="form" novalidate>
          ${field({ id: 'login-user', name: 'username', label: 'auth.username', autocomplete: 'username' })}
          ${field({ id: 'login-pass', name: 'password', label: 'auth.password', type: 'password', autocomplete: 'current-password' })}
          <p class="form-error" id="login-error" role="alert" hidden></p>
          <button type="submit" class="btn btn-primary btn-block" id="login-submit">${esc(t('auth.login'))}</button>
        </form>
        <p class="muted small auth-note">${esc(t('auth.offlineNote'))}</p>
      </section>
    </div>`);
  $root.find('#login-form').on('submit', (event) => submit(event, $root, query.next));
}

async function submit(event, $root, next) {
  event.preventDefault();
  const $submit = $root.find('#login-submit').prop('disabled', true);
  try {
    await auth.login($root.find('#login-user').val(), $root.find('#login-pass').val());
    navigate(safeNext(next));
  } catch (err) {
    showError($root.find('#login-error'), err);
    $submit.prop('disabled', false);
    $root.find('#login-pass').val('');
  }
}

/** Only in-app paths are accepted as redirect targets. */
function safeNext(next) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  if (/^\/(login|setup)(\?|$)/.test(next)) return '/dashboard';
  return next;
}
