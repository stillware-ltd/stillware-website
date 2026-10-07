// Image helpers for blog articles. Server side only (build time): they read public/ with node:fs.
//
// Convention: a blog hero lives at public/blog/images/<slug>/hero.<webp|png|jpg> (frontmatter `heroImage`).
// scripts/optimize-heroes.mjs writes, next to it, before every build and dev run (git-ignored):
//   - hero-480.webp, hero-960.webp, hero-1200.webp   plain resizes, for the srcset
//   - hero-1200x675.webp (16:9), hero-1200x900.webp (4:3), hero-1200x1200.webp (1:1)   attention-cropped; the three
//     aspect ratios Google asks for in schema.org `image`, and the 16:9 one is the og:image / twitter:image
// A source narrower than MIN_SOURCE_WIDTH gets no 1200 variant and no crops (the script warns).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

export const SITE_ORIGIN = 'https://www.stillwareltd.com';
/** Widths of the plain-resize variants named in the srcset. */
export const HERO_WIDTHS = [480, 960, 1200];
/** A hero narrower than this is too small for Google's large image preview: no 1200 variant, no crops. */
export const MIN_SOURCE_WIDTH = 1200;
/** Crops in the order they are listed in schema.org `image` (16:9 first: it is also the og:image). */
export const HERO_CROPS = [
  { width: 1200, height: 675, ratio: '16:9' },
  { width: 1200, height: 900, ratio: '4:3' },
  { width: 1200, height: 1200, ratio: '1:1' },
];
/** A crop that would enlarge the source by more than this factor is skipped (it would only be a blurry copy). */
export const MAX_UPSCALE = 2;

export const cropFileName = ({ width, height }) => `hero-${width}x${height}.webp`;

const HERO_PATH = /^(\/blog\/images\/[^/]+\/)hero\.(?:webp|png|jpe?g)$/i;
const publicDir = () => join(process.cwd(), 'public');
const localFile = (urlPath) => join(publicDir(), decodeURIComponent(urlPath.split(/[?#]/)[0]));

/**
 * srcset for a blog hero, or null when the path does not follow the convention (then use the plain src).
 * `originalWidth` (from the file's metadata) adds the 1200 variant (only for sources that are at least 1200 wide, which
 * is when the script makes it) and the untouched original when it is wider still.
 */
export function heroSrcset(heroImage, originalWidth) {
  const m = typeof heroImage === 'string' && heroImage.match(HERO_PATH);
  if (!m) return null;
  const parts = [`${m[1]}hero-480.webp 480w`, `${m[1]}hero-960.webp 960w`];
  if (originalWidth && originalWidth >= MIN_SOURCE_WIDTH) parts.push(`${m[1]}hero-1200.webp 1200w`);
  if (originalWidth && originalWidth > MIN_SOURCE_WIDTH) parts.push(`${heroImage} ${originalWidth}w`);
  return parts.join(', ');
}

/** The crops that exist on disk for a hero: [{ path: '/blog/images/<slug>/hero-1200x675.webp', width, height, ratio }]. */
export function heroCrops(heroImage) {
  const m = typeof heroImage === 'string' && heroImage.match(HERO_PATH);
  if (!m) return [];
  return HERO_CROPS.map((c) => ({ ...c, path: `${m[1]}${cropFileName(c)}` })).filter((c) => existsSync(localFile(c.path)));
}

const RASTER = /\.(?:png|jpe?g|webp|gif|avif)$/i;
/** True for a path or URL whose file is a raster image. An SVG (or anything else) is never an og:image or schema image. */
export const isRaster = (p) => typeof p === 'string' && RASTER.test(p.split(/[?#]/)[0]);

/** Fallback cards by app cluster, for articles with no hero and no raster ogImage. */
export const GENERAL_FALLBACK = '/StillwareLtd_logo_title.png';
const CLUSTER_FALLBACK = {
  zeroed: '/Zeroed_Desktop_Today.png',
  // The macOS home screen the /rankupchess/ page opens with (its 1040 px webp is the page's first hero slide).
  'rankup-chess': '/rankupchess-screens/mac_090_04_home.jpg',
  rankupchess: '/rankupchess-screens/mac_090_04_home.jpg',
};
export const clusterFallback = (appCluster) => CLUSTER_FALLBACK[appCluster] || GENERAL_FALLBACK;

// An image on this site, as a root-relative path ("/x.png"); '' for another host.
function sitePath(p) {
  if (/^https?:\/\//i.test(p)) {
    const u = new URL(p);
    return u.origin === SITE_ORIGIN ? u.pathname : '';
  }
  return p.startsWith('/') && !p.startsWith('//') ? p : '';
}

async function describe(urlPath) {
  const abs = new URL(urlPath, SITE_ORIGIN).href;
  try {
    const meta = await sharp(localFile(urlPath)).metadata();
    return { url: abs, width: meta.width, height: meta.height };
  } catch {
    return { url: abs };
  }
}

/**
 * The picture a post is shared and described with. Always a raster, never an SVG.
 *   og      -> { url, width?, height?, source }  for og:image and twitter:image. Priority: the 1200x675 hero crop, then a
 *              raster `ogImage` that exists in public/, then the cluster default card (zeroed, rankup-chess, else the
 *              Stillware title logo).
 *   schema  -> string[]  for BlogPosting.image: the hero crops that exist (16:9, 4:3, 1:1); else the hero itself when it
 *              is a raster that exists (a hero too narrow to crop); else a raster `ogImage`; else the cluster default card,
 *              unless that is the logo (Google asks for a relevant picture, not a logo); else [].
 */
export async function resolvePostImages({ heroImage, ogImage, appCluster }) {
  const crops = heroCrops(heroImage);
  const hero = crops.find((c) => c.width === 1200 && c.height === 675);
  const abs = (p) => new URL(p, SITE_ORIGIN).href;

  const own = typeof ogImage === 'string' ? sitePath(ogImage) : '';
  const remoteOg = typeof ogImage === 'string' && /^https?:\/\//i.test(ogImage) && !own && isRaster(ogImage);
  const ogOk = (own && isRaster(own) && existsSync(localFile(own))) ? own : '';
  const fallback = clusterFallback(appCluster);

  let og;
  if (hero) og = { url: abs(hero.path), width: hero.width, height: hero.height, source: 'hero-crop' };
  else if (ogOk) og = { ...(await describe(ogOk)), source: 'og-image' };
  else if (remoteOg) og = { url: ogImage, source: 'og-image' };
  else og = { ...(await describe(fallback)), source: fallback === GENERAL_FALLBACK ? 'general-default' : 'cluster-default' };

  let schema = [];
  if (crops.length) schema = crops.map((c) => abs(c.path));
  else {
    const heroPath = typeof heroImage === 'string' ? sitePath(heroImage) : '';
    if (heroPath && isRaster(heroPath) && existsSync(localFile(heroPath))) schema = [abs(heroPath)];
    else if (og.source === 'og-image') schema = [og.url];
    else if (og.source === 'cluster-default') schema = [og.url];
  }
  return { og, schema };
}
