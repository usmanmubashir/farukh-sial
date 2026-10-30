import { localizeDigits } from './numbers.js';
// Dates are stored as ISO strings: "YYYY-MM-DD" for business dates, full ISO timestamps for audit fields.
// Display is DD/MM/YYYY with ASCII digits.

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
export function toISODate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO() {
  return toISODate(new Date());
}

export function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function parseISODate(value) {
  if (!isValidISODate(value)) throw new RangeError(`Invalid date: ${value}`);
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, days) {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function formatDate(iso) {
  if (!isValidISODate(iso)) return '—';
  const [y, m, d] = iso.split('-');
  return localizeDigits(`${d}/${m}/${y}`);
}

export function formatDateTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  const date = new Date(ms);
  return localizeDigits(`${formatDate(toISODate(date))} ${pad(date.getHours())}:${pad(date.getMinutes())}`);
}

/**
 * Accepts "MM/YY", "MM/YYYY" or an ISO date and returns the ISO date of the last day of that month
 * (a pharmacy expiry month is usable until its last day). Returns null when the text is not valid.
 */
export function expiryFromInput(input) {
  const text = String(input ?? '').trim();
  if (isValidISODate(text)) return text;
  const match = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (!match) return null;
  const month = Number(match[1]);
  let year = Number(match[2]);
  if (match[2].length === 2) year += 2000;
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${pad(month)}-${pad(lastDay)}`;
}

/** 'expired' | 'soon' (within warnDays) | 'ok' | 'unknown'. Used for batch expiry. */
export function expiryState(expiryISO, { today = todayISO(), warnDays = 90 } = {}) {
  if (!isValidISODate(expiryISO)) return 'unknown';
  if (expiryISO < today) return 'expired';
  if (expiryISO <= addDays(today, warnDays)) return 'soon';
  return 'ok';
}

/**
 * The date range a report period means, as { from, to } (YYYY-MM-DD, inclusive; '' = no lower bound).
 * Presets: today, yesterday, week (Monday to today), lastWeek (the Monday-to-Sunday week before), month, lastMonth,
 * last3 (the current month and the two before it), year, all, custom (uses from and to; a missing end is today).
 */
export function periodRange(preset, { today = todayISO(), from = '', to = '' } = {}) {
  const [year, month, day] = today.split('-').map(Number);
  const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const at = (y, m, d) => new Date(y, m, d);
  const weekday = (at(year, month - 1, day).getDay() + 6) % 7; // Monday = 0
  const monday = at(year, month - 1, day - weekday);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = iso(at(year, month - 1, day - 1));
      return { from: y, to: y };
    }
    case 'week':
      return { from: iso(monday), to: today };
    case 'lastWeek':
      return { from: iso(at(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7)), to: iso(at(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1)) };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'lastMonth':
      return { from: iso(at(year, month - 2, 1)), to: iso(at(year, month - 1, 0)) };
    case 'last3':
      return { from: iso(at(year, month - 3, 1)), to: today };
    case 'year':
      return { from: `${year}-01-01`, to: today };
    case 'custom':
      return { from, to: to || today };
    default:
      return { from: '', to: '\uffff' };
  }
}
