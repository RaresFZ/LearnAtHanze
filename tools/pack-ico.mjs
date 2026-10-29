// Packs tools/icon/png/icon-<size>.png into tools/icon/LearnAtHanze.ico (PNG-compressed icon, fine on Windows Vista and later).
// The PNGs are renders of tools/icon/icon.svg (any browser or SVG tool will do; transparent background).
// Run: node tools/pack-ico.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'icon');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((n) => ({ n, data: fs.readFileSync(path.join(dir, 'png', `icon-${n}.png`)) }));
for (const { n, data } of pngs) {
  const w = data.readUInt32BE(16), h = data.readUInt32BE(20);
  if (data.subarray(1, 4).toString() !== 'PNG' || w !== n || h !== n) throw new Error(`icon-${n}.png must be a ${n}x${n} PNG (is ${w}x${h})`);
}
const head = Buffer.alloc(6 + 16 * pngs.length);
head.writeUInt16LE(1, 2);                       // type: icon
head.writeUInt16LE(pngs.length, 4);
let offset = head.length;
pngs.forEach(({ n, data }, i) => {
  const e = 6 + 16 * i;
  head[e] = n === 256 ? 0 : n; head[e + 1] = n === 256 ? 0 : n;   // 0 means 256
  head.writeUInt16LE(1, e + 4);                 // colour planes
  head.writeUInt16LE(32, e + 6);                // bits per pixel
  head.writeUInt32LE(data.length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
const out = path.join(dir, 'LearnAtHanze.ico');
fs.writeFileSync(out, Buffer.concat([head, ...pngs.map((p) => p.data)]));
console.log(`wrote ${path.relative(process.cwd(), out)} (${sizes.join(', ')} px, ${offset} bytes)`);
