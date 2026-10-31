// Shifts: the cash drawer of one register (this device). Open a shift with a float, record cash moved in or out during
// it, count the drawer at the close, and keep the record.
//
// Every ledger line posted while a shift is open is tagged with that shift (ledgerEntries.shiftId, set in ledger.js).
// The drawer's expected cash is therefore exact: the opening float plus the net cash (account 1000) tagged with the shift.
//   expected = opening + Σ(debit − credit on cash, tagged with the shift)
//   variance = counted − expected            (over = positive, short = negative)
// Shifts and their movements live on this device only (the drawer is physical), and are never synced.
//
// Permissions: opening, movements and the close are for the 'shifts' screen. Viewing summaries and discrepancies is for
// 'shift-audit'. Correcting the count of a closed shift is owner-only.
import * as db from '../core/db.js';
import { todayISO } from '../core/dates.js';
import { sum } from '../core/money.js';
import { ServiceError, missing, requireInt, requireText, requireOneOf } from './errors.js';
import { ACCOUNT, expenseLines, postEntryIn, requirePaymentAccount, transferLines } from './ledger.js';
import { nextDocNumber } from './numbering.js';

export const CURRENT_KEY = 'currentShiftId';
export const MOVEMENT_TYPES = ['payIn', 'payOut', 'petty', 'cashDrop'];

/** What each ledger document type means in a drawer. Anything not listed falls into 'other'. */
const CATEGORY = {
  sale: 'cashSales',
  practice: 'practice',
  practiceVoid: 'voids',
  void: 'voids',
  receipt: 'customerReceipts',
  payment: 'supplierPayments',
  purchase: 'purchases',
  saleReturn: 'refunds',
  purchaseReturn: 'purchaseReturns',
  expense: 'expenses',
  income: 'otherIn',
  transfer: 'transfers',
  shiftPayIn: 'payIns',
  shiftPayOut: 'payOuts',
  shiftPetty: 'petty',
  shiftDrop: 'cashDrops',
};
export const CATEGORIES = [...new Set(Object.values(CATEGORY)), 'other'];

/** Money-in documents that can be paid by card, bank or wallet. Their non-cash side is the digital total. */
const DIGITAL_DOCS = ['sale', 'practice', 'receipt'];

async function currentIdIn(ctx) {
  return (await ctx.get('settings', CURRENT_KEY))?.value ?? null;
}

/** The shift open on this device, or null. Used by the ledger to tag lines. */
export async function currentShiftIdIn(ctx) {
  return currentIdIn(ctx);
}

async function openShiftIn(ctx) {
  const id = await currentIdIn(ctx);
  if (!id) return null;
  const shift = await ctx.get('shifts', id);
  return shift && shift.status === 'open' ? shift : null;
}

async function signedInName(ctx) {
  return (await ctx.get('settings', 'session'))?.value?.username ?? '';
}

/** Throws unless the signed-in user is the owner. */
async function requireOwnerIn(ctx) {
  const session = (await ctx.get('settings', 'session'))?.value;
  const userId = session?.userId ?? 'owner';
  if (userId !== 'owner') throw new ServiceError('ownerOnly');
}

/* ---------- Reads ---------- */

/** The open shift on this device, or null. */
export async function currentShift() {
  const id = await db.getSetting(CURRENT_KEY, null);
  if (!id) return null;
  const shift = await db.get('shifts', id);
  return shift && shift.status === 'open' ? shift : null;
}

/** The figures of one shift from its ledger lines: categories, digital totals, counts and the expected drawer. */
export async function shiftSummary(shiftId) {
  const shift = await db.get('shifts', shiftId);
  if (!shift) throw missing('shift', shiftId);
  const lines = await db.getAll('ledgerEntries', { index: 'shiftId', query: shiftId });
  const accounts = new Map((await db.getAll('accounts')).map((a) => [a.code, a]));
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const digital = { sales: 0, practice: 0, customerReceipts: 0 };
  const counts = { sales: new Set(), practices: new Set(), refunds: new Set(), voids: new Set() };
  for (const line of lines) {
    const net = (line.debit ?? 0) - (line.credit ?? 0);
    if (line.accountCode === ACCOUNT.cash) {
      categories[CATEGORY[line.docType] ?? 'other'] += net;
    } else if (DIGITAL_DOCS.includes(line.docType) && line.debit > 0 && accounts.get(line.accountCode)?.kind && accounts.get(line.accountCode).kind !== 'cash') {
      if (line.docType === 'sale') digital.sales += line.debit;
      else if (line.docType === 'practice') digital.practice += line.debit;
      else digital.customerReceipts += line.debit;
    }
    if (line.docType === 'sale') counts.sales.add(line.docId);
    if (line.docType === 'practice') counts.practices.add(line.docId);
    if (line.docType === 'saleReturn') counts.refunds.add(line.docId);
    if (line.docType === 'void' || line.docType === 'practiceVoid') counts.voids.add(line.docId);
  }
  const cashNet = sum(Object.values(categories));
  return {
    shift,
    categories,
    cashNet,
    expected: shift.openingCash + cashNet,
    digital,
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.size])),
    movements: await db.getAll('shiftMovements', { index: 'shiftId', query: shiftId }),
  };
}

/** Shifts that opened in [from, to] (dates, inclusive), newest first. */
export async function listShifts({ from = '', to = '￿' } = {}) {
  const rows = await db.getAll('shifts', { index: 'openedAt', query: IDBKeyRange.bound(from, `${to}￿`) });
  return rows.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

/** Closed shifts whose counted cash is not equal to the expected cash. */
export async function discrepancies({ from = '', to = '￿' } = {}) {
  return (await listShifts({ from, to })).filter((s) => s.status === 'closed' && s.variance !== 0);
}

/* ---------- Writes (own transaction) ---------- */

/** Opens a shift on this device with the opening cash float counted in the drawer. */
export function openShift({ openingCash, note = '' }) {
  return db.transaction(async (ctx) => {
    if (await openShiftIn(ctx)) throw new ServiceError('shiftAlreadyOpen');
    const opening = requireInt(openingCash, 'openingCash', 0);
    const number = await nextDocNumber(ctx, 'shift');
    const shift = ctx.put('shifts', {
      id: db.newId(),
      number,
      status: 'open',
      openedAt: new Date().toISOString(),
      openedBy: await signedInName(ctx),
      openingCash: opening,
      openNote: String(note ?? '').trim(),
      closedAt: null,
      closedBy: null,
      counted: null,
      expected: null,
      variance: null,
      closingNote: '',
      corrections: [],
    });
    ctx.put('settings', { key: CURRENT_KEY, value: shift.id });
    return shift;
  });
}

/**
 * Records cash moved during the open shift. The ledger gets the entry, so the expected drawer moves with it.
 *   payIn:    money put into the drawer by the owner (credit: owner's equity)
 *   payOut:   cash paid out for a purchase or service (expense)
 *   petty:    small cash expense with a reason (expense)
 *   cashDrop: cash moved from the drawer to the bank or wallet chosen (payAccount)
 */
export function addShiftMovement({ type, amount, reason, payAccount = ACCOUNT.bank, date = todayISO() }) {
  return db.transaction(async (ctx) => {
    const shift = await openShiftIn(ctx);
    if (!shift) throw new ServiceError('shiftNotOpen');
    const kind = requireOneOf(type, MOVEMENT_TYPES, 'type');
    const value = requireInt(amount, 'amount', 1);
    const note = requireText(reason, 'reason');
    const by = await signedInName(ctx);

    let docType;
    let lines;
    if (kind === 'payIn') {
      docType = 'shiftPayIn';
      lines = [{ account: ACCOUNT.cash, debit: value }, { account: ACCOUNT.openingEquity, credit: value }];
    } else if (kind === 'payOut') {
      docType = 'shiftPayOut';
      lines = expenseLines({ amount: value, expenseCode: ACCOUNT.generalExpenses, fromCode: ACCOUNT.cash });
    } else if (kind === 'petty') {
      docType = 'shiftPetty';
      lines = expenseLines({ amount: value, expenseCode: ACCOUNT.generalExpenses, fromCode: ACCOUNT.cash });
    } else {
      docType = 'shiftDrop';
      await requirePaymentAccount(ctx, payAccount);
      lines = transferLines({ amount: value, fromCode: ACCOUNT.cash, toCode: payAccount });
    }
    const entryId = await postEntryIn(ctx, { date, docType, docId: shift.id, memo: note, lines });
    return ctx.put('shiftMovements', {
      id: db.newId(),
      shiftId: shift.id,
      type: kind,
      amount: value,
      reason: note,
      account: kind === 'cashDrop' ? payAccount : ACCOUNT.cash,
      at: new Date().toISOString(),
      by,
      entryId,
    });
  });
}

/**
 * Closes the open shift. The count is typed blind (the cashier does not see the expected figure first). Returns the
 * closed shift with its expected cash, counted cash and variance, which are kept for the audit.
 */
export function closeShift({ counted, note = '' }) {
  return db.transaction(async (ctx) => {
    const open = await openShiftIn(ctx);
    if (!open) throw new ServiceError('shiftNotOpen');
    const countedPaisa = requireInt(counted, 'counted', 0);
    const lines = await ctx.getAll('ledgerEntries', { index: 'shiftId', query: open.id });
    const cashNet = sum(lines.filter((l) => l.accountCode === ACCOUNT.cash).map((l) => (l.debit ?? 0) - (l.credit ?? 0)));
    const expected = open.openingCash + cashNet;
    const closed = ctx.put('shifts', {
      ...open,
      status: 'closed',
      closedAt: new Date().toISOString(),
      closedBy: await signedInName(ctx),
      counted: countedPaisa,
      expected,
      variance: countedPaisa - expected,
      closingNote: String(note ?? '').trim(),
    });
    ctx.remove('settings', CURRENT_KEY);
    return closed;
  });
}

/**
 * Corrects the counted cash of a closed shift (owner only). The old and new figures and the reason are kept in the
 * shift's correction history, so the change can be audited.
 */
export function correctShiftCount(shiftId, { counted, reason }) {
  return db.transaction(async (ctx) => {
    await requireOwnerIn(ctx);
    const shift = await ctx.get('shifts', shiftId);
    if (!shift) throw missing('shift', shiftId);
    if (shift.status !== 'closed') throw new ServiceError('shiftNotClosed');
    const why = requireText(reason, 'reason');
    const next = requireInt(counted, 'counted', 0);
    return ctx.put('shifts', {
      ...shift,
      counted: next,
      variance: next - shift.expected,
      corrections: [
        ...(shift.corrections ?? []),
        { at: new Date().toISOString(), by: await signedInName(ctx), from: shift.counted, to: next, reason: why },
      ],
    });
  });
}
