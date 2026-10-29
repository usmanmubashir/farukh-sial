// Demo data for showing the app: 24 stocked medicines with prices, two supplier accounts and four customers
// (one with an opening balance), 30 days of sales, a supplier purchase and some vouchers.
// It uses the same services as real use, so reports, the ledger and stock all reflect it.
//
// Safety: it runs only on an empty pharmacy (no medicines and no sales). It never mixes with real records.
// Deterministic: the same seed gives the same demo every time. Names and phone numbers are invented.
import * as db from '../core/db.js';
import { POPULAR_MEDICINES, seedToProduct } from './seed-medicines.js';
import { createProduct } from './products.js';
import { addBatch } from './stock.js';
import { createSale } from './sales.js';
import { createPurchase } from './purchases.js';
import { addParty } from './parties.js';
import { expenseVoucher, receiptVoucher } from './ledger.js';

const PRODUCT_COUNT = 24;
const DAYS = 30;
const SEED = 20261029;

/** A small seeded random generator (mulberry32), so the demo is the same every time. */
function generator(seed) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local calendar date, `days` from today (negative = in the past). */
function dayOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** True when the pharmacy has no medicines and no sales yet. Demo data is only added then. */
export async function isEmptyPharmacy() {
  return (await db.count('products')) === 0 && (await db.count('sales')) === 0;
}

/** Adds the demo records. Resolves with counts, or { loaded: false } when the pharmacy is not empty. */
export async function loadDemoData() {
  if (!(await isEmptyPharmacy())) return { loaded: false };
  const random = generator(SEED);
  const pick = (list) => list[Math.floor(random() * list.length)];

  // Medicines: non-Rx, so every demo sale can be completed without a patient or doctor.
  const seeds = POPULAR_MEDICINES.filter((row) => row[6] === 'otc' || row[6] === 'general').slice(0, PRODUCT_COUNT);
  const products = [];
  for (const [index, row] of seeds.entries()) {
    const cost = (40 + index * 23) * 100; // paisa per pack
    const price = Math.round((cost * 1.3) / 100) * 100;
    const product = await createProduct({
      ...seedToProduct(row),
      costPerPack: cost,
      mrpPerPack: price,
      salePricePerPack: price,
      reorderLevel: 10,
      reorderQty: 30,
    });
    products.push({ id: product.id, price, cost, sold: 0 });
    // One batch expires soon, so the expiry list has something to show.
    const expiryDays = index === 3 ? 20 : 365 + index * 20;
    await addBatch({
      productId: product.id,
      batchNo: `DM-${100 + index}`,
      expiry: dayOffset(expiryDays),
      packs: 60 + Math.floor(random() * 80),
      costPerPack: cost,
      mrp: price,
      date: dayOffset(-(DAYS + 30)),
    });
  }

  // Parties. One customer starts with an old balance that is still owed.
  const customers = [];
  const customerNames = ['Demo Customer A', 'Demo Customer B', 'Demo Customer C', 'Demo Customer D'];
  for (const [index, name] of customerNames.entries()) {
    customers.push(
      await addParty({
        kind: 'customer',
        name,
        phone: `0300-000${index + 1}${index + 1}${index + 1}${index + 1}`,
        openingAmount: index === 1 ? 150000 : 0,
        asOf: dayOffset(-(DAYS + 10)),
      }),
    );
  }
  const suppliers = [];
  for (const name of ['Demo Supplier A', 'Demo Supplier B']) {
    suppliers.push(await addParty({ kind: 'supplier', name }));
  }

  // Sales over the last 30 days. Most are cash; some go on a customer's account. Sales that would run out
  // of stock are skipped, so every sale that is saved is valid.
  let sales = 0;
  let skipped = 0;
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo -= 1) {
    const date = dayOffset(-daysAgo);
    const count = 1 + Math.floor(random() * 4);
    for (let n = 0; n < count; n += 1) {
      const lines = Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(products));
      const items = lines.map((product) => ({ productId: product.id, packs: 1 + Math.floor(random() * 3) }));
      const total = items.reduce((sum, item) => sum + products.find((p) => p.id === item.productId).price * item.packs, 0);
      const onAccount = random() < 0.25;
      try {
        await createSale({
          customer: onAccount ? pick(customers).id : '',
          date,
          today: date,
          items,
          payments: onAccount ? [] : [{ method: 'cash', amount: total }],
        });
        sales += 1;
      } catch {
        skipped += 1;
      }
    }
  }

  // A purchase from a supplier on account, and a few payments and expenses.
  await createPurchase({
    supplierId: suppliers[0].id,
    date: dayOffset(-12),
    paid: 0,
    payFrom: '1000',
    items: [{ productId: products[0].id, batchNo: 'DM-PUR-1', expiry: dayOffset(540), packs: 50, costPerPack: products[0].cost, mrp: products[0].price }],
  });
  await receiptVoucher({ amount: 50000, partyId: customers[1].id, date: dayOffset(-5), note: 'Part payment' });
  await expenseVoucher({ amount: 180000, date: dayOffset(-8), note: 'Electricity bill' });
  await expenseVoucher({ amount: 65000, date: dayOffset(-2), note: 'Tea and tissues' });

  return { loaded: true, products: products.length, customers: customers.length, suppliers: suppliers.length, sales, skipped };
}
