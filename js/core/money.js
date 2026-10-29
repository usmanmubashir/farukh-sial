// Money rules:
//  - Stored and computed as integer paisa (1 rupee = 100 paisa). Never floats.
//  - Rounding is half away from zero, applied only at the point of calculation.
//  - Formatting happens only at display time, through format().
import { t } from './i18n.js';

const PAISA_PER_RUPEE = 100;

/** Throws unless value is a safe integer. Use it at every boundary that accepts money. */
export function assertPaisa(value) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Money must be integer paisa, got ${value}`);
  }
  return value;
}

/** Urdu and Arabic-Indic digits to ASCII, so typed Urdu numbers parse. */
export function normalizeDigits(text) {
  return String(text ?? '').replace(/[۰-۹٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * Parses user input such as "1,234.5", "Rs 20" or "۱۲۵" into integer paisa.
 * Returns null when the text is not a valid amount (more than 2 decimals, letters, etc.).
 * Empty input is 0.
 */
export function parseRupees(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * PAISA_PER_RUPEE) : null;
  }
  const cleaned = normalizeDigits(input)
    .trim()
    .replace(/^rs\.?/i, '')
    .replace(/[,\s]/g, '');
  if (cleaned === '') return 0;

  const match = /^(-?)(\d+)(?:\.(\d{1,2})?)?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const paisa = Number(whole) * PAISA_PER_RUPEE + Number(fraction.padEnd(2, '0'));
  return sign ? -paisa : paisa;
}

/** Rounds half away from zero: 2.5 → 3, -2.5 → -3, 2.4 → 2. */
export function roundHalfAway(value) {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** percent of paisa, e.g. percentOf(100050, 17) → 17009 (rounded half away from zero). */
export function percentOf(paisa, percent) {
  assertPaisa(paisa);
  return roundHalfAway((paisa * percent) / 100);
}

/** Rounds to the nearest whole rupee (used when a pharmacy rounds totals). */
export function roundToRupee(paisa) {
  assertPaisa(paisa);
  return roundHalfAway(paisa / PAISA_PER_RUPEE) * PAISA_PER_RUPEE;
}

/** Sums integer paisa values with validation. */
export function sum(values) {
  return values.reduce((total, value) => total + assertPaisa(value), 0);
}

function groupThousands(whole) {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Display only. format(123450) → "Rs 1,234.50", format(-5) → "−Rs 0.05".
 * decimals: 2 (default) or 0 (rounds to the rupee first).
 */
export function format(paisa, { symbol = true, decimals = 2 } = {}) {
  assertPaisa(paisa);
  const value = decimals === 0 ? roundToRupee(paisa) : paisa;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / PAISA_PER_RUPEE);
  const fraction = abs % PAISA_PER_RUPEE;

  let text = groupThousands(whole);
  if (decimals !== 0) text += `.${String(fraction).padStart(2, '0')}`;

  const sign = value < 0 ? '−' : '';
  return symbol ? `${sign}${t('currency.symbol')} ${text}` : `${sign}${text}`;
}
