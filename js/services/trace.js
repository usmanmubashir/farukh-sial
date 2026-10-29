// Batch trace, for recalls. Given a batch number or a medicine name, it lists each matching batch with:
//   - the purchases that brought it in, and the supplier of each
//   - every sale line that took units from it, net of returns (voided sales do not count)
// Walk-in sales have no customer. They are listed with an empty customer, so the screen can say "walk-in".
import * as db from '../core/db.js';
import { todayISO } from '../core/dates.js';
import { daysBetween } from './stock.js';

/** Lowercased text match over the batch number and the medicine's names, salt, company and barcode. */
function matches(batch, product, q) {
  if (String(batch.batchNo ?? '').toLowerCase().includes(q)) return true;
  if (!product) return false;
  return [product.name, product.nameUr, product.generic, product.company, product.barcode].some((value) =>
    String(value ?? '').toLowerCase().includes(q),
  );
}

/**
 * Returns one entry per matching batch, newest batches first, at most `limit` batches.
 * Each entry: { batchId, productName, strength, batchNo, expiry, days, units, packs, looseUnits, unitsPerPack,
 *   purchases: [{ number, date, supplier, packs, costPerPack }],
 *   sales: [{ date, number, customer, phone, units, returned, net }] }
 */
export async function traceBatches(text, { today = todayISO(), limit = 50 } = {}) {
  const q = String(text ?? '').trim().toLowerCase();
  if (!q) return [];

  const [products, batches, purchases, purchaseItems, sales, saleItems, customers, suppliers] = await Promise.all([
    db.getAll('products'),
    db.getAll('batches'),
    db.getAll('purchases'),
    db.getAll('purchaseItems'),
    db.getAll('sales'),
    db.getAll('saleItems'),
    db.getAll('customers'),
    db.getAll('suppliers'),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));
  const saleById = new Map(sales.map((s) => [s.id, s]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const found = batches
    .filter((batch) => matches(batch, productById.get(batch.productId), q))
    .sort((a, b) => String(b.receivedAt ?? '').localeCompare(String(a.receivedAt ?? '')))
    .slice(0, limit);

  return found.map((batch) => {
    const product = productById.get(batch.productId);
    const perPack = product?.unitsPerPack ?? 1;

    const bought = purchaseItems
      .filter((line) => line.batchId === batch.id)
      .map((line) => {
        const purchase = purchaseById.get(line.purchaseId);
        return {
          number: purchase?.number ?? '',
          date: purchase?.date ?? '',
          supplier: supplierById.get(purchase?.supplierId)?.name ?? '',
          packs: line.packs,
          costPerPack: line.costPerPack,
        };
      });

    const sold = [];
    for (const item of saleItems) {
      for (const allocation of item.allocations ?? []) {
        if (allocation.batchId !== batch.id) continue;
        const sale = saleById.get(item.saleId);
        if (!sale || sale.status === 'void') continue;
        const returned = allocation.returnedUnits ?? 0;
        const net = allocation.units - returned;
        if (net <= 0) continue;
        const customer = sale.customerId ? customerById.get(sale.customerId) : null;
        sold.push({
          date: sale.date,
          number: sale.number,
          customer: customer?.name ?? '',
          phone: customer?.phone ?? '',
          units: allocation.units,
          returned,
          net,
        });
      }
    }
    sold.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));

    return {
      batchId: batch.id,
      productName: product?.name ?? '',
      strength: product?.strength ?? '',
      batchNo: batch.batchNo,
      expiry: batch.expiry,
      days: daysBetween(today, batch.expiry),
      units: batch.onHand ?? 0,
      unitsPerPack: perPack,
      packs: Math.trunc((batch.onHand ?? 0) / perPack),
      looseUnits: (batch.onHand ?? 0) % perPack,
      purchases: bought,
      sales: sold,
    };
  });
}
