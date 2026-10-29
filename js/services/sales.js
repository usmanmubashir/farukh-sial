// Sales: create, void, and hold/resume carts.
//
// A sale is one atomic transaction: validation, FEFO allocation (or a manual batch), stock movements, the sale and
// its lines, the document number, the ledger entry, the Rx register rows and the outbox rows. A failure rolls it all back.
//
//   line    = packs × packPrice + looseUnits × loosePrice − lineDiscount
//   total   = subtotal − discount + tax          (discount: amount, or a percentage of the subtotal)
//   paid    = cash applied + bank/wallet applied; cash tendered may be more, and the difference is change
//   balance = total − paid, owed by the customer (udhaar). Walk-in sales must be paid in full.
//   cost    = cost of the batches the units came from (per allocation)
//   profit  = (total − tax) − cost
import * as db from '../core/db.js';
import { todayISO } from '../core/dates.js';
import { percentOf, sum } from '../core/money.js';
import { ServiceError, missing, optionalInt, requireInt, requireOneOf } from './errors.js';
import { allocateFEFOIn, applyMovementIn, costOfUnits } from './stock.js';
import { ACCOUNT, postEntryIn, requirePaymentAccount, reversalLines, saleLines } from './ledger.js';
import { nextDocNumber } from './numbering.js';
import { readSettingsIn } from './settings.js';

export const PAYMENT_METHODS = ['cash', 'card', 'bank', 'mobile'];
const DETAILS_REQUIRED_CLASSES = ['rx', 'controlled'];

/** Price of one line. Price edits are allowed only when the setting allows them. */
function priceLine(product, raw, settings) {
  const packPrice = optionalInt(raw.packPrice, 'packPrice', 0, product.salePricePerPack);
  const loosePrice = optionalInt(raw.loosePrice, 'loosePrice', 0, product.looseUnitPrice);
  const edited = packPrice !== product.salePricePerPack || loosePrice !== product.looseUnitPrice;
  if (edited && settings.allowPriceEdit === false) throw new ServiceError('priceEditNotAllowed', { product: product.name });
  return { packPrice, loosePrice };
}

/**
 * Creates a sale inside the caller's transaction.
 * input: {
 *   customer, items: [{ productId, packs, looseUnits, packPrice?, loosePrice?, lineDiscount?, batchId? }],
 *   discount (paisa) or discountPercent, tax, payments: [{ method, amount }], tendered (cash handed over),
 *   patient, doctor, note, date, today
 * }
 */
export async function createSaleIn(ctx, input) {
  const settings = await readSettingsIn(ctx);
  const today = input.today ?? todayISO();
  const date = input.date ?? today;
  const customerId = input.customer || null;

  if (!Array.isArray(input.items) || input.items.length === 0) throw new ServiceError('emptyCart');
  let customer = null;
  if (customerId) {
    customer = await ctx.get('customers', customerId);
    if (!customer) throw missing('customer', customerId);
  }

  // 1. Validate and price every line.
  const lines = [];
  for (const raw of input.items) {
    const packs = optionalInt(raw.packs, 'packs', 0, 0);
    const looseUnits = optionalInt(raw.looseUnits, 'looseUnits', 0, 0);
    if (packs + looseUnits <= 0) throw new ServiceError('invalidField', { field: 'quantity' });
    const product = await ctx.get('products', raw.productId);
    if (!product) throw missing('product', raw.productId);
    if (!product.active) throw new ServiceError('productInactive', { product: product.name });
    if (looseUnits > 0 && !product.looseSelling) throw new ServiceError('looseNotAllowed', { product: product.name });
    const { packPrice, loosePrice } = priceLine(product, raw, settings);
    const gross = packs * packPrice + looseUnits * loosePrice;
    const lineDiscount = optionalInt(raw.lineDiscount, 'lineDiscount', 0, 0);
    if (lineDiscount > gross) throw new ServiceError('discountTooLarge', { subtotal: gross });
    lines.push({
      product,
      packs,
      looseUnits,
      units: packs * product.unitsPerPack + looseUnits,
      packPrice,
      loosePrice,
      lineDiscount,
      batchId: raw.batchId || null,
      amount: gross - lineDiscount,
    });
  }

  // 2. Rx and controlled items need patient and doctor when the setting says so.
  const patient = String(input.patient ?? '').trim();
  const doctor = String(input.doctor ?? '').trim();
  const isRx = (line) => DETAILS_REQUIRED_CLASSES.includes(line.product.class);
  if (lines.some(isRx) && settings.rxRequiresPatientDoctor && (!patient || !doctor)) {
    throw new ServiceError('patientDoctorRequired');
  }

  // 3. Totals and payments.
  const subtotal = sum(lines.map((line) => line.amount));
  const discount = input.discountPercent !== undefined && input.discountPercent !== null && input.discountPercent !== ''
    ? percentOf(subtotal, Math.min(100, Math.max(0, Number(input.discountPercent))))
    : optionalInt(input.discount, 'discount', 0, 0);
  if (discount > subtotal) throw new ServiceError('discountTooLarge', { subtotal });
  const tax = optionalInt(input.tax, 'tax', 0, 0);
  const total = subtotal - discount + tax;
  if (total <= 0) throw new ServiceError('emptyTotal');

  // Each payment goes to a money account: cash goes to the drawer, anything else to the account picked (bank by default).
  const payments = [];
  for (const p of input.payments ?? []) {
    const method = requireOneOf(p.method, PAYMENT_METHODS, 'method');
    const accountCode = method === 'cash' ? ACCOUNT.cash : String(p.accountCode || ACCOUNT.bank);
    if (method !== 'cash') await requirePaymentAccount(ctx, accountCode);
    payments.push({ method, accountCode, amount: requireInt(p.amount, 'amount', 1) });
  }
  const receipts = [...payments.reduce((map, p) => map.set(p.accountCode, (map.get(p.accountCode) ?? 0) + p.amount), new Map())]
    .map(([accountCode, amount]) => ({ accountCode, amount }));
  const paidCash = sum(payments.filter((p) => p.method === 'cash').map((p) => p.amount));
  const paidBank = sum(payments.filter((p) => p.method !== 'cash').map((p) => p.amount));
  const paid = paidCash + paidBank;
  if (paid > total) throw new ServiceError('overpaid', { total, paid });
  const tendered = input.tendered === undefined || input.tendered === null || input.tendered === '' ? paidCash : requireInt(input.tendered, 'tendered', 0);
  if (tendered < paidCash) throw new ServiceError('tenderedTooLow', { due: paidCash });
  const change = tendered - paidCash;
  const balance = total - paid;
  if (balance > 0 && !customer) throw new ServiceError('walkInCredit');

  // 4. Allocate and move stock. Each allocation is a movement, so a shortage aborts the whole sale.
  const saleId = db.newId();
  const saleItems = [];
  let cost = 0;
  for (const line of lines) {
    // Products that do not track stock (services, bundles) sell without allocating batches.
    const allocations = line.product.trackStock === false
      ? []
      : await allocateFEFOIn(ctx, line.product.id, line.units, { today, batchId: line.batchId });
    for (const a of allocations) {
      await applyMovementIn(ctx, {
        productId: line.product.id,
        batchId: a.batchId,
        units: -a.units,
        type: 'sale',
        docType: 'sale',
        docId: saleId,
        date,
      });
    }
    const itemCost = sum(allocations.map((a) => costOfUnits(a.costPerPack, a.unitsPerPack, a.units)));
    cost += itemCost;
    saleItems.push({
      id: db.newId(),
      saleId,
      productId: line.product.id,
      productName: line.product.name,
      strength: line.product.strength ?? '',
      class: line.product.class,
      packs: line.packs,
      looseUnits: line.looseUnits,
      units: line.units,
      unitPricePack: line.packPrice,
      unitPriceLoose: line.loosePrice,
      lineDiscount: line.lineDiscount,
      amount: line.amount,
      cost: itemCost,
      allocations,
      returnedUnits: 0,
      returnedAmount: 0,
    });
  }

  // 5. Persist the document, the Rx register rows, then the ledger.
  const number = await nextDocNumber(ctx, 'sale');
  const profit = total - tax - cost;
  const sale = ctx.put('sales', {
    id: saleId,
    number,
    date,
    customerId,
    subtotal,
    discount,
    tax,
    total,
    paid,
    paidCash,
    paidBank,
    tendered,
    change,
    balance,
    cost,
    profit,
    patient,
    doctor,
    note: String(input.note ?? '').trim(),
    payments,
    status: 'completed',
    returnedTotal: 0,
  });
  for (const item of saleItems) ctx.put('saleItems', item);

  for (const item of saleItems.filter((i) => ['rx', 'controlled'].includes(i.class))) {
    ctx.put('rxRegister', {
      id: db.newId(),
      saleId,
      saleNumber: number,
      date,
      customerId,
      productId: item.productId,
      productName: item.productName,
      strength: item.strength,
      class: item.class,
      units: item.units,
      batches: item.allocations.map((a) => a.batchNo),
      patient,
      doctor,
    });
  }

  const entryId = await postEntryIn(ctx, {
    date,
    docType: 'sale',
    docId: saleId,
    memo: number,
    lines: saleLines({ receipts, paid, paidCash, paidBank, balance, net: total - tax, tax, cost, customerId }),
  });
  return { ...sale, items: saleItems, entryId };
}

export function createSale(input) {
  return db.transaction((ctx) => createSaleIn(ctx, input));
}

/**
 * Voids a sale. Allowed only with no returns, and (by default) on the day of the sale.
 * Stock goes back to the same batches, and the ledger gets the exact reverse of the original entries.
 */
export function voidSale(saleId, { reason = '', today = todayISO() } = {}) {
  return db.transaction(async (ctx) => {
    const settings = await readSettingsIn(ctx);
    const sale = await ctx.get('sales', saleId);
    if (!sale) throw missing('sale', saleId);
    if (sale.status === 'void') throw new ServiceError('alreadyVoid');
    if (sale.returnedTotal > 0) throw new ServiceError('hasReturns');
    if (settings.voidSameDayOnly && sale.date !== today) throw new ServiceError('voidNotSameDay');

    const items = await ctx.getAll('saleItems', { index: 'saleId', query: saleId });
    for (const item of items) {
      for (const a of item.allocations) {
        await applyMovementIn(ctx, {
          productId: item.productId,
          batchId: a.batchId,
          units: a.units,
          type: 'sale_void',
          docType: 'sale',
          docId: saleId,
          date: today,
        });
      }
    }

    const rxRows = await ctx.getAll('rxRegister', { index: 'saleId', query: saleId });
    for (const row of rxRows) ctx.remove('rxRegister', row.id);

    const original = await ctx.getAll('ledgerEntries', { index: 'doc', query: ['sale', saleId] });
    await postEntryIn(ctx, {
      date: today,
      docType: 'void',
      docId: saleId,
      memo: sale.number,
      lines: reversalLines(original),
    });
    return ctx.put('sales', { ...sale, status: 'void', voidReason: String(reason).trim(), voidedOn: today });
  });
}

export const getSale = (id) => db.get('sales', id);

export async function getSaleWithItems(id) {
  const sale = await db.get('sales', id);
  if (!sale) throw missing('sale', id);
  const items = await db.getAll('saleItems', { index: 'saleId', query: id });
  return { ...sale, items };
}

/** Sales between two ISO dates (inclusive), newest first. Pass nothing for all sales. */
export async function listSales({ from = '', to = '￿' } = {}) {
  const rows = await db.getAll('sales', { index: 'date', query: IDBKeyRange.bound(from, to) });
  return rows.sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

/** Rx and controlled dispensing rows, newest first. */
export async function listRxRegister({ from = '', to = '￿' } = {}) {
  const rows = await db.getAll('rxRegister', { index: 'date', query: IDBKeyRange.bound(from, to) });
  return rows.sort((a, b) => b.date.localeCompare(a.date) || (b.saleNumber ?? '').localeCompare(a.saleNumber ?? ''));
}

/* ---------- Hold and resume (device-local, in settings) ---------- */

/** Parks a cart. Lines are kept as they were on screen: quantities, pack or loose mode, prices, discounts, batch. */
export function holdCart(cart) {
  return db.transaction(async (ctx) => {
    const row = await ctx.get('settings', 'heldCarts');
    const list = row?.value ?? [];
    const entry = {
      id: db.newId(),
      savedAt: new Date().toISOString(),
      customer: cart.customer || null,
      items: (cart.items ?? []).map((item) => ({ ...item })),
      discount: cart.discount ?? 0,
      discountPercent: cart.discountPercent ?? null,
      tax: cart.tax ?? 0,
      patient: cart.patient ?? '',
      doctor: cart.doctor ?? '',
      note: cart.note ?? '',
    };
    ctx.put('settings', { key: 'heldCarts', value: [...list, entry] });
    return entry.id;
  });
}

export const listHeldCarts = () => db.getSetting('heldCarts', []);

/** Removes a held cart and returns it, so the caller can load it into the sale screen. */
export function resumeCart(id) {
  return takeHeldCart(id);
}

export function discardHeldCart(id) {
  return takeHeldCart(id).then(() => undefined);
}

function takeHeldCart(id) {
  return db.transaction(async (ctx) => {
    const row = await ctx.get('settings', 'heldCarts');
    const list = row?.value ?? [];
    const cart = list.find((entry) => entry.id === id);
    if (!cart) throw missing('heldCart', id);
    ctx.put('settings', { key: 'heldCarts', value: list.filter((entry) => entry.id !== id) });
    return cart;
  });
}
