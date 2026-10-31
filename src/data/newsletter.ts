// The newsletter, "Join the Rebellion" (31 Oct 2026). One list for Zeroed and RankUp Chess, sent with Buttondown
// (buttondown.com/stillware): double opt-in, no open or click tracking, a public archive and RSS. Every form on the site is
// src/components/NewsletterSignup.astro; it posts straight to Buttondown, so the site itself stores no email addresses.
// Strategy and rules (no gating, no popups, at most one email a month): Marketing/Newsletter/newsletter-growth-strategy-2026-10-31.md.
export const NEWSLETTER = {
  action: 'https://buttondown.com/api/emails/embed-subscribe/stillware',
  archive: 'https://buttondown.com/stillware/archive/',
  rss: 'https://buttondown.com/stillware/rss',
  page: '/newsletter/',
  // The promise every form repeats; change it here, and on /newsletter/, never on one form alone.
  promise: 'One email when we ship something: a new version of Zeroed or RankUp Chess, a free printable or tool, and the dates that matter.',
  terms: 'At most once a month. No tracking pixels. Leave in one click.',
} as const;
