// Protected-URL guard (2026-10-07, SEO_STRATEGY.md section 2 rule 1 and section 6.1). Runs after `astro build` and fails the
// build when a page that has ever earned search traffic would disappear, redirect or leave the index.
//
// Why: deleting pages that rank is the single most expensive SEO mistake this site has made. The 28 Aug 2026 cleanup removed
// 13 posts with no redirect and took the two biggest pages (94 clicks / 4,517 impressions and 40 clicks / 18,137 impressions);
// the 29 Sep 2026 audit then turned the 404s into 410s. Between them they cost 63% of the site's lifetime Google clicks.
// Nothing in the build noticed, so this guard does.
//
// Inputs:
//   seo/protected-urls.txt    one site path per line: every URL with at least 1 Search Console impression in 16 months.
//   seo/approved-removals.txt `<path> | <YYYY-MM-DD> | <who> | <reason>`: a dated, founder-written exception. Nothing else exempts a path.
//
// For every protected path that is not in approved-removals, FAIL when:
//   1. there is no built file for it (path/ -> dist/path/index.html; /file.ext -> dist/file.ext);
//   2. public/_redirects or netlify.toml has a 301/302/303/307/308/404/410 rule whose source matches it (exact, with or without
//      the trailing slash, or a splat/placeholder), even if a real file currently wins over a non-forced rule;
//   3. netlify.toml sends an `X-Robots-Tag: noindex` header for it;
//   4. the built HTML carries a robots meta with noindex, or a canonical link that points to a different path.
//
// Escape hatch for an emergency deploy ONLY: SKIP_PROTECTED_CHECK=1 (prints a loud warning). Log the reason in seo/CHANGES.md.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dist = join(root, 'dist');

if (process.env.SKIP_PROTECTED_CHECK) {
  console.warn('');
  console.warn('verify-protected: ********************************************************************************');
  console.warn('verify-protected: SKIPPED because SKIP_PROTECTED_CHECK is set. Protected pages may be missing, redirected');
  console.warn('verify-protected: or noindexed in this build. Emergency use only: record why in seo/CHANGES.md, and');
  console.warn('verify-protected: run the check again (unset SKIP_PROTECTED_CHECK) before the next deploy.');
  console.warn('verify-protected: ********************************************************************************');
  console.warn('');
  process.exit(0);
}
if (!existsSync(dist)) {
  console.error('verify-protected: dist/ not found; run astro build first');
  process.exit(1);
}

const errors = [];
const fail = (path, msg) => errors.push(`${path}  ${msg}`);

// ---- the two lists ---------------------------------------------------------------------------------------------------
const dataLines = (file) =>
  readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const protectedFile = join(root, 'seo', 'protected-urls.txt');
if (!existsSync(protectedFile)) {
  console.error('verify-protected: seo/protected-urls.txt is missing. It lists every page that has earned search traffic; restore it from git.');
  process.exit(1);
}
const protectedPaths = [...new Set(dataLines(protectedFile))];
if (!protectedPaths.length) {
  console.error('verify-protected: seo/protected-urls.txt is empty. Restore it from git; do not empty it.');
  process.exit(1);
}
for (const p of protectedPaths) {
  if (!p.startsWith('/') || /\s/.test(p) || p.includes('*')) fail(p, 'seo/protected-urls.txt: each line must be one site path starting with "/" (no spaces, no wildcards)');
}

const approved = new Map(); // path -> { date, who, reason }
const approvedFile = join(root, 'seo', 'approved-removals.txt');
if (existsSync(approvedFile)) {
  for (const line of dataLines(approvedFile)) {
    const parts = line.split('|').map((s) => s.trim());
    const [path, date, who, ...rest] = parts;
    const reason = rest.join(' | ');
    if (!path?.startsWith('/') || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !who || !reason) {
      fail(path || line, 'seo/approved-removals.txt: use `<path> | <YYYY-MM-DD> | <who> | <reason>` (a dated line with a named person and a reason)');
      continue;
    }
    approved.set(path, { date, who, reason });
  }
}

// ---- redirect rules (source file and what Netlify will read) ---------------------------------------------------------
function ruleToRegex(from) {
  const esc = from
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/:[A-Za-z_][\w]*/g, '[^/]+');
  return new RegExp(`^${esc.replace(/\/$/, '')}/?$`);
}
const BAD_STATUS = new Set([301, 302, 303, 307, 308, 404, 410]);
const rules = []; // { from, re, status, where }

for (const [label, file] of [['public/_redirects', join(root, 'public', '_redirects')]]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(\/\S*)\s+(\S+)\s+(\d{3})!?\s*$/);
    if (m && BAD_STATUS.has(Number(m[3]))) rules.push({ from: m[1], re: ruleToRegex(m[1]), status: Number(m[3]), where: label });
  }
}
const tomlFile = join(root, 'netlify.toml');
const toml = existsSync(tomlFile) ? readFileSync(tomlFile, 'utf8') : '';
for (const block of toml.split(/\[\[redirects\]\]/).slice(1)) {
  const body = block.split(/\n\[\[?[a-z]/i)[0]; // stop at the next table
  const from = body.match(/from\s*=\s*"([^"]+)"/)?.[1];
  const status = Number(body.match(/status\s*=\s*(\d+)/)?.[1] || 301);
  if (from && from.startsWith('/') && BAD_STATUS.has(status)) rules.push({ from, re: ruleToRegex(from), status, where: 'netlify.toml' });
}
const noindexHeaders = []; // netlify.toml [[headers]] that noindex a path
for (const block of toml.split(/\[\[headers\]\]/).slice(1)) {
  const body = block.split(/\n\[\[(?!headers)/)[0];
  const forPath = body.match(/for\s*=\s*"([^"]+)"/)?.[1];
  if (forPath && /X-Robots-Tag\s*=\s*"[^"]*noindex/i.test(body)) noindexHeaders.push({ from: forPath, re: ruleToRegex(forPath) });
}

// ---- built files -----------------------------------------------------------------------------------------------------
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const hasExtension = (p) => /\.[a-z0-9]+$/i.test(p.split('/').pop() || '');
function builtFile(path) {
  const rel = decodeURIComponent(path.split(/[?#]/)[0]).replace(/^\//, '');
  if (path.endsWith('/')) return join(dist, rel, 'index.html');
  if (hasExtension(path)) return join(dist, rel);
  return [join(dist, rel, 'index.html'), join(dist, `${rel}.html`)].find(isFile) || join(dist, rel, 'index.html');
}
const normPath = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
const pathOf = (href) => {
  try { return decodeURI(new URL(href, 'https://www.stillwareltd.com').pathname); } catch { return href; }
};

let checked = 0;
let skipped = 0;
for (const path of protectedPaths) {
  if (!path.startsWith('/') || /\s|\*/.test(path)) continue; // already reported
  if (approved.has(path)) { skipped++; continue; }
  checked++;

  // 1. built page
  const file = builtFile(path);
  const built = isFile(file);
  if (!built) fail(path, `has Search Console impressions but there is no built page (${file.replace(root, '')}). Restore the page, or add a dated line to seo/approved-removals.txt`);

  // 2. redirect / 404 / 410 rules
  for (const r of rules) {
    if (r.re.test(path) || r.re.test(path.replace(/\/$/, '')) || r.re.test(`${path.replace(/\/$/, '')}/`)) {
      fail(path, `matches a ${r.status} rule in ${r.where} ("${r.from}"). Remove the rule; a page with search traffic must stay a 200`);
    }
  }

  // 3. noindex header
  for (const h of noindexHeaders) {
    if (h.re.test(path) || h.re.test(path.replace(/\/$/, ''))) fail(path, `netlify.toml sends X-Robots-Tag noindex for "${h.from}", which covers this page`);
  }

  // 4. noindex meta and canonical
  if (built && file.endsWith('.html')) {
    const html = readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
      if (/name=["'](robots|googlebot|bingbot)["']/i.test(m[0]) && /noindex/i.test(m[0])) {
        fail(path, 'the built page has a robots meta with noindex. A page with search traffic must stay indexable (or get a dated line in seo/approved-removals.txt)');
        break;
      }
    }
    const canon = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => /rel=["']canonical["']/i.test(t));
    const href = canon?.match(/href=["']([^"']+)["']/i)?.[1];
    if (href && normPath(pathOf(href)) !== normPath(path)) {
      fail(path, `canonical points to a different path (${pathOf(href)}), which asks Google to drop this URL`);
    }
  }
}

// ---- stale approvals (information only) -------------------------------------------------------------------------------
for (const path of approved.keys()) {
  if (!protectedPaths.includes(path)) console.warn(`verify-protected: note: ${path} is in seo/approved-removals.txt but not in seo/protected-urls.txt (nothing to approve)`);
}

// ---- report ----------------------------------------------------------------------------------------------------------
if (errors.length) {
  const unique = [...new Set(errors)];
  console.error(`verify-protected: ${unique.length} problem(s) found:`);
  for (const e of unique.slice(0, 60)) console.error(`  - ${e}`);
  if (unique.length > 60) console.error(`  ... and ${unique.length - 60} more`);
  console.error('Never remove a working page (SEO_STRATEGY.md section 2). Restore it, or add a dated, founder-written line to seo/approved-removals.txt. For an emergency deploy set SKIP_PROTECTED_CHECK=1.');
  process.exitCode = 1;
} else console.log(`verify-protected: ok (${checked} protected URLs checked, ${skipped} approved removal(s) skipped)`);
