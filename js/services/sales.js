// Sales: create, void and hold/resume carts.
//
// A sale is one atomic transaction: validation, FEFO allocation, stock movements, the sale and its lines,
// the document number, the ledger entry and the outbox rows. Any failure rolls back all of it.
//
//   total   = subtotal − discount + tax
//   paid    = sum of payments (must not exceed total)
//   balance = total − paid, owed by the customer (udhaar). Walk-in sales must be paid in full.
//   cost    = cost of the batches the units came from (per allocation)
//   profit  = (total − tax) − cost
import * as db from '../core/db.js';
import { todayISO } from '../core/dates.js';
import { sum } from '../core/money.js';
import { ServiceError, missing, optionalInt, requireInt, requireOneOf } from './errors.js';
import { allocateFEFOIn, applyMovementIn, costOfUnits } from './stock.js';
import { postEntryIn, reversalLines, saleLines } from './ledger.js';
import { nextDocNumber } from './numbering.js';
import { readSettingsIn } from './settings.js';

export const PAYMENT_METHODS = ['cash', 'card', 'bank', 'mobile'];
const DETAILS_REQUIRED_CLASSES = ['rx', 'controlled'];

/** Price of one line from the product's pack and loose prices. */
function priceLine(product, packs, looseUnits) {
  if (looseUnits > 0 && !product.looseSelling) {
    throw new ServiceError('looseNotAllowed', { product: product.name });
  }
  return packs * product.salePricePerPack + looseUnits * product.looseUnitPrice;
}

/**
 * Creates a sale inside the caller's transaction.
 * input: { customer, items: [{ productId, packs, looseUnits }], discount, tax, payments: [{ method, amount }],
 *          doctor, patient, note, date, today }
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
    lines.push({
      product,
      packs,
      looseUnits,
      units: packs * product.unitsPerPack + looseUnits,
      amount: priceLine(product, packs, looseUnits),
    });
  }

  // 2. Rx and controlled items need patient and doctor when the setting says so.
  const patient = String(input.patient ?? '').trim();
  const doctor = String(input.doctor ?? '').trim();
  const needsDetails = lines.some((line) => DETAILS_REQUIRED_CLASSES.includes(line.product.class));
  if (needsDetails && settings.rxRequiresPatientDoctor && (!patient || !doctor)) {
    throw new ServiceError('patientDoctorRequired');
  }

  // 3. Totals and payments.
  const subtotal = sum(lines.map((line) => line.amount));
  const discount = optionalInt(input.discount, 'discount', 0, 0);
  if (discount > subtotal) throw new ServiceError('discountTooLarge', { subtotal });
  const tax = optionalInt(input.tax, 'tax', 0, 0);
  const total = subtotal - discount + tax;
  if (total <= 0) throw new ServiceError('emptyTotal');

  const payments = (input.payments ?? []).map((p) => ({
    method: requireOneOf(p.method, PAYMENT_METHODS, 'method'),
    amount: requireInt(p.amount, 'amount', 1),
  }));
  const paid = sum(payments.map((p) => p.amount));
  if (paid > total) throw new ServiceError('overpaid', { total, paid });
  const balance = total - paid;
  if (balance > 0 && !customer) throw new ServiceError('walkInCredit');

  // 4. Allocate FEFO and move stock. Each allocation is a movement, so a shortage aborts the whole sale.
  const saleId = db.newId();
  const saleItems = [];
  let cost = 0;
  for (const line of lines) {
    // Products that do not track stock (services, bundles) sell without allocating batches.
    const allocations = line.product.trackStock === false ? [] : await allocateFEFOIn(ctx, line.product.id, line.units, { today });
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
      packs: line.packs,
      looseUnits: line.looseUnits,
      units: line.units,
      amount: line.amount,
      cost: itemCost,
      allocations,
      returnedUnits: 0,
      returnedAmount: 0,
    });
  }

  // 5. Persist the document, then the ledger.
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

  const entryId = await postEntryIn(ctx, {
    date,
    docType: 'sale',
    docId: saleId,
    memo: number,
    lines: saleLines({ paid, balance, net: total - tax, tax, cost, customerId }),
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

/* ---------- Hold and resume (device-local, in settings) ---------- */

export function holdCart(cart) {
  return db.transaction(async (ctx) => {
    const row = await ctx.get('settings', 'heldCarts');
    const list = row?.value ?? [];
    const entry = {
      id: db.newId(),
      savedAt: new Date().toISOString(),
      customer: cart.customer || null,
      items: (cart.items ?? []).map((item) => ({
        productId: item.productId,
        packs: item.packs ?? 0,
        looseUnits: item.looseUnits ?? 0,
      })),
      discount: cart.discount ?? 0,
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
