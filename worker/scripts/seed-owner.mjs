// Creates the first (owner) sign-in and the pharmacy's name for the sync server. Run it once, on your own computer.
// It asks for the username, password and pharmacy name, writes the PBKDF2 hash to worker/seed-owner.sql, and you load
// that file into D1:
//   node worker/scripts/seed-owner.mjs
//   npx wrangler d1 execute shifa-sync --remote --file=worker/seed-owner.sql
// Delete worker/seed-owner.sql afterwards (it is git-ignored, but there is no reason to keep it).
import { createInterface } from 'node:readline/promises';
import { randomBytes, webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ITERATIONS = 310000;
const rl = createInterface({ input: process.stdin, output: process.stdout });
const username = (await rl.question('Owner username (3-32 letters, digits, . - _): ')).trim().toLowerCase();
const password = await rl.question('Owner password (at least 8 characters): ');
const pharmacyName = (await rl.question('Pharmacy name (shown on every device): ')).trim();
rl.close();

if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('The username must be 3 to 32 letters, digits, dots, dashes or underscores.');
if (password.length < 8) throw new Error('The password must be at least 8 characters.');
if (!pharmacyName) throw new Error('The pharmacy name is required.');

// The same derivation the app uses (PBKDF2-SHA256, 256 bits), so the device's proof matches this hash.
const salt = randomBytes(16);
const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
const hash = Buffer.from(bits).toString('base64');
const saltB64 = salt.toString('base64');
const quotedName = pharmacyName.replace(/'/g, "''");

const sql = `CREATE TABLE IF NOT EXISTS pharmacy (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL);
INSERT OR REPLACE INTO pharmacy (id, name) VALUES (1, '${quotedName}');
INSERT INTO members (id, username, salt, hash, iterations, active, stamp)
VALUES ('owner', '${username}', '${saltB64}', '${hash}', ${ITERATIONS}, 1, '');
`;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed-owner.sql');
writeFileSync(out, sql);
console.log(`Written: ${out}`);
console.log('Next: npx wrangler d1 execute shifa-sync --remote --file=worker/seed-owner.sql');
