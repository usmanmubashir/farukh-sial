// Digit style for display. Western digits (0–9) are the default. Urdu digits (۰–۹) are an option for Urdu readers.
// Only display uses this: CSV files, stored values and input parsing always use Western digits (parseRupees
// already reads both).
let style = 'western';
const URDU_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** 'western' or 'urdu'. Anything else falls back to western. */
export function setDigitStyle(value) {
  style = value === 'urdu' ? 'urdu' : 'western';
}

export const digitStyle = () => style;

/** Turns the Western digits in a display string into the chosen style. */
export function localizeDigits(text) {
  const value = String(text ?? '');
  if (style !== 'urdu') return value;
  return value.replace(/[0-9]/g, (digit) => URDU_DIGITS[Number(digit)]);
}
