// First-load budget and preload check.
// Measures the JavaScript reachable from js/app.js through static imports (routes load later with import()),
// plus jQuery and the stylesheets linked from index.html. Budget: 300 KB gzipped.
// It also keeps the modulepreload block in index.html equal to that module list, so every module of the first
// load downloads in parallel instead of one import level at a time.
//   node scripts/audit-budget.mjs          check (exit 1 when over budget or the preload block is stale)
//   node scripts/audit-budget.mjs --write  rewrite the preload block
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_KB = 300;
const START = '<!-- modulepreload:start -->';
const END = '<!-- modulepreload:end -->';
const gz = (file) => gzipSync(readFileSync(join(root, file))).length;

const seen = new Set();
function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = readFileSync(join(root, file), 'utf8');
  for (const [, spec] of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g)) {
    walk(posix.join(posix.dirname(file), spec));
  }
  for (const [, spec] of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
    walk(posix.join(posix.dirname(file), spec));
  }
}
walk('js/app.js');

const indexPath = join(root, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
const jsBytes = [...seen].reduce((sum, file) => sum + gz(file), 0) + gz('vendor/jquery.min.js');
const cssBytes = css.reduce((sum, file) => sum + gz(file), 0);
const totalKB = (jsBytes + cssBytes) / 1024;

console.log(`first load: ${seen.size} modules + jQuery ${(jsBytes / 1024).toFixed(1)} KB gz, ${css.length} stylesheets ${(cssBytes / 1024).toFixed(1)} KB gz`);
console.log(`total first load: ${totalKB.toFixed(1)} KB gz (budget ${BUDGET_KB} KB)`);
const shellFiles = [...readFileSync(join(root, 'sw.js'), 'utf8').matchAll(/'\.\/((?:js|css)\/[^']+)'/g)].map((m) => m[1]);
const everything = shellFiles.reduce((sum, file) => sum + gz(file), 0) / 1024;
console.log(`all app JS and CSS, if fully downloaded: ${everything.toFixed(1)} KB gz`);

// The preload block: every module of the first load except app.js itself, which index.html loads directly.
const preloads = [...seen].filter((file) => file !== 'js/app.js').sort();
const lines = preloads.map((file) => `  <link rel="modulepreload" href="${file}">`);
const block = [START, ...lines, `  ${END}`].join('\n');
const from = html.indexOf(START);
const to = html.indexOf(END);
if (from < 0 || to < 0) throw new Error('index.html needs the modulepreload markers');
const current = html.slice(from, to + END.length);

if (process.argv.includes('--write')) {
  writeFileSync(indexPath, html.slice(0, from) + block + html.slice(to + END.length));
  console.log(`modulepreload block: ${preloads.length} modules written`);
} else if (current !== block) {
  console.log('index.html modulepreload block is out of date. Run: node scripts/audit-budget.mjs --write');
  process.exit(1);
}
process.exit(totalKB > BUDGET_KB ? 1 : 0);
