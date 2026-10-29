// Checks WCAG 2.1 contrast of the colour tokens used for text and controls, in light and dark themes.
// Reads css/tokens.css (light) and css/dark.css (dark, the [data-theme="dark"] block). Run: node scripts/audit-contrast.mjs
// Text needs 4.5:1 (AA). Non-text UI (borders of inputs, focus ring) needs 3:1.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

/** Declarations inside the first block that starts with `selector`. */
function block(css, selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector} block`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error('unterminated block');
}

function vars(text) {
  const out = {};
  for (const [, name, value] of text.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

function resolve(name, table, depth = 0) {
  const raw = table[name];
  if (raw === undefined) throw new Error(`undefined token --${name}`);
  const ref = raw.match(/^var\(--([\w-]+)\)$/);
  if (ref && depth < 10) return resolve(ref[1], table, depth + 1);
  return raw;
}

function rgb(value) {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const fn = value.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (fn) return [1, 2, 3].map((i) => Number(fn[i]));
  throw new Error(`cannot read colour ${value}`);
}

const lum = ([r, g, b]) => {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const tokens = read('css/tokens.css');
const dark = read('css/dark.css');
const lightPalette = vars(tokens);
const darkBlock = vars(block(dark, ':root[data-theme="dark"]'));

const PAIRS = [
  ['text', 'bg', 4.5, 'body text on page'],
  ['text', 'surface', 4.5, 'body text on cards'],
  ['text', 'surface-muted', 4.5, 'text on muted panels'],
  ['text-muted', 'bg', 4.5, 'secondary text on page'],
  ['text-muted', 'surface', 4.5, 'secondary text on cards'],
  ['text-muted', 'surface-muted', 4.5, 'secondary text on muted panels'],
  ['on-brand', 'brand', 4.5, 'primary button label'],
  ['brand', 'surface', 4.5, 'brand-coloured links on cards'],
  ['brand-ink', 'brand-soft', 4.5, 'soft brand badge text'],
  ['ok', 'ok-soft', 4.5, 'success pill'],
  ['warn', 'warn-soft', 4.5, 'warning pill'],
  ['danger', 'danger-soft', 4.5, 'error text'],
  ['danger', 'surface', 4.5, 'error text on cards'],
  ['info', 'info-soft', 4.5, 'info badge'],
  ['focus', 'surface', 3, 'focus ring on cards (non-text)'],
  ['control-border', 'surface', 3, 'input and control outline on cards (non-text)'],
];

let failures = 0;
const report = [];
for (const [theme, table] of [['light', { ...lightPalette }], ['dark', { ...lightPalette, ...darkBlock }]]) {
  for (const [fg, bg, min, label] of PAIRS) {
    const r = ratio(rgb(resolve(`c-${fg}`, table)), rgb(resolve(`c-${bg}`, table)));
    const ok = r >= min;
    if (!ok) failures += 1;
    report.push(`${ok ? 'ok  ' : 'FAIL'} ${theme.padEnd(5)} ${r.toFixed(2).padStart(5)}:1 (need ${min})  c-${fg} on c-${bg}  — ${label}`);
  }
}
console.log(report.join('\n'));
console.log(failures ? `${failures} pair(s) below the required contrast.` : 'Contrast audit passed.');
process.exit(failures ? 1 : 0);
