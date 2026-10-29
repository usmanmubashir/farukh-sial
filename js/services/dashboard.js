// Numbers for the home screen. One read of each store, computed in memory. Nothing here writes.
import * as db from '../core/db.js';
import { addDays, todayISO } from '../core/dates.js';
import { listWithStock } from './products.js';
import { batchRows } from './stock.js';
import { accountBalance } from './ledger.js';
import { listOpen } from './demand.js';

/** Cash-like accounts: Cash in Hand (1000) and custom asset accounts numbered 10xx (banks, petty cash). */
const isCashCode = (code) => code.startsWith('10') && code !== '1100' && code !== '1200';

export async function getDashboard({ today = todayISO() } = {}) {
  const [sales, saleItems, accounts, entries, products, batches, open, settings] = await Promise.all([
    db.getAll('sales'),
    db.getAll('saleItems'),
    db.getAll('accounts'),
    db.getAll('ledgerEntries'),
    listWithStock({ includeInactive: false }),
    batchRows({ today }),
    listOpen(),
    db.getSetting('business', {}),
  ]);

  const live = sales.filter((s) => s.status !== 'void');
  const todays = live.filter((s) => s.date === today);
  const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);

  // Cash moved today and held now, from the ledger.
  const cashCodes = new Set(accounts.filter((a) => isCashCode(a.code)).map((a) => a.code));
  const cashRows = entries.filter((e) => cashCodes.has(e.accountCode));
  const cashIn = sum(cashRows.filter((e) => e.date === today), 'debit');
  const cashOut = sum(cashRows.filter((e) => e.date === today), 'credit');
  const cashHeld = sum(cashRows, 'debit') - sum(cashRows, 'credit');

  const receivable = (await accountBalance('1100')).balance;
  const payable = -(await accountBalance('2000')).balance;

  // Stock health.
  const withStock = batches.filter((b) => b.units > 0);
  const stockCost = sum(withStock, 'costValue');
  const stockRetail = sum(withStock, 'retailValue');
  const expired = withStock.filter((b) => b.bucket === 'expired');
  const expiringSoon = withStock.filter((b) => b.bucket === 'd30');
  const lowProducts = products.filter((p) => p.reorderLevel > 0 && p.units < p.reorderLevel * p.unitsPerPack && p.units > 0);
  const outProducts = products.filter((p) => p.units <= 0 && p.trackStock !== false);

  // Last seven days, oldest first.
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const week = days.map((day) => ({
    day,
    total: sum(live.filter((s) => s.date === day), 'total'),
    count: live.filter((s) => s.date === day).length,
  }));

  // Top medicines by value over the last 30 days.
  const from = addDays(today, -29);
  const liveIds = new Set(live.filter((s) => s.date >= from).map((s) => s.id));
  const byProduct = new Map();
  for (const item of saleItems) {
    if (!liveIds.has(item.saleId)) continue;
    const row = byProduct.get(item.productId) ?? { productId: item.productId, name: item.productName, amount: 0, units: 0 };
    row.amount += item.amount;
    row.units += item.units;
    byProduct.set(item.productId, row);
  }
  const topMedicines = [...byProduct.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);

  const recentSales = [...live].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 5);

  return {
    today,
    greetingHour: new Date().getHours(),
    pharmacyName: await db.getSetting('pharmacyName', ''),
    hero: {
      salesTotal: sum(todays, 'total'),
      invoices: todays.length,
      profit: sum(todays, 'profit'),
      cashIn,
      cashOut,
    },
    backup: { lastBackupAt: settings.lastBackupAt ?? null },
    attention: {
      expired: expired.length,
      expiring30: expiringSoon.length,
      lowOrOut: lowProducts.length + outProducts.length,
      orderList: open.length,
      productCount: products.length,
    },
    overview: {
      receivable,
      payable,
      stockCost,
      stockRetail,
      cashHeld,
    },
    week,
    topMedicines,
    expiringSoon: batches.filter((b) => b.units > 0 && ['expired', 'd30'].includes(b.bucket)).slice(0, 5),
    recentSales,
  };
}
