// QR landing-page downloads guard (2026-11-13). Runs at the end of `npm run build` and fails the build when a page that
// a RankUp Chess short link lands on is missing any of the four downloads near its top.
//
// Why: the founder, 13 Nov 2026: "For every QR code url the user visits there must see all 4 downloads option on each
// of those devices for the user to download. Place that in a easy and prominent position for easy downloads." On that
// day only /rankupchess/ had them; the printable hubs and /rankupchess/schools/ had none. Research note:
// Marketing/Rank_Up_Chess/SEO/research/qr-landing-four-downloads-2026-11-13.md.
//
// For every 302 in _redirects whose target is under /rankupchess/, the target page must:
//   1. be built (dist/<path>/index.html);
//   2. carry exactly one downloads group marked data-rankup-downloads="top" (src/components/RankupDownloads.astro);
//   3. hold, in that group, the four links with their labels word for word, each in the HTML and none hidden:
//      "Download on the App Store" (apps.apple.com), "Get it on Google Play" (com.stillware.rankup_chess),
//      "Download for Windows" (the .exe on GitHub releases) and "Download for Mac" (the .dmg);
//   4. have it near the top: after the page's one <h1>, before its first <h2>, and with no more than
//      MAX_WORDS_BEFORE words of text between the two.
//
// Live mode, after a deploy: `node scripts/verify-qr-downloads.mjs --live [origin]`. Each short link, in both forms,
// must answer a 302 to its page in _redirects. The page is read from the live site and checked as above. Every
// download URL must answer: the store pages 200, and GitHub's assets 200 or 302. A new QR link is not live until its
// page passes (Marketing/Rank_Up_Chess/Youtube/rotation/upload-playbook.md, section 6).
//
// Escape hatch for an emergency deploy: SKIP_LINK_CHECK=1 (the same switch as verify-links.mjs).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_WORDS_BEFORE = 120;
const FOUR = [
  { label: 'Download on the App Store', href: /^https:\/\/apps\.apple\.com\/app\/id\d+$/ },
  { label: 'Get it on Google Play', href: /^https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.stillware\.rankup_chess$/ },
  { label: 'Download for Windows', href: /^https:\/\/github\.com\/stillware-ltd\/rankup-chess-releases\/releases\/download\/[^/]+\/[^/]+\.exe$/ },
  { label: 'Download for Mac', href: /^https:\/\/github\.com\/stillware-ltd\/rankup-chess-releases\/releases\/download\/[^/]+\/[^/]+\.dmg$/ },
];

if (process.env.SKIP_LINK_CHECK) {
  console.log('verify-qr-downloads: skipped (SKIP_LINK_CHECK is set)');
  process.exit(0);
}

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dist = join(root, 'dist');
const args = process.argv.slice(2);
const live = args.includes('--live');
const origin = (args.find((a) => /^https?:\/\//.test(a)) || 'https://www.stillwareltd.com').replace(/\/$/, '');

// ---- the RankUp short links ----------------------------------------------------------------------------------------
const redirectsFile = existsSync(join(dist, '_redirects')) && !live ? join(dist, '_redirects') : join(root, 'public', '_redirects');
const links = [];
for (const line of readFileSync(redirectsFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^(\/\S+)\s+(\/rankupchess\S*)\s+302!?\s*$/);
  if (m) links.push({ from: m[1], to: m[2], page: m[2].split(/[?#]/)[0].replace(/\/?$/, '/') });
}
if (links.length === 0) {
  console.error(`verify-qr-downloads: no RankUp short link (a 302 to /rankupchess/...) in ${redirectsFile}`);
  process.exit(1);
}
const pages = [...new Set(links.map((l) => l.page))];

// ---- the HTML checks -----------------------------------------------------------------------------------------------
const text = (html) =>
  html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;|&#\d+;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

// The element that opens at `start` (a "<div"), up to its matching close tag.
function element(html, start) {
  const re = /<(\/?)div\b[^>]*>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html)); ) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return null;
}

function checkPage(page, html) {
  const problems = [];
  const marks = [...html.matchAll(/data-rankup-downloads="top"/g)];
  if (marks.length !== 1) {
    problems.push(`${marks.length} downloads groups marked "top" (need exactly 1: <RankupDownloads top /> near the top)`);
    return { problems, used: [] };
  }
  const open = html.lastIndexOf('<div', marks[0].index);
  const group = open >= 0 ? element(html, open) : null;
  if (!group) return { problems: ['the downloads group has no closing tag'], used: [] };
  if (/^<div\b[^>]*\shidden[\s=>]/.test(group) || /^<div\b[^>]*style="[^"]*display:\s*none/.test(group)) {
    problems.push('the downloads group is hidden');
  }

  const anchors = [...group.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    attrs: m[1],
    href: (m[1].match(/\shref="([^"]*)"|^href="([^"]*)"/) || []).slice(1).find(Boolean) || '',
    label: text(m[2]),
  }));
  const used = [];
  for (const want of FOUR) {
    const got = anchors.filter((a) => a.label === want.label);
    if (got.length !== 1) {
      problems.push(`"${want.label}": ${got.length} links with that label in the group (need 1)`);
      continue;
    }
    const a = got[0];
    if (!want.href.test(a.href)) problems.push(`"${want.label}" goes to ${a.href || '(no href)'}`);
    if (/(^|\s)hidden([\s=]|$)/.test(a.attrs) || /style="[^"]*display:\s*none/.test(a.attrs)) {
      problems.push(`"${want.label}" is hidden`);
    }
    used.push(a.href);
  }

  const h1s = [...html.matchAll(/<h1\b/g)];
  if (h1s.length !== 1) problems.push(`${h1s.length} <h1> elements (need 1)`);
  else {
    const h1End = html.indexOf('</h1>', h1s[0].index);
    if (h1End < 0 || h1End > open) problems.push('the downloads come before the <h1> ends');
    else {
      const words = text(html.slice(h1End + 5, open)).split(' ').filter(Boolean).length;
      if (words > MAX_WORDS_BEFORE) {
        problems.push(`${words} words between the <h1> and the downloads (at most ${MAX_WORDS_BEFORE}: move them up)`);
      }
    }
  }
  const h2 = html.search(/<h2\b/);
  if (h2 >= 0 && h2 < open) problems.push('the downloads come after the first <h2> (they belong near the top)');
  return { problems, used };
}

// ---- build mode ------------------------------------------------------------------------------------------------------
const errors = [];
if (!live) {
  if (!existsSync(dist)) {
    console.error('verify-qr-downloads: dist/ not found; run astro build first');
    process.exit(1);
  }
  for (const page of pages) {
    const file = join(dist, page, 'index.html');
    if (!existsSync(file)) {
      errors.push(`${page}  not built, but a short link lands here (${links.filter((l) => l.page === page).map((l) => l.from).join(', ')})`);
      continue;
    }
    for (const p of checkPage(page, readFileSync(file, 'utf8')).problems) errors.push(`${page}  ${p}`);
  }
  if (errors.length) {
    console.error(`verify-qr-downloads: ${errors.length} problem(s) on the pages RankUp short links land on:`);
    for (const e of errors) console.error(`  ${e}`);
    console.error('Every QR landing page shows all four downloads near its top (src/components/RankupDownloads.astro, top).');
    process.exit(1);
  }
  console.log(`verify-qr-downloads: ${links.length} short links, ${pages.length} pages, all four downloads near the top of each`);
  process.exit(0);
}

// ---- live mode -------------------------------------------------------------------------------------------------------
const pageUrls = new Set();
for (const l of links) {
  const res = await fetch(origin + l.from, { redirect: 'manual' });
  const loc = res.headers.get('location') || '';
  const target = new URL(l.to, origin + '/').toString();
  const got = loc ? new URL(loc, origin + '/').toString() : '';
  if (res.status !== 302 || got !== target) errors.push(`${l.from}  answers ${res.status} ${got || '(no Location)'}, want 302 ${target}`);
  else pageUrls.add(target);
}
const downloads = new Set();
for (const url of pageUrls) {
  const res = await fetch(url, { redirect: 'manual' });
  if (res.status !== 200) {
    errors.push(`${url}  answers ${res.status}`);
    continue;
  }
  const { problems, used } = checkPage(url, await res.text());
  for (const p of problems) errors.push(`${url}  ${p}`);
  used.forEach((u) => downloads.add(u));
}
for (const url of downloads) {
  const github = url.startsWith('https://github.com/');
  const res = await fetch(url, { redirect: github ? 'manual' : 'follow', headers: { 'user-agent': 'Mozilla/5.0 (link check)' } });
  const ok = github ? [200, 302].includes(res.status) : res.status === 200;
  if (!ok) errors.push(`${url}  answers ${res.status}`);
  else console.log(`  ${res.status}  ${url}`);
  try { await res.body?.cancel(); } catch {}
}
if (errors.length) {
  console.error(`verify-qr-downloads --live: ${errors.length} problem(s) on ${origin}:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`verify-qr-downloads --live: ${links.length} short links answer 302, ${pageUrls.size} pages carry the four, ${downloads.size} download URLs answer (${origin})`);
