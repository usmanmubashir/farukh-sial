// The sync sheet: what is waiting to be sent, when the last sync ran, what went wrong, and a "Sync now" button.
// Opened from the status pill in the header. Updates live while it is open.
import * as i18n from '../core/i18n.js';
import * as ui from '../core/ui.js';
import * as sync from '../core/sync.js';
import * as events from '../core/events.js';
import { formatDateTime } from '../core/dates.js';
import { navigate } from '../core/router.js';

const t = i18n.t;
const { esc } = ui;

function connectionLine(s) {
  if (!s.online) return t('sync.lineOffline');
  if (!s.configured) return t('sync.lineNotConnected');
  if (s.state === 'auth') return t('sync.lineSignIn');
  if (s.state === 'error') return t('sync.lineError');
  if (s.state === 'syncing') return t('sync.lineSyncing');
  return t('sync.lineConnected');
}

function issueLine(issue) {
  if (issue.kind === 'duplicate') return t('sync.issue.duplicate', { store: t(`backup.store.${issue.store}`), value: issue.value });
  if (issue.kind === 'negative-stock') return t('sync.issue.negativeStock', { units: Math.abs(issue.onHand) });
  return issue.kind;
}

function bodyHtml(s) {
  const last = s.lastSyncAt ? formatDateTime(new Date(s.lastSyncAt).getTime()) : t('sync.never');
  const issues = s.issues.slice(-10).reverse();
  return `
    <p class="sync-line">${esc(connectionLine(s))}</p>
    <dl class="doc-totals">
      <div><dt>${esc(t('sync.pending'))}</dt><dd>${esc(s.pending)}</dd></div>
      <div><dt>${esc(t('sync.last'))}</dt><dd>${esc(last)}</dd></div>
    </dl>
    ${s.lastError && s.state !== 'syncing' ? `<p class="form-error" role="alert">${esc(s.lastError)}</p>` : ''}
    ${issues.length ? `<h4 class="set-sub">${esc(t('sync.issues'))}</h4><ul class="sync-issues">${issues.map((i) => `<li>${esc(issueLine(i))}</li>`).join('')}</ul>` : ''}
    ${s.configured ? '' : `<p class="muted small">${esc(t('sync.notConnectedHelp'))}</p>`}`;
}

/** Opens the sheet. It listens to sync status while open, and stops listening when it closes. */
export function openSyncSheet() {
  const $body = $(`<div class="sync-sheet" id="sync-sheet-body">${bodyHtml(sync.getStatus())}</div>`);
  const refresh = (s) => $body.html(bodyHtml(s));
  const unsubscribe = events.on('sync:status', refresh);

  const actions = [];
  if (sync.getStatus().configured) {
    actions.push({ label: t('sync.now'), variant: 'primary', onClick: () => {
      sync.syncNow();
      return false;
    } });
  }
  if (sync.getStatus().state === 'auth') {
    actions.push({ label: t('sync.signIn'), onClick: () => navigate('/settings') });
  }
  actions.push({ label: t('btn.close') });

  ui.openModal({
    title: t('sync.title'),
    body: $body,
    actions,
    onClose: () => unsubscribe(),
  });
}
