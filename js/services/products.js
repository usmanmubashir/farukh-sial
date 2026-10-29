// Product master with the pack model.
//   A product is bought and stored in packs (strip, box, bottle...) and each pack holds unitsPerPack units
//   (tablets, ml...). Stock is always kept in units, so a loose tablet sale is just a sale of fewer units.
//   Prices: salePricePerPack (MRP per pack), looseUnitPrice (per unit, only when looseSelling).
import * as db from '../core/db.js';
import { ServiceError, missing, optionalInt, requireInt, requireOneOf, requireText } from './errors.js';
import { unitsOfProductIn } from './stock.js';

export const CLASSES = ['otc', 'rx', 'controlled', 'general'];
export const STORAGE = ['room', 'cool', 'fridge'];
export const SOLD_AS = ['pack', 'strip', 'box', 'bottle', 'vial', 'tube', 'sachet', 'piece', 'ampoule'];

export const keyOf = (text) => String(text ?? '').trim().toLowerCase();

/** Validates and normalizes a product. Missing fields fall back to base (the stored row when updating). */
function normalise(input, base = {}) {
  const merged = { ...base, ...input };
  const name = requireText(merged.name, 'name');
  const product = {
    code: String(merged.code ?? '').trim(),
    name,
    nameKey: keyOf(name),
    generic: String(merged.generic ?? '').trim(),
    genericKey: keyOf(merged.generic),
    company: String(merged.company ?? '').trim(),
    companyKey: keyOf(merged.company),
    barcode: String(merged.barcode ?? '').trim(),
    class: requireOneOf(merged.class ?? 'general', CLASSES, 'class'),
    storage: requireOneOf(merged.storage ?? 'room', STORAGE, 'storage'),
    soldAs: requireOneOf(merged.soldAs ?? 'pack', SOLD_AS, 'soldAs'),
    unitName: String(merged.unitName ?? '').trim() || 'unit',
    unitsPerPack: requireInt(merged.unitsPerPack ?? 1, 'unitsPerPack', 1),
    packsPerBox: optionalInt(merged.packsPerBox, 'packsPerBox', 1, null),
    looseSelling: Boolean(merged.looseSelling),
    looseUnitPrice: optionalInt(merged.looseUnitPrice, 'looseUnitPrice', 0, 0),
    costPerPack: optionalInt(merged.costPerPack, 'costPerPack', 0, 0),
    salePricePerPack: optionalInt(merged.salePricePerPack, 'salePricePerPack', 0, 0),
    reorderLevel: optionalInt(merged.reorderLevel, 'reorderLevel', 0, 0),
    reorderQty: optionalInt(merged.reorderQty, 'reorderQty', 0, 0),
    active: merged.active !== false,
  };
  if (product.looseSelling) {
    if (product.unitsPerPack < 2) throw new ServiceError('looseNeedsPack');
    if (product.looseUnitPrice <= 0) throw new ServiceError('looseNeedsPrice');
  }
  return product;
}

/** Barcode and code must be unique among products. */
async function assertUnique(ctx, product, selfId) {
  if (product.code) {
    const same = await ctx.getAll('products', { index: 'code', query: product.code });
    if (same.some((p) => p.id !== selfId)) throw new ServiceError('codeTaken', { code: product.code });
  }
  if (product.barcode) {
    const same = await ctx.getAll('products', { index: 'barcode', query: product.barcode });
    if (same.some((p) => p.id !== selfId)) throw new ServiceError('barcodeTaken', { barcode: product.barcode });
  }
}

export function createProduct(input) {
  return db.transaction(async (ctx) => {
    const product = { ...normalise({ ...input, active: true }), id: db.newId() };
    await assertUnique(ctx, product, product.id);
    return ctx.put('products', product);
  });
}

export function updateProduct(id, patch) {
  return db.transaction(async (ctx) => {
    const current = await ctx.get('products', id);
    if (!current) throw missing('product', id);
    const next = normalise({ ...current, ...patch }, current);
    if (next.unitsPerPack !== current.unitsPerPack && (await unitsOfProductIn(ctx, id)) !== 0) {
      throw new ServiceError('unitsLocked', { product: current.name });
    }
    await assertUnique(ctx, next, id);
    return ctx.put('products', { ...next, id });
  });
}

/** Inactive products cannot be sold or bought. They stay in the database and in history. */
export const deactivateProduct = (id) => updateProduct(id, { active: false });
export const activateProduct = (id) => updateProduct(id, { active: true });

export async function getProduct(id) {
  const product = await db.get('products', id);
  if (!product) throw missing('product', id);
  return product;
}

const byName = (a, b) => a.nameKey.localeCompare(b.nameKey);

export async function listProducts({ includeInactive = false } = {}) {
  const rows = await db.getAll('products');
  return rows.filter((p) => includeInactive || p.active).sort(byName);
}

/**
 * Search across name, salt (generic), company, barcode and code. Ranking: exact barcode or code first,
 * then prefix matches, then anywhere in the text. Case-insensitive.
 */
export async function searchProducts(query, { includeInactive = false, limit = 30 } = {}) {
  const raw = String(query ?? '').trim();
  const q = keyOf(raw);
  if (!q) return [];
  const rows = await db.getAll('products');
  const scored = [];
  for (const product of rows) {
    if (!includeInactive && !product.active) continue;
    const exact = product.barcode === raw || keyOf(product.code) === q;
    const fields = [product.nameKey, product.genericKey, product.companyKey, keyOf(product.barcode), keyOf(product.code)];
    let score = 0;
    if (exact) score = 100;
    else if (fields.some((f) => f && f.startsWith(q))) score = 50;
    else if (fields.some((f) => f && f.includes(q))) score = 10;
    if (score) scored.push({ product, score });
  }
  scored.sort((a, b) => b.score - a.score || byName(a.product, b.product));
  return scored.slice(0, limit).map((entry) => entry.product);
}

/** Same salt (generic) as the product, excluding itself and inactive products. */
export async function alternatives(productId) {
  const product = await db.get('products', productId);
  if (!product || !product.genericKey) return [];
  const same = await db.getAll('products', { index: 'generic', query: product.genericKey });
  return same.filter((p) => p.id !== productId && p.active).sort(byName);
}
