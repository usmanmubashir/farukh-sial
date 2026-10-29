// Chart of accounts. Read-only for now: posting and account edits come in later milestones.
import * as ledger from '../services/ledger.js';
import { t } from '../core/i18n.js';
import { esc } from '../core/ui.js';

export const route = '/ledger';
export const title = 'nav.ledger';

const TYPE_KEYS = {
  asset: 'ledger.typeAsset',
  liability: 'ledger.typeLiability',
  equity: 'ledger.typeEquity',
  income: 'ledger.typeIncome',
  expense: 'ledger.typeExpense',
};

export async function render($root) {
  const accounts = await ledger.listAccounts();

  const rows = accounts
    .map(
      (account) => `
        <tr>
          <td class="num">${esc(account.code)}</td>
          <td>${esc(ledger.accountName(account))}${account.system ? `<span class="badge">${esc(t('ledger.systemBadge'))}</span>` : ''}</td>
          <td>${esc(t(TYPE_KEYS[account.type] ?? 'common.none'))}</td>
          <td>${esc(t(account.normal === 'debit' ? 'ledger.debit' : 'ledger.credit'))}</td>
        </tr>`,
    )
    .join('');

  $root.html(`
    <div class="page-head">
      <div>
        <h2>${esc(t(title))}</h2>
        <p class="muted small">${esc(t('ledger.intro'))}</p>
      </div>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th scope="col">${esc(t('ledger.code'))}</th>
            <th scope="col">${esc(t('ledger.name'))}</th>
            <th scope="col">${esc(t('ledger.type'))}</th>
            <th scope="col">${esc(t('ledger.normal'))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`);
}

export function destroy() {}
