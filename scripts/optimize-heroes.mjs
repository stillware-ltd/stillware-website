// Makes the derived copies of every blog hero image: public/blog/images/<slug>/hero.<ext> ->
//   hero-480.webp, hero-960.webp, hero-1200.webp         plain resizes for the srcset (2026-09-29; the 1200 one 2026-10-07)
//   hero-1200x675.webp, hero-1200x900.webp, hero-1200x1200.webp   16:9, 4:3 and 1:1 crops (2026-10-07)
//
// Why the small copies: heroes are 1792x1024 (200-300 KB) but the blog index draws them at 750 px or less, so /blog/ shipped 63
// images and about 6 MB. Templates (blog/index.astro, blog/[slug].astro) reference them in a srcset next to the original.
//
// Why the crops: Google shows one main image per article and asks for it in three aspect ratios in schema.org `image`
// (16:9, 4:3, 1:1), each at least 1200 px wide. The 16:9 crop is also the og:image and twitter:image. The crops use sharp's
// attention strategy (it keeps the busiest, most salient part of the picture in frame) rather than a blind centre crop.
// A source narrower than 1200 px gets no 1200 variant and no crops: the script warns and carries on, it never fails the build,
// and the templates fall back to the next image (see src/lib/images.mjs).
//
// Runs before `astro build` and `astro dev` (see package.json), so a new article's hero gets its variants automatically; the
// output is git-ignored and regenerated on every deploy (a few seconds; files that are already up to date are skipped).
// scripts/verify-links.mjs fails the build if a template points at a variant that does not exist.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { HERO_CROPS, HERO_WIDTHS, MAX_UPSCALE, MIN_SOURCE_WIDTH, cropFileName } from '../src/lib/images.mjs';

const images = new URL('../public/blog/images/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const force = process.argv.includes('--force');

if (!existsSync(images)) process.exit(0);

const upToDate = (out, src) => !force && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs;
const warnings = [];
let made = 0;
for (const slug of readdirSync(images, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
  const dir = join(images, slug);
  const hero = readdirSync(dir).find((f) => /^hero\.(webp|png|jpe?g)$/i.test(f));
  if (!hero) continue;
  const src = join(dir, hero);

  let meta;
  try {
    meta = await sharp(src).metadata();
  } catch (err) {
    warnings.push(`${slug}: ${hero} cannot be read (${err.message}); no variants made.`);
    continue;
  }
  const wide = (meta.width || 0) >= MIN_SOURCE_WIDTH;

  for (const width of HERO_WIDTHS) {
    const out = join(dir, `hero-${width}.webp`);
    if (width >= MIN_SOURCE_WIDTH && !wide) {
      rmSync(out, { force: true }); // a stale copy from an earlier, larger hero
      continue;
    }
    if (upToDate(out, src)) continue;
    // Never upscale: a small source still gets the file the srcset names, just at its own width.
    await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toFile(out);
    made++;
  }

  if (!wide) {
    for (const crop of HERO_CROPS) rmSync(join(dir, cropFileName(crop)), { force: true });
    warnings.push(
      `${slug}: ${hero} is ${meta.width || '?'} px wide, under ${MIN_SOURCE_WIDTH}. Skipped the 1200 variant and the 16:9, 4:3 and 1:1 crops; ` +
        'the article falls back to a raster ogImage or the cluster default for og:image. Replace the hero with one at least 1200 px wide (1600x900 or larger is better).',
    );
    continue;
  }

  for (const crop of HERO_CROPS) {
    const out = join(dir, cropFileName(crop));
    const upscale = Math.max(crop.width / meta.width, crop.height / meta.height);
    if (upscale > MAX_UPSCALE) {
      rmSync(out, { force: true });
      warnings.push(`${slug}: no ${crop.ratio} crop (${crop.width}x${crop.height}): the ${meta.width}x${meta.height} hero would be enlarged ${upscale.toFixed(1)}x (limit ${MAX_UPSCALE}x).`);
      continue;
    }
    if (upToDate(out, src)) continue;
    await sharp(src)
      .resize({ width: crop.width, height: crop.height, fit: 'cover', position: sharp.strategy.attention })
      .webp({ quality: 82, effort: 4 })
      .toFile(out);
    made++;
  }
}

if (warnings.length) {
  console.warn(`optimize-heroes: ${warnings.length} warning(s) (never fatal):`);
  for (const w of warnings) console.warn(`  - ${w}`);
}
console.log(made ? `optimize-heroes: wrote ${made} image(s)` : 'optimize-heroes: up to date');
