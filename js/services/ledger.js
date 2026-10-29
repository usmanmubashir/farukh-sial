// Chart of accounts and double-entry posting.
// Every business document builds its lines with a helper below and posts them through postEntryIn(),
// which refuses anything that does not balance. Account ids are "acc-<code>", so every device agrees.
//
// Inventory is perpetual: purchases debit Inventory (1200) and sales move cost from Inventory to COGS (5200).
// Purchases (5000) and Purchase Returns (5100) are seeded for reports; posting does not use them yet.
//
// Money accounts: Cash in Hand (1000) is the cash drawer. Bank and wallet accounts are asset accounts
// numbered 1011–1099 with kind 'bank' or 'wallet'. Bank (1010) is a system account of kind 'bank'.
// Any of them can receive a sale, pay a supplier, or be the source of a purchase or expense.
import * as db from '../core/db.js';
import { t } from '../core/i18n.js';
import { todayISO } from '../core/dates.js';
import { ServiceError, missing, requireInt, requireOneOf, requireText } from './errors.js';
import { nextDocNumber } from './numbering.js';
import { applyCashLine, ledgerGroup } from './rollups.js';

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
  { id: 'acc-1000', code: '1000', key: 'account.cashInHand', type: 'asset', normal: 'debit', kind: 'cash' },
  { id: 'acc-1010', code: '1010', key: 'account.bank', type: 'asset', normal: 'debit', kind: 'bank' },
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

/** Payment kinds: where money physically sits. */
export const PAYMENT_KINDS = ['cash', 'bank', 'wallet'];

export const accountId = (code) => `acc-${code}`;

/** 'cash' | 'bank' | 'wallet' for money accounts, otherwise null. */
export function accountKind(account) {
  if (!account) return null;
  if (account.kind) return account.kind;
  if (account.code === ACCOUNT.cash) return 'cash';
  if (account.code === ACCOUNT.bank) return 'bank';
  return null;
}

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

/** Adds a custom account (petty cash, a bank, a wallet...). Codes are four or more digits and unique. */
export function createAccount({ code, name, type, normal, kind = null }) {
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
      kind: kind ? requireOneOf(kind, ['cash', 'bank', 'wallet'], 'kind') : null,
    };
    return ctx.put('accounts', row);
  });
}

/** First free code in 1011–1099 for a new bank or wallet account. */
async function nextPaymentCode(ctx) {
  const used = new Set((await ctx.getAll('accounts')).map((a) => a.code));
  for (let code = 1011; code <= 1099; code += 1) {
    if (!used.has(String(code))) return String(code);
  }
  throw new ServiceError('noFreeAccountCode');
}

/**
 * Adds a bank or wallet account that can take payments. openingBalance may be negative (an overdraft).
 * It is posted against Opening Balance Equity on the as-of date.
 */
export function addPaymentAccount({ name, kind, openingBalance = 0, date = todayISO(), note = '' }) {
  return db.transaction(async (ctx) => {
    requireOneOf(kind, ['bank', 'wallet'], 'kind');
    const label = requireText(name, 'name');
    if (!Number.isSafeInteger(openingBalance)) throw new ServiceError('invalidField', { field: 'openingBalance' });
    const code = await nextPaymentCode(ctx);
    const account = {
      id: accountId(code),
      code,
      name: label,
      type: 'asset',
      normal: 'debit',
      system: false,
      kind,
      note: String(note ?? '').trim(),
    };
    ctx.put('accounts', account);
    if (openingBalance !== 0) {
      await postEntryIn(ctx, {
        date,
        docType: 'opening',
        memo: 'opening balance',
        lines: openingBalanceLines({
          accountCode: code,
          amount: Math.abs(openingBalance),
          side: openingBalance > 0 ? 'debit' : 'credit',
        }),
      });
    }
    return account;
  });
}

export async function listAccounts() {
  const rows = await db.getAll('accounts');
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

/** Accounts where money can be received or paid from: cash, banks and wallets. */
export async function paymentAccounts({ includeCash = true } = {}) {
  return (await listAccounts()).filter((a) => {
    const kind = accountKind(a);
    return kind && (includeCash || kind !== 'cash');
  });
}

/** System accounts are translated; custom ones use the stored name. */
export function accountName(account) {
  return account.system ? t(account.key) : account.name;
}

/** The balance as the account's normal side shows it: a credit-normal account (liability, income) is positive when credit. */
export function naturalBalance(account, balance) {
  return account.normal === 'credit' ? -balance : balance;
}

async function loadAccount(ctx, code) {
  const account = await ctx.get('accounts', accountId(code));
  if (!account) throw new ServiceError('unknownAccount', { account: code });
  return account;
}

/** The account must exist and be a money account (cash, bank or wallet). */
export async function requirePaymentAccount(ctx, code) {
  const account = await loadAccount(ctx, code);
  if (!PAYMENT_KINDS.includes(accountKind(account))) throw new ServiceError('invalidAccount', { account: code });
  return account;
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
  for (const [i, line] of nonZero.entries()) {
    const row = ctx.put('ledgerEntries', {
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
    await applyCashLine(ctx, { accountCode: row.accountCode, date, group: ledgerGroup(docType, row.memo), debit: row.debit, credit: row.credit });
  }
  return entryId;
}

/** Public form: posts one entry in its own transaction. */
export function postEntry(entry) {
  return db.transaction((ctx) => postEntryIn(ctx, entry));
}

/* ---------- Line builders (pure). Each returns lines that balance. ---------- */

/**
 * Sale: money in against net sales and tax, and cost moves Inventory → COGS.
 * receipts: [{ accountCode, amount }] for the money that came in (cash and each bank or wallet).
 * balance is the part left on the customer's account.
 */
export function saleLines({ receipts, paid, paidBank = 0, paidCash, balance, net, tax, cost, customerId = null }) {
  const money = receipts ?? [
    { accountCode: ACCOUNT.cash, amount: paidCash ?? paid - paidBank },
    { accountCode: ACCOUNT.bank, amount: paidBank },
  ];
  return [
    ...money.map((r) => ({ account: r.accountCode, debit: r.amount })),
    { account: ACCOUNT.receivable, debit: balance, partyId: customerId },
    { account: ACCOUNT.sales, credit: net },
    { account: ACCOUNT.salesTax, credit: tax },
    { account: ACCOUNT.cogs, debit: cost },
    { account: ACCOUNT.inventory, credit: cost },
  ];
}

/** Purchase: stock in (Inventory) against the money paid from cashAccount and the supplier payable. */
export function purchaseLines({ total, paid, balance, supplierId = null, cashAccount = ACCOUNT.cash }) {
  return [
    { account: ACCOUNT.inventory, debit: total },
    { account: cashAccount, credit: paid },
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

/** Money from a customer into an account (cash by default). Clears the customer's receivable. */
export function receiptLines({ amount, partyId = null, accountCode = ACCOUNT.cash }) {
  return [
    { account: accountCode, debit: amount },
    { account: ACCOUNT.receivable, credit: amount, partyId },
  ];
}

/** Money to a supplier from an account (cash by default). Reduces the supplier payable. */
export function paymentLines({ amount, partyId = null, accountCode = ACCOUNT.cash }) {
  return [
    { account: ACCOUNT.payable, debit: amount, partyId },
    { account: accountCode, credit: amount },
  ];
}

export function expenseLines({ amount, expenseCode = ACCOUNT.generalExpenses, fromCode = ACCOUNT.cash }) {
  return [
    { account: expenseCode, debit: amount },
    { account: fromCode, credit: amount },
  ];
}

export function incomeLines({ amount, incomeCode = ACCOUNT.otherIncome, toCode = ACCOUNT.cash }) {
  return [
    { account: toCode, debit: amount },
    { account: incomeCode, credit: amount },
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

/** Saves the voucher header and returns it. Each voucher has one ledger entry, linked by entryId. */
function saveVoucher(ctx, { type, number, date, amount, entryId, note, ...rest }) {
  return ctx.put('vouchers', { id: db.newId(), number, type, date, amount, entryId, note: String(note ?? '').trim(), ...rest });
}

/** Customer pays money in. The money goes to accountCode (cash by default). The customer's receivable goes down. */
export function receiptVoucher({ amount, partyId, accountCode = ACCOUNT.cash, date = todayISO(), note = '' }) {
  return db.transaction(async (ctx) => {
    const value = requireInt(amount, 'amount', 1);
    await requireParty(ctx, 'customers', partyId, 'customer');
    await requirePaymentAccount(ctx, accountCode);
    const number = await nextDocNumber(ctx, 'receipt');
    const entryId = await postEntryIn(ctx, {
      date, docType: 'receipt', docId: null, memo: number, lines: receiptLines({ amount: value, partyId, accountCode }),
    });
    return saveVoucher(ctx, { type: 'receipt', number, date, amount: value, entryId, note, partyId, accountCode });
  });
}

/** Money paid to a supplier from accountCode (cash by default). The supplier payable goes down. */
export function paymentVoucher({ amount, partyId, accountCode = ACCOUNT.cash, date = todayISO(), note = '' }) {
  return db.transaction(async (ctx) => {
    const value = requireInt(amount, 'amount', 1);
    await requireParty(ctx, 'suppliers', partyId, 'supplier');
    await requirePaymentAccount(ctx, accountCode);
    const number = await nextDocNumber(ctx, 'payment');
    const entryId = await postEntryIn(ctx, {
      date, docType: 'payment', docId: null, memo: number, lines: paymentLines({ amount: value, partyId, accountCode }),
    });
    return saveVoucher(ctx, { type: 'payment', number, date, amount: value, entryId, note, partyId, accountCode });
  });
}

/** A general expense paid from an account (cash, bank or wallet). */
export function expenseVoucher({ amount, expenseCode = ACCOUNT.generalExpenses, fromCode = ACCOUNT.cash, date = todayISO(), note = '' }) {
  return db.transaction(async (ctx) => {
    const value = requireInt(amount, 'amount', 1);
    const expense = await loadAccount(ctx, expenseCode);
    if (expense.type !== 'expense') throw new ServiceError('invalidAccount', { account: expenseCode });
    await requirePaymentAccount(ctx, fromCode);
    const number = await nextDocNumber(ctx, 'expense');
    const entryId = await postEntryIn(ctx, {
      date, docType: 'expense', docId: null, memo: number, lines: expenseLines({ amount: value, expenseCode, fromCode }),
    });
    return saveVoucher(ctx, { type: 'expense', number, date, amount: value, entryId, note, accountCode: expenseCode, fromCode });
  });
}

/** Money received that is not a sale or a customer payment (for example a refund from a supplier of a service). */
export function incomeVoucher({ amount, incomeCode = ACCOUNT.otherIncome, toCode = ACCOUNT.cash, date = todayISO(), note = '' }) {
  return db.transaction(async (ctx) => {
    const value = requireInt(amount, 'amount', 1);
    const income = await loadAccount(ctx, incomeCode);
    if (income.type !== 'income') throw new ServiceError('invalidAccount', { account: incomeCode });
    await requirePaymentAccount(ctx, toCode);
    const number = await nextDocNumber(ctx, 'income');
    const entryId = await postEntryIn(ctx, {
      date, docType: 'income', docId: null, memo: number, lines: incomeLines({ amount: value, incomeCode, toCode }),
    });
    return saveVoucher(ctx, { type: 'income', number, date, amount: value, entryId, note, accountCode: incomeCode, toCode });
  });
}

/** Moves money between two money accounts (for example cash into the bank). */
export function transfer({ amount, fromCode, toCode, date = todayISO(), note = '' }) {
  return db.transaction(async (ctx) => {
    const value = requireInt(amount, 'amount', 1);
    if (fromCode === toCode) throw new ServiceError('invalidField', { field: 'toCode' });
    await requirePaymentAccount(ctx, fromCode);
    await requirePaymentAccount(ctx, toCode);
    const number = await nextDocNumber(ctx, 'transfer');
    const entryId = await postEntryIn(ctx, {
      date, docType: 'transfer', docId: null, memo: number, lines: transferLines({ amount: value, fromCode, toCode }),
    });
    return saveVoucher(ctx, { type: 'transfer', number, date, amount: value, entryId, note, fromCode, toCode });
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

/** Vouchers in a date range, newest first. type: '' for all. */
export async function listVouchers({ from = '', to = '￿', type = '' } = {}) {
  const rows = await db.getAll('vouchers', { index: 'date', query: IDBKeyRange.bound(from, to) });
  return rows
    .filter((row) => !type || row.type === type)
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.number).localeCompare(String(a.number)));
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

/** Every party's balance on an account in one read: Map partyId → debit − credit. */
export async function partyBalances(code) {
  const totals = new Map();
  for (const row of await entriesFor(code)) {
    if (!row.partyId) continue;
    totals.set(row.partyId, (totals.get(row.partyId) ?? 0) + row.debit - row.credit);
  }
  return totals;
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
