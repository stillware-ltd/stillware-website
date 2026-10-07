// Article dates read straight from the markdown frontmatter, for astro.config.mjs (the sitemap `serialize` hook runs at
// config time, outside Astro's content layer, so getCollection() is not available there).
// Same approach as src/lib/tags.mjs: a tiny line parser, no YAML dependency.
import { readdirSync, readFileSync } from 'node:fs';
import { tagSlug } from './tags.mjs';

const DAY = /^(\d{4}-\d{2}-\d{2})(?:[T ][\d:.]+Z?)?$/;

function field(frontmatter, name) {
  const m = frontmatter.match(new RegExp(`^${name}:[ \\t]*(.*?)[ \\t]*$`, 'm'));
  if (!m) return null;
  const raw = m[1].replace(/^["']|["']$/g, '');
  const day = raw.match(DAY);
  return day ? day[1] : null; // YYYY-MM-DD; anything that is not a date is ignored rather than guessed
}

/** [{ slug, date, updated, lastmod, tags }] for every article; `lastmod` is `updated` when set, else `date` (YYYY-MM-DD). */
export function postDates(dir = new URL('../content/blog/', import.meta.url)) {
  const out = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(new URL(file, dir), 'utf8').replace(/\r\n/g, '\n');
    const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
    if (!fm) continue;
    const date = field(fm, 'date');
    const updated = field(fm, 'updated');
    const lastmod = updated && (!date || updated > date) ? updated : date;
    const tagLine = fm.match(/^tags:\s*\[(.*)\]\s*$/m);
    const tags = tagLine
      ? tagLine[1].split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      : [];
    out.push({ slug: file.replace(/\.md$/, ''), date, updated, lastmod, tags });
  }
  return out;
}

/**
 * Sitemap lastmod by pathname: each article (`updated` || `date`), /blog/ (the newest article) and each tag page (the newest
 * article carrying that tag). Pages that are not in this map get no lastmod: never the build time, which would claim every
 * page changed on every deploy.
 */
export function sitemapLastmods(dir) {
  const map = new Map();
  const newest = (a, b) => (!a || (b && b > a) ? b : a);
  let all = null;
  const byTag = new Map();
  for (const p of postDates(dir)) {
    if (!p.lastmod) continue;
    map.set(`/blog/${p.slug}/`, p.lastmod);
    all = newest(all, p.lastmod);
    for (const t of p.tags) byTag.set(tagSlug(t), newest(byTag.get(tagSlug(t)), p.lastmod));
  }
  if (all) map.set('/blog/', all);
  for (const [slug, day] of byTag) map.set(`/blog/tag/${slug}/`, day);
  return map;
}
