// Demand list (order list). Items come from three places:
//   low_stock  – added automatically when a product falls below its reorder level
//   not_found  – a sale search found nothing, so the name is noted for ordering
//   manual     – typed in by the user
// One open row per product (or per unmatched name). Adding again raises the quantity; it never duplicates.
import * as db from '../core/db.js';
import { t } from '../core/i18n.js';
import { formatDate, todayISO } from '../core/dates.js';
import { ServiceError, missing, requireInt, requireOneOf, requireText } from './errors.js';
import { lowStock } from './stock.js';
import { readVelocity, suggestedPacks } from './reports.js';
import { keyOf } from './products.js';

export const REASONS = ['low_stock', 'not_found', 'manual'];

export function addDemand({ productId = null, name = '', packs = 1, reason = 'manual', note = '' }) {
  return db.transaction(async (ctx) => {
    requireOneOf(reason, REASONS, 'reason');
    const qty = requireInt(packs, 'packs', 1);
    let label = String(name ?? '').trim();
    if (productId) {
      const product = await ctx.get('products', productId);
      if (!product) throw missing('product', productId);
      label = product.name;
    }
    if (!label) throw new ServiceError('required', { field: 'name' });

    const open = (await ctx.getAll('demandList')).filter((row) => row.status === 'open');
    const existing = open.find((row) =>
      productId ? row.productId === productId : !row.productId && row.nameKey === keyOf(label),
    );
    if (existing) {
      return ctx.put('demandList', { ...existing, packs: Math.max(existing.packs, qty) });
    }
    return ctx.put('demandList', {
      id: db.newId(),
      productId: productId || null,
      name: label,
      nameKey: keyOf(label),
      packs: qty,
      reason,
      status: 'open',
      note: String(note ?? '').trim(),
      createdAt: new Date().toISOString(),
    });
  });
}

export const addManual = (productId, packs = 1, note = '') =>
  addDemand({ productId, packs, reason: 'manual', note });

/** Called when a sale search finds nothing. Records the typed name once. */
export function noteSearchMiss(query) {
  const text = String(query ?? '').trim();
  if (!text) return Promise.resolve(null);
  return addDemand({ name: text, packs: 1, reason: 'not_found' });
}

/** Adds every low-stock product that is not already on the list. Returns how many were added. */
export async function autoAddLowStock() {
  const low = await lowStock();
  const open = await listOpen();
  const [velocity, settings] = await Promise.all([readVelocity(), db.getSetting('business', {})]);
  let added = 0;
  for (const row of low) {
    const { product } = row;
    if (open.some((o) => o.productId === product.id)) continue;
    const packs = suggestedPacks({ product, packs: Math.trunc(row.units / product.unitsPerPack), unitsLast30: velocity.get(product.id) ?? 0, orderDays: settings.orderDays ?? 30 });
    await addDemand({
      productId: product.id,
      packs,
      reason: 'low_stock',
    });
    added += 1;
  }
  return added;
}

export async function listOpen() {
  const rows = await db.getAll('demandList');
  return rows
    .filter((row) => row.status === 'open')
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

export function markOrdered(id) {
  return db.transaction(async (ctx) => {
    const row = await ctx.get('demandList', id);
    if (!row) throw missing('demand', id);
    return ctx.put('demandList', { ...row, status: 'ordered' });
  });
}

/** Removes an open order line and returns it, so the screen can offer to put it back (restoreDemand). */
export function removeDemand(id) {
  return db.transaction(async (ctx) => {
    const row = await ctx.get('demandList', id);
    if (!row) throw missing('demand', id);
    ctx.remove('demandList', id);
    return row;
  });
}

/** Puts a removed order line back exactly as it was. */
export function restoreDemand(row) {
  return db.transaction((ctx) => {
    ctx.put('demandList', row);
  });
}

/** Changes an open order line: quantity, preferred supplier (or none) and note. */
export function updateDemand(id, patch) {
  return db.transaction(async (ctx) => {
    const row = await ctx.get('demandList', id);
    if (!row) throw missing('demand', id);
    const next = { ...row };
    if (patch.packs !== undefined) next.packs = requireInt(patch.packs, 'packs', 1);
    if (patch.supplierId !== undefined) {
      if (patch.supplierId && !(await ctx.get('suppliers', patch.supplierId))) throw missing('supplier', patch.supplierId);
      next.supplierId = patch.supplierId || null;
    }
    if (patch.note !== undefined) next.note = String(patch.note ?? '').trim();
    return ctx.put('demandList', next);
  });
}

/**
 * Order text for one supplier, ready for WhatsApp. rows are open demand rows (already filtered to that supplier).
 * Lines carry the quantity in packs and the note, if any.
 */
export function formatSupplierOrder({ pharmacyName = '', supplierName = '', date = todayISO(), rows = [] }) {
  const greeting = supplierName ? [t('order.wa.greeting', { supplier: supplierName })] : [];
  const lines = rows.map((row, i) =>
    t('order.wa.line', { index: i + 1, name: row.name, packs: row.packs, note: row.note ? ` (${row.note})` : '' }),
  );
  return [
    ...greeting,
    t('order.wa.header', { pharmacy: pharmacyName, date: formatDate(date) }),
    '',
    ...lines,
    '',
    t('order.wa.footer'),
  ].join('\n');
}

/** Plain-text order list for WhatsApp. */
export async function toWhatsAppText({ pharmacyName = null, date = todayISO() } = {}) {
  const rows = await listOpen();
  if (rows.length === 0) return t('demand.wa.empty');
  const pharmacy = pharmacyName ?? (await db.getSetting('pharmacyName', ''));
  const header = t('demand.wa.header', { pharmacy, date });
  const lines = rows.map((row, i) =>
    t('demand.wa.line', {
      index: i + 1,
      name: row.name,
      packs: row.packs,
      note: row.note ? ` (${row.note})` : '',
    }),
  );
  return [header, ...lines].join('\n');
}

/** wa.me link carrying the text. Digits-only phone number is optional. */
export function whatsappLink(text, phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
