// Customers and suppliers. A customer balance lives in the ledger (account 1100), not on the row.
import * as db from '../core/db.js';
import { requireText } from './errors.js';

const keyOf = (text) => String(text ?? '').trim().toLowerCase();

function partyRow(input, existing = {}) {
  const name = requireText(input.name ?? existing.name, 'name');
  return {
    ...existing,
    name,
    nameKey: keyOf(name),
    phone: String(input.phone ?? existing.phone ?? '').trim(),
    address: String(input.address ?? existing.address ?? '').trim(),
  };
}

export function createCustomer(input) {
  return db.transaction((ctx) => ctx.put('customers', partyRow(input, { id: db.newId() })));
}

export function createSupplier(input) {
  return db.transaction((ctx) => ctx.put('suppliers', partyRow(input, { id: db.newId() })));
}

export const getCustomer = (id) => db.get('customers', id);
export const getSupplier = (id) => db.get('suppliers', id);

export async function listCustomers() {
  const rows = await db.getAll('customers');
  return rows.sort((a, b) => a.nameKey.localeCompare(b.nameKey));
}

export async function listSuppliers() {
  const rows = await db.getAll('suppliers');
  return rows.sort((a, b) => a.nameKey.localeCompare(b.nameKey));
}
