// Customers and suppliers. A party's balance lives in the ledger, never on the row:
//   customer → account 1100 (Customer Receivables). Positive means the customer owes the pharmacy.
//   supplier → account 2000 (Supplier Payables). Positive means the pharmacy owes the supplier.
// A negative balance is an advance: the customer has paid ahead, or the pharmacy has paid ahead to a supplier.
import * as db from '../core/db.js';
import { todayISO } from '../core/dates.js';
import { requireText } from './errors.js';
import { ACCOUNT, ledgerByAccount, openingBalanceLines, partyBalances, postEntryIn } from './ledger.js';

const keyOf = (text) => String(text ?? '').trim().toLowerCase();

export const PARTY_KINDS = {
  customer: { store: 'customers', account: ACCOUNT.receivable, owedSign: 1 },
  supplier: { store: 'suppliers', account: ACCOUNT.payable, owedSign: -1 },
};

function partyRow(input, existing = {}) {
  const name = requireText(input.name ?? existing.name, 'name');
  return {
    ...existing,
    name,
    nameKey: keyOf(name),
    phone: String(input.phone ?? existing.phone ?? '').trim(),
    email: String(input.email ?? existing.email ?? '').trim(),
    address: String(input.address ?? existing.address ?? '').trim(),
    note: String(input.note ?? existing.note ?? '').trim(),
    active: existing.active ?? true,
  };
}

/**
 * Adds a customer or supplier. openingAmount is what they already owe us (customer) or we owe them (supplier)
 * on the as-of date. Negative means an advance. It is posted against Opening Balance Equity.
 */
export function addParty({ kind, openingAmount = 0, asOf = todayISO(), ...input }) {
  const config = PARTY_KINDS[kind];
  if (!config) throw new Error(`unknown party kind ${kind}`);
  if (!Number.isSafeInteger(openingAmount)) throw new Error('invalid opening amount');
  return db.transaction(async (ctx) => {
    const party = ctx.put(config.store, partyRow(input, { id: db.newId() }));
    if (openingAmount !== 0) {
      // A customer's positive opening is a debit (receivable up). A supplier's positive opening is a credit (payable up).
      const debitSide = kind === 'customer' ? openingAmount > 0 : openingAmount < 0;
      await postEntryIn(ctx, {
        date: asOf,
        docType: 'opening',
        memo: 'opening balance',
        lines: openingBalanceLines({
          accountCode: config.account,
          amount: Math.abs(openingAmount),
          side: debitSide ? 'debit' : 'credit',
          partyId: party.id,
        }),
      });
    }
    return party;
  });
}

export function setPartyActive(kind, id, active) {
  const config = PARTY_KINDS[kind];
  return db.transaction(async (ctx) => {
    const row = await ctx.get(config.store, id);
    if (!row) throw new Error('party not found');
    return ctx.put(config.store, { ...row, active: Boolean(active) });
  });
}

export const getCustomer = (id) => db.get('customers', id);
export const getSupplier = (id) => db.get('suppliers', id);

export function createCustomer(input) {
  return addParty({ ...input, kind: 'customer' });
}

export function createSupplier(input) {
  return addParty({ ...input, kind: 'supplier' });
}

export async function getParty(kind, id) {
  return db.get(PARTY_KINDS[kind].store, id);
}

export async function listCustomers() {
  const rows = await db.getAll('customers');
  return rows.sort((a, b) => a.nameKey.localeCompare(b.nameKey));
}

export async function listSuppliers() {
  const rows = await db.getAll('suppliers');
  return rows.sort((a, b) => a.nameKey.localeCompare(b.nameKey));
}

/**
 * Parties with their balance, as the owner reads it: owed is positive when money is due to the pharmacy
 * (customers) or from the pharmacy (suppliers). Advances show as negative.
 * Returns { rows, totalOwed, advances }. totalOwed is the net figure shown on the list.
 */
export async function partySummaries(kind, { includeInactive = false } = {}) {
  const config = PARTY_KINDS[kind];
  const [parties, balances] = await Promise.all([db.getAll(config.store), partyBalances(config.account)]);
  const rows = parties
    .filter((p) => includeInactive || p.active !== false)
    .map((p) => ({ ...p, owed: config.owedSign * (balances.get(p.id) ?? 0) }))
    .sort((a, b) => a.nameKey.localeCompare(b.nameKey));
  const totalOwed = rows.reduce((total, row) => total + row.owed, 0);
  return { rows, totalOwed };
}

/** Party detail: the party, its ledger lines with running balance (as owed), and the current balance. */
export async function partyStatement(kind, id) {
  const config = PARTY_KINDS[kind];
  const party = await db.get(config.store, id);
  if (!party) throw new Error('party not found');
  const lines = await ledgerByAccount(config.account, { partyId: id });
  const rows = lines.map((line) => ({ ...line, owed: config.owedSign * line.running }));
  const owed = rows.length ? rows[rows.length - 1].owed : 0;
  return { party, rows, owed };
}
