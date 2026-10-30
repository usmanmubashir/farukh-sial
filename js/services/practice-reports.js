// Reports for Practice and for sales against practice. Readers read the stores once per run; the maths is pure, so it
// is tested without a database. Nothing here writes. Money is integer paisa throughout.
//
// The shares of a practice: a practice's charged amount is split across its items in proportion to each item's list
// price, and the last item of a practice takes the rounding, so the shares always add up to the charged amount.
import * as db from '../core/db.js';
import { OPEN_END } from './reports.js';
import { daysBetween } from './stock.js';
import { listPractices } from './practice.js';
import { listWithStock } from './products.js';
import { readDailySales, readLastSold, readSales } from './reports.js';

/* ---------- Pure maths ---------- */

/** Practice figures for the active (not voided) rows: totals, averages, margin, and the best and worst by profit. */
export function practiceKpis(rows) {
  const active = rows.filter((row) => !row.voided);
  const count = active.length;
  const charged = active.reduce((sum, row) => sum + row.charged, 0);
  const cost = active.reduce((sum, row) => sum + row.cost, 0);
  const profit = charged - cost;
  let best = null;
  let worst = null;
  for (const row of active) {
    if (!best || row.profit > best.profit) best = row;
    if (!worst || row.profit < worst.profit) worst = row;
  }
  return {
    count,
    charged,
    cost,
    profit,
    averageCharge: count ? Math.round(charged / count) : 0,
    averageProfit: count ? Math.round(profit / count) : 0,
    margin: charged > 0 ? profit / charged : null,
    best,
    worst,
  };
}

/** One point per day with charged, cost and profit, oldest first. Voided practices are left out. */
export function practiceTrend(rows) {
  const days = new Map();
  for (const row of rows) {
    if (row.voided) continue;
    const day = days.get(row.date) ?? { date: row.date, charged: 0, cost: 0, profit: 0 };
    day.charged += row.charged;
    day.cost += row.cost;
    day.profit += row.profit;
    days.set(row.date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The charged amount of each practice split across its items, by list price. Returns Map itemId → share (paisa).
 * A practice whose items have no list value puts all its charge on its first item.
 */
export function chargedShares(practices, items) {
  const byPractice = new Map();
  for (const item of items) {
    const list = byPractice.get(item.practiceId) ?? [];
    list.push(item);
    byPractice.set(item.practiceId, list);
  }
  const shares = new Map();
  for (const practice of practices) {
    const own = byPractice.get(practice.id) ?? [];
    if (own.length === 0) continue;
    const listTotal = own.reduce((sum, item) => sum + item.lineList, 0);
    let left = practice.chargedAmount;
    own.forEach((item, index) => {
      const share = index === own.length - 1
        ? left
        : listTotal > 0 ? Math.round((practice.chargedAmount * item.lineList) / listTotal) : index === 0 ? practice.chargedAmount : 0;
      shares.set(item.id, share);
      left -= share;
    });
  }
  return shares;
}

/** Quantity as packs and loose units, for a product with the given units per pack. */
export function packsText(units, unitsPerPack) {
  const packs = Math.floor(units / unitsPerPack);
  const loose = units % unitsPerPack;
  return { packs, loose };
}

/* ---------- Readers ---------- */

/** Practice rows for [from, to]: one per practice, newest first. */
export async function practiceReportRows({ from = '', to = OPEN_END, showVoided = false } = {}) {
  const practices = await listPractices({ from, to, includeVoided: showVoided });
  return practices.map((p) => ({
    id: p.id,
    date: p.date,
    number: p.number,
    dateTime: p.dateTime,
    patientName: p.patientName,
    cost: p.costTotal,
    charged: p.chargedAmount,
    profit: p.profit,
    voided: p.voided,
  }));
}

/** Practice by medicine for [from, to]: quantity, cost, the charged share and the profit share of each medicine. */
export async function practiceByMedicine({ from = '', to = OPEN_END, showVoided = false } = {}) {
  const practices = await listPractices({ from, to, includeVoided: showVoided });
  const inRange = new Set(practices.map((p) => p.id));
  const items = (await db.getAll('practiceItems')).filter((item) => inRange.has(item.practiceId));
  const shares = chargedShares(practices, items);
  const products = new Map((await listWithStock({ includeInactive: true })).map((p) => [p.id, p]));
  const groups = new Map();
  for (const item of items) {
    const g = groups.get(item.productId) ?? {
      key: item.productId,
      label: products.get(item.productId)?.name ?? item.productName,
      units: 0,
      cost: 0,
      charged: 0,
      practices: new Set(),
    };
    const share = shares.get(item.id) ?? 0;
    g.units += item.qtyUnits;
    g.cost += item.lineCost;
    g.charged += share;
    g.practices.add(item.practiceId);
    groups.set(item.productId, g);
  }
  return [...groups.values()]
    .map((g) => ({
      key: g.key,
      label: g.label,
      units: g.units,
      cost: g.cost,
      charged: g.charged,
      profit: g.charged - g.cost,
      practices: g.practices.size,
    }))
    .sort((a, b) => b.charged - a.charged || a.label.localeCompare(b.label));
}

/**
 * Sold medicines, from sales (net of returns) and practice (not voided), for [from, to].
 * source: 'both' | 'sales' | 'practice'. Returns every medicine that sold, with each source kept apart.
 */
export async function soldByProduct({ from = '', to = OPEN_END, source = 'both' } = {}) {
  const products = new Map((await listWithStock({ includeInactive: true })).map((p) => [p.id, p]));
  const sold = new Map();
  const add = (productId, name, part) => {
    const g = sold.get(productId) ?? {
      productId,
      name: products.get(productId)?.name ?? name,
      company: products.get(productId)?.company ?? '',
      unitsPerPack: products.get(productId)?.unitsPerPack ?? 1,
      soldAs: products.get(productId)?.soldAs ?? 'pack',
      unitName: products.get(productId)?.unitName ?? 'unit',
      units: 0,
      revenue: 0,
      cost: 0,
      lastSold: '',
    };
    g.units += part.units;
    g.revenue += part.revenue;
    g.cost += part.cost;
    if (part.date > g.lastSold) g.lastSold = part.date;
    sold.set(productId, g);
  };

  if (source !== 'practice') {
    const sales = await readSales({ from, to });
    const dateOf = new Map(sales.map((s) => [s.id, s.date]));
    for (const item of await db.getAll('saleItems')) {
      const date = dateOf.get(item.saleId);
      if (!date) continue;
      const units = item.units - (item.returnedUnits ?? 0);
      if (units <= 0) continue;
      const revenue = item.amount - (item.returnedAmount ?? 0);
      const cost = item.units > 0 ? Math.round((item.cost * units) / item.units) : 0;
      add(item.productId, item.productName, { units, revenue, cost, date });
    }
  }

  if (source !== 'sales') {
    const practices = await listPractices({ from, to, includeVoided: false });
    const items = (await db.getAll('practiceItems')).filter((item) => practices.some((p) => p.id === item.practiceId));
    const shares = chargedShares(practices, items);
    const dateOf = new Map(practices.map((p) => [p.id, p.date]));
    for (const item of items) {
      add(item.productId, item.productName, {
        units: item.qtyUnits,
        revenue: shares.get(item.id) ?? 0,
        cost: item.lineCost,
        date: dateOf.get(item.practiceId),
      });
    }
  }
  return [...sold.values()];
}

/** The value a ranking uses: quantity in units, revenue, or profit. */
export const rankValue = (row, rank) => (rank === 'revenue' ? row.revenue : rank === 'profit' ? row.revenue - row.cost : row.units);

/** Top sellers: ranked, with the total of the whole list as the base for each share. */
export async function topProducts({ from = '', to = OPEN_END, source = 'both', rank = 'qty', limit = 20 } = {}) {
  const sold = (await soldByProduct({ from, to, source })).filter((row) => row.units > 0);
  const metric = rank === 'revenue' ? 'revenue' : rank === 'profit' ? 'profit' : 'qty';
  const totals = sold.reduce((sum, row) => ({
    units: sum.units + row.units,
    revenue: sum.revenue + row.revenue,
    cost: sum.cost + row.cost,
  }), { units: 0, revenue: 0, cost: 0 });
  const whole = rankValue({ units: totals.units, revenue: totals.revenue, cost: totals.cost }, rank);
  const ranked = sold
    .map((row) => {
      const profit = row.revenue - row.cost;
      const value = rankValue(row, rank);
      const { packs, loose } = packsText(row.units, row.unitsPerPack);
      return {
        key: row.productId,
        name: row.name,
        company: row.company,
        units: row.units,
        qtyText: `${packs} ${row.soldAs}${loose ? ` + ${loose} ${row.unitName}` : ''}`,
        revenue: row.revenue,
        cost: row.cost,
        profit,
        margin: row.revenue > 0 ? profit / row.revenue : null,
        share: whole > 0 ? value / whole : 0,
        value,
        metric,
      };
    })
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const bottom = {
    units: totals.units,
    revenue: totals.revenue,
    cost: totals.cost,
    profit: totals.revenue - totals.cost,
    count: sold.length,
  };
  return { rows: limit ? ranked.slice(0, limit) : ranked, bottom, all: ranked.length };
}

/**
 * Slow movers: medicines with stock, least sold first (never sold first of all), with the days since the last sale.
 * "Sold" counts sales and practice together.
 */
export async function slowMovers({ from = '', to = OPEN_END, today = '', limit = 50 } = {}) {
  const sold = new Map((await soldByProduct({ from, to, source: 'both' })).map((row) => [row.productId, row]));
  const lastSoldBySale = await readLastSold();
  const practiceItems = await db.getAll('practiceItems');
  const practices = await listPractices({ includeVoided: false });
  const activeIds = new Set(practices.map((p) => p.id));
  const lastPractice = new Map();
  for (const item of practiceItems) {
    if (!activeIds.has(item.practiceId) || !item.date) continue;
    if (!lastPractice.get(item.productId) || item.date > lastPractice.get(item.productId)) lastPractice.set(item.productId, item.date);
  }
  const products = await listWithStock({ includeInactive: false });
  const rows = products
    .filter((p) => p.trackStock !== false && (p.units ?? 0) > 0)
    .map((p) => {
      const soldRow = sold.get(p.id);
      const last = [lastSoldBySale.get(p.id) ?? '', lastPractice.get(p.id) ?? ''].sort().pop() || '';
      const { packs, looseUnits } = { packs: p.packs ?? 0, looseUnits: p.looseUnits ?? 0 };
      return {
        key: p.id,
        name: p.name,
        company: p.company ?? '',
        sold: soldRow?.units ?? 0,
        stockText: `${packs} ${p.soldAs ?? 'pack'}${looseUnits ? ` + ${looseUnits} ${p.unitName ?? 'unit'}` : ''}`,
        lastSold: last,
        daysSince: last && today ? daysBetween(last, today) : null,
      };
    })
    .sort((a, b) => a.sold - b.sold || (b.daysSince ?? 99999) - (a.daysSince ?? 99999) || a.name.localeCompare(b.name));
  return limit ? rows.slice(0, limit) : rows;
}

/** Sales and practice side by side, per day or per month, from the two rollups. Oldest first. */
export async function salesVsPracticeRows({ from = '', to = OPEN_END, by = 'day' } = {}) {
  const [days, practiceDays] = await Promise.all([
    readDailySales({ from, to }),
    db.getAll('dailyPractice', { query: IDBKeyRange.bound(from || '', to || '￿') }),
  ]);
  const key = (date) => (by === 'month' ? date.slice(0, 7) : date);
  const periods = new Map();
  const at = (k) => periods.get(k) ?? { period: k, salesRevenue: 0, practiceCharged: 0, salesProfit: 0, practiceProfit: 0 };
  for (const day of days) {
    const p = at(key(day.date));
    p.salesRevenue += day.total;
    p.salesProfit += day.profit;
    periods.set(p.period, p);
  }
  for (const day of practiceDays) {
    const p = at(key(day.date));
    p.practiceCharged += day.charged;
    p.practiceProfit += day.profit;
    periods.set(p.period, p);
  }
  return [...periods.values()]
    .map((p) => ({ ...p, total: p.salesRevenue + p.practiceCharged }))
    .sort((a, b) => a.period.localeCompare(b.period));
}
