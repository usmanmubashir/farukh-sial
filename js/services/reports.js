// Reports. Two layers:
//   1. Pure functions turn plain rows into report rows and totals. They read no database, so the maths is unit
//      tested with small fixtures (tests/services.test.html).
//   2. Readers stream from the daily rollups (services/rollups.js) for the aggregate reports, and from the
//      source rows for the reports that list individual documents. Nothing here writes.
// The rollups are updated in the same transaction as each sale, void and cash posting, so the reports agree with
// the dashboard (sales, profit), the stock page (stock value) and the ledger (cash).
import * as db from '../core/db.js';
import { addDays, todayISO } from '../core/dates.js';
import { batchRows, daysBetween } from './stock.js';

export const OPEN_END = '￿';

/** True when an ISO date falls inside [from, to]. An empty from is the start of time. */
export const inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to);

/* ================================================================
   Pure functions
   ================================================================ */

/** One row per day from the live sales (the raw form of the dailySales rollup). Used to check the rollups. */
export function dailySales(sales) {
  const days = new Map();
  for (const sale of sales) {
    if (sale.status === 'void') continue;
    const row = days.get(sale.date) ?? {
      date: sale.date, invoices: 0, subtotal: 0, discount: 0, tax: 0, total: 0, cost: 0, profit: 0, cash: 0, bank: 0, credit: 0,
    };
    row.invoices += 1;
    row.subtotal += sale.subtotal;
    row.discount += sale.discount ?? 0;
    row.tax += sale.tax ?? 0;
    row.total += sale.total;
    row.cost += sale.cost ?? 0;
    row.profit += sale.profit ?? 0;
    row.cash += sale.paidCash ?? 0;
    row.bank += sale.paidBank ?? 0;
    row.credit += sale.balance ?? 0;
    days.set(sale.date, row);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Medicine, company or salt rows from the per-day product rollup. keyOf(row) gives the group key and label.
 * Margin is profit over net sales.
 */
export function groupProductRows(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const { key, label } = keyOf(row);
    const g = groups.get(key) ?? { key, label, units: 0, lines: 0, amount: 0, net: 0, cost: 0, profit: 0 };
    g.units += row.units;
    g.lines += row.lines;
    g.amount += row.amount;
    g.net += row.net;
    g.cost += row.cost;
    g.profit += row.profit;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, margin: g.net > 0 ? g.profit / g.net : 0 }))
    .sort((a, b) => b.net - a.net || a.label.localeCompare(b.label));
}

/** Purchases grouped by supplier (or by any key keyOf gives). */
export function purchaseGroups(purchases, keyOf) {
  const groups = new Map();
  for (const purchase of purchases) {
    const { key, label } = keyOf(purchase);
    const row = groups.get(key) ?? { key, label, documents: 0, total: 0, paid: 0, due: 0 };
    row.documents += 1;
    row.total += purchase.total;
    row.paid += purchase.paid;
    row.due += purchase.balance;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Stock per product from batch rows (batchRows): packs, units and the values the stock page shows. */
export function stockByProduct(batches) {
  const products = new Map();
  for (const batch of batches) {
    const row = products.get(batch.productId) ?? {
      productId: batch.productId, name: batch.productName, units: 0, unitsPerPack: batch.unitsPerPack,
      batches: 0, costValue: 0, retailValue: 0, nearestExpiry: null,
    };
    row.units += batch.units;
    row.batches += batch.units > 0 ? 1 : 0;
    row.costValue += batch.costValue;
    row.retailValue += batch.retailValue;
    if (batch.units > 0 && (!row.nearestExpiry || batch.expiry < row.nearestExpiry)) row.nearestExpiry = batch.expiry;
    products.set(batch.productId, row);
  }
  return [...products.values()]
    .filter((row) => row.units > 0)
    .map((row) => ({ ...row, packs: Math.trunc(row.units / row.unitsPerPack), looseUnits: row.units % row.unitsPerPack }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Batches with stock, in expiry order. The date range applies to the expiry date. */
export function expiryRows(batches, { from = '', to = OPEN_END, today = todayISO() } = {}) {
  return batches
    .filter((batch) => batch.units > 0 && inRange(batch.expiry, from, to))
    .map((batch) => ({
      batchId: batch.batchId,
      name: batch.productName,
      batchNo: batch.batchNo,
      expiry: batch.expiry,
      days: daysBetween(today, batch.expiry),
      bucket: batch.bucket,
      packs: batch.packs,
      looseUnits: batch.looseUnits,
      costValue: batch.costValue,
    }))
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.name.localeCompare(b.name));
}

/** Products at or below their reorder level, out of stock first. Suggests the packs to order. */
export function lowStockRows(products) {
  return products
    .filter((p) => p.active !== false && p.reorderLevel > 0 && p.trackStock !== false && p.units < p.reorderLevel * p.unitsPerPack)
    .map((p) => {
      const packs = Math.trunc(p.units / p.unitsPerPack);
      return {
        productId: p.id,
        name: p.name,
        status: p.units <= 0 ? 'out' : 'low',
        packs,
        reorderLevel: p.reorderLevel,
        suggested: Math.max(1, (p.reorderQty || p.reorderLevel) - packs),
      };
    })
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'out' ? -1 : 1));
}

/**
 * Products with stock that have not sold in `days` days (or never sold). lastSold: Map productId → latest sale date.
 * costByProduct: Map productId → cost value of the stock held, so the money tied up is visible.
 */
export function deadStockRows({ products, lastSold, costByProduct, today = todayISO(), days = 90 }) {
  const cutoff = addDays(today, -days);
  return products
    .filter((p) => p.units > 0 && p.active !== false && (!lastSold.get(p.id) || lastSold.get(p.id) < cutoff))
    .map((p) => {
      const last = lastSold.get(p.id) ?? null;
      return {
        productId: p.id,
        name: p.name,
        packs: Math.trunc(p.units / p.unitsPerPack),
        costValue: costByProduct.get(p.id) ?? 0,
        lastSold: last,
        daysSince: last ? daysBetween(last, today) : null,
      };
    })
    .sort((a, b) => b.costValue - a.costValue || a.name.localeCompare(b.name));
}

/**
 * Profit for each day or month, from the daily sales rollup. Gross profit is the sales profit (as the dashboard
 * shows it). Sale returns and expenses come after it.
 */
export function profitFromDaily({ days, returns = [], expenses = [], granularity = 'day' }) {
  const keyOf = (date) => (granularity === 'month' ? date.slice(0, 7) : date);
  const periods = new Map();
  const row = (key) => {
    if (!periods.has(key)) {
      periods.set(key, { period: key, invoices: 0, revenue: 0, cost: 0, grossProfit: 0, returnsProfit: 0, expenses: 0, netProfit: 0 });
    }
    return periods.get(key);
  };
  for (const day of days) {
    const r = row(keyOf(day.date));
    r.invoices += day.invoices;
    r.revenue += day.total - day.tax;
    r.cost += day.cost;
    r.grossProfit += day.profit;
  }
  for (const ret of returns) {
    if (ret.type !== 'sale') continue;
    // A sale return gives back the net and restores the cost to stock, so its effect on profit is net − cost.
    row(keyOf(ret.date)).returnsProfit -= (ret.net ?? 0) - (ret.cost ?? 0);
  }
  for (const expense of expenses) row(keyOf(expense.date)).expenses += expense.amount;
  return [...periods.values()]
    .map((r) => ({ ...r, netProfit: r.grossProfit + r.returnsProfit - r.expenses }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Daily closing for the cash account, from the cash rollup (one row per day and kind: date, group, debit, credit).
 * For each day with activity inside [from, to]: opening cash (everything before that day), money in and out by kind,
 * expected cash at close, the counted amount (counted: Map date → paisa, typed on the closing screen) and the difference.
 */
export function dailyClosingFromCash({ rows, from = '', to = OPEN_END, counted = new Map() }) {
  const days = new Map();
  for (const row of rows) {
    const day = days.get(row.date) ?? {
      date: row.date, salesIn: 0, receiptsIn: 0, otherIn: 0, paymentsOut: 0, purchasesOut: 0, expensesOut: 0, otherOut: 0,
    };
    if (row.debit) {
      if (row.group === 'sales') day.salesIn += row.debit;
      else if (row.group === 'receipts') day.receiptsIn += row.debit;
      else day.otherIn += row.debit;
    }
    if (row.credit) {
      if (row.group === 'payments') day.paymentsOut += row.credit;
      else if (row.group === 'purchases') day.purchasesOut += row.credit;
      else if (row.group === 'expenses') day.expensesOut += row.credit;
      else day.otherOut += row.credit;
    }
    days.set(row.date, day);
  }
  // Opening cash is the running total of every earlier day, so it stays right however the range is set.
  const ordered = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  const out = [];
  for (const day of ordered) {
    const opening = running;
    const expected = opening + day.salesIn + day.receiptsIn + day.otherIn - day.paymentsOut - day.purchasesOut - day.expensesOut - day.otherOut;
    running = expected;
    if (!inRange(day.date, from, to)) continue;
    const count = counted.get(day.date);
    const hasCount = count !== undefined && count !== null;
    out.push({ ...day, opening, expected, counted: hasCount ? count : null, difference: hasCount ? count - expected : null });
  }
  return out;
}


/* ================================================================
   Readers (rollups and source rows; no writes)
   ================================================================ */

/** Daily sales rows in [from, to], from the rollup (a few hundred rows, however many sales there are). */
export async function readDailySales({ from = '', to = OPEN_END } = {}) {
  return db.getAll('dailySales', { query: IDBKeyRange.bound(from, to) });
}

/** Per-day, per-medicine rows in [from, to], from the rollup. */
export async function readDailyProducts({ from = '', to = OPEN_END } = {}) {
  return db.getAll('dailyProducts', { index: 'date', query: IDBKeyRange.bound(from, to) });
}

/** Cash rollup rows for every day (the opening balance needs the days before the range). */
export async function readCashDaily() {
  return db.getAll('dailyLedger', { index: 'account', query: '1000' });
}

/** Latest sale date for every product, from the per-day product rollup. */
export async function readLastSold() {
  const lastSold = new Map();
  await db.each('dailyProducts', {}, (row) => {
    if (row.units <= 0) return;
    if (!lastSold.get(row.productId) || row.date > lastSold.get(row.productId)) lastSold.set(row.productId, row.date);
  });
  return lastSold;
}

/** Live sales whose date is in [from, to]. For the reports that list every invoice. */
export async function readSales({ from = '', to = OPEN_END } = {}) {
  const sales = [];
  await db.each('sales', { index: 'date', query: IDBKeyRange.bound(from, to) }, (sale) => {
    if (sale.status !== 'void') sales.push(sale);
  });
  return sales;
}

/** Stock by batch, the same rows the stock page uses. */
export async function readBatches(today = todayISO()) {
  return batchRows({ withStockOnly: false, today });
}

