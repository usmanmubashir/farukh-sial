// Dev audit: every literal translation key used in the code must exist in the English and Urdu dictionaries.
// Dynamic keys (built with a template) are listed separately, because the audit cannot check them statically.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });

const i18nDir = path.join(root, 'js', 'i18n');
const keysIn = (files) => {
  const keys = new Set();
  for (const file of files) {
    const text = fs.readFileSync(path.join(i18nDir, file), 'utf8');
    for (const match of text.matchAll(/^\s*'([^']+)':/gm)) keys.add(match[1]);
  }
  return keys;
};
const en = keysIn(fs.readdirSync(i18nDir).filter((f) => f.endsWith('-en.js') || f === 'en.js'));
const ur = keysIn(fs.readdirSync(i18nDir).filter((f) => f.endsWith('-ur.js') || f === 'ur.js'));

const used = new Map();
const dynamic = new Set();
for (const file of walk(path.join(root, 'js'))) {
  if (file.includes(`${path.sep}i18n${path.sep}`)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\bt\(\s*'([^']+)'/g)) {
    const list = used.get(match[1]) ?? [];
    list.push(path.relative(root, file));
    used.set(match[1], list);
  }
  for (const match of text.matchAll(/\bt\(\s*`([^`]*)`/g)) {
    if (match[1].includes('${')) dynamic.add(`${match[1]}  (${path.relative(root, file)})`);
  }
}

const missingEn = [...used.keys()].filter((k) => !en.has(k) && k !== 'key');
const missingUr = [...used.keys()].filter((k) => !ur.has(k) && k !== 'key');
console.log(`literal keys used: ${used.size}; missing in en: ${missingEn.length}; missing in ur: ${missingUr.length}`);
if (missingEn.length) console.log(`MISSING IN EN:\n  ${missingEn.map((k) => `${k}  <- ${used.get(k)[0]}`).join('\n  ')}`);
if (missingUr.length) console.log(`MISSING IN UR:\n  ${missingUr.map((k) => `${k}  <- ${used.get(k)[0]}`).join('\n  ')}`);
console.log(`dynamic keys (check by hand): ${dynamic.size}`);
for (const line of dynamic) console.log(`  ${line}`);
