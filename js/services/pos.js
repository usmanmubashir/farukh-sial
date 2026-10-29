// Sale-screen lookups. Read-only, built for speed: one pass over batches and movements, then in-memory filtering.
import * as db from '../core/db.js';
import { todayISO } from '../core/dates.js';
import { listWithStock, searchProducts, keyOf } from './products.js';
import { batchRows } from './stock.js';

/** Stock status for a product card: out, low (below reorder level) or in. */
export function stockStatus(row) {
  if (row.trackStock !== false && row.units <= 0) return 'out';
  if (row.reorderLevel > 0 && row.units < row.reorderLevel * row.unitsPerPack) return 'low';
  return 'in';
}

/**
 * Product cards for the sale screen. query: name, salt, company, barcode or code (empty = all).
 * group: a group name, or '' for all. Each card carries stock, the nearest sellable batch (FEFO), and the rack.
 */
export async function saleCards({ query = '', group = '', today = todayISO(), limit = 80 } = {}) {
  const q = keyOf(query);
  const products = await listWithStock({ includeInactive: false });
  const batches = await batchRows({ today, withStockOnly: true });
  const firstBatch = new Map();
  for (const b of batches) {
    if (b.bucket === 'expired' || firstBatch.has(b.productId)) continue;
    firstBatch.set(b.productId, b);
  }

  // Exact barcode or code first, then prefix, then anywhere in the text.
  const score = (p) => {
    if (!q) return 1;
    if (p.barcode === query.trim() || keyOf(p.code) === q) return 100;
    const fields = [p.nameKey, p.genericKey, p.companyKey].filter(Boolean);
    if (fields.some((f) => f.startsWith(q))) return 50;
    if (fields.some((f) => f.includes(q)) || keyOf(p.barcode).includes(q)) return 10;
    return 0;
  };

  return products
    .filter((p) => (!group || p.group === group) && score(p) > 0)
    .map((p) => ({ p, s: score(p) }))
    .sort((a, b) => b.s - a.s || a.p.nameKey.localeCompare(b.p.nameKey))
    .slice(0, limit)
    .map(({ p }) => {
      const nearest = firstBatch.get(p.id) ?? null;
      return {
        id: p.id,
        name: p.name,
        nameUr: p.nameUr,
        strength: p.strength,
        form: p.form,
        generic: p.generic,
        company: p.company,
        class: p.class,
        storage: p.storage,
        rack: p.rack,
        group: p.group,
        barcode: p.barcode,
        soldAs: p.soldAs,
        unitName: p.unitName,
        unitsPerPack: p.unitsPerPack,
        looseSelling: p.looseSelling,
        looseUnitPrice: p.looseUnitPrice,
        mrpPerPack: p.mrpPerPack,
        salePricePerPack: p.salePricePerPack,
        trackStock: p.trackStock,
        reorderLevel: p.reorderLevel,
        units: p.units,
        packs: p.packs,
        looseUnits: p.looseUnits,
        status: stockStatus(p),
        nearestExpiry: nearest?.expiry ?? null,
        nearestBatch: nearest?.batchNo ?? null,
        nearestDays: nearest?.days ?? null,
      };
    });
}

/** Medicines with the same salt that have stock now. Used when a search finds the medicine but none is on the shelf. */
export async function alternativesInStock(productId, { today = todayISO() } = {}) {
  const product = await db.get('products', productId);
  if (!product || !product.genericKey) return [];
  const cards = await saleCards({ query: product.generic, today, limit: 200 });
  return cards.filter((c) => c.id !== productId && c.status !== 'out' && keyOf(c.generic) === product.genericKey);
}

/** A barcode scanned or typed. Returns the card for an exact match, or null. */
export async function cardForBarcode(code, { today = todayISO() } = {}) {
  const text = String(code ?? '').trim();
  if (!text) return null;
  const [match] = await searchProducts(text, { limit: 1 });
  if (!match || match.barcode !== text) return null;
  const [card] = await saleCards({ query: text, today, limit: 1 });
  return card ?? null;
}
