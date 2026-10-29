// Settings. Sections, top to bottom: language and digits, pharmacy profile, receipt printer, my account,
// app and data, pharmacy rules, appearance. Rules save as they change. The profile and the password have their own
// save buttons, because a half-typed name or password should not be saved by accident.
import * as auth from '../core/auth.js';
import * as i18n from '../core/i18n.js';
import * as store from '../core/store.js';
import * as ui from '../core/ui.js';
import { esc } from '../core/ui.js';
import { formatDateTime } from '../core/dates.js';
import { navigate } from '../core/router.js';
import { setDigitStyle } from '../core/numbers.js';
import { APP_VERSION } from '../core/version.js';
import { getProfile, getSettings, saveProfile, saveSettings } from '../services/settings.js';
import { bluetoothSupported, connectBluetoothPrinter, printInBrowser, printerConnected, printToBluetooth, sampleReceipt } from '../services/printing.js';
import { checkIntegrity, recalculateStock } from '../services/stock.js';
import { importProducts } from '../services/products.js';
import { popularMedicines } from '../services/seed-medicines.js';

export const route = '/settings';
export const title = 'nav.settings';

const t = i18n.t;
let $host = null;
let installPrompt = null;
let onInstallAvailable = null;

const THEMES = [
  { value: 'auto', key: 'settings.themeAuto' },
  { value: 'light', key: 'settings.themeLight' },
  { value: 'dark', key: 'settings.themeDark' },
];

const DOC_KEYS = ['sale', 'purchase', 'saleReturn', 'purchaseReturn', 'receipt', 'payment', 'expense', 'income', 'transfer', 'adjustment'];

/* ---------- Field helpers ---------- */

const switchField = (rule, label, checked) => `
  <label class="switch set-switch">
    <input type="checkbox" data-rule="${esc(rule)}" data-type="bool"${checked ? ' checked' : ''}>
    <span class="switch-track"><span class="switch-thumb"></span></span>
    <span>${esc(label)}</span>
  </label>`;

const numberField = (rule, label, value, { min = 0, max = 9999, step = 1, help = '' } = {}) => `
  <div class="field">
    <label for="set-${esc(rule)}">${esc(label)}</label>
    <input id="set-${esc(rule)}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${esc(value)}" data-rule="${esc(rule)}" data-type="number">
    ${help ? `<span class="hint">${esc(help)}</span>` : ''}
  </div>`;

const textField = (id, label, value, { help = '', attrs = '' } = {}) => `
  <div class="field">
    <label for="${esc(id)}">${esc(label)}</label>
    <input id="${esc(id)}" name="${esc(id)}" type="text" value="${esc(value)}" autocomplete="off"${attrs}>
    ${help ? `<span class="hint">${esc(help)}</span>` : ''}
  </div>`;

const selectField = (id, label, options, value, { rule = '', help = '' } = {}) => `
  <div class="field">
    <label for="${esc(id)}">${esc(label)}</label>
    <select id="${esc(id)}" class="select-inline"${rule ? ` data-rule="${esc(rule)}" data-type="text"` : ''}>
      ${options.map(([v, text]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(text)}</option>`).join('')}
    </select>
    ${help ? `<span class="hint">${esc(help)}</span>` : ''}
  </div>`;

const section = (id, heading, body) => `
  <section class="card section set-section" aria-labelledby="${esc(id)}">
    <h3 id="${esc(id)}">${esc(heading)}</h3>
    ${body}
  </section>`;

/* ---------- Sections ---------- */

async function languageSection() {
  const lang = store.get('lang');
  const digits = (await getSettings()).numberDigits;
  const languageOptions = i18n.LANGUAGES.map((option) => [option.code, option.label]);
  return section(
    'set-language',
    t('settings.language'),
    `${selectField('set-lang', t('settings.language'), languageOptions, lang, { help: t('settings.languageHelp') })}
     ${selectField('set-digits', t('settings.digits'), [['western', t('settings.digitsWestern')], ['urdu', t('settings.digitsUrdu')]], digits, { help: t('settings.digitsHelp') })}`,
  );
}

async function profileSection() {
  const p = await getProfile();
  return section(
    'set-profile',
    t('settings.profile'),
    `<p class="muted small">${esc(t('settings.profileHelp'))}</p>
     <form class="set-form" data-form="profile" novalidate>
       ${textField('pf-name', t('settings.profileName'), p.name, { attrs: ' required' })}
       ${textField('pf-nameUr', t('settings.profileNameUr'), p.nameUr, { attrs: ' lang="ur" dir="rtl"' })}
       ${textField('pf-address', t('settings.profileAddress'), p.address)}
       ${textField('pf-phone', t('settings.profilePhone'), p.phone, { attrs: ' inputmode="tel"' })}
       ${textField('pf-ntn', t('settings.profileNtn'), p.ntn, { help: t('settings.profileNtnHelp') })}
       ${textField('pf-licence', t('settings.profileLicence'), p.licence, { help: t('settings.profileLicenceHelp') })}
       ${textField('pf-qualifiedPerson', t('settings.profileQualified'), p.qualifiedPerson)}
       ${textField('pf-receiptFooter', t('settings.profileFooter'), p.receiptFooter, { help: t('settings.profileFooterHelp') })}
       ${textField('pf-currency', t('settings.profileCurrency'), p.currency)}
       <p class="form-error" role="alert" hidden></p>
       <div class="row"><button type="submit" class="btn btn-primary">${esc(t('settings.saveProfile'))}</button></div>
     </form>`,
  );
}

async function printerSection() {
  const s = await getSettings();
  const bt = bluetoothSupported();
  return section(
    'set-printer',
    t('settings.printer'),
    `${selectField('set-printMethod', t('settings.printMethod'), [['browser', t('settings.printBrowser')], ['bluetooth', t('settings.printBluetooth')]], s.printMethod, { rule: 'printMethod', help: bt ? '' : t('settings.bluetoothNo') })}
     ${selectField('set-receiptWidth', t('settings.paperWidth'), [['80', '80 mm'], ['58', '58 mm']], String(s.receiptWidth), { rule: 'receiptWidth' })}
     ${numberField('printCopies', t('settings.copies'), s.printCopies, { min: 1, max: 5 })}
     ${switchField('printAutoPrint', t('settings.autoPrint'), s.printAutoPrint)}
     <div class="row set-actions">
       <button type="button" class="btn btn-soft" data-action="test-print">${esc(t('settings.testPrint'))}</button>
       <button type="button" class="btn btn-ghost" data-action="connect-printer" ${bt ? '' : 'disabled'}>${esc(t('settings.connectPrinter'))}</button>
     </div>
     <p class="muted small set-printer-status" role="status"></p>`,
  );
}

async function accountSection() {
  const [username, session, deviceId, s] = await Promise.all([auth.ownerUsername(), store.get('session') ?? auth.currentSession(), auth.getDeviceId(), getSettings()]);
  return section(
    'set-account',
    t('settings.account'),
    `<dl class="doc-totals">
       <div><dt>${esc(t('settings.username'))}</dt><dd>${esc(username)}</dd></div>
       <div><dt>${esc(t('settings.role'))}</dt><dd>${esc(t('settings.roleOwner'))}</dd></div>
       <div><dt>${esc(t('settings.deviceId'))}</dt><dd><code class="code-box">${esc(deviceId)}</code></dd></div>
     </dl>
     <p class="muted small">${esc(t('settings.deviceIdHelp'))}</p>
     ${numberField('sessionHours', t('settings.sessionHours'), s.sessionHours, { min: 1, max: 720, help: t('settings.sessionHoursHelp') })}
     <p class="muted small">${esc(t('settings.sessionUntil', { when: formatDateTime(session?.expiresAt) }))}</p>
     <h4 class="set-sub">${esc(t('settings.changePassword'))}</h4>
     <form class="set-form" data-form="password" novalidate>
       <div class="field"><label for="pw-current">${esc(t('settings.currentPassword'))}</label><input id="pw-current" type="password" autocomplete="current-password"></div>
       <div class="field"><label for="pw-new">${esc(t('settings.newPassword'))}</label><input id="pw-new" type="password" autocomplete="new-password"></div>
       <div class="field"><label for="pw-confirm">${esc(t('settings.confirmPassword'))}</label><input id="pw-confirm" type="password" autocomplete="new-password"></div>
       <p class="form-error" role="alert" hidden></p>
       <div class="row"><button type="submit" class="btn btn-primary">${esc(t('settings.savePassword'))}</button></div>
     </form>
     <div class="row set-actions"><button type="button" class="btn btn-danger" id="set-logout">${esc(t('auth.logout'))}</button></div>`,
  );
}

function appSection() {
  return section(
    'set-app',
    t('settings.app'),
    `<dl class="doc-totals">
       <div><dt>${esc(t('settings.version'))}</dt><dd>${esc(APP_VERSION)}</dd></div>
       <div><dt>${esc(t('settings.storage'))}</dt><dd class="set-storage">—</dd></div>
       <div><dt>${esc(t('settings.persistent'))}</dt><dd class="set-persist">—</dd></div>
     </dl>
     <div class="row set-actions">
       <button type="button" class="btn btn-soft" data-action="persist">${esc(t('settings.requestPersist'))}</button>
       <button type="button" class="btn btn-soft" data-action="install" hidden>${esc(t('settings.install'))}</button>
       <button type="button" class="btn btn-soft" data-action="popular">${esc(t('settings.addPopular'))}</button>
       <button type="button" class="btn btn-soft" data-action="integrity">${esc(t('settings.checkIntegrity'))}</button>
       <button type="button" class="btn btn-soft" data-action="recalc">${esc(t('settings.recalculate'))}</button>
       <button type="button" class="btn btn-soft" data-action="camera">${esc(t('settings.cameraTest'))}</button>
     </div>
     <p class="muted small set-app-status" role="status"></p>`,
  );
}

async function rulesSection() {
  const s = await getSettings();
  const docs = DOC_KEYS.map((key) => textField(`doc-${key}`, t(`settings.doc.${key}`), s.docPrefixes?.[key] ?? '', { attrs: ` data-rule="docPrefixes.${key}" data-type="prefix"` })).join('');
  return section(
    'set-rules',
    t('settings.rules'),
    `${numberField('expiryWarnDays', t('settings.expiryWarn'), s.expiryWarnDays, { min: 1, max: 365, help: t('settings.expiryWarnHelp') })}
     ${numberField('orderDays', t('settings.orderDays'), s.orderDays, { min: 1, max: 365, help: t('settings.orderDaysHelp') })}
     ${numberField('backupReminderDays', t('settings.backupReminder'), s.backupReminderDays, { min: 0, max: 365, help: t('settings.backupReminderHelp') })}
     ${switchField('rxRequiresPatientDoctor', t('settings.rxPatientDoctor'), s.rxRequiresPatientDoctor)}
     ${switchField('receiptShowBatch', t('settings.receiptBatch'), s.receiptShowBatch)}
     ${switchField('receiptShowDirections', t('settings.receiptDirections'), s.receiptShowDirections)}
     ${switchField('updateSalePriceOnMrpChange', t('settings.updatePriceOnMrp'), s.updateSalePriceOnMrpChange)}
     ${switchField('updateCostFromLastPurchase', t('settings.updateCost'), s.updateCostFromLastPurchase)}
     ${switchField('allowPriceEdit', t('settings.allowPriceEdit'), s.allowPriceEdit)}
     <h4 class="set-sub">${esc(t('settings.tax'))}</h4>
     ${switchField('taxEnabled', t('settings.taxOn'), s.taxEnabled)}
     ${numberField('taxRate', t('settings.taxRate'), s.taxRate, { min: 0, max: 100, step: 0.5, help: t('settings.taxRateHelp') })}
     <h4 class="set-sub">${esc(t('settings.documents'))}</h4>
     <p class="muted small">${esc(t('settings.documentsHelp'))}</p>
     ${textField('devicePrefix', t('settings.devicePrefix'), s.devicePrefix, { help: t('settings.devicePrefixHelp'), attrs: ' data-rule="devicePrefix" data-type="prefix"' })}
     ${docs}`,
  );
}

function appearanceSection() {
  const theme = ui.getTheme();
  return section(
    'set-appearance',
    t('settings.appearance'),
    selectField('set-theme', t('settings.theme'), THEMES.map((o) => [o.value, t(o.key)]), theme, { help: t('settings.themeHelp') }),
  );
}

/* ---------- Painting ---------- */

async function paint() {
  const sections = await Promise.all([languageSection(), profileSection(), printerSection(), accountSection(), rulesSection()]);
  $host.html(`
    <div class="page-head"><h2>${esc(t(title))}</h2></div>
    ${sections[0]}
    ${sections[1]}
    ${sections[2]}
    ${sections[3]}
    ${appSection()}
    ${sections[4]}
    ${appearanceSection()}`);
  paintStorage();
}

async function paintStorage() {
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
  $host.find('.set-storage').text(estimate?.usage !== undefined ? t('settings.storageUsed', { used: mb(estimate.usage), quota: mb(estimate.quota ?? 0) }) : t('settings.storageUnknown'));
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  $host.find('.set-persist').text(t(persisted ? 'settings.persistYes' : 'settings.persistNo'));
  $host.find('[data-action="install"]').prop('hidden', !installPrompt);
}

/* ---------- Actions ---------- */

function status(selector, text) {
  $host.find(selector).text(text ?? '');
}

async function saveRule(input) {
  const type = input.dataset.type;
  const rule = input.dataset.rule;
  let value;
  if (type === 'bool') value = input.checked;
  else if (type === 'number') {
    const n = Number(input.value);
    const min = Number(input.min ?? 0);
    const max = Number(input.max ?? 9999);
    if (!Number.isFinite(n) || n < min || n > max) {
      ui.toast(t('settings.err.range', { min, max }), { type: 'error' });
      return;
    }
    value = n;
  } else if (type === 'prefix') {
    value = input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    input.value = value;
  } else value = input.value;

  if (rule.startsWith('docPrefixes.')) {
    const key = rule.slice('docPrefixes.'.length);
    if (!value) {
      ui.toast(t('settings.err.prefixEmpty'), { type: 'error' });
      return;
    }
    await saveSettings({ docPrefixes: { [key]: value } });
  } else if (rule === 'printMethod' || rule === 'receiptWidth') {
    await saveSettings({ [rule]: rule === 'receiptWidth' ? Number(value) : value });
  } else {
    await saveSettings({ [rule]: value });
  }
  ui.toast(t('settings.saved'), { type: 'success', timeout: 1400 });
}

async function saveDigits(value) {
  await saveSettings({ numberDigits: value });
  setDigitStyle(value);
  store.set('digits', value);
}

async function saveProfileForm(form) {
  const $error = $(form).find('.form-error');
  const name = $(form).find('#pf-name').val().trim();
  if (!name) {
    $error.text(t('settings.err.nameNeeded')).prop('hidden', false);
    return;
  }
  const fields = ['name', 'nameUr', 'address', 'phone', 'ntn', 'licence', 'qualifiedPerson', 'receiptFooter', 'currency'];
  const patch = Object.fromEntries(fields.map((f) => [f, $(form).find(`#pf-${f}`).val()]));
  await saveProfile(patch);
  store.set('pharmacyName', name);
  $error.prop('hidden', true);
  ui.toast(t('settings.profileSaved'), { type: 'success' });
}

async function savePassword(form) {
  const $error = $(form).find('.form-error');
  try {
    await auth.changePassword({
      current: $(form).find('#pw-current').val(),
      password: $(form).find('#pw-new').val(),
      confirm: $(form).find('#pw-confirm').val(),
    });
    form.reset();
    $error.prop('hidden', true);
    ui.toast(t('settings.passwordSaved'), { type: 'success' });
  } catch (err) {
    $error.text(err instanceof auth.AuthError ? t(`auth.err.${err.code}`, err.vars) : t('errors.generic')).prop('hidden', false);
  }
}

async function testPrint() {
  const s = await getSettings();
  const model = sampleReceipt(s.receiptWidth);
  try {
    if (s.printMethod === 'bluetooth') {
      if (!printerConnected()) await connectBluetoothPrinter();
      await printToBluetooth(model, { copies: 1 });
    } else {
      printInBrowser(model, { copies: 1 });
    }
    status('.set-printer-status', t('settings.testPrinted'));
  } catch (err) {
    console.error('[settings] test print failed', err);
    status('.set-printer-status', t('settings.testFailed'));
  }
}

async function connectPrinter() {
  try {
    const name = await connectBluetoothPrinter();
    status('.set-printer-status', t('settings.connected', { name }));
  } catch (err) {
    status('.set-printer-status', t('settings.connectFailed'));
    console.error('[settings] bluetooth connect failed', err);
  }
}

async function runAction(action) {
  if (action === 'persist') {
    const granted = navigator.storage?.persist ? await navigator.storage.persist().catch(() => false) : false;
    ui.toast(t(granted ? 'settings.persistYes' : 'settings.persistNo'), { type: granted ? 'success' : 'info' });
    await paintStorage();
  }
  if (action === 'install') {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    await paintStorage();
  }
  if (action === 'popular') {
    const result = await importProducts(popularMedicines());
    ui.toast(t('med.imported', result), { type: 'success' });
  }
  if (action === 'integrity') {
    const r = await checkIntegrity();
    status('.set-app-status', r.ok ? t('settings.integrityOk', { count: r.checkedBatches }) : t('settings.integrityBad', { count: r.mismatches.length + r.orphanMovements }));
  }
  if (action === 'recalc') {
    const r = await recalculateStock();
    status('.set-app-status', t('settings.recalcDone', { checked: r.checked, corrected: r.corrected.length }));
  }
  if (action === 'camera') {
    status('.set-app-status', t('settings.cameraChecking'));
    const detector = 'BarcodeDetector' in window ? t('settings.detectorYes') : t('settings.detectorNo');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      status('.set-app-status', `${t('settings.cameraOk')} · ${detector}`);
    } catch {
      status('.set-app-status', `${t('settings.cameraNo')} · ${detector}`);
    }
  }
}

function bind() {
  $host.on('change', '[data-rule]', async (event) => {
    if (event.currentTarget.id === 'set-digits') return;
    await saveRule(event.currentTarget);
    if (event.currentTarget.dataset.rule === 'printMethod') paint();
  });
  $host.on('change', '#set-lang', (event) => i18n.setLang(event.currentTarget.value));
  $host.on('change', '#set-digits', (event) => saveDigits(event.currentTarget.value));
  $host.on('change', '#set-theme', (event) => ui.setTheme(event.currentTarget.value));
  $host.on('submit', '[data-form="profile"]', (event) => {
    event.preventDefault();
    saveProfileForm(event.currentTarget);
  });
  $host.on('submit', '[data-form="password"]', (event) => {
    event.preventDefault();
    savePassword(event.currentTarget);
  });
  $host.on('click', '[data-action]', (event) => {
    const action = event.currentTarget.getAttribute('data-action');
    if (action === 'test-print') testPrint();
    else if (action === 'connect-printer') connectPrinter();
    else runAction(action);
  });
  $host.on('click', '#set-logout', async () => {
    await auth.logout();
    navigate('/login');
  });
}

export async function render($root) {
  $root.html('<div class="set-root"></div>');
  $host = $root.children('.set-root');
  onInstallAvailable = (event) => {
    event.preventDefault();
    installPrompt = event;
    $host?.find('[data-action="install"]').prop('hidden', false);
  };
  window.addEventListener('beforeinstallprompt', onInstallAvailable);
  bind();
  await paint();
}

export function destroy() {
  if (onInstallAvailable) window.removeEventListener('beforeinstallprompt', onInstallAvailable);
  onInstallAvailable = null;
  $host = null;
}

