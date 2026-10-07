// /llms.txt: a short plain-text map of the site for AI agents and answer engines (https://llmstxt.org).
// Generated at build time, so new articles appear on their own. SEO strategy P4.2 (2026-10-07).
//
// The Apps facts below are the single facts list (SEO_STRATEGY.md section 5.4), worded as /zeroed/, /rankupchess/ and
// /about/ state them. If a fact changes, change it on the app page first, then here.
// Output is text/plain, so it is not an HTML page and verify-links (which scans dist/**/*.html) does not read it.
import { getCollection } from 'astro:content';
import { SITE } from '../lib/seo.mjs';

const url = (path) => `${SITE}${path}`;
const oneLine = (s = '') => s.replace(/\s+/g, ' ').trim();
const link = (title, path, note) => `- [${title}](${url(path)})${note ? `: ${oneLine(note)}` : ''}`;

// Hubs that exist as pages today. /budgeting/ is listed as soon as its page exists (it arrives in a separate branch),
// so llms.txt never points at a page that is not built.
const hasBudgetingHub = Object.keys(
  import.meta.glob(['../pages/budgeting/index.astro', '../pages/budgeting.astro']),
).length > 0;

// Key articles: the pillars that answer a question on their own (comparisons, problem-solution pieces, guides,
// philosophy). Daily puzzles and Shorts worked examples are reached through the hubs, not listed one by one.
const KEY_PILLARS = ['comparison', 'guide', 'problem-solution', 'philosophy'];

export async function GET() {
  const posts = (await getCollection('blog'))
    .filter((p) => KEY_PILLARS.includes(p.data.pillar))
    .sort(
      (a, b) =>
        KEY_PILLARS.indexOf(a.data.pillar) - KEY_PILLARS.indexOf(b.data.pillar) ||
        Number(!!b.data.featured) - Number(!!a.data.featured) ||
        b.data.date.valueOf() - a.data.date.valueOf(),
    );

  const lines = [
    '# Stillware Ltd',
    '',
    '> Stillware Ltd is an independent UK company (Companies House 16927952) that makes pay-once, privacy-first apps that run on your own device: Zeroed, an offline zero-based budgeting app, and RankUp Chess, an offline chess academy for kids. Its website also publishes free budgeting calculators, guides to budgeting without a subscription, and chess checkmate-pattern guides with daily puzzles.',
    '',
    '## Apps',
    '',
    link(
      'Zeroed: Offline Budget Planner',
      '/zeroed/',
      'Offline zero-based (envelope) budgeting app for iPhone and iPad (iOS and iPadOS), Android (Google Play), Windows (Microsoft Store) and macOS. Pay once, no subscription. Data is AES-256 encrypted on your device, with no account and no bank sync (it imports CSV, PDF, OFX, QFX and QIF statements). 34-day free trial with no credit card; $19.99 founder price until 14 February 2027, then $39.99, with all 1.x updates included.',
    ),
    link(
      'RankUp Chess',
      '/rankupchess/',
      'Offline chess academy for kids: 5,000+ puzzles, 10 AI strength levels and interactive lessons. Free to play forever; one optional one-time payment unlocks everything. No ads, no subscription, no data harvesting. Runs on iPhone and iPad, Android, Windows and macOS. RankUp Chess. No ads, no subscription and it works offline.',
    ),
    link('About Stillware Ltd', '/about/', 'Who is behind the apps: the company, the founder (Tejaswi Dhulipala) and how Stillware works.'),
    '',
    '## Guides',
    '',
    link('Blog', '/blog/', 'Guides on budgeting without a subscription, private offline apps, and daily chess puzzles.'),
    link('Free budget calculators and printables', '/tools/', 'Debt payoff, zero-based budget, 50/30/20, emergency fund, savings goal, net worth and more. No sign-up.'),
    link('Checkmate patterns in chess', '/chess/checkmate-patterns/', 'Plain-English definitions of the common checkmate patterns, with a puzzle for each.'),
    ...(hasBudgetingHub ? [link('Budgeting guides', '/budgeting/', 'The budgeting guides, calculators and worked examples, grouped by theme.')] : []),
    link('Zeroed videos', '/videos/zeroed/', 'Envelope budgeting videos and Shorts, playable on the page.'),
    link('RankUp Chess videos', '/videos/rankupchess/', 'Daily chess puzzles from beginner to master, one Short each, explained move by move.'),
    '',
    '## Key articles',
    '',
    ...posts.map((p) => link(p.data.title, `/blog/${p.slug}/`, p.data.description)),
    '',
    '## Company',
    '',
    link('About', '/about/', 'Stillware Ltd, registered in England and Wales, company number 16927952.'),
    link('Press kit', '/press/', 'Fact sheet, boilerplate, logos and screenshots for Zeroed.'),
    link('Privacy policy', '/privacy/', 'What the apps and this website do and do not collect.'),
    link('Support', '/support/', 'Help centre and contact: support@stillwareltd.com.'),
    '',
    '## Optional',
    '',
    `- [Sitemap](${url('/sitemap-index.xml')}): every indexable page`,
    `- [RSS feed](${url('/rss.xml')}): new articles`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
