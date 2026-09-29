// Website analytics: Umami Cloud (cookieless, no personal identifiers), replacing Google Analytics 4 on 2026-09-29.
//
// Why: this site sells privacy-first apps, and GA4 set cookies and sent visitor data to Google. Umami sets no cookies,
// needs no consent banner, and still answers the questions the marketing dashboard asks: visits, top pages, referrers
// (?ref=yt|blog|reddit|...), and the store_click / video_play / video_impression / get_redirect events.
//
// The website id is public (it sits in the page source), so it lives here rather than in a Netlify env var. Get it from
// Umami Cloud -> Settings -> Websites -> the site -> "Website ID". Production builds fail (scripts/verify-links.mjs)
// if it is empty, so the site cannot ship without a tracker.
export const UMAMI = {
  websiteId: '',
  scriptSrc: 'https://cloud.umami.is/script.js',
  // Count only the live site: local previews and Netlify deploy previews are on other hostnames.
  domains: 'www.stillwareltd.com',
};
