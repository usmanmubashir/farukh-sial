// Backup and restore. Back up now (a file to save, or to share on mobile with the Web Share API). Restore reads a
// file, checks it (format, schema version, checksum), shows when it was made and what is in it, and replaces the
// data only after the owner types RESTORE. The weekly reminder is set here and shows on the dashboard.
import * as i18n from '../core/i18n.js';
import * as ui from '../core/ui.js';
import { esc } from '../core/ui.js';
import { formatDateTime } from '../core/dates.js';
import { navigate } from '../core/router.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { buildBackupFile, readBackupFile, restoreBackup, validateBackup } from '../services/backup.js';
import * as db from '../core/db.js';

export const route = '/backup';
export const title = 'nav.backup';

const t = i18n.t;
const CONFIRM_WORD = 'RESTORE';
let $host = null;
let picked = null; // { parsed, summary } for the file chosen to restore

/** Days since an ISO time, rounded down. */
const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

async function statusHtml() {
  const [last, s] = await Promise.all([db.getSetting('lastBackupAt', null), getSettings()]);
  const reminder = Number(s.backupReminderDays) || 0;
  let line;
  if (!last) line = t('backup.never');
  else line = t('backup.last', { when: formatDateTime(new Date(last).getTime()), days: daysSince(last) });
  const due = !last || (reminder > 0 && daysSince(last) >= reminder);
  return `
    <p>${esc(line)}</p>
    ${due ? `<p class="set-warn">${esc(reminder ? t('backup.due', { days: reminder }) : t('backup.dueNever'))}</p>` : ''}`;
}

/** Share works on phones and some desktops. Checked with a sample file, so the button only shows when it will work. */
function canShareFiles() {
  try {
    return Boolean(navigator.share && navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] }));
  } catch {
    return false;
  }
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function paintStatus() {
  $host.find('.backup-status').html(await statusHtml());
}

async function backupNow({ share }) {
  $host.find('[data-action="backup"]').prop('disabled', true);
  try {
    const file = await buildBackupFile();
    if (share && canShareFiles() && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: t('backup.shareTitle'), text: t('backup.shareText') }).catch((err) => {
        if (err?.name !== 'AbortError') throw err;
      });
    } else {
      downloadFile(file);
    }
    ui.toast(t('backup.done'), { type: 'success' });
  } catch (err) {
    console.error('[backup] export failed', err);
    ui.toast(t('backup.exportFailed'), { type: 'error' });
  } finally {
    $host.find('[data-action="backup"]').prop('disabled', false);
    await paintStatus();
  }
}

function summaryHtml({ createdAt, app, deviceId, counts, total }) {
  const rows = Object.entries(counts)
    .map(([name, n]) => `<tr><td>${esc(t(`backup.store.${name}`))}</td><td class="num">${esc(n)}</td></tr>`)
    .join('');
  return `
    <dl class="doc-totals">
      <div><dt>${esc(t('backup.madeOn'))}</dt><dd>${esc(formatDateTime(new Date(createdAt).getTime()))}</dd></div>
      <div><dt>${esc(t('backup.madeWith'))}</dt><dd>${esc(app ?? '')}</dd></div>
      <div><dt>${esc(t('backup.fromDevice'))}</dt><dd><code>${esc(String(deviceId).slice(0, 8))}</code></dd></div>
      <div><dt>${esc(t('backup.records'))}</dt><dd>${esc(total)}</dd></div>
    </dl>
    <div class="table-wrap"><table class="table"><thead><tr><th>${esc(t('backup.col.store'))}</th><th class="num">${esc(t('backup.col.count'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function chooseFile(file) {
  const $result = $host.find('.restore-result');
  $result.empty();
  picked = null;
  $host.find('[data-action="restore"]').prop('disabled', true);
  $host.find('[name="confirm"]').val('');
  if (!file) return;
  try {
    const parsed = await readBackupFile(file);
    const summary = await validateBackup(parsed);
    picked = { parsed, summary };
    $result.html(`
      <h4 class="set-sub">${esc(t('backup.checked'))}</h4>
      ${summaryHtml(summary)}
      <p class="set-warn">${esc(t('backup.warning'))}</p>
      <div class="field">
        <label for="restore-confirm">${esc(t('backup.typeToConfirm', { word: CONFIRM_WORD }))}</label>
        <input id="restore-confirm" name="confirm" type="text" autocomplete="off" autocapitalize="characters" placeholder="${CONFIRM_WORD}">
      </div>`);
  } catch (err) {
    const key = err?.code ? `backup.err.${err.code}` : 'backup.err.notBackup';
    const message = err?.code === 'backupSchema' ? t('backup.err.backupSchema', { found: err.vars?.found, expected: err.vars?.expected }) : t(key);
    $result.html(`<p class="form-error" role="alert">${esc(message)}</p>`);
  }
}

async function restoreNow() {
  if (!picked || $host.find('[name="confirm"]').val().trim() !== CONFIRM_WORD) return;
  $host.find('[data-action="restore"]').prop('disabled', true);
  try {
    await restoreBackup(picked.parsed);
    picked = null;
    ui.toast(t('backup.restored'), { type: 'success' });
    navigate('/dashboard');
  } catch (err) {
    console.error('[backup] restore failed', err);
    ui.toast(t('backup.restoreFailed'), { type: 'error' });
    $host.find('[data-action="restore"]').prop('disabled', false);
  }
}

export async function render($root) {
  const s = await getSettings();
  $root.html(`
    <div class="set-root">
    <div class="page-head"><h2>${esc(t(title))}</h2></div>
    <section class="card section set-section" aria-labelledby="bk-backup">
      <h3 id="bk-backup">${esc(t('backup.backupTitle'))}</h3>
      <p class="muted small">${esc(t('backup.backupHelp'))}</p>
      <div class="backup-status"></div>
      <div class="row set-actions">
        <button type="button" class="btn btn-primary" data-action="backup">${esc(t('backup.button'))}</button>
        <button type="button" class="btn btn-soft" data-action="share" ${canShareFiles() ? '' : 'hidden'}>${esc(t('backup.share'))}</button>
      </div>
      <div class="field">
        <label for="bk-reminder">${esc(t('backup.reminderLabel'))}</label>
        <input id="bk-reminder" type="number" min="0" max="365" inputmode="numeric" value="${esc(s.backupReminderDays)}" data-reminder>
        <span class="hint">${esc(t('backup.reminderHelp'))}</span>
      </div>
    </section>
    <section class="card section set-section" aria-labelledby="bk-restore">
      <h3 id="bk-restore">${esc(t('backup.restoreTitle'))}</h3>
      <p class="muted small">${esc(t('backup.restoreHelp'))}</p>
      <div class="field">
        <label for="bk-file">${esc(t('backup.chooseFile'))}</label>
        <input id="bk-file" type="file" accept=".json,.gz,application/json,application/gzip" data-file>
      </div>
      <div class="restore-result" aria-live="polite"></div>
      <div class="row set-actions"><button type="button" class="btn btn-danger" data-action="restore" disabled>${esc(t('backup.restoreButton'))}</button></div>
    </section>
    </div>`);
  $host = $root.children('.set-root');
  await paintStatus();
  $host.on('click', '[data-action="backup"]', () => backupNow({ share: false }));
  $host.on('click', '[data-action="share"]', () => backupNow({ share: true }));
  $host.on('change', '[data-file]', (event) => chooseFile(event.currentTarget.files?.[0] ?? null));
  $host.on('input', '[name="confirm"]', (event) => {
    $host.find('[data-action="restore"]').prop('disabled', !picked || event.currentTarget.value.trim() !== CONFIRM_WORD);
  });
  $host.on('click', '[data-action="restore"]', restoreNow);
  $host.on('change', '[data-reminder]', async (event) => {
    const days = Number(event.currentTarget.value);
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      ui.toast(t('settings.err.range', { min: 0, max: 365 }), { type: 'error' });
      return;
    }
    await saveSettings({ backupReminderDays: days });
    ui.toast(t('settings.saved'), { type: 'success', timeout: 1400 });
    await paintStatus();
  });
}

export function destroy() {
  $host = null;
  picked = null;
}
