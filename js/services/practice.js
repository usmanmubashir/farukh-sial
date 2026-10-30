// Practice: medicine given to a patient at the owner's own charge. It is not a sale.
// The charge is any amount the owner decides (even 0). Profit = charged − cost, where cost is the FEFO batch cost.
// A saved practice is immutable. A void is a separate, append-only event: it puts the exact batches back and posts the
// exact reverse of the ledger lines. Nothing is ever deleted. All money is integer paisa.
import * as db from '../core/db.js';
import { roundHalfAway } from '../core/money.js';
import { todayISO } from '../core/dates.js';
import { ServiceError, missing, optionalInt, requireInt, requireText } from './errors.js';
import { ACCOUNT, postEntryIn, practiceLines, requirePaymentAccount, reversalLines } from './ledger.js';
import { nextDocNumber } from './numbering.js';
import { readSettingsIn } from './settings.js';
import { allocateFEFOIn, applyMovementIn, costOfUnits, unitsFromPacks } from './stock.js';
import { applyPractice } from './rollups.js';

/** Classes whose dispensing needs a patient and a doctor (the same rule as sales, when the setting is on). */
const DETAILS_REQUIRED_CLASSES = ['rx', 'controlled'];

const sum = (values) => values.reduce((total, value) => total + value, 0);
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value));

/**
 * Prices the requested lines at the list price (pack price, plus loose units at the loose price). Touches no stock.
 * items: [{ productId, packs, looseUnits }]. A line with both packs and loose units is recorded as loose.
 */
async function priceItems(ctx, items) {
  if (!Array.isArray(items) || items.length === 0) throw new ServiceError('emptyPractice');
  const lines = [];
  for (const raw of items) {
    const packs = optionalInt(raw.packs, 'packs', 0, 0);
    const looseUnits = optionalInt(raw.looseUnits, 'looseUnits', 0, 0);
    if (packs + looseUnits <= 0) throw new ServiceError('invalidField', { field: 'quantity' });
    const product = await ctx.get('products', raw.productId);
    if (!product) throw missing('product', raw.productId);
    if (!product.active) throw new ServiceError('productInactive', { product: product.name });
    if (looseUnits > 0 && !product.looseSelling) throw new ServiceError('looseNotAllowed', { product: product.name });
    lines.push({
      product,
      packs,
      looseUnits,
      units: unitsFromPacks(product, packs, looseUnits),
      list: packs * product.salePricePerPack + looseUnits * (product.looseUnitPrice ?? 0),
      unitType: looseUnits > 0 ? 'loose' : 'pack',
    });
  }
  return lines;
}

/**
 * Takes every line FEFO from the batches and writes one `practice` stock movement per batch allocation.
 * Returns one practiceItems row per allocation. The list price of a line is split across its allocations by units;
 * the last allocation takes the rounding, so the parts always add up to the line.
 */
async function allocateLines(ctx, lines, { practiceId, date, today }) {
  const rows = [];
  for (const line of lines) {
    const allocations = line.product.trackStock === false
      ? []
      : await allocateFEFOIn(ctx, line.product.id, line.units, { today });
    let listLeft = line.list;
    for (const [index, a] of allocations.entries()) {
      const lineList = index === allocations.length - 1 ? listLeft : roundHalfAway((line.list * a.units) / line.units);
      listLeft -= lineList;
      await applyMovementIn(ctx, {
        productId: line.product.id,
        batchId: a.batchId,
        units: -a.units,
        type: 'practice',
        docType: 'practice',
        docId: practiceId,
        date,
      });
      rows.push({
        id: db.newId(),
        practiceId,
        productId: line.product.id,
        productName: line.product.name,
        strength: line.product.strength ?? '',
        class: line.product.class,
        batchId: a.batchId,
        batchNo: a.batchNo,
        expiry: a.expiry,
        unitType: line.unitType,
        qtyUnits: a.units,
        listPrice: roundHalfAway(line.list / line.units),
        costPerUnit: roundHalfAway(a.costPerPack / a.unitsPerPack),
        lineList,
        lineCost: costOfUnits(a.costPerPack, a.unitsPerPack, a.units),
        date,
      });
    }
  }
  return rows;
}

/**
 * Saves a practice in one transaction: stock out (FEFO), the practice and its items, Rx register rows where a
 * controlled item is dispensed, the ledger, and the practice rollup. A shortage throws and nothing is written.
 *
 * input: {
 *   items: [{ productId, packs, looseUnits }],
 *   chargedAmount (paisa; omitted = the calculated total; 0 is allowed),
 *   paymentAccountCode ('1000' cash by default; '1010' bank, wallet codes, or '1100' for the customer's account),
 *   customerId (required for '1100'; optional otherwise), patientName, patientPhone, doctorRef, note,
 *   date (YYYY-MM-DD, default today; a past date needs the allowBackdating setting), dateTime, today
 * }
 */
export function createPractice(input) {
  return db.transaction((ctx) => createPracticeIn(ctx, input));
}

export async function createPracticeIn(ctx, input = {}) {
  const settings = await readSettingsIn(ctx);
  const today = input.today ?? todayISO();
  const date = input.date ?? today;
  if (!isDate(date)) throw new ServiceError('invalidField', { field: 'date' });
  if (date !== today && !settings.allowBackdating) throw new ServiceError('backdatingNotAllowed');
  const dateTime = input.dateTime ?? (date === today ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString());

  const lines = await priceItems(ctx, input.items);
  const patientName = String(input.patientName ?? '').trim();
  const patientPhone = String(input.patientPhone ?? '').trim();
  const doctorRef = String(input.doctorRef ?? '').trim();
  const note = String(input.note ?? '').trim();
  const isRx = (line) => DETAILS_REQUIRED_CLASSES.includes(line.product.class);
  if (lines.some(isRx) && settings.rxRequiresPatientDoctor && (!patientName || !doctorRef)) {
    throw new ServiceError('patientDoctorRequired');
  }

  const calculatedTotal = sum(lines.map((line) => line.list));
  const charged = input.chargedAmount === undefined || input.chargedAmount === null || input.chargedAmount === ''
    ? calculatedTotal
    : requireInt(input.chargedAmount, 'chargedAmount', 0);

  const customerId = input.customerId || null;
  if (customerId && !(await ctx.get('customers', customerId))) throw missing('customer', customerId);
  const paymentAccountCode = String(input.paymentAccountCode || settings.practiceDefaultAccount || ACCOUNT.cash);
  if (paymentAccountCode === ACCOUNT.receivable) {
    if (!customerId) throw new ServiceError('practiceCustomerRequired');
  } else {
    await requirePaymentAccount(ctx, paymentAccountCode);
  }

  const practiceId = db.newId();
  const rows = await allocateLines(ctx, lines, { practiceId, date, today });
  const costTotal = sum(rows.map((row) => row.lineCost));
  const profit = charged - costTotal;
  const number = await nextDocNumber(ctx, 'practice');
  const deviceId = (await ctx.get('settings', 'deviceId'))?.value ?? '';

  const practice = ctx.put('practices', {
    id: practiceId,
    number,
    date,
    dateTime,
    patientName,
    patientPhone,
    doctorRef,
    note,
    customerId,
    calculatedTotal,
    chargedAmount: charged,
    costTotal,
    profit,
    paymentAccountCode,
    createdBy: input.createdBy ?? 'owner',
    deviceId,
  });
  for (const row of rows) ctx.put('practiceItems', row);

  // Controlled and Rx items also go in the Rx register, tagged as practice.
  for (const line of lines.filter(isRx)) {
    ctx.put('rxRegister', {
      id: db.newId(),
      saleId: null,
      practiceId,
      source: 'practice',
      saleNumber: number,
      date,
      customerId,
      productId: line.product.id,
      productName: line.product.name,
      strength: line.product.strength ?? '',
      class: line.product.class,
      units: line.units,
      batches: rows.filter((row) => row.productId === line.product.id).map((row) => row.batchNo),
      patient: patientName,
      doctor: doctorRef,
    });
  }

  await postEntryIn(ctx, {
    date,
    docType: 'practice',
    docId: practiceId,
    memo: number,
    lines: practiceLines({ charged, cost: costTotal, paymentAccountCode, customerId }),
  });
  await applyPractice(ctx, practice, 1);
  return { ...practice, items: rows };
}

/**
 * Voids a practice (owner only, with a reason). The exact batches come back, and the ledger gets the exact reverse of
 * the practice's lines. A practice can be voided once. Nothing is deleted: the void is a new row.
 */
export function voidPractice(practiceId, options = {}) {
  return db.transaction((ctx) => voidPracticeIn(ctx, practiceId, options));
}

export async function voidPracticeIn(ctx, practiceId, { reason, today = todayISO(), voidedBy = 'owner' } = {}) {
  const why = requireText(reason, 'reason');
  const practice = await ctx.get('practices', practiceId);
  if (!practice) throw missing('practice', practiceId);
  const existing = await ctx.getAll('practiceVoids', { index: 'practiceId', query: practiceId });
  if (existing.length) throw new ServiceError('practiceAlreadyVoided', { number: practice.number });

  const items = await ctx.getAll('practiceItems', { index: 'practiceId', query: practiceId });
  for (const item of items) {
    if (!item.batchId) continue;
    await applyMovementIn(ctx, {
      productId: item.productId,
      batchId: item.batchId,
      units: item.qtyUnits,
      type: 'practiceVoid',
      docType: 'practiceVoid',
      docId: practiceId,
      date: today,
    });
  }

  const entries = await ctx.getAll('ledgerEntries', { index: 'doc', query: ['practice', practiceId] });
  await postEntryIn(ctx, {
    date: today,
    docType: 'practiceVoid',
    docId: practiceId,
    memo: practice.number,
    lines: reversalLines(entries),
  });

  const voidRow = ctx.put('practiceVoids', {
    id: db.newId(),
    practiceId,
    number: practice.number,
    voidedAt: new Date().toISOString(),
    voidDate: today,
    reason: why,
    voidedBy,
  });
  await applyPractice(ctx, practice, -1);
  return voidRow;
}

/** One practice with its items, and whether it is voided. */
export async function getPractice(id) {
  const practice = await db.get('practices', id);
  if (!practice) throw missing('practice', id);
  const [items, voids] = await Promise.all([
    db.getAll('practiceItems', { index: 'practiceId', query: id }),
    db.getAll('practiceVoids', { index: 'practiceId', query: id }),
  ]);
  return { ...practice, items, voided: voids.length > 0, void: voids[0] ?? null };
}

/**
 * Practices dated within [from, to] (YYYY-MM-DD, inclusive), newest first. Each row says whether it is voided.
 * The date range uses the practice's own date, so a backdated practice counts on its day.
 */
export async function listPractices({ from = '', to = '￿', includeVoided = true } = {}) {
  const [rows, voids] = await Promise.all([
    db.getAll('practices', { index: 'date', query: IDBKeyRange.bound(from, to) }),
    db.getAll('practiceVoids'),
  ]);
  const voidOf = new Map(voids.map((v) => [v.practiceId, v]));
  return rows
    .map((p) => ({ ...p, voided: voidOf.has(p.id), voidDate: voidOf.get(p.id)?.voidDate ?? null }))
    .filter((p) => includeVoided || !p.voided)
    .sort((a, b) => b.dateTime.localeCompare(a.dateTime) || b.number.localeCompare(a.number));
}

/* ---------- Kits: saved item sets, applied with one tap ---------- */

/** Saves a kit (new, or an update of the kit with this id). items: [{ productId, packs, looseUnits }]. */
export function saveKit({ id = null, name, items } = {}) {
  return db.transaction(async (ctx) => {
    const label = requireText(name, 'name');
    if (!Array.isArray(items) || items.length === 0) throw new ServiceError('emptyPractice');
    const list = [];
    for (const raw of items) {
      const packs = optionalInt(raw.packs, 'packs', 0, 0);
      const looseUnits = optionalInt(raw.looseUnits, 'looseUnits', 0, 0);
      if (packs + looseUnits <= 0) throw new ServiceError('invalidField', { field: 'quantity' });
      if (!(await ctx.get('products', raw.productId))) throw missing('product', raw.productId);
      list.push({ productId: raw.productId, packs, looseUnits });
    }
    const existing = id ? await ctx.get('practiceKits', id) : null;
    return ctx.put('practiceKits', { id: existing?.id ?? db.newId(), name: label, nameKey: label.toLowerCase(), items: list });
  });
}

/** All kits, by name. */
export async function listKits() {
  return (await db.getAll('practiceKits')).sort((a, b) => a.nameKey.localeCompare(b.nameKey));
}

/** Removes a kit. Practices made from it are not affected: they keep their own items. */
export function deleteKit(id) {
  return db.transaction(async (ctx) => {
    if (!(await ctx.get('practiceKits', id))) throw missing('kit', id);
    ctx.remove('practiceKits', id);
  });
}
