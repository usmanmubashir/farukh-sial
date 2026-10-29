// Checks that the service worker's precache list matches the files on disk, and that its VERSION matches the app.
// Run: node scripts/audit-shell.mjs   (exit code 1 when something is out of step)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const version = readFileSync(join(root, 'js/core/version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)?.[1];
const swVersion = sw.match(/const VERSION = '([^']+)'/)?.[1];

const listed = new Set([...sw.matchAll(/^\s+'(\.\/[^']*)',$/gm)].map((m) => m[1]));
const onDisk = new Set(['./', './index.html', './manifest.webmanifest']);
function walk(dir) {
  for (const name of readdirSync(join(root, dir))) {
    const path = join(root, dir, name);
    if (statSync(path).isDirectory()) walk(relative(root, path));
    else onDisk.add(`./${relative(root, path).split(sep).join('/')}`);
  }
}
for (const dir of ['js', 'css', 'fonts', 'icons', 'vendor']) walk(dir);

const missingFromList = [...onDisk].filter((file) => !listed.has(file));
const missingOnDisk = [...listed].filter((file) => !onDisk.has(file));
let problems = 0;
if (missingFromList.length) {
  problems += missingFromList.length;
  console.log('Not in the precache list (add to SHELL in sw.js):\n  ' + missingFromList.join('\n  '));
}
if (missingOnDisk.length) {
  problems += missingOnDisk.length;
  console.log('In the precache list but not on disk (remove from SHELL in sw.js):\n  ' + missingOnDisk.join('\n  '));
}
if (swVersion !== version) {
  problems += 1;
  console.log(`VERSION mismatch: sw.js has ${swVersion}, js/core/version.js has ${version}`);
}
console.log(problems ? `${problems} problem(s).` : `Shell audit passed: ${listed.size} files, version ${version}.`);
process.exit(problems ? 1 : 0);
