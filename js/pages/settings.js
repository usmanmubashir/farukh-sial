// Settings: pharmacy, language, theme, device ID and session.
import * as auth from '../core/auth.js';
import * as i18n from '../core/i18n.js';
import * as store from '../core/store.js';
import * as ui from '../core/ui.js';
import { formatDateTime } from '../core/dates.js';
import { navigate } from '../core/router.js';

export const route = '/settings';
export const title = 'nav.settings';

const THEMES = [
  { value: 'auto', key: 'settings.themeAuto' },
  { value: 'light', key: 'settings.themeLight' },
  { value: 'dark', key: 'settings.themeDark' },
];

export async function render($root) {
  const [deviceId, pharmacyName] = await Promise.all([auth.getDeviceId(), auth.getPharmacyName()]);
  const session = store.get('session');
  const lang = store.get('lang');
  const theme = ui.getTheme();

  const languageOptions = i18n.LANGUAGES.map(
    (option) => `<option value="${option.code}"${option.code === lang ? ' selected' : ''}>${ui.esc(option.label)}</option>`,
  ).join('');
  const themeOptions = THEMES.map(
    (option) =>
      `<option value="${option.value}"${option.value === theme ? ' selected' : ''}>${ui.esc(i18n.t(option.key))}</option>`,
  ).join('');

  $root.html(`
    <div class="page-head">
      <h2>${ui.esc(i18n.t(title))}</h2>
    </div>

    <section class="card section" aria-labelledby="set-pharmacy">
      <h3 id="set-pharmacy">${ui.esc(i18n.t('settings.pharmacy'))}</h3>
      <p>${ui.esc(pharmacyName)}</p>
    </section>

    <section class="card section">
      <div class="field">
        <label for="set-lang">${ui.esc(i18n.t('settings.language'))}</label>
        <select id="set-lang" class="select-inline">${languageOptions}</select>
      </div>
      <div class="field">
        <label for="set-theme">${ui.esc(i18n.t('settings.theme'))}</label>
        <select id="set-theme" class="select-inline">${themeOptions}</select>
      </div>
    </section>

    <section class="card section" aria-labelledby="set-device">
      <h3 id="set-device">${ui.esc(i18n.t('settings.deviceId'))}</h3>
      <p class="muted small">${ui.esc(i18n.t('settings.deviceIdHelp'))}</p>
      <code class="code-box">${ui.esc(deviceId)}</code>
    </section>

    <section class="card section">
      <h3>${ui.esc(i18n.t('settings.session'))}</h3>
      <p class="muted small">${ui.esc(i18n.t('settings.sessionUntil', { when: formatDateTime(session?.expiresAt) }))}</p>
      <div class="row">
        <button type="button" class="btn btn-danger" id="set-logout">${ui.esc(i18n.t('auth.logout'))}</button>
      </div>
    </section>`);

  $root.find('#set-lang').on('change', (event) => i18n.setLang(event.target.value));
  $root.find('#set-theme').on('change', (event) => ui.setTheme(event.target.value));
  $root.find('#set-logout').on('click', async () => {
    await auth.logout();
    navigate('/login');
  });
}
