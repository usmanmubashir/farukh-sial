// First run. Creates the pharmacy's owner account on this device. A device that is joining an existing pharmacy uses
// the sign-in screen instead, which is where it lands when no pharmacy is set up here yet.
import * as auth from '../core/auth.js';
import { t } from '../core/i18n.js';
import { esc } from '../core/ui.js';
import { navigate } from '../core/router.js';
import { brand, field, showError } from './_form.js';

export const route = '/setup';
export const title = 'auth.setupTitle';

export function render($root) {
  $root.html(`
    <div class="auth-shell">
      <section class="card auth-card" aria-labelledby="setup-title">
        ${brand()}
        <h2 id="setup-title">${esc(t(title))}</h2>
        <p class="muted">${esc(t('auth.setupSubtitle'))}</p>
        <form id="setup-form" class="form" novalidate>
          ${field({ id: 'setup-pharmacy', name: 'pharmacyName', label: 'auth.pharmacyName', autocomplete: 'organization' })}
          ${field({ id: 'setup-user', name: 'username', label: 'auth.username', autocomplete: 'username' })}
          ${field({ id: 'setup-pass', name: 'password', label: 'auth.password', type: 'password', autocomplete: 'new-password', hint: 'auth.passwordHint' })}
          ${field({ id: 'setup-confirm', name: 'confirm', label: 'auth.confirmPassword', type: 'password', autocomplete: 'new-password' })}
          <p class="form-error" id="setup-error" role="alert" hidden></p>
          <button type="submit" class="btn btn-primary btn-block" id="setup-submit">${esc(t('auth.createOwner'))}</button>
        </form>
        <div class="setup-divider"><span>${esc(t('auth.or'))}</span></div>
        <a class="btn btn-soft btn-block" href="#/login">${esc(t('auth.joinExistingLink'))}</a>
      </section>
    </div>`);
  $root.find('#setup-form').on('submit', (event) => submit(event, $root));
}

async function submit(event, $root) {
  event.preventDefault();
  const $submit = $root.find('#setup-submit').prop('disabled', true);
  const value = (name) => $root.find(`[name="${name}"]`).val();
  try {
    await auth.setupOwner({
      pharmacyName: value('pharmacyName'),
      username: value('username'),
      password: value('password'),
      confirm: value('confirm'),
    });
    navigate('/dashboard');
  } catch (err) {
    showError($root.find('#setup-error'), err);
    $submit.prop('disabled', false);
  }
}
