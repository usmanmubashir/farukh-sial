// Daily rollups: the numbers the reports need, kept per day, so a report over 50,000 sales reads a few hundred
// rows instead of the whole sales history.
//   dailySales     one row per day: invoices, totals, cost, profit, cash / bank / credit
//   dailyProducts  one row per day and medicine: units, lines, amounts, net, cost, profit
//   dailyLedger    the cash account (1000) per day and kind of movement: debit, credit
// Writes keep them up to date inside the same transaction as the business write (sales.js, ledger.js), so the
// rollups can never disagree with the sales they summarise. rebuildRollups() recomputes everything from the
// source rows in one transaction; ensureRollups() runs it once when the rollups were never built.
import * as db from '../core/db.js';
import { roundHalfAway } from '../core/money.js';

export const ROLLUP_VERSION = 2;
const OPEN_END = '￿';

/* ---------- Pure helpers ---------- */

/**
 * Splits one sale's net (total less tax) and cost over its lines, so the lines add up exactly to the sale.
 * Items are ordered by id first, so a void (which reads the lines back in a different order) takes out exactly
 * what the sale put in. The last line takes the rounding.
 */
export function allocateSaleLines(sale, items) {
  const ordered = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const net = sale.total - sale.tax;
  let used = 0;
  return ordered.map((item, index) => {
    const share = index === ordered.length - 1
      ? net - used
      : sale.subtotal > 0 ? roundHalfAway((item.amount * net) / sale.subtotal) : 0;
    used += share;
    const cost = item.cost ?? 0;
    return { item, net: share, cost, profit: share - cost };
  });
}

/** The cash-book group of a ledger line. Legacy voucher rows are told apart by their number prefix. */
export function ledgerGroup(docType, memo = '') {
  const map = {
    sale: 'sales', purchase: 'purchases', receipt: 'receipts', payment: 'payments', expense: 'expenses',
    income: 'incomes', transfer: 'transfers', saleReturn: 'returns', purchaseReturn: 'returns', opening: 'other',
    void: 'other',
    practice: 'practice', practiceVoid: 'practice',
  };
  if (map[docType]) return map[docType];
  const legacy = { RCV: 'receipts', PAY: 'payments', TRF: 'transfers' }[String(memo ?? '').slice(0, 3)];
  return legacy ?? 'other';
}

/**
 * The rollup changes one sale makes. sign is +1 when the sale is written and −1 when it is voided.
 * Returns { day: { date, delta }, products: [{ key, date, productId, delta }] }.
 */
export function saleDeltas(sale, items, sign = 1) {
  const day = {
    date: sale.date,
    delta: {
      invoices: sign,
      subtotal: sign * sale.subtotal,
      discount: sign * (sale.discount ?? 0),
      tax: sign * (sale.tax ?? 0),
      total: sign * sale.total,
      cost: sign * (sale.cost ?? 0),
      profit: sign * (sale.profit ?? 0),
      cash: sign * (sale.paidCash ?? 0),
      bank: sign * (sale.paidBank ?? 0),
      credit: sign * (sale.balance ?? 0),
    },
  };
  const products = allocateSaleLines(sale, items).map((line) => ({
    key: `${sale.date}|${line.item.productId}`,
    date: sale.date,
    productId: line.item.productId,
    productName: line.item.productName,
    delta: {
      units: sign * (line.item.units ?? 0),
      lines: sign,
      amount: sign * (line.item.amount ?? 0),
      net: sign * line.net,
      cost: sign * line.cost,
      profit: sign * line.profit,
    },
  }));
  return { day, products };
}

/**
 * The rollup changes one sale return makes, on the return's own date. Sales fall by the returned value before tax,
 * tax and cost come off, and the customer's credit falls by the part credited. No invoice is added or removed.
 * The sale's discount is not re-split, so it stays on the sale's own day.
 */
export function returnDeltas(ret, lines) {
  const net = ret.gross - ret.tax;
  const day = {
    date: ret.date,
    delta: {
      invoices: 0,
      subtotal: -net,
      discount: 0,
      tax: -ret.tax,
      total: -ret.gross,
      cost: -ret.cost,
      profit: -(net - ret.cost),
      cash: 0,
      bank: 0,
      credit: -(ret.credit ?? 0),
    },
  };
  const products = lines.map((line) => ({
    key: `${ret.date}|${line.productId}`,
    date: ret.date,
    productId: line.productId,
    productName: line.productName,
    delta: {
      units: -(line.units ?? 0),
      lines: 0,
      amount: -line.net,
      net: -line.net,
      cost: -line.cost,
      profit: -(line.net - line.cost),
    },
  }));
  return { day, products };
}

/** Applies one sale return to the rollups (called inside the return's transaction). */
export async function applyReturn(ctx, ret, lines) {
  const { day, products } = returnDeltas(ret, lines);
  await addTo(ctx, 'dailySales', ret.date, EMPTY_DAY(ret.date), day.delta);
  for (const row of products) {
    await addTo(ctx, 'dailyProducts', row.key, EMPTY_PRODUCT(row.key, row.date, row.productId, row.productName), row.delta);
  }
}

const EMPTY_DAY = (date) => ({ date, invoices: 0, subtotal: 0, discount: 0, tax: 0, total: 0, cost: 0, profit: 0, cash: 0, bank: 0, credit: 0 });
const EMPTY_PRODUCT = (key, date, productId, productName) => ({ key, date, productId, productName, units: 0, lines: 0, amount: 0, net: 0, cost: 0, profit: 0 });
const EMPTY_CASH = (key, accountCode, date, group) => ({ key, accountCode, date, group, debit: 0, credit: 0 });
const EMPTY_PRACTICE = (date) => ({ date, count: 0, charged: 0, cost: 0, profit: 0 });

/** Adds a delta to a row, creating the row first if it does not exist. Keeps every other field. */
async function addTo(ctx, store, key, base, delta) {
  const row = (await ctx.get(store, key)) ?? base;
  const next = { ...row };
  for (const [field, value] of Object.entries(delta)) next[field] = (row[field] ?? 0) + value;
  return ctx.put(store, next);
}

/* ---------- Online updates (called inside the business transaction) ---------- */

/** Applies a sale (sign +1) or its void (sign −1) to the rollups. */
export async function applySale(ctx, sale, items, sign = 1) {
  const { day, products } = saleDeltas(sale, items, sign);
  await addTo(ctx, 'dailySales', sale.date, EMPTY_DAY(sale.date), day.delta);
  for (const row of products) {
    await addTo(ctx, 'dailyProducts', row.key, EMPTY_PRODUCT(row.key, row.date, row.productId, row.productName), row.delta);
  }
}

/** Applies a practice (sign +1) or its void (sign −1) to the practice rollup, on the practice's own date. */
export async function applyPractice(ctx, practice, sign = 1) {
  await addTo(ctx, 'dailyPractice', practice.date, EMPTY_PRACTICE(practice.date), {
    count: sign,
    charged: sign * practice.chargedAmount,
    cost: sign * practice.costTotal,
    profit: sign * practice.profit,
  });
}

/** Applies one cash-account line. Only the cash account (1000) has a rollup. */
export async function applyCashLine(ctx, { accountCode, date, group, debit = 0, credit = 0 }) {
  if (accountCode !== '1000') return;
  const key = `${accountCode}|${date}|${group}`;
  await addTo(ctx, 'dailyLedger', key, EMPTY_CASH(key, accountCode, date, group), { debit, credit });
}

/* ---------- Rebuild and status ---------- */

/**
 * Recomputes every rollup from the sales, their lines and the cash ledger. One transaction, so the rebuild either
 * lands in full or not at all, and no sale written meanwhile can be missed.
 */
export function rebuildRollups() {
  return db.transaction(async (ctx) => {
    ctx.clear('dailySales');
    ctx.clear('dailyProducts');
    ctx.clear('dailyLedger');
    ctx.clear('dailyPractice');

    const itemsBySale = new Map();
    for (const item of await ctx.getAll('saleItems')) {
      const list = itemsBySale.get(item.saleId) ?? [];
      list.push(item);
      itemsBySale.set(item.saleId, list);
    }

    // Accumulate in memory, then write each row once.
    const days = new Map();
    const products = new Map();
    const addDay = (day) => {
      const d = days.get(day.date) ?? EMPTY_DAY(day.date);
      for (const [field, value] of Object.entries(day.delta)) d[field] += value;
      days.set(day.date, d);
    };
    const addProduct = (line) => {
      const p = products.get(line.key) ?? EMPTY_PRODUCT(line.key, line.date, line.productId, line.productName);
      for (const [field, value] of Object.entries(line.delta)) p[field] += value;
      products.set(line.key, p);
    };
    for (const sale of await ctx.getAll('sales')) {
      if (sale.status === 'void') continue;
      const { day, products: lines } = saleDeltas(sale, itemsBySale.get(sale.id) ?? [], 1);
      addDay(day);
      lines.forEach(addProduct);
    }

    // Sale returns reduce the day they were made on, the same way applyReturn() does during normal use.
    const returnItemsByReturn = new Map();
    for (const item of await ctx.getAll('returnItems')) {
      const list = returnItemsByReturn.get(item.returnId) ?? [];
      list.push(item);
      returnItemsByReturn.set(item.returnId, list);
    }
    for (const ret of await ctx.getAll('returns')) {
      if (ret.type !== 'sale') continue;
      const { day, products: lines } = returnDeltas(ret, returnItemsByReturn.get(ret.id) ?? []);
      addDay(day);
      lines.forEach(addProduct);
    }

    const cash = new Map();
    const entries = await ctx.getAll('ledgerEntries', {
      index: 'accountDate',
      query: IDBKeyRange.bound(['acc-1000', ''], ['acc-1000', OPEN_END]),
    });
    for (const entry of entries) {
      const group = ledgerGroup(entry.docType, entry.memo);
      const key = `1000|${entry.date}|${group}`;
      const row = cash.get(key) ?? EMPTY_CASH(key, '1000', entry.date, group);
      row.debit += entry.debit;
      row.credit += entry.credit;
      cash.set(key, row);
    }

    // Practices: every practice that has no void event, grouped by its own date.
    const voided = new Set((await ctx.getAll('practiceVoids')).map((v) => v.practiceId));
    const practiceDays = new Map();
    for (const p of await ctx.getAll('practices')) {
      if (voided.has(p.id)) continue;
      const row = practiceDays.get(p.date) ?? EMPTY_PRACTICE(p.date);
      row.count += 1;
      row.charged += p.chargedAmount;
      row.cost += p.costTotal;
      row.profit += p.profit;
      practiceDays.set(p.date, row);
    }
    for (const row of practiceDays.values()) ctx.put('dailyPractice', row);
    for (const row of days.values()) ctx.put('dailySales', row);
    for (const row of products.values()) ctx.put('dailyProducts', row);
    for (const row of cash.values()) ctx.put('dailyLedger', row);
    ctx.put('settings', { key: 'rollups', value: { version: ROLLUP_VERSION, builtAt: new Date().toISOString() } });
    return { days: days.size, products: products.size, cash: cash.size };
  });
}

/** True when the rollups exist and match this version. */
export async function rollupsReady() {
  const flag = await db.get('settings', 'rollups');
  return flag?.value?.version === ROLLUP_VERSION;
}

/** Builds the rollups if they were never built (or were built by an older version). Returns true when it rebuilt. */
export async function ensureRollups() {
  if (await rollupsReady()) return false;
  await rebuildRollups();
  return true;
}
