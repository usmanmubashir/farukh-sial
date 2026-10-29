// Writes the app icons as PNG files. Run once with: node scripts/make-icons.mjs
// No dependencies: the PNG is encoded here with zlib from Node's standard library.
// Any icon: a teal square with a white cross. Maskable: the cross sits inside the central 60 % safe zone,
// so launchers that crop to a circle or squircle still show all of it.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'icons');
const BG = [15, 118, 110];
const FG = [255, 255, 255];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(size, drawPixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = drawPixel(x, y);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A plus sign whose arms reach `arm` of the half-size, with a bar of `thick` of the full size. */
function cross(size, arm, thick) {
  const mid = size / 2;
  const half = (size * arm) / 2;
  const bar = (size * thick) / 2;
  return (x, y) => {
    const dx = Math.abs(x + 0.5 - mid);
    const dy = Math.abs(y + 0.5 - mid);
    const inside = (dx <= half && dy <= bar) || (dy <= half && dx <= bar);
    return inside ? FG : BG;
  };
}

const jobs = [
  ['icon-192.png', 192, cross(192, 0.56, 0.1)],
  ['icon-512.png', 512, cross(512, 0.56, 0.1)],
  ['icon-maskable-512.png', 512, cross(512, 0.36, 0.07)],
];
for (const [name, size, pixel] of jobs) {
  writeFileSync(join(out, name), png(size, pixel));
  console.log('wrote', name);
}
