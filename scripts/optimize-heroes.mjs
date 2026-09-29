// Makes small copies of every blog hero image (2026-09-29): public/blog/images/<slug>/hero.<ext> -> hero-480.webp, hero-960.webp.
//
// Why: heroes are 1792x1024 (200-300 KB) but the blog index draws them at 750 px or less, so /blog/ shipped 63 images and about
// 6 MB. Templates (blog/index.astro, blog/[slug].astro) reference the two small copies in a srcset next to the original.
//
// Runs before `astro build` and `astro dev` (see package.json), so a new article's hero gets its variants automatically; the
// output is git-ignored and regenerated on every deploy (a few seconds; files that are already up to date are skipped).
// scripts/verify-links.mjs fails the build if a template points at a variant that does not exist.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const images = new URL('../public/blog/images/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const force = process.argv.includes('--force');
const WIDTHS = [480, 960];

if (!existsSync(images)) process.exit(0);

let made = 0;
for (const slug of readdirSync(images, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
  const dir = join(images, slug);
  const hero = readdirSync(dir).find((f) => /^hero\.(webp|png|jpe?g)$/i.test(f));
  if (!hero) continue;
  const src = join(dir, hero);
  for (const width of WIDTHS) {
    const out = join(dir, `hero-${width}.webp`);
    if (!force && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue;
    // Never upscale: a small source still gets the file the srcset names, just at its own width.
    await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toFile(out);
    made++;
  }
}
console.log(made ? `optimize-heroes: wrote ${made} image(s)` : 'optimize-heroes: up to date');
