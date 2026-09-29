// Blog tag helpers shared by the tag pages (Astro runtime) and astro.config.mjs (sitemap filter, config time).
import { readdirSync, readFileSync } from 'node:fs';

// A tag page lists posts; with only a few it is a thin page, so it stays out of the index and the sitemap.
export const MIN_INDEXABLE_TAG_POSTS = 5;

export function tagSlug(tag) {
  return tag.toLowerCase().replace(/ & /g, '-').replace(/ /g, '-');
}

/**
 * Slugs of tags used by fewer than MIN_INDEXABLE_TAG_POSTS posts. Reads the frontmatter directly so the
 * sitemap filter (which runs outside Astro's content layer) and the tag page's noindex agree.
 */
export function thinTagSlugs(dir = new URL('../content/blog/', import.meta.url)) {
  const counts = new Map();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(new URL(file, dir), 'utf8').replace(/\r\n/g, '\n');
    const line = text.match(/^tags:\s*\[(.*)\]\s*$/m);
    if (!line) continue;
    for (const raw of line[1].split(',')) {
      const tag = raw.trim().replace(/^["']|["']$/g, '');
      if (tag) counts.set(tagSlug(tag), (counts.get(tagSlug(tag)) || 0) + 1);
    }
  }
  return new Set([...counts].filter(([, n]) => n < MIN_INDEXABLE_TAG_POSTS).map(([slug]) => slug));
}
