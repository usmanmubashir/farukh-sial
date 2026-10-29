// The report catalogue. Each report names its group, its columns and how its rows are loaded. The viewer in
// reports.js handles the filters, the virtual table, totals, the chart, print and CSV, so every report behaves the same.
//
// Column types: text, int, money (paisa), date, pct, input (the counted cash box on the daily closing).
// A column with sum: true gets a total in the totals row (money and int only).
import * as db from '../core/db.js';
import { t } from '../core/i18n.js';
import { listWithStock } from '../services/products.js';
import { listCustomers, listSuppliers, partySummaries } from '../services/parties.js';
import { accountKind, ledgerByAccount, listAccounts, listVouchers } from '../services/ledger.js';
import { listReturns } from '../services/returns.js';
import { listPurchases } from '../services/purchases.js';
import {
  dailyClosingFromCash,
  deadStockRows,
  expiryRows,
  groupProductRows,
  inRange,
  lowStockRows,
  profitFromDaily,
  purchaseGroups,
  readBatches,
  readCashDaily,
  readDailyProducts,
  readDailySales,
  readLastSold,
  readSales,
  stockByProduct,
} from '../services/reports.js';
import { ledgerGroup } from '../services/rollups.js';

export const GROUPS = [
  { key: 'inventory', reports: ['stock', 'batches', 'expiry', 'lowstock', 'dead'] },
  { key: 'sales', reports: ['daily', 'range', 'returns', 'medicine', 'company', 'salt'] },
  { key: 'purchases', reports: ['purchases', 'purchaseReturns', 'purchaseMedicine', 'supplier'] },
  { key: 'parties', reports: ['customerLedger', 'supplierLedger', 'receivables', 'payables'] },
  { key: 'accounts', reports: ['cashBook', 'accountLedger', 'dailyClosing', 'profit'] },
];

const partyLabel = (map, id) => map.get(id)?.name ?? '';

/** Product details by id, for the group keys (company, salt). */
async function productMap() {
  const products = await listWithStock({ includeInactive: true });
  return new Map(products.map((p) => [p.id, p]));
}

/** Reads the closing counts the user typed (stored as settings "closing.<date>"). */
async function countedMap() {
  const rows = await db.getAll('settings');
  const map = new Map();
  for (const row of rows) {
    if (row.key.startsWith('closing.')) map.set(row.key.slice(8), row.value);
  }
  return map;
}

/** The first customer and supplier names, read once per run. */
async function parties() {
  const [customers, suppliers] = await Promise.all([listCustomers(), listSuppliers()]);
  return { customers: new Map(customers.map((c) => [c.id, c])), suppliers: new Map(suppliers.map((s) => [s.id, s])) };
}

/* ---------- Definitions ---------- */

export const REPORTS = {
  /* Inventory */
  stock: {
    group: 'inventory', period: false, search: true,
    columns: [
      { key: 'name', label: 'rpt.col.medicine', type: 'text' },
      { key: 'packs', label: 'rpt.col.packs', type: 'int', sum: true },
      { key: 'looseUnits', label: 'rpt.col.loose', type: 'int' },
      { key: 'batches', label: 'rpt.col.batches', type: 'int' },
      { key: 'nearestExpiry', label: 'rpt.col.nearest', type: 'date' },
      { key: 'costValue', label: 'rpt.col.costValue', type: 'money', sum: true },
      { key: 'retailValue', label: 'rpt.col.retailValue', type: 'money', sum: true },
    ],
    async load() {
      const rows = stockByProduct(await readBatches());
      return { rows, text: ['name'] };
    },
  },
  batches: {
    group: 'inventory', period: false, search: true,
    columns: [
      { key: 'name', label: 'rpt.col.medicine', type: 'text' },
      { key: 'batchNo', label: 'rpt.col.batch', type: 'text' },
      { key: 'expiry', label: 'rpt.col.expiry', type: 'date' },
      { key: 'days', label: 'rpt.col.days', type: 'int' },
      { key: 'packs', label: 'rpt.col.packs', type: 'int', sum: true },
      { key: 'costValue', label: 'rpt.col.costValue', type: 'money', sum: true },
      { key: 'retailValue', label: 'rpt.col.retailValue', type: 'money', sum: true },
    ],
    async load() {
      const rows = (await readBatches()).filter((b) => b.units > 0).map((b) => ({
        name: b.productName, batchNo: b.batchNo, expiry: b.expiry, days: b.days, packs: b.packs,
        costValue: b.costValue, retailValue: b.retailValue,
      })).sort((a, b) => a.name.localeCompare(b.name) || a.expiry.localeCompare(b.expiry));
      return { rows, text: ['name', 'batchNo'] };
    },
  },
  expiry: {
    group: 'inventory', period: true, defaultPeriod: 'all', search: true,
    periodHint: 'rpt.hint.expiryDate',
    columns: [
      { key: 'name', label: 'rpt.col.medicine', type: 'text' },
      { key: 'batchNo', label: 'rpt.col.batch', type: 'text' },
      { key: 'expiry', label: 'rpt.col.expiry', type: 'date' },
      { key: 'days', label: 'rpt.col.days', type: 'int' },
      { key: 'packs', label: 'rpt.col.packs', type: 'int', sum: true },
      { key: 'costValue', label: 'rpt.col.costValue', type: 'money', sum: true },
    ],
    async load(ctx) {
      const rows = expiryRows(await readBatches(ctx.today), { from: ctx.from, to: ctx.to, today: ctx.today });
      return { rows, text: ['name', 'batchNo'] };
    },
  },
  lowstock: {
    group: 'inventory', period: false, search: true,
    columns: [
      { key: 'name', label: 'rpt.col.medicine', type: 'text' },
      { key: 'statusText', label: 'rpt.col.status', type: 'text' },
      { key: 'packs', label: 'rpt.col.packs', type: 'int' },
      { key: 'reorderLevel', label: 'rpt.col.reorderLevel', type: 'int' },
      { key: 'suggested', label: 'rpt.col.suggested', type: 'int', sum: true },
    ],
    async load() {
      const products = await listWithStock({ includeInactive: false });
      const rows = lowStockRows(products).map((r) => ({ ...r, statusText: t(`rpt.status.${r.status}`) }));
      return { rows, text: ['name', 'statusText'] };
    },
  },
  dead: {
    group: 'inventory', period: false, search: true, extras: ['days'],
    columns: [
      { key: 'name', label: 'rpt.col.medicine', type: 'text' },
      { key: 'packs', label: 'rpt.col.packs', type: 'int' },
      { key: 'costValue', label: 'rpt.col.costValue', type: 'money', sum: true },
      { key: 'lastSold', label: 'rpt.col.lastSold', type: 'date' },
      { key: 'daysSince', label: 'rpt.col.daysSince', type: 'int' },
    ],
    async load(ctx) {
      const [products, batches, lastSold] = await Promise.all([listWithStock({ includeInactive: false }), readBatches(ctx.today), readLastSold()]);
      const cost = new Map();
      for (const b of batches) cost.set(b.productId, (cost.get(b.productId) ?? 0) + b.costValue);
      const rows = deadStockRows({ products, lastSold, costByProduct: cost, today: ctx.today, days: ctx.days });
      return { rows, text: ['name'] };
    },
  },

  /* Sales */
  daily: {
    group: 'sales', period: true, chart: { key: 'total', label: 'rpt.col.total' },
    columns: [
      { key: 'date', label: 'rpt.col.date', type: 'date' },
      { key: 'invoices', label: 'rpt.col.invoices', type: 'int', sum: true },
      { key: 'total', label: 'rpt.col.total', type: 'money', sum: true },
      { key: 'discount', label: 'rpt.col.discount', type: 'money', sum: true },
      { key: 'tax', label: 'rpt.col.tax', type: 'money', sum: true },
      { key: 'cost', label: 'rpt.col.cost', type: 'money', sum: true },
      { key: 'profit', label: 'rpt.col.profit', type: 'money', sum: true },
      { key: 'cash', label: 'rpt.col.cash', type: 'money', sum: true },
      { key: 'bank', label: 'rpt.col.bank', type: 'money', sum: true },
      { key: 'credit', label: 'rpt.col.credit', type: 'money', sum: true },
    ],
    async load(ctx) {
      const rows = await readDailySales(ctx);
      return { rows, text: [] };
    },
  },
  range: {
    group: 'sales', period: true, search: true,
    columns: [
      { key: 'date', label: 'rpt.col.date', type: 'date' },
      { key: 'number', label: 'rpt.col.invoice', type: 'text' },
      { key: 'customer', label: 'rpt.col.customer', type: 'text' },
      { key: 'total', label: 'rpt.col.total', type: 'money', sum: true },
      { key: 'paid', label: 'rpt.col.paid', type: 'money', sum: true },
      { key: 'balance', label: 'rpt.col.balance', type: 'money', sum: true },
      { key: 'profit', label: 'rpt.col.profit', type: 'money', sum: true },
    ],
    async load(ctx) {
      const { customers } = await parties();
      const rows = (await readSales(ctx))
        .map((s) => ({
          date: s.date, number: s.number, customer: partyLabel(customers, s.customerId) || t('doc.walkIn'),
          total: s.total, paid: s.paid, balance: s.balance, profit: s.profit,
        }))
        .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
      return { rows, text: ['number', 'customer'] };
    },
  },
  returns: {
    group: 'sales', period: true, search: true,
    columns: [
      { key: 'date', label: 'rpt.col.date', type: 'date' },
      { key: 'number', label: 'rpt.col.returnNo', type: 'text' },
      { key: 'original', label: 'rpt.col.original', type: 'text' },
      { key: 'customer', label: 'rpt.col.customer', type: 'text' },
      { key: 'gross', label: 'rpt.col.value', type: 'money', sum: true },
      { key: 'refund', label: 'rpt.col.refund', type: 'money', sum: true },
      { key: 'credit', label: 'rpt.col.credit', type: 'money', sum: true },
    ],
    async load(ctx) {
      const { customers } = await parties();
      const returns = (await listReturns({ from: ctx.from, to: ctx.to, type: 'sale' }));
      const rows = [];
      for (const r of returns) {
        const sale = await db.get('sales', r.saleId);
        rows.push({
          date: r.date, number: r.number, original: sale?.number ?? '',
          customer: partyLabel(customers, r.customerId) || t('doc.walkIn'),
          gross: r.gross, refund: r.refund, credit: r.credit,
        });
      }
      return { rows, text: ['number', 'original', 'customer'] };
    },
  },
  medicine: {
    group: 'sales', period: true, search: true,
    columns: [
      { key: 'label', label: 'rpt.col.medicine', type: 'text' },
      { key: 'units', label: 'rpt.col.units', type: 'int', sum: true },
      { key: 'net', label: 'rpt.col.net', type: 'money', sum: true },
      { key: 'cost', label: 'rpt.col.cost', type: 'money', sum: true },
      { key: 'profit', label: 'rpt.col.profit', type: 'money', sum: true },
      { key: 'margin', label: 'rpt.col.margin', type: 'pct' },
    ],
    async load(ctx) {
      const rows = groupProductRows(await readDailyProducts(ctx), (row) => ({ key: row.productId, label: row.productName }));
      return { rows, text: ['label'], chart: { key: 'net', label: 'rpt.col.net' }, top: 30 };
    },
  },
  company: {
    group: 'sales', period: true, search: true,
    columns: [
      { key: 'label', label: 'rpt.col.company', type: 'text' },
      { key: 'units', label: 'rpt.col.units', type: 'int', sum: true },
      { key: 'net', label: 'rpt.col.net', type: 'money', sum: true },
      { key: 'cost', label: 'rpt.col.cost', type: 'money', sum: true },
      { key: 'profit', label: 'rpt.col.profit', type: 'money', sum: true },
      { key: 'margin', label: 'rpt.col.margin', type: 'pct' },
    ],
    async load(ctx) {
      const [lines, products] = await Promise.all([readDailyProducts(ctx), productMap()]);
      const rows = groupProductRows(lines, (item) => {
        const company = products.get(item.productId)?.company || t('rpt.none');
        return { key: company, label: company };
      });
      return { rows, text: ['label'] };
    },
  },
  salt: {
    group: 'sales', period: true, search: true,
    columns: [
      { key: 'label', label: 'rpt.col.salt', type: 'text' },
      { key: 'units', label: 'rpt.col.units', type: 'int', sum: true },
      { key: 'net', label: 'rpt.col.net', type: 'money', sum: true },
      { key: 'cost', label: 'rpt.col.cost', type: 'money', sum: true },
      { key: 'profit', label: 'rpt.col.profit', type: 'money', sum: true },
      { key: 'margin', label: 'rpt.col.margin', type: 'pct' },
    ],
    async load(ctx) {
      const [lines, products] = await Promise.all([readDailyProducts(ctx), productMap()]);
      const rows = groupProductRows(lines, (item) => {
        const salt = products.get(item.productId)?.generic || t('rpt.none');
        return { key: salt.toLowerCase(), label: salt };
      });
      return { rows, text: ['label'] };
    },
  },

  /* Purchases */
  purchases: {
    group: 'purchases', period: true, search: true,
    columns: [
      { key: 'date', label: 'rpt.col.date', type: 'date' },
      { key: 'number', label: 'rpt.col.number', type: 'text' },
      { key: 'supplier', label: 'rpt.col.supplier', type: 'text' },
      { key: 'total', label: 'rpt.col.total', type: 'money', sum: true },
      { key: 'paid', label: 'rpt.col.paid', type: 'money', sum: true },
      { key: 'balance', label: 'rpt.col.due', type: 'money', sum: true },
    ],
    async load(ctx) {
      const { suppliers } = await parties();
      const rows = (await listPurchases(ctx)).map((p) => ({
        date: p.date, number: p.number, supplier: partyLabel(suppliers, p.supplierId) || t('doc.walkIn'),
        total: p.total, paid: p.paid, balance: p.balance,
      }));
      return { rows, text: ['number', 'supplier'] };
    },
  },
  purchaseReturns: {
    group: 'purchases', period: true, search: true,
    columns: [
      { key: 'date', label: 'rpt.col.date', type: 'date' },
      { key: 'number', label: 'rpt.col.returnNo', type: 'text' },
      { key: 'original', label: 'rpt.col.original', type: 'text' },
      { key: 'supplier', label: 'rpt.col.supplier', type: 'text' },
      { key: 'gross', label: 'rpt.col.value', type: 'money', sum: true },
      { key: 'refund', label: 'rpt.col.refund', type: 'money', sum: true },
      { key: 'credit', label: 'rpt.col.credit', type: 'money', sum: true },
    ],
    async load(ctx) {
      const { suppliers } = await parties();
      const rows = [];
      for (const r of await listReturns({ from: ctx.from, to: ctx.to, type: 'purchase' })) {
        const purchase = await db.get('purchases', r.purchaseId);
        rows.push({
          date: r.date, number: r.number, original: purchase?.number ?? '', supplier: partyLabel(suppliers, r.supplierId) || t('doc.walkIn'),
          gross: r.gross, refund: r.refund, credit: r.credit,
        });
      }
      return { rows, text: ['number', 'original', 'supplier'] };
    },
  },
  purchaseMedicine: {
    group: 'purchases', period: true, search: true,
    columns: [
      { key: 'name', label: 'rpt.col.medicine', type: 'text' },
      { key: 'packs', label: 'rpt.col.packs', type: 'int', sum: true },
      { key: 'amount', label: 'rpt.col.amount', type: 'money', sum: true },
      { key: 'lines', label: 'rpt.col.lines', type: 'int', sum: true },
    ],
    async load(ctx) {
      const purchases = await listPurchases(ctx);
      const ids = new Set(purchases.map((p) => p.id));
      const groups = new Map();
      await db.each('purchaseItems', {}, (line) => {
        if (!ids.has(line.purchaseId)) return;
        const row = groups.get(line.productId) ?? { name: line.productName, packs: 0, amount: 0, lines: 0 };
        row.packs += line.packs;
        row.amount += line.amount;
        row.lines += 1;
        groups.set(line.productId, row);
      });
      return { rows: [...groups.values()].sort((a, b) => b.amount - a.amount), text: ['name'] };
    },
  },
  supplier: {
    group: 'purchases', period: true, search: true,
    columns: [
      { key: 'label', label: 'rpt.col.supplier', type: 'text' },
      { key: 'documents', label: 'rpt.col.documents', type: 'int', sum: true },
      { key: 'total', label: 'rpt.col.total', type: 'money', sum: true },
      { key: 'paid', label: 'rpt.col.paid', type: 'money', sum: true },
      { key: 'due', label: 'rpt.col.due', type: 'money', sum: true },
    ],
    async load(ctx) {
      const { suppliers } = await parties();
      const rows = purchaseGroups(await listPurchases(ctx), (p) => ({
        key: p.supplierId ?? '', label: partyLabel(suppliers, p.supplierId) || t('doc.walkIn'),
      }));
      return { rows, text: ['label'] };
    },
  },

  /* Parties */
  customerLedger: {
    group: 'parties', period: true, defaultPeriod: 'all', search: false, extras: ['party:customer'],
    columns: [
      { key: 'date', label: 'rpt.col.date', type: 'date' },
      { key: 'memo', label: 'rpt.col.document', type: 'text' },
      { key: 'typeText', label: 'rpt.col.type', type: 'text' },
      { key: 'debit', label: 'rpt.col.debit', type: 'money', sum: true },
      { key: 'credit', label: 'rpt.col.credit', type: 'money', sum: true },
      { key: 'balance', label: 'rpt.col.balance', type: 'money' },
    ],
    async load(ctx) {
      return partyLedgerRows({ kind: 'customer', ...ctx });
    },
  },
  supplierLedger: {
    group: 'parties', period: true, defaultPeriod: 'all', search: false, extras: ['party:supplier'],
    columns: [
      { key: 'date', label: 'rpt.col.date', type: 'date' },
      { key: 'memo', label: 'rpt.col.document', type: 'text' },
      { key: 'typeText', label: 'rpt.col.type', type: 'text' },
      { key: 'debit', label: 'rpt.col.debit', type: 'money', sum: true },
      { key: 'credit', label: 'rpt.col.credit', type: 'money', sum: true },
      { key: 'balance', label: 'rpt.col.balance', type: 'money' },
    ],
    async load(ctx) {
      return partyLedgerRows({ kind: 'supplier', ...ctx });
    },
  },
  receivables: {
    group: 'parties', period: false, search: true,
    columns: [
      { key: 'name', label: 'rpt.col.customer', type: 'text' },
      { key: 'phone', label: 'rpt.col.phone', type: 'text' },
      { key: 'owed', label: 'rpt.col.balance', type: 'money', sum: true },
    ],
    async load() {
      const { rows } = await partySummaries('customer', { includeInactive: true });
      return { rows: rows.filter((r) => r.owed !== 0).sort((a, b) => b.owed - a.owed), text: ['name', 'phone'] };
    },
  },
  payables: {
    group: 'parties', period: false, search: true,
    columns: [
      { key: 'name', label: 'rpt.col.supplier', type: 'text' },
      { key: 'phone', label: 'rpt.col.phone', type: 'text' },
      { key: 'owed', label: 'rpt.col.balance', type: 'money', sum: true },
    ],
    async load() {
      const { rows } = await partySummaries('supplier', { includeInactive: true });
      return { rows: rows.filter((r) => r.owed !== 0).sort((a, b) => b.owed - a.owed), text: ['name', 'phone'] };
    },
  },

  /* Accounts */
  cashBook: {
    group: 'accounts', period: true, defaultPeriod: 'all', search: true, extras: ['account:money'],
    columns: [
      { key: 'date', label: 'rpt.col.date', type: 'date' },
      { key: 'memo', label: 'rpt.col.document', type: 'text' },
      { key: 'typeText', label: 'rpt.col.type', type: 'text' },
      { key: 'partyName', label: 'rpt.col.party', type: 'text' },
      { key: 'debit', label: 'rpt.col.in', type: 'money', sum: true },
      { key: 'credit', label: 'rpt.col.out', type: 'money', sum: true },
      { key: 'balance', label: 'rpt.col.balance', type: 'money' },
    ],
    async load(ctx) {
      return accountLedgerRows(ctx.account ?? '1000', ctx);
    },
  },
  accountLedger: {
    group: 'accounts', period: true, defaultPeriod: 'all', search: true, extras: ['account:all'],
    columns: [
      { key: 'date', label: 'rpt.col.date', type: 'date' },
      { key: 'memo', label: 'rpt.col.document', type: 'text' },
      { key: 'typeText', label: 'rpt.col.type', type: 'text' },
      { key: 'partyName', label: 'rpt.col.party', type: 'text' },
      { key: 'debit', label: 'rpt.col.debit', type: 'money', sum: true },
      { key: 'credit', label: 'rpt.col.credit', type: 'money', sum: true },
      { key: 'balance', label: 'rpt.col.balance', type: 'money' },
    ],
    async load(ctx) {
      return accountLedgerRows(ctx.account ?? '1000', ctx);
    },
  },
  dailyClosing: {
    group: 'accounts', period: true, search: false, chart: null,
    columns: [
      { key: 'date', label: 'rpt.col.date', type: 'date' },
      { key: 'opening', label: 'rpt.col.opening', type: 'money' },
      { key: 'salesIn', label: 'rpt.col.salesIn', type: 'money', sum: true },
      { key: 'receiptsIn', label: 'rpt.col.receiptsIn', type: 'money', sum: true },
      { key: 'otherIn', label: 'rpt.col.otherIn', type: 'money', sum: true },
      { key: 'paymentsOut', label: 'rpt.col.paymentsOut', type: 'money', sum: true },
      { key: 'purchasesOut', label: 'rpt.col.purchasesOut', type: 'money', sum: true },
      { key: 'expensesOut', label: 'rpt.col.expensesOut', type: 'money', sum: true },
      { key: 'otherOut', label: 'rpt.col.otherOut', type: 'money', sum: true },
      { key: 'expected', label: 'rpt.col.expected', type: 'money' },
      { key: 'counted', label: 'rpt.col.counted', type: 'input' },
      { key: 'difference', label: 'rpt.col.difference', type: 'money' },
    ],
    async load(ctx) {
      const [cashRows, counted] = await Promise.all([readCashDaily(), countedMap()]);
      const rows = dailyClosingFromCash({ rows: cashRows, from: ctx.from, to: ctx.to, counted });
      return { rows, text: [] };
    },
  },
  profit: {
    group: 'accounts', period: true, search: false, extras: ['by'], chart: { key: 'netProfit', label: 'rpt.col.netProfit' },
    columns: [
      { key: 'period', label: 'rpt.col.period', type: 'text' },
      { key: 'invoices', label: 'rpt.col.invoices', type: 'int', sum: true },
      { key: 'revenue', label: 'rpt.col.revenue', type: 'money', sum: true },
      { key: 'cost', label: 'rpt.col.cost', type: 'money', sum: true },
      { key: 'grossProfit', label: 'rpt.col.grossProfit', type: 'money', sum: true },
      { key: 'returnsProfit', label: 'rpt.col.returnsProfit', type: 'money', sum: true },
      { key: 'expenses', label: 'rpt.col.expenses', type: 'money', sum: true },
      { key: 'netProfit', label: 'rpt.col.netProfit', type: 'money', sum: true },
    ],
    async load(ctx) {
      const [days, returns, expenses] = await Promise.all([
        readDailySales(ctx),
        listReturns({ from: ctx.from, to: ctx.to }),
        listVouchers({ from: ctx.from, to: ctx.to, type: 'expense' }),
      ]);
      const rows = profitFromDaily({ days, returns, expenses, granularity: ctx.by ?? 'day' });
      return { rows, text: [] };
    },
  },
};

/* ---------- Ledger rows ---------- */

const DOC_KEY = {
  opening: 'party.doc.opening', sale: 'party.doc.sale', saleReturn: 'party.doc.saleReturn', receipt: 'party.doc.receipt',
  payment: 'party.doc.payment', purchase: 'party.doc.purchase', purchaseReturn: 'party.doc.purchaseReturn', voucher: 'party.doc.voucher',
};

async function partyLedgerRows({ kind, party, from, to }) {
  if (!party) return { rows: [], text: [], needs: 'rpt.pickParty' };
  const account = kind === 'customer' ? '1100' : '2000';
  const sign = kind === 'customer' ? 1 : -1;
  const lines = await ledgerByAccount(account, { partyId: party });
  const rows = lines
    .filter((line) => inRange(line.date, from, to))
    .map((line) => ({
      date: line.date, memo: line.memo ?? '', typeText: t(DOC_KEY[line.docType] ?? 'party.doc.voucher'),
      debit: line.debit, credit: line.credit, balance: sign * line.running,
    }));
  return { rows, text: ['memo', 'typeText'] };
}

async function accountLedgerRows(code, { from, to }) {
  const [lines, customers, suppliers] = await Promise.all([ledgerByAccount(code), listCustomers(), listSuppliers()]);
  const names = new Map([...customers, ...suppliers].map((p) => [p.id, p.name]));
  const rows = lines
    .filter((line) => inRange(line.date, from, to))
    .map((line) => ({
      date: line.date,
      memo: line.memo ?? '',
      typeText: t(`cash.group.${ledgerGroup(line.docType, line.memo)}`),
      partyName: names.get(line.partyId) ?? '',
      debit: line.debit,
      credit: line.credit,
      balance: line.running,
    }));
  return { rows, text: ['memo', 'typeText', 'partyName'] };
}

/** Accounts for the pickers: money accounts only (cash, banks, wallets), or every account when all is true. */
export async function accountChoices(all = false) {
  const accounts = await listAccounts();
  return accounts.filter((a) => all || Boolean(accountKind(a)));
}
