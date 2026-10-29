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
  return `${d}/${m}/${y}`;
}

export function formatDateTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  const date = new Date(ms);
  return `${formatDate(toISODate(date))} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 'expired' | 'soon' (within warnDays) | 'ok' | 'unknown'. Used for batch expiry. */
export function expiryState(expiryISO, { today = todayISO(), warnDays = 90 } = {}) {
  if (!isValidISODate(expiryISO)) return 'unknown';
  if (expiryISO < today) return 'expired';
  if (expiryISO <= addDays(today, warnDays)) return 'soon';
  return 'ok';
}
