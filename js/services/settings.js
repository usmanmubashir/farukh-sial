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
  /** Optional per-device prefix, so two devices never issue the same document number. */
  devicePrefix: '',
  docPrefixes: {
    sale: 'SALE',
    purchase: 'PUR',
    saleReturn: 'SRN',
    purchaseReturn: 'PRN',
    receipt: 'RCV',
    payment: 'PAY',
    transfer: 'TRF',
    adjustment: 'ADJ',
  },
};

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
