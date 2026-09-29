// IndexNow helpers (pure functions; no Netlify APIs) so the logic can be tested without a build.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** File on disk (inside the publish dir) that a sitemap <loc> URL is served from. */
function urlToFile(publishDir, origin, url) {
  const { pathname } = new URL(url, origin);
  const rel = decodeURIComponent(pathname).replace(/^\//, '');
  if (rel === '' || rel.endsWith('/')) return path.join(publishDir, rel, 'index.html');
  return path.join(publishDir, rel);
}

/** Every <loc> in sitemap-index.xml's child sitemaps (or in the index itself if it is a plain urlset). */
function sitemapUrls(publishDir) {
  const read = (file) => fs.readFileSync(path.join(publishDir, file), 'utf8');
  const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const index = read('sitemap-index.xml');
  if (!/<sitemapindex\b/.test(index)) return locs(index);
  const urls = [];
  for (const child of locs(index)) urls.push(...locs(read(path.posix.basename(new URL(child).pathname))));
  return [...new Set(urls)];
}

/** { url: sha256 of the built HTML } for every sitemap URL that has a built file. */
function buildManifest(publishDir, origin) {
  const pages = {};
  for (const url of sitemapUrls(publishDir)) {
    const file = urlToFile(publishDir, origin, url);
    if (!fs.existsSync(file)) continue;
    pages[url] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  return pages;
}

/** Absolute URLs of retired pages: plain (no wildcard) 410 rules in the _redirects file. */
function retiredUrls(publishDir, origin) {
  const file = path.join(publishDir, '_redirects');
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(\/\S+)\s+\S+\s+410!?\s*$/);
    if (m && !m[1].includes('*')) out.push(`${origin}${m[1]}/`);
  }
  return out;
}

/**
 * What to tell IndexNow. With no previous manifest (first run) that is every page plus every retired URL;
 * afterwards only pages whose HTML changed or is new, and pages that dropped out of the sitemap.
 */
function diffManifests(previous, current, retired = []) {
  if (!previous) return { changed: Object.keys(current), removed: [...retired], first: true };
  const changed = Object.keys(current).filter((u) => previous[u] !== current[u]);
  const removed = Object.keys(previous).filter((u) => !(u in current));
  return { changed, removed, first: false };
}

module.exports = { urlToFile, sitemapUrls, buildManifest, retiredUrls, diffManifests };
