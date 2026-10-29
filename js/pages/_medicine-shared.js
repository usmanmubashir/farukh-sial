// Filters, search and labels shared by the Medicines and Stock screens.
import { t } from '../core/i18n.js';
import { esc } from '../core/ui.js';

export const FILTERS = ['all', 'low', 'out', 'rx', 'controlled', 'fridge', 'noPrice', 'inactive'];

/** Each filter is a predicate over a product row from listWithStock(). */
export function matchesFilter(raw, filter) {
  // A row without an explicit active flag counts as active.
  const row = { ...raw, active: raw.active !== false };
  switch (filter) {
    case 'low':
      return row.active && row.reorderLevel > 0 && row.units > 0 && row.units < row.reorderLevel * row.unitsPerPack;
    case 'out':
      return row.active && row.units <= 0 && row.trackStock !== false;
    case 'rx':
      return row.active && row.class === 'rx';
    case 'controlled':
      return row.active && row.class === 'controlled';
    case 'fridge':
      return row.active && row.storage === 'fridge';
    case 'noPrice':
      return row.active && !row.mrpPerPack;
    case 'inactive':
      return !row.active;
    default:
      return row.active;
  }
}

/** Case-insensitive match on the name (English and Urdu), salt, company, strength, barcode and code. */
export function matchesQuery(row, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.nameUr, row.generic, row.company, row.strength, row.barcode, row.code].some((value) =>
    String(value ?? '').toLowerCase().includes(q),
  );
}

/** "3 strip + 4 tablet" style stock line. */
export function stockLine(row) {
  const pack = t(`sold.${row.soldAs || 'pack'}`).toLowerCase();
  let text = t('med.stockLine', { packs: row.packs, pack });
  if (row.looseUnits) text += t('med.stockLoose', { count: row.looseUnits, unit: row.unitName });
  return text;
}

/** "1 medicine" or "6 medicines". */
export const medCount = (n) => (n === 1 ? t('med.countOne') : t('med.count', { count: n }));

/** Filter chip buttons. */
export function chipRow(active) {
  return FILTERS.map(
    (key) =>
      `<button type="button" class="chip" data-filter="${key}" aria-pressed="${key === active}">${esc(t(`filter.${key}`))}</button>`,
  ).join('');
}
