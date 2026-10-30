// Sign-in. On a device that has no pharmacy yet, the same screen joins one from the sync server with only the username
// and password (or leads to creating a new pharmacy). After signing in, returns to ?next= when it is a safe in-app path.
import * as auth from '../core/auth.js';
import { t } from '../core/i18n.js';
import { esc } from '../core/ui.js';
import { navigate } from '../core/router.js';
import { brand, field, showError } from './_form.js';
import { joinPharmacy, remembered } from './_join.js';

export const route = '/login';
export const title = 'auth.loginTitle';

export async function render($root, params, query = {}) {
  const firstVisit = !(await auth.isSetupDone());
  const known = firstVisit ? remembered() : {};
  $root.html(`
    <div class="auth-shell">
      <section class="card auth-card" aria-labelledby="login-title">
        ${brand()}
        <h2 id="login-title">${esc(t(firstVisit ? 'auth.firstVisitTitle' : title))}</h2>
        <p class="muted">${esc(t(firstVisit ? 'auth.firstVisitSubtitle' : 'auth.loginSubtitle'))}</p>
        <form id="login-form" class="form" novalidate>
          ${field({ id: 'login-user', name: 'username', label: 'auth.username', autocomplete: 'username', value: known.username })}
          ${field({ id: 'login-pass', name: 'password', label: 'auth.password', type: 'password', autocomplete: 'current-password' })}
          <p class="form-error" id="login-error" role="alert" hidden></p>
          <button type="submit" class="btn btn-primary btn-block" id="login-submit">${esc(t(firstVisit ? 'auth.joinAndLogin' : 'auth.login'))}</button>
        </form>
        ${
          firstVisit
            ? `<div class="setup-divider"><span>${esc(t('auth.or'))}</span></div>
               <a class="btn btn-soft btn-block" href="#/setup">${esc(t('auth.createNewPharmacy'))}</a>`
            : ''
        }
        <p class="muted small auth-note">${esc(t('auth.offlineNote'))}</p>
      </section>
    </div>`);
  $root.find('#login-form').on('submit', (event) => submit(event, $root, query.next, firstVisit));
}

async function submit(event, $root, next, firstVisit) {
  event.preventDefault();
  const $submit = $root.find('#login-submit').prop('disabled', true);
  const $error = $root.find('#login-error');
  const value = (name) => $root.find(`#login-form [name="${name}"]`).val();
  try {
    if (firstVisit) {
      await joinPharmacy({ username: value('username'), password: value('password') });
    }
    await auth.login(value('username'), value('password'));
    navigate(safeNext(next));
  } catch (err) {
    if (firstVisit && !(err instanceof auth.AuthError)) {
      $error.text(err?.message ?? t('errors.generic')).prop('hidden', false);
    } else {
      showError($error, err);
    }
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
