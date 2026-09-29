// Local Netlify build plugin: tell IndexNow (Bing, Yandex, Naver, Seznam) which pages changed after each production deploy.
//
// Why: Bing and AI search products built on it only learn about new or changed pages when they next crawl. The site
// publishes daily articles and retires pages, and deploys are metered, so one ping per deploy is cheap and useful.
//
// How (no state stored anywhere but the site itself):
//   onPostBuild  hash every sitemap page in the freshly built site, fetch the manifest the PREVIOUS deploy published at
//                /indexnow-manifest.json, diff the two, and publish the new manifest inside this deploy.
//   onSuccess    the deploy is live and the key file is reachable, so POST the changed / removed URLs to IndexNow.
//
// It must never break a deploy: every hook catches its own errors and only logs. Production context only.
// Set INDEXNOW_DRY_RUN=1 to log what would be sent without sending it.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { buildManifest, retiredUrls, diffManifests } = require('./lib.js');

const HOST = 'www.stillwareltd.com';
const ORIGIN = `https://${HOST}`;
const KEY = 'cf55ab0b3c2dd9caeb805199d1e5c505'; // public by design: the same value is served at KEY_LOCATION
const KEY_LOCATION = `${ORIGIN}/${KEY}.txt`;
const MANIFEST_FILE = 'indexnow-manifest.json';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

let pending = null;

const isProduction = () => process.env.CONTEXT === 'production';

async function previousManifest() {
  try {
    const res = await fetch(`${ORIGIN}/${MANIFEST_FILE}`, { signal: AbortSignal.timeout(15000), headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return null;
    const json = await res.json();
    return json && typeof json.pages === 'object' ? json.pages : null;
  } catch {
    return null;
  }
}

module.exports = {
  async onPostBuild({ constants }) {
    pending = null;
    try {
      if (!isProduction()) return console.log(`IndexNow: skipped (context is "${process.env.CONTEXT || 'unset'}", not production)`);
      const publishDir = constants.PUBLISH_DIR;
      const current = buildManifest(publishDir, ORIGIN);
      const previous = await previousManifest();
      const { changed, removed, first } = diffManifests(previous, current, retiredUrls(publishDir, ORIGIN));
      pending = { urls: [...changed, ...removed] };
      fs.writeFileSync(path.join(publishDir, MANIFEST_FILE), JSON.stringify({ generated: new Date().toISOString(), pages: current }));
      console.log(`IndexNow: ${Object.keys(current).length} pages hashed; ${first ? 'first run (no previous manifest)' : 'previous manifest found'}; ${changed.length} new or changed, ${removed.length} removed or retired`);
    } catch (err) {
      pending = null;
      console.log(`IndexNow: could not prepare the URL list (${err.message}); continuing without it`);
    }
  },

  async onSuccess() {
    try {
      if (!isProduction()) return;
      if (!pending || pending.urls.length === 0) return console.log('IndexNow: nothing to submit');
      const urlList = pending.urls.slice(0, 10000);
      if (process.env.INDEXNOW_DRY_RUN) return console.log(`IndexNow (dry run): would submit ${urlList.length} URLs, e.g. ${urlList.slice(0, 3).join(', ')}`);
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
        signal: AbortSignal.timeout(20000),
      });
      console.log(`IndexNow: submitted ${urlList.length} URLs, HTTP ${res.status}${res.ok ? '' : ' (not accepted; the next deploy will not retry these)'}`);
    } catch (err) {
      console.log(`IndexNow: submission failed (${err.message}); the deploy is unaffected`);
    }
  },
};
