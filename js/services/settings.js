// Business settings (device-local, stored as one settings row under the key "business").
// Every service reads them through readSettingsIn(ctx) so the rules change in one place.
import * as db from '../core/db.js';

export const DEFAULT_SETTINGS = {
  /** Rx and controlled items need patient and doctor on the sale. */
  rxRequiresPatientDoctor: true,
  /** A sale can be voided only on the day it was made. */
  voidSameDayOnly: true,
  /** Purchases update the product's cost price. */
  updateCostFromLastPurchase: true,
  /** Purchases whose MRP differs from the product price update the sale price. */
  updateSalePriceOnMrpChange: true,
  /** Batches expiring within this many days show as "soon". */
  expiryWarnDays: 90,
  /** The sale screen may change a price per pack or per unit. Turn off to hold prices at the list price. */
  allowPriceEdit: true,
  /** Receipt paper width in millimetres: 58 or 80. */
  receiptWidth: 80,
  /** Print the batch number and expiry on each receipt line. */
  receiptShowBatch: false,
  /** Print each medicine's usual directions under it. */
  receiptShowDirections: true,
  /** Optional per-device prefix, so two devices never issue the same document number. */
  devicePrefix: '',
  /** Sales tax: when on, the sale screen adds taxRate percent of the net amount unless a tax is typed. */
  taxEnabled: false,
  taxRate: 0,
  /** Low-stock orders suggest enough packs for this many days of sales. */
  orderDays: 30,
  /** Owner session length, in hours. An expired session asks for the password again once online. */
  sessionHours: 24,
  /** Remind the owner to take a backup after this many days (0 turns the reminder off). */
  backupReminderDays: 7,
  /** 'browser' (print dialog) or 'bluetooth' (ESC/POS printer). */
  printMethod: 'browser',
  /** Copies of each receipt. */
  printCopies: 1,
  /** Open the print dialog (or send to the printer) as soon as a sale completes. */
  printAutoPrint: false,
  /** 'western' (0–9, default) or 'urdu' (۰–۹) for displayed numbers. */
  numberDigits: 'western',
  /** Practice (medicine given at the owner's charge). Backdating is off unless the owner allows it. */
  allowBackdating: false,
  /** Show a non-blocking warning when a practice is charged less than its cost. */
  practiceWarnBelowCost: true,
  /** Show the list price on the practice slip. Off by default: the slip shows only the charged amount. */
  practicePrintListPrice: false,
  /** Show the cost of each practice to the signed-in owner. */
  practiceShowCost: true,
  /** Account that receives practice payments by default (cash). 1100 means on the customer's account. */
  practiceDefaultAccount: '1000',
  docPrefixes: {
    sale: 'SALE',
    purchase: 'PUR',
    saleReturn: 'SRN',
    purchaseReturn: 'PRN',
    receipt: 'RCV',
    payment: 'PAY',
    transfer: 'TRF',
    adjustment: 'ADJ',
    expense: 'EXP',
    income: 'INC',
    practice: 'PRC',
    shift: 'SFT',
  },
};

/** Pharmacy profile, printed on receipts and reports. Stored under the key 'profile'. */
export const DEFAULT_PROFILE = {
  name: '',
  nameUr: '',
  address: '',
  phone: '',
  ntn: '',
  licence: '',
  qualifiedPerson: '',
  receiptFooter: '',
  currency: 'PKR',
};

/** The profile, with the pharmacy name from setup when the profile itself has no name yet. */
export async function getProfile() {
  const profile = { ...DEFAULT_PROFILE, ...(await db.getSetting('profile', {})) };
  if (!profile.name) profile.name = (await db.getSetting('pharmacyName', '')) ?? '';
  return profile;
}

/** Saves the profile. The name is kept in sync with the 'pharmacyName' setting the rest of the app reads. */
export function saveProfile(patch) {
  return db.transaction(async (ctx) => {
    const row = await ctx.get('settings', 'profile');
    const next = { ...DEFAULT_PROFILE, ...(row?.value ?? {}), ...patch };
    for (const field of Object.keys(DEFAULT_PROFILE)) next[field] = String(next[field] ?? '').trim();
    if (!next.name) next.name = (await ctx.get('settings', 'pharmacyName'))?.value ?? '';
    ctx.put('settings', { key: 'profile', value: next });
    ctx.put('settings', { key: 'pharmacyName', value: next.name });
    return next;
  });
}

export function mergeSettings(stored = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    docPrefixes: { ...DEFAULT_SETTINGS.docPrefixes, ...(stored.docPrefixes ?? {}) },
  };
}

export async function readSettingsIn(ctx) {
  const row = await ctx.get('settings', 'business');
  return mergeSettings(row?.value);
}

export async function getSettings() {
  return mergeSettings(await db.getSetting('business', {}));
}

/** Saves a partial update. docPrefixes merge key by key. */
export function saveSettings(patch) {
  return db.transaction(async (ctx) => {
    const row = await ctx.get('settings', 'business');
    const current = row?.value ?? {};
    const next = {
      ...current,
      ...patch,
      docPrefixes: { ...(current.docPrefixes ?? {}), ...(patch.docPrefixes ?? {}) },
    };
    ctx.put('settings', { key: 'business', value: next });
    return mergeSettings(next);
  });
}
