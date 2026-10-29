// Chart of accounts and double-entry posting.
// Every business document builds its lines with a helper below and posts them through postEntryIn(),
// which refuses anything that does not balance. Account ids are "acc-<code>", so every device agrees.
//
// Inventory is perpetual: purchases debit Inventory (1200) and sales move cost from Inventory to COGS (5200).
// Purchases (5000) and Purchase Returns (5100) are seeded for reports; posting does not use them yet.
import * as db from '../core/db.js';
import { t } from '../core/i18n.js';
import { todayISO } from '../core/dates.js';
import { ServiceError, missing, requireInt, requireOneOf, requireText } from './errors.js';
import { nextDocNumber } from './numbering.js';

export const ACCOUNT = {
  cash: '1000',
  bank: '1010',
  receivable: '1100',
  inventory: '1200',
  payable: '2000',
  salesTax: '2100',
  openingEquity: '3000',
  sales: '4000',
  salesReturns: '4100',
  otherIncome: '4200',
  purchases: '5000',
  purchaseReturns: '5100',
  cogs: '5200',
  generalExpenses: '6000',
};

/** System accounts. Fixed ids, so every device seeds the same rows. They cannot be deleted. */
export const DEFAULT_ACCOUNTS = [
  { id: 'acc-1000', code: '1000', key: 'account.cashInHand', type: 'asset', normal: 'debit' },
  { id: 'acc-1010', code: '1010', key: 'account.bank', type: 'asset', normal: 'debit' },
  { id: 'acc-1100', code: '1100', key: 'account.customerReceivables', type: 'asset', normal: 'debit' },
  { id: 'acc-1200', code: '1200', key: 'account.inventory', type: 'asset', normal: 'debit' },
  { id: 'acc-2000', code: '2000', key: 'account.supplierPayables', type: 'liability', normal: 'credit' },
  { id: 'acc-2100', code: '2100', key: 'account.salesTaxPayable', type: 'liability', normal: 'credit' },
  { id: 'acc-3000', code: '3000', key: 'account.openingBalanceEquity', type: 'equity', normal: 'credit' },
  { id: 'acc-4000', code: '4000', key: 'account.sales', type: 'income', normal: 'credit' },
  { id: 'acc-4100', code: '4100', key: 'account.salesReturns', type: 'income', normal: 'debit' },
  { id: 'acc-4200', code: '4200', key: 'account.otherIncome', type: 'income', normal: 'credit' },
  { id: 'acc-5000', code: '5000', key: 'account.purchases', type: 'expense', normal: 'debit' },
  { id: 'acc-5100', code: '5100', key: 'account.purchaseReturns', type: 'expense', normal: 'credit' },
  { id: 'acc-5200', code: '5200', key: 'account.costOfGoodsSold', type: 'expense', normal: 'debit' },
  { id: 'acc-6000', code: '6000', key: 'account.generalExpenses', type: 'expense', normal: 'debit' },
];

export const accountId = (code) => `acc-${code}`;

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

/** Adds a custom account (bank, petty cash...). Codes are four or more digits and unique. */
export function createAccount({ code, name, type, normal }) {
  return db.transaction(async (ctx) => {
    const accountCode = String(code ?? '').trim();
    if (!/^\d{4,}$/.test(accountCode)) throw new ServiceError('invalidField', { field: 'code' });
    if (await ctx.get('accounts', accountId(accountCode))) throw new ServiceError('accountExists', { code: accountCode });
    const row = {
      id: accountId(accountCode),
      code: accountCode,
      name: requireText(name, 'name'),
      type: requireOneOf(type, ['asset', 'liability', 'equity', 'income', 'expense'], 'type'),
      normal: requireOneOf(normal, ['debit', 'credit'], 'normal'),
      system: false,
    };
    return ctx.put('accounts', row);
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

/* ---------- Posting ---------- */

function normaliseLine(line) {
  const debit = line.debit ?? 0;
  const credit = line.credit ?? 0;
  if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit < 0 || credit < 0) {
    throw new ServiceError('invalidAmount', { account: line.account });
  }
  if (debit > 0 && credit > 0) throw new ServiceError('lineBothSides', { account: line.account });
  return { account: line.account, debit, credit, partyId: line.partyId ?? null, memo: line.memo ?? '' };
}

/**
 * Posts one balanced entry inside the caller's transaction. Zero lines are dropped.
 * Returns the entry id, or null when every line was zero (nothing to post).
 * Throws ServiceError('unbalanced') when debits and credits differ, and writes nothing in that case.
 */
export async function postEntryIn(ctx, { date = todayISO(), docType, docId = null, memo = '', lines }) {
  const nonZero = lines
    .filter((line) => (line.debit ?? 0) !== 0 || (line.credit ?? 0) !== 0)
    .map(normaliseLine);
  if (nonZero.length === 0) return null;
  if (nonZero.length < 2) throw new ServiceError('ledgerNeedsTwoLines');

  const debit = nonZero.reduce((total, line) => total + line.debit, 0);
  const credit = nonZero.reduce((total, line) => total + line.credit, 0);
  if (debit !== credit) throw new ServiceError('unbalanced', { debit, credit });

  const accounts = [];
  for (const line of nonZero) {
    const account = await ctx.get('accounts', accountId(line.account));
    if (!account) throw new ServiceError('unknownAccount', { account: line.account });
    accounts.push(account);
  }

  const entryId = db.newId();
  nonZero.forEach((line, i) => {
    ctx.put('ledgerEntries', {
      id: db.newId(),
      entryId,
      date,
      docType,
      docId,
      accountId: accounts[i].id,
      accountCode: accounts[i].code,
      partyId: line.partyId,
      debit: line.debit,
      credit: line.credit,
      memo: line.memo || memo,
    });
  });
  return entryId;
}

/** Public form: posts one entry in its own transaction. */
export function postEntry(entry) {
  return db.transaction((ctx) => postEntryIn(ctx, entry));
}

/* ---------- Line builders (pure). Each returns lines that balance. ---------- */

/** Sale: money in (paid + balance receivable) against net sales and tax, and cost moves Inventory → COGS. */
export function saleLines({ paid, paidBank = 0, paidCash, balance, net, tax, cost, customerId = null }) {
  const cashIn = paidCash ?? paid - paidBank;
  return [
    { account: ACCOUNT.cash, debit: cashIn },
    { account: ACCOUNT.bank, debit: paidBank },
    { account: ACCOUNT.receivable, debit: balance, partyId: customerId },
    { account: ACCOUNT.sales, credit: net },
    { account: ACCOUNT.salesTax, credit: tax },
    { account: ACCOUNT.cogs, debit: cost },
    { account: ACCOUNT.inventory, credit: cost },
  ];
}

/** Purchase: stock in (Inventory) against cash paid and supplier payable. */
export function purchaseLines({ total, paid, balance, supplierId = null }) {
  return [
    { account: ACCOUNT.inventory, debit: total },
    { account: ACCOUNT.cash, credit: paid },
    { account: ACCOUNT.payable, credit: balance, partyId: supplierId },
  ];
}

/** Sale return: reverses sales and tax, pays out `refund`, credits the customer for the rest, restocks cost. */
export function saleReturnLines({ net, tax, refund, credit, cost, customerId = null }) {
  return [
    { account: ACCOUNT.salesReturns, debit: net },
    { account: ACCOUNT.salesTax, debit: tax },
    { account: ACCOUNT.cash, credit: refund },
    { account: ACCOUNT.receivable, credit: credit, partyId: customerId },
    { account: ACCOUNT.inventory, debit: cost },
    { account: ACCOUNT.cogs, credit: cost },
  ];
}

/** Purchase return: stock goes back to the supplier. Cash may come back, and the payable shrinks by the rest. */
export function purchaseReturnLines({ value, refund, payableReduce, supplierId = null }) {
  return [
    { account: ACCOUNT.cash, debit: refund },
    { account: ACCOUNT.payable, debit: payableReduce, partyId: supplierId },
    { account: ACCOUNT.inventory, credit: value },
  ];
}

export function receiptLines({ amount, partyId = null }) {
  return [
    { account: ACCOUNT.cash, debit: amount },
    { account: ACCOUNT.receivable, credit: amount, partyId },
  ];
}

export function paymentLines({ amount, partyId = null }) {
  return [
    { account: ACCOUNT.payable, debit: amount, partyId },
    { account: ACCOUNT.cash, credit: amount },
  ];
}

export function transferLines({ amount, fromCode, toCode }) {
  return [
    { account: toCode, debit: amount },
    { account: fromCode, credit: amount },
  ];
}

/** direction 'out' (write-off: General Expenses) or 'in' (gain: Other Income). Inventory moves by value. */
export function adjustmentLines({ value, direction }) {
  if (direction === 'out') {
    return [
      { account: ACCOUNT.generalExpenses, debit: value },
      { account: ACCOUNT.inventory, credit: value },
    ];
  }
  return [
    { account: ACCOUNT.inventory, debit: value },
    { account: ACCOUNT.otherIncome, credit: value },
  ];
}

export function openingBalanceLines({ accountCode, amount, side = 'debit', partyId = null }) {
  const against = { account: ACCOUNT.openingEquity, debit: side === 'credit' ? amount : 0, credit: side === 'debit' ? amount : 0 };
  const own = { account: accountCode, debit: side === 'debit' ? amount : 0, credit: side === 'credit' ? amount : 0, partyId };
  return [own, against];
}

/** Reverses posted entries: every debit becomes a credit. Used to void a document. */
export function reversalLines(entries) {
  return entries.map((entry) => ({
    account: entry.accountCode,
    debit: entry.credit,
    credit: entry.debit,
    partyId: entry.partyId ?? null,
  }));
}

/* ---------- Vouchers and opening balances ---------- */

async function requireParty(ctx, store, id, entity) {
  const party = id ? await ctx.get(store, id) : null;
  if (!party) throw missing(entity, id);
  return party;
}

/** Customer pays money in. Cash goes up, the customer's receivable goes down. */
export function receiptVoucher({ amount, partyId, date = todayISO(), note = '' }) {
  return db.transaction(async (ctx) => {
    const value = requireInt(amount, 'amount', 1);
    await requireParty(ctx, 'customers', partyId, 'customer');
    const number = await nextDocNumber(ctx, 'receipt');
    const id = db.newId();
    const entryId = await postEntryIn(ctx, { date, docType: 'voucher', docId: id, memo: number, lines: receiptLines({ amount: value, partyId }) });
    return ctx.put('vouchers', { id, number, type: 'receipt', date, amount: value, partyId, note: String(note).trim(), entryId });
  });
}

/** Money paid to a supplier. Cash goes down, the supplier payable goes down. */
export function paymentVoucher({ amount, partyId, date = todayISO(), note = '' }) {
  return db.transaction(async (ctx) => {
    const value = requireInt(amount, 'amount', 1);
    await requireParty(ctx, 'suppliers', partyId, 'supplier');
    const number = await nextDocNumber(ctx, 'payment');
    const id = db.newId();
    const entryId = await postEntryIn(ctx, { date, docType: 'voucher', docId: id, memo: number, lines: paymentLines({ amount: value, partyId }) });
    return ctx.put('vouchers', { id, number, type: 'payment', date, amount: value, partyId, note: String(note).trim(), entryId });
  });
}

/** Moves money between two accounts (for example cash into the bank). */
export function transfer({ amount, fromCode, toCode, date = todayISO(), note = '' }) {
  return db.transaction(async (ctx) => {
    const value = requireInt(amount, 'amount', 1);
    if (fromCode === toCode) throw new ServiceError('invalidField', { field: 'toCode' });
    const number = await nextDocNumber(ctx, 'transfer');
    const id = db.newId();
    const entryId = await postEntryIn(ctx, { date, docType: 'voucher', docId: id, memo: number, lines: transferLines({ amount: value, fromCode, toCode }) });
    return ctx.put('vouchers', { id, number, type: 'transfer', date, amount: value, fromCode, toCode, note: String(note).trim(), entryId });
  });
}

/** Opening balance for an account (optionally per party). side 'debit' or 'credit'. Offset to Opening Balance Equity. */
export function openingBalance({ accountCode, amount, side = 'debit', partyId = null, date = todayISO() }) {
  return db.transaction(async (ctx) => {
    const value = requireInt(amount, 'amount', 1);
    requireOneOf(side, ['debit', 'credit'], 'side');
    return postEntryIn(ctx, { date, docType: 'opening', docId: null, memo: 'opening balance', lines: openingBalanceLines({ accountCode, amount: value, side, partyId }) });
  });
}

/* ---------- Queries ---------- */

async function entriesFor(code, { partyId, from, to } = {}) {
  const id = accountId(code);
  const range = IDBKeyRange.bound([id, from ?? ''], [id, to ?? '￿']);
  let rows = await db.getAll('ledgerEntries', { index: 'accountDate', query: range });
  if (partyId !== undefined) rows = rows.filter((row) => row.partyId === partyId);
  return rows;
}

/** Totals for an account. balance = debit − credit (positive means a debit balance). */
export async function accountBalance(code, options = {}) {
  const rows = await entriesFor(code, options);
  const debit = rows.reduce((total, row) => total + row.debit, 0);
  const credit = rows.reduce((total, row) => total + row.credit, 0);
  return { code, debit, credit, balance: debit - credit };
}

/** Balance of one party on an account, e.g. partyBalance(customerId, '1100'). */
export async function partyBalance(partyId, code) {
  return (await accountBalance(code, { partyId })).balance;
}

/** Entries for an account in date order, each with the running balance. */
export async function ledgerByAccount(code, options = {}) {
  const rows = (await entriesFor(code, options)).sort(
    (a, b) => a.date.localeCompare(b.date) || (a.updatedAt ?? '').localeCompare(b.updatedAt ?? ''),
  );
  let running = 0;
  return rows.map((row) => {
    running += row.debit - row.credit;
    return { ...row, running };
  });
}

/** Whole-book check: total debits must equal total credits. */
export async function trialBalance() {
  const rows = await db.getAll('ledgerEntries');
  const debit = rows.reduce((total, row) => total + row.debit, 0);
  const credit = rows.reduce((total, row) => total + row.credit, 0);
  return { debit, credit, balanced: debit === credit };
}
