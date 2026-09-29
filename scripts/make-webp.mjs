// One-off image tooling (2026-09-29): writes right-sized WebP copies next to the original screenshots and logos in public/.
//
// Why: /zeroed/ shipped 2.1 MB and /rankupchess/ 5.1 MB of PNG/JPEG screenshots for images shown at 260-600 px, and every page
// fetched an 84 KB logo (267x309) for a logo drawn 85 px tall. The originals stay (Open Graph images, the press kit, app-store
// assets); the templates point at the -<width>.webp copies, sized at about 2x the displayed width.
//
// Run:  node scripts/make-webp.mjs          (idempotent; regenerates only missing or older files; --force rewrites all)
// New screenshot? Add a line to `jobs` below and reference the -<width>.webp file from the template.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, parse } from 'node:path';
import sharp from 'sharp';

const pub = new URL('../public/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const force = process.argv.includes('--force');

/** [directory under public/, file-name pattern, output width]. Output: <name>-<width>.webp beside the source. */
const jobs = [
  ['', /^StillwareLtd_logo\.png$/, 150], // header 85 px tall, footer 48 px tall
  ['', /^logo\.png$/, 128], // Zeroed icon shown at 64 px on /apps/
  ['', /^RankUpChess_logo\.png$/, 240], // shown at 48-120 px
  ['', /^Zeroed_Desktop_(Today|Budget|Reports)\.png$/, 1200], // hero carousel and home, shown at 600 px
  ['mobile-slides', /^\d\.png$/, 520], // shown at 260 px
  ['rankupchess-screens', /^phone_.*\.jpg$/, 560], // shown at 280 px
  ['rankupchess-screens', /^mac_.*\.jpg$/, 1040], // shown at up to 520 px
];

let made = 0, before = 0, after = 0;
for (const [dir, pattern, width] of jobs) {
  const folder = join(pub, dir);
  for (const name of readdirSync(folder).filter((n) => pattern.test(n))) {
    const src = join(folder, name);
    const out = join(folder, `${parse(name).name}-${width}.webp`);
    if (!force && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue;
    await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality: 82, effort: 5 }).toFile(out);
    before += statSync(src).size;
    after += statSync(out).size;
    made++;
    console.log(`${(dir ? dir + '/' : '') + parse(out).base}`.padEnd(58), `${Math.round(statSync(src).size / 1024)} KB -> ${Math.round(statSync(out).size / 1024)} KB`);
  }
}
console.log(`\n${made} file(s) written, ${Math.round(before / 1024)} KB -> ${Math.round(after / 1024)} KB`);
