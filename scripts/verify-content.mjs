// Content guardrails (2026-09-29, SEO strategy §5.8). Runs at the start of `npm run build`, before the slow steps.
//
// Why: the 28 Aug 2026 cleanup showed what unchecked auto-generated content costs: off-topic posts, near-duplicate posts
// competing for one search, and titles/descriptions cut off in results. These rules keep the daily routine honest.
//
// ERRORS (fail the build):
//   - the article body starts a line with "# " (the template already prints the title as the one H1; a second H1 splits
//     the page's heading structure)
//   - two articles share a primaryKeyword (refresh the existing article instead of adding a second one). The daily chess
//     puzzle series (daily-chess-puzzle-*) is exempt: those posts are templated companions to videos, not search assets.
//   - an unknown appCluster is rejected by the schema in src/content/config.ts (products that ship, plus "general")
// WARNINGS (printed, never fail the build):
//   - the search-result title is over 60 characters (add a shorter `seoTitle`)
//   - the description is not 120 to 160 characters
//   - no `heroImage` (the main image Google shows for the article; see scripts/optimize-heroes.mjs): the posts are listed
//   - the only image is an SVG `ogImage` (a text card Google and social previews cannot use): the posts are listed
//
// Escape hatch for an emergency deploy: SKIP_LINK_CHECK=1 (the same switch as verify-links.mjs).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { postSeoTitle, TITLE_MAX } from '../src/lib/seo.mjs';

if (process.env.SKIP_LINK_CHECK) {
  console.log('verify-content: skipped (SKIP_LINK_CHECK is set)');
  process.exit(0);
}

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dir = join(root, 'src', 'content', 'blog');
if (!existsSync(dir)) {
  console.log('verify-content: no content directory, nothing to check');
  process.exit(0);
}

const unquote = (v) => v.trim().replace(/^(["'])(.*)\1$/s, '$2');

function parse(file) {
  const text = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z][\w]*):\s*(.*)$/);
    if (kv) data[kv[1]] = unquote(kv[2]);
  }
  return { data, body: m[2] };
}

const errors = [];
const warnings = [];
const byKeyword = new Map();
const noHero = [];
const svgOnly = [];
const isSvg = (p) => /\.svg$/i.test((p || '').split(/[?#]/)[0]);

for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
  const slug = file.replace(/\.md$/, '');
  const { data, body } = parse(file);

  // Headings inside fenced code blocks do not count.
  let fenced = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^# \S/.test(line)) {
      errors.push(`${slug}: the body contains an H1 ("${line.slice(0, 50)}"); the template already prints the title as the H1. Remove that line.`);
      break;
    }
  }

  const kw = (data.primaryKeyword || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (kw && !slug.startsWith('daily-chess-puzzle-')) {
    if (!byKeyword.has(kw)) byKeyword.set(kw, []);
    byKeyword.get(kw).push(slug);
  }

  const title = postSeoTitle({ title: data.title || '', seoTitle: data.seoTitle, pillar: data.pillar });
  if (title.length > TITLE_MAX) warnings.push(`${slug}: search title is ${title.length} characters (limit ${TITLE_MAX}); add a shorter seoTitle.`);

  // Main image (heroImage -> /blog/images/<slug>/hero.webp, at least 1200 px wide, ideally 1600x900). An SVG ogImage is not one.
  if (!data.heroImage) {
    noHero.push(slug);
    if (isSvg(data.ogImage)) svgOnly.push(slug);
  }

  const dl = (data.description || '').length;
  if (dl < 120 || dl > 160) warnings.push(`${slug}: description is ${dl} characters (aim for 120 to 160).`);
}

for (const [kw, slugs] of byKeyword) {
  if (slugs.length > 1) {
    errors.push(`primaryKeyword "${kw}" is used by ${slugs.length} articles (${slugs.join(', ')}). Refresh the existing article instead of adding another for the same search.`);
  }
}

const imageWarnings = noHero.length + svgOnly.length;
if (warnings.length) {
  console.warn(`verify-content: ${warnings.length} warning(s):`);
  for (const w of warnings) console.warn(`  - ${w}`);
}
if (noHero.length) {
  console.warn(`verify-content: ${noHero.length} post(s) with no heroImage (the main image Google shows; add /blog/images/<slug>/hero.webp, at least 1200 px wide, and set heroImage):`);
  for (const slug of noHero) console.warn(`  - ${slug}`);
}
if (svgOnly.length) {
  console.warn(`verify-content: ${svgOnly.length} post(s) whose only image is an SVG ogImage (never used as og:image or in schema; the page falls back to a raster default until a hero is added):`);
  for (const slug of svgOnly) console.warn(`  - ${slug}`);
}
if (errors.length) {
  console.error(`verify-content: ${errors.length} problem(s) found:`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('Fix the articles above. For an emergency deploy set SKIP_LINK_CHECK=1.');
  process.exitCode = 1;
} else {
  console.log(`verify-content: ok (${warnings.length + imageWarnings} warning(s))`);
}
