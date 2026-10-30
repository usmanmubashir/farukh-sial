// First run. Either creates the pharmacy's owner account on this device, or joins a pharmacy that already exists on the
// sync server: the owner's username and password are checked there, and the pharmacy's data is downloaded.
import * as auth from '../core/auth.js';
import * as sync from '../core/sync.js';
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
        <button type="button" class="btn btn-soft btn-block" id="setup-join-toggle" aria-expanded="false" aria-controls="join-form">${esc(t('auth.joinToggle'))}</button>

        <form id="join-form" class="form" novalidate hidden>
          <p class="muted small">${esc(t('auth.joinHelp'))}</p>
          ${field({ id: 'join-pharmacy', name: 'pharmacyName', label: 'auth.pharmacyName', autocomplete: 'organization' })}
          ${field({ id: 'join-url', name: 'url', label: 'settings.syncUrl', type: 'url', autocomplete: 'url' })}
          ${field({ id: 'join-user', name: 'username', label: 'auth.username', autocomplete: 'username' })}
          ${field({ id: 'join-pass', name: 'password', label: 'auth.password', type: 'password', autocomplete: 'current-password' })}
          <p class="form-error" id="join-error" role="alert" hidden></p>
          <button type="submit" class="btn btn-primary btn-block" id="join-submit">${esc(t('auth.joinSubmit'))}</button>
        </form>
      </section>
    </div>`);
  $root.find('#setup-form').on('submit', (event) => submit(event, $root));
  $root.find('#join-form').on('submit', (event) => join(event, $root));
  $root.find('#setup-join-toggle').on('click', (event) => {
    const open = $root.find('#join-form').prop('hidden');
    $root.find('#join-form').prop('hidden', !open);
    event.currentTarget.setAttribute('aria-expanded', String(open));
  });
}

async function submit(event, $root) {
  event.preventDefault();
  const $submit = $root.find('#setup-submit').prop('disabled', true);
  const value = (name) => $root.find(`#setup-form [name="${name}"]`).val();
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

/**
 * Joins the pharmacy on the sync server from an empty device. The owner's username and password are checked there,
 * then the records are downloaded. The app then opens the sign-in screen, where the same password works offline.
 */
async function join(event, $root) {
  event.preventDefault();
  const $submit = $root.find('#join-submit').prop('disabled', true);
  const $error = $root.find('#join-error');
  const value = (name) => $root.find(`#join-form [name="${name}"]`).val();
  try {
    await auth.setPharmacyName(value('pharmacyName'));
    await sync.joinPharmacy({ backend: 'cloudflare', url: value('url'), username: value('username'), password: value('password') });
    if (!(await auth.isSetupDone())) {
      // The sync engine keeps its own error and retries; show it so the owner knows what to fix.
      throw new Error(sync.getStatus().lastError ?? t('auth.joinNoData'));
    }
    $error.prop('hidden', true);
    navigate('/login');
  } catch (err) {
    $error.text(err?.message ?? t('errors.generic')).prop('hidden', false);
    $submit.prop('disabled', false);
  }
}
