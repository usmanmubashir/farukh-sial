// Chart of accounts and double-entry posting. Business documents post balanced entries through here
// (posting arrives in a later milestone).
import * as db from '../core/db.js';
import { t } from '../core/i18n.js';

/** System accounts. Fixed ids, so every device seeds the same rows. They cannot be deleted. */
export const DEFAULT_ACCOUNTS = [
  { id: 'acc-1000', code: '1000', key: 'account.cashInHand', type: 'asset', normal: 'debit' },
  { id: 'acc-1100', code: '1100', key: 'account.customerReceivables', type: 'asset', normal: 'debit' },
  { id: 'acc-2000', code: '2000', key: 'account.supplierPayables', type: 'liability', normal: 'credit' },
  { id: 'acc-2100', code: '2100', key: 'account.salesTaxPayable', type: 'liability', normal: 'credit' },
  { id: 'acc-3000', code: '3000', key: 'account.openingBalanceEquity', type: 'equity', normal: 'credit' },
  { id: 'acc-4000', code: '4000', key: 'account.sales', type: 'income', normal: 'credit' },
  { id: 'acc-4100', code: '4100', key: 'account.salesReturns', type: 'income', normal: 'debit' },
  { id: 'acc-4200', code: '4200', key: 'account.otherIncome', type: 'income', normal: 'credit' },
  { id: 'acc-5000', code: '5000', key: 'account.purchases', type: 'expense', normal: 'debit' },
  { id: 'acc-5100', code: '5100', key: 'account.purchaseReturns', type: 'expense', normal: 'credit' },
  { id: 'acc-6000', code: '6000', key: 'account.generalExpenses', type: 'expense', normal: 'debit' },
];

/** Creates any missing system accounts. Idempotent, so it is safe on every boot. Returns how many were created. */
export function seedDefaultAccounts() {
  return db.transaction(async (ctx) => {
    let created = 0;
    for (const account of DEFAULT_ACCOUNTS) {
      if (!(await ctx.get('accounts', account.id))) {
        ctx.put('accounts', { ...account, system: true });
        created += 1;
      }
    }
    return created;
  });
}

export async function listAccounts() {
  const rows = await db.getAll('accounts');
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

/** System accounts are translated; custom ones use the stored name. */
export function accountName(account) {
  return account.system ? t(account.key) : account.name;
}
