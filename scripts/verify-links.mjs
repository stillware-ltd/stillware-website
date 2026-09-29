// Post-build link guard (2026-09-29). Runs after `astro build` and fails the build on problems that silently cost traffic.
//
// Why: the 28 Aug 2026 cleanup deleted 13 posts and every link to them kept working in the source: 57 references
// (in-body links and relatedSlugs) pointed at 404s, and the deleted pages themselves had no redirect, so the two biggest
// traffic pages became dead ends. Nothing in the build noticed.
//
// Checks (each failure names the page and the link):
//   1. Internal links and local images/scripts/styles must point at something that exists in dist/.
//   2. No internal link may point at a retired URL (a 410 rule in _redirects) or a URL that redirects.
//   3. Internal links must end in "/" (Netlify 301s the slashless form) and use the www host, not the apex.
//   4. Every relatedSlugs entry in an article must be an existing article.
//   5. A page that was in the previous deploy's sitemap must still exist or be redirected/retired. The previous
//      deploy is read from /indexnow-manifest.json on the live site, so this runs only for production builds
//      (or with CHECK_REMOVED=1) and is skipped if the manifest cannot be fetched.
//
// Escape hatch for an emergency deploy: SKIP_LINK_CHECK=1. To retire a page on purpose, add it to public/_redirects.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dist = join(root, 'dist');
const ORIGIN = 'https://www.stillwareltd.com';

if (process.env.SKIP_LINK_CHECK) {
  console.log('verify-links: skipped (SKIP_LINK_CHECK is set)');
  process.exit(0);
}
if (!existsSync(dist)) {
  console.error('verify-links: dist/ not found; run astro build first');
  process.exit(1);
}

const errors = [];
const fail = (page, msg) => errors.push(`${page}  ${msg}`);

// ---- redirect / retired-URL rules (public/_redirects is copied into dist; netlify.toml redirects too) ------------------
function ruleToRegex(from) {
  const esc = from.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc.replace(/\/$/, '')}/?$`);
}
const rules = [];
const redirectsFile = join(dist, '_redirects');
if (existsSync(redirectsFile)) {
  for (const line of readFileSync(redirectsFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(\/\S+)\s+(\S+)\s+(\d{3})!?\s*$/);
    if (m) rules.push({ re: ruleToRegex(m[1]), status: Number(m[3]) });
  }
}
const toml = existsSync(join(root, 'netlify.toml')) ? readFileSync(join(root, 'netlify.toml'), 'utf8') : '';
for (const block of toml.split(/\[\[redirects\]\]/).slice(1)) {
  const from = block.match(/from\s*=\s*"([^"]+)"/)?.[1];
  const status = Number(block.match(/status\s*=\s*(\d+)/)?.[1] || 301);
  if (from && from.startsWith('/') && ![200, 404].includes(status)) rules.push({ re: ruleToRegex(from), status });
}
const ruleFor = (path) => rules.find((r) => r.re.test(path));

// ---- built pages -------------------------------------------------------------------------------------------------
const htmlFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.html')) htmlFiles.push(p);
  }
})(dist);

const pageUrl = (file) => '/' + relative(dist, file).replace(/\\/g, '/').replace(/index\.html$/, '');
const exists = (urlPath) => {
  const rel = decodeURIComponent(urlPath.split(/[?#]/)[0]).replace(/^\//, '');
  return [rel, `${rel}/index.html`, `${rel.replace(/\/$/, '')}.html`].some((c) => {
    try { return statSync(join(dist, c)).isFile(); } catch { return false; }
  });
};
const hasExtension = (p) => /\.[a-z0-9]+$/i.test(p.split('/').pop() || '');

let checked = 0;
for (const file of htmlFiles) {
  const page = pageUrl(file);
  if (page === '/404.html') continue;
  const html = readFileSync(file, 'utf8');

  for (const m of html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)) {
    let href = m[1];
    if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    if (/^https?:\/\/stillwareltd\.com(\/|$)/i.test(href)) { fail(page, `link uses the apex host (use a relative link): ${href}`); continue; }
    href = href.replace(/^https:\/\/www\.stillwareltd\.com(?=\/|$)/i, '') || '/';
    if (!href.startsWith('/') || href.startsWith('//')) continue; // another site
    checked++;
    const path = href.split(/[?#]/)[0];
    if (!path.endsWith('/') && !hasExtension(path)) fail(page, `slashless internal link (Netlify 301s it): ${href}`);
    const rule = ruleFor(path);
    if (rule && !exists(path)) fail(page, `links to a ${rule.status === 410 ? 'retired (410)' : 'redirected'} URL: ${href}`);
    else if (!exists(path)) fail(page, `broken internal link: ${href}`);
  }

  for (const tag of html.matchAll(/<(?:img|script|source)\b[^>]*>/g)) {
    for (const m of tag[0].matchAll(/\s(src|srcset)="([^"]+)"/g)) {
      // A srcset holds several candidates ("/a.webp 480w, /b.webp 960w"); every one must exist.
      const urls = m[1] === 'srcset' ? m[2].split(',').map((c) => c.trim().split(/\s+/)[0]) : [m[2]];
      for (const src of urls) {
        if (!src.startsWith('/') || src.startsWith('//')) continue;
        checked++;
        if (!exists(src)) fail(page, `missing file: ${src}`);
      }
    }
  }
  for (const m of html.matchAll(/<link\b[^>]*?\shref="(\/[^"]+)"[^>]*>/g)) {
    if (/rel="(stylesheet|icon|preload)"/.test(m[0]) && !exists(m[1])) fail(page, `missing file: ${m[1]}`);
  }
}

// ---- relatedSlugs -----------------------------------------------------------------------------------------------
const blogDir = join(root, 'src', 'content', 'blog');
if (existsSync(blogDir)) {
  const slugs = new Set(readdirSync(blogDir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')));
  for (const slug of slugs) {
    const text = readFileSync(join(blogDir, `${slug}.md`), 'utf8').replace(/\r\n/g, '\n');
    const line = text.match(/^relatedSlugs:\s*\[(.*)\]\s*$/m);
    if (!line) continue;
    for (const raw of line[1].split(',')) {
      const rel = raw.trim().replace(/^["']|["']$/g, '');
      if (rel && !slugs.has(rel)) fail(`/blog/${slug}/`, `relatedSlugs entry does not exist: ${rel}`);
    }
  }
}

// ---- pages that disappeared since the last deploy ---------------------------------------------------------------------
if (process.env.CONTEXT === 'production' || process.env.CHECK_REMOVED) {
  try {
    const res = await fetch(`${ORIGIN}/indexnow-manifest.json`, { signal: AbortSignal.timeout(15000) });
    const pages = res.ok ? (await res.json()).pages : null;
    if (pages && typeof pages === 'object') {
      for (const url of Object.keys(pages)) {
        const path = new URL(url).pathname;
        if (!exists(path) && !ruleFor(path)) fail(path, 'was live at the last deploy but is now gone with no redirect or 410 rule (add it to public/_redirects)');
      }
    } else {
      console.log('verify-links: previous deploy manifest not available; skipping the disappeared-pages check');
    }
  } catch (err) {
    console.log(`verify-links: could not read the previous deploy manifest (${err.message}); skipping the disappeared-pages check`);
  }
}

// ---- report -----------------------------------------------------------------------------------------------------
if (errors.length) {
  const unique = [...new Set(errors)];
  console.error(`verify-links: ${unique.length} problem(s) found:`);
  for (const e of unique.slice(0, 60)) console.error(`  - ${e}`);
  if (unique.length > 60) console.error(`  ... and ${unique.length - 60} more`);
  console.error('Fix the links, or add a redirect/410 rule in public/_redirects. For an emergency deploy set SKIP_LINK_CHECK=1.');
  // exitCode, not process.exit(): exiting straight after a fetch can trip a libuv assertion on Windows.
  process.exitCode = 1;
} else console.log(`verify-links: ok (${htmlFiles.length} pages, ${checked} internal references checked)`);
