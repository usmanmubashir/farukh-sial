// Dev audit: Urdu entries whose text is identical to the English entry (likely untranslated).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'i18n');
const entryLine = /^\s*'([^']+)':\s*'(.*)',?\s*$/;

const pairs = (files) => {
  const map = new Map();
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
      const match = entryLine.exec(line);
      if (match) map.set(match[1], match[2]);
    }
  }
  return map;
};

const all = fs.readdirSync(dir);
const en = pairs(all.filter((f) => f.endsWith('-en.js') || f === 'en.js'));
const ur = pairs(all.filter((f) => f.endsWith('-ur.js') || f === 'ur.js'));
const same = [...ur.keys()].filter((k) => en.get(k) === ur.get(k) && /[A-Za-z]{3,}/.test(ur.get(k)));
console.log(`parsed en ${en.size}, ur ${ur.size}; identical English and Urdu text: ${same.length}`);
for (const k of same) console.log(`  ${k}: ${ur.get(k)}`);
