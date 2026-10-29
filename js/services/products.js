// Product master with the pack model.
//   A product is bought and stored in packs (strip, box, bottle...) and each pack holds unitsPerPack units
//   (tablets, ml...). Stock is always kept in units, so a loose tablet sale is just a sale of fewer units.
//   Prices (all paisa, all per ONE PACK unless named otherwise):
//     mrpPerPack        printed MRP (what the pack says)
//     salePricePerPack  what we charge; defaults to the MRP
//     costPerPack       what we paid, updated from the latest purchase
//     looseUnitPrice    per single unit, only when looseSelling
import * as db from '../core/db.js';
import { ServiceError, missing, optionalInt, requireInt, requireOneOf, requireText } from './errors.js';
import { unitsOfProductIn } from './stock.js';

export const CLASSES = ['otc', 'rx', 'controlled', 'general'];
export const STORAGE = ['room', 'cool', 'fridge'];
export const SOLD_AS = ['pack', 'strip', 'box', 'bottle', 'vial', 'tube', 'sachet', 'piece', 'ampoule'];
export const FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'injection', 'cream', 'ointment', 'drops', 'inhaler', 'sachet', 'powder', 'gel', 'spray', 'other'];
const PHOTO_LIMIT = 150 * 1024;

export const keyOf = (text) => String(text ?? '').trim().toLowerCase();

/** Validates and normalizes a product. Missing fields fall back to base (the stored row when updating). */
function normalise(input, base = {}) {
  const merged = { ...base, ...input };
  const name = requireText(merged.name, 'name');
  const photo = merged.photo ? String(merged.photo) : null;
  if (photo && photo.length > PHOTO_LIMIT) throw new ServiceError('photoTooLarge');
  const product = {
    code: String(merged.code ?? '').trim(),
    name,
    nameKey: keyOf(name),
    nameUr: String(merged.nameUr ?? '').trim(),
    strength: String(merged.strength ?? '').trim(),
    form: requireOneOf(merged.form ?? 'tablet', FORMS, 'form'),
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
    mrpPerPack: optionalInt(merged.mrpPerPack, 'mrpPerPack', 0, 0),
    costPerPack: optionalInt(merged.costPerPack, 'costPerPack', 0, 0),
    salePricePerPack: optionalInt(merged.salePricePerPack, 'salePricePerPack', 0, merged.mrpPerPack ?? 0),
    wholesalePerPack: optionalInt(merged.wholesalePerPack, 'wholesalePerPack', 0, 0),
    reorderLevel: optionalInt(merged.reorderLevel, 'reorderLevel', 0, 0),
    reorderQty: optionalInt(merged.reorderQty, 'reorderQty', 0, 0),
    rack: String(merged.rack ?? '').trim(),
    group: String(merged.group ?? '').trim(),
    directions: String(merged.directions ?? '').trim(),
    trackStock: merged.trackStock !== false,
    photo,
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

/** Every product with its stock from movements: units, whole packs and loose units. */
export async function listWithStock({ includeInactive = true } = {}) {
  const [products, movements] = await Promise.all([db.getAll('products'), db.getAll('stockMovements')]);
  const totals = new Map();
  for (const row of movements) totals.set(row.productId, (totals.get(row.productId) ?? 0) + row.units);
  return products
    .filter((p) => includeInactive || p.active !== false)
    .map((p) => {
      const units = totals.get(p.id) ?? 0;
      const perPack = p.unitsPerPack || 1;
      return {
        ...p,
        soldAs: p.soldAs || 'pack',
        unitName: p.unitName || 'unit',
        unitsPerPack: perPack,
        units,
        packs: Math.trunc(units / perPack),
        looseUnits: units % perPack,
      };
    })
    .sort(byName);
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

/**
 * Bulk import (the popular-medicines seed). One transaction. A medicine already in the list
 * (same name and strength, case-insensitive) is skipped, so importing twice adds nothing.
 */
export function importProducts(list) {
  return db.transaction(async (ctx) => {
    const existing = await ctx.getAll('products');
    const seen = new Set(existing.map((p) => `${p.nameKey}|${keyOf(p.strength)}`));
    let added = 0;
    let skipped = 0;
    for (const input of list) {
      const product = normalise({ ...input, active: true });
      const key = `${product.nameKey}|${keyOf(product.strength)}`;
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      ctx.put('products', { ...product, id: db.newId() });
      added += 1;
    }
    return { added, skipped };
  });
}

/** Internal barcode: 13 digits, starting with 2 (store-internal range in GS1), with a valid check digit. */
export function generateBarcode() {
  const digits = ['2', ...Array.from({ length: 11 }, () => Math.floor(Math.random() * 10))];
  const sum = digits.reduce((total, d, i) => total + d * (i % 2 === 0 ? 1 : 3), 0);
  digits.push((10 - (sum % 10)) % 10);
  return digits.join('');
}

/* ---------- Groups (device-local list of names; products carry the name) ---------- */

export async function listGroups() {
  return db.getSetting('productGroups', []);
}

export function saveGroups(names) {
  const clean = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return db.setSetting('productGroups', clean).then(() => clean);
}
