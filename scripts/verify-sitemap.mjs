// Post-build guard for the sitemap files (2026-09-07).
//
// Why: the 4 Sep 2026 Netlify deploy shipped a 176-byte sitemap-index.xml with no closing
// </sitemapindex> (the `sitemap` package writes the index through a stream that can be closed
// before the last chunk is flushed). Search Console reported "Sitemap can be read, but has
// errors: Parsing error, line 1" and discovered 0 pages, so nothing new got indexed from it.
// A local build produced the correct 191-byte file, so the truncation is a build-host race.
//
// What: after `astro build`, parse every dist/sitemap*.xml. Repair a missing root closing tag,
// then fail the build if any file still does not parse or the index lists a sitemap that does
// not exist in dist. Google only re-reads the index when it has changed or on resubmission.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = readdirSync(dist).filter((f) => /^sitemap.*\.xml$/.test(f));
if (files.length === 0) {
  console.error('verify-sitemap: no sitemap*.xml in dist/');
  process.exit(1);
}

let failed = false;
for (const f of files) {
  const p = join(dist, f);
  let xml = readFileSync(p, 'utf8');
  const root = xml.match(/<(sitemapindex|urlset)\b/)?.[1];
  if (!root) {
    console.error(`verify-sitemap: ${f} has no <sitemapindex> or <urlset> root`);
    failed = true;
    continue;
  }
  const close = `</${root}>`;
  if (!xml.trimEnd().endsWith(close)) {
    console.warn(`verify-sitemap: ${f} was missing ${close}; repaired`);
    xml = xml.trimEnd() + close + '\n';
    writeFileSync(p, xml);
  }
  // Well-formedness: every <loc> closed, tags balanced for the two elements we care about.
  const opens = (xml.match(/<url>|<sitemap>/g) || []).length;
  const closes = (xml.match(/<\/url>|<\/sitemap>/g) || []).length;
  const locs = (xml.match(/<loc>/g) || []).length;
  const locClose = (xml.match(/<\/loc>/g) || []).length;
  if (opens !== closes || locs !== locClose || locs === 0) {
    console.error(`verify-sitemap: ${f} is malformed (entries ${opens}/${closes}, loc ${locs}/${locClose})`);
    failed = true;
    continue;
  }
  if (root === 'sitemapindex') {
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const child = m[1].split('/').pop();
      if (!existsSync(join(dist, child))) {
        console.error(`verify-sitemap: ${f} lists ${child} but dist/${child} does not exist`);
        failed = true;
      }
    }
  }
  console.log(`verify-sitemap: ${f} ok (${locs} entries, ${Buffer.byteLength(xml)} bytes)`);
}
if (failed) process.exit(1);
