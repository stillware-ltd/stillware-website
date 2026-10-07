// Evergreen guides (SEO strategy 6.3, 2026-10-07): the data behind /chess/checkmate-patterns/<pattern>/ and /budgeting/,
// and the "Part of the guide" block on the daily puzzle and Shorts articles.
//
// Everything here is derived from the content collection, so a new routine article joins its hub on the next build with
// no edit. Two things are written by hand and live in data files / this file:
//   - src/data/checkmate-patterns.json   one entry per named checkmate pattern (definition, how to recognise it, FAQ).
//     A pattern page exists only when at least one published daily puzzle has that pattern as its named mate, so an entry
//     for a pattern the routine has not used yet stays dormant until its first puzzle is published.
//     To add a pattern the routine starts using, add an entry with a `match` regex for the puzzle title. Entries for all 13
//     named mates the routine can pick exist already (see PATTERNS in Youtube/tools/select_set.py). Bump `updated` in the
//     JSON when a definition, tip or FAQ answer is changed: it is the "Updated" date shown on every pattern page.
//   - THEMES below                        the Shorts themes: the label, and the two pillar pages each links to.
import data from '../data/checkmate-patterns.json';

export const PATTERNS = data.patterns;
export const PATTERNS_UPDATED = data.updated;

const stripMd = (s) => s.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();

export const patternRegex = (p) => new RegExp(p.match, 'i');

/** "Daily Chess Puzzle #14: Morphy's mate, Discovered attack" -> 14 */
export const puzzleNumber = (title) => Number((title.match(/#(\d+)/) || [])[1] || 0);
/** "Daily Chess Puzzle #14: Morphy's mate, Discovered attack" -> "#14: Morphy's mate, Discovered attack" */
export const puzzleLabel = (title) => title.replace(/^Daily Chess Puzzle\s*/i, '');

/**
 * The worked example for `pattern` in a daily puzzle post: the "## Puzzle N: <Pattern> (tier, rated R)" section of the
 * article, with the board image, the solution lines and the explanation exactly as the article states them.
 * Returns null when the article has no section for the pattern.
 */
export function extractExample(post, pattern) {
  const re = patternRegex(pattern);
  const sections = (post.body || '').replace(/\r\n/g, '\n').split(/^## /m).slice(1);
  for (const sec of sections) {
    const head = sec.split('\n', 1)[0];
    const h = head.match(/^Puzzle (\d+):\s*(.+?)\s*\((\w+),\s*rated\s*(\d+)\)\s*$/);
    if (!h || !re.test(h[2])) continue;

    const imgs = [...sec.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map((m) => ({ alt: m[1], src: m[2] }));
    const turn = sec.match(/\*\*(White|Black) to play\.\*\*\s*([^\n]*)/);
    const lichess = sec.match(/https:\/\/lichess\.org\/training\/(\w+)/);
    const solution = sec.split(/^### Solution\s*$/m)[1] || '';
    const moves = [...solution.matchAll(/^(\d+)\.\s+\*\*(.+?)\*\*\s+—\s+(.+)$/gm)].map((m) => ({ san: m[2], text: m[3].trim() }));
    if (!imgs.length || !turn || !lichess || !moves.length) continue;

    // The paragraph that follows the numbered moves and explains them, before the final-position image.
    const afterMoves = solution.split(/^\d+\.\s+\*\*.+$/m).pop() || '';
    const narrative = afterMoves
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('!') && !p.startsWith('>') && !p.startsWith('**The pattern'));

    return {
      slug: post.slug,
      title: post.data.title,
      number: puzzleNumber(post.data.title),
      date: post.data.date,
      puzzleNo: Number(h[1]),
      name: h[2],
      tier: h[3],
      rating: Number(h[4]),
      side: turn[1],
      prompt: stripMd(turn[2]),
      puzzleImage: imgs[0],
      solutionImage: imgs[1] || null,
      lichessId: lichess[1],
      lichessUrl: lichess[0],
      moves,
      narrative: narrative ? stripMd(narrative) : '',
    };
  }
  return null;
}

let indexCache = null;
/**
 * Map of pattern id -> examples (one per daily puzzle post that names the pattern, oldest first). Only patterns with at
 * least one real, parsed example appear: a pattern page is never built without a worked example from a published puzzle.
 */
export function patternIndex(posts) {
  if (indexCache && indexCache.size === posts.length) return indexCache.map;
  const map = new Map();
  const daily = posts.filter((p) => p.data.pillar === 'daily-puzzle');
  for (const pattern of PATTERNS) {
    const re = patternRegex(pattern);
    const examples = [];
    for (const post of daily) {
      if (!re.test(post.data.title)) continue;
      const ex = extractExample(post, pattern);
      if (ex) examples.push(ex);
      else console.warn(`guides: ${post.slug} names "${pattern.name}" but has no parsable puzzle section for it`);
    }
    examples.sort((a, b) => a.number - b.number);
    if (examples.length) map.set(pattern.id, examples);
  }
  indexCache = { size: posts.length, map };
  return map;
}

/** The patterns (with examples) that a daily puzzle post is about, from its title and primary keyword. */
export function patternsForPost(post, index) {
  const text = `${post.data.title} ${post.data.primaryKeyword || ''}`;
  return PATTERNS.filter((p) => index.has(p.id) && patternRegex(p).test(text));
}

// ---------------------------------------------------------------------------------------------------------------------
// Budgeting: the Shorts themes (SHORTS_STRATEGY.md 3.2). The theme tag is the third tag on a Shorts article, written by
// the routine as the theme name with punctuation removed ("Where does it go", "The tax bill for the self employed").
// `re` matches the tag's slug; `pillars` are two evergreen pages the theme points to. Unknown themes fall back to DEFAULT.
// ---------------------------------------------------------------------------------------------------------------------
const ZBB = '/blog/zero-based-budgeting-explained-simply/';
const ENV = '/blog/envelope-budgeting-app-no-bank-sync/';
const SINK = '/blog/sinking-funds-uk-total/';
const SINK_CAR = '/blog/sinking-funds-for-car-repairs/';
const EMERG = '/blog/how-much-emergency-fund-uk/';
const EMERG_DEBT = '/blog/emergency-fund-vs-paying-off-debt/';
const MINPAY = '/blog/what-your-minimum-payment-actually-pays-off/';
const IRREG = '/blog/how-to-budget-on-an-irregular-income/';
const MONTHLY = '/blog/how-to-budget-when-you-get-paid-monthly/';
const AHEAD = '/blog/how-to-get-a-month-ahead-on-bills/';
const MULTI = '/blog/budgeting-with-multiple-bank-accounts/';
const BILLCAL = '/blog/bill-calendar-what-it-does-not-tell-you/';
const OFFLINE = '/blog/budgeting-app-that-works-without-internet/';
const PRIVATE = '/blog/privacy-first-budgeting-apps-compared-2026/';
const CASHSTUFF = '/blog/why-cash-stuffing-stops-working-week-6/';
const T_503020 = '/tools/50-30-20-budget-calculator/';
const T_ZBB = '/tools/zero-based-budget-calculator/';
const T_SAVE = '/tools/savings-goal-calculator/';
const T_DEBT = '/tools/debt-payoff-calculator/';
const T_SUBS = '/tools/subscription-cost-calculator/';
const T_NETWORTH = '/tools/net-worth-calculator/';

export const THEMES = [
  { re: /lifestyle-creep/, label: 'Lifestyle creep', pillars: [ZBB, T_503020] },
  { re: /bonus/, label: 'Bonus, commission and RSUs', pillars: [IRREG, ZBB] },
  { re: /two-incomes/, label: 'Two incomes, one plan', pillars: [MULTI, ZBB] },
  { re: /sinking-funds/, label: 'Sinking funds at scale', pillars: [SINK, BILLCAL] },
  { re: /nursery|cliffs/, label: 'The nursery years', pillars: [SINK, EMERG] },
  { re: /mortgage/, label: 'The mortgage', pillars: [EMERG_DEBT, SINK] },
  { re: /quiet-leak/, label: 'The quiet leak', pillars: [T_SUBS, ZBB] },
  { re: /emergency-fund/, label: 'Emergency fund for a fixed-cost life', pillars: [EMERG, EMERG_DEBT] },
  { re: /^cars?$/, label: 'Cars', pillars: [SINK_CAR, SINK] },
  { re: /holidays/, label: 'Holidays and travel', pillars: [SINK, T_SAVE] },
  { re: /eating-out/, label: 'Eating out and convenience', pillars: [ENV, CASHSTUFF] },
  { re: /gifts|christmas/, label: 'Gifts, Christmas and weddings', pillars: [SINK, T_SAVE] },
  { re: /supporting-parents/, label: 'Supporting parents and family', pillars: [BILLCAL, ZBB] },
  { re: /teenagers|university/, label: 'Teenagers and university', pillars: [SINK, T_SAVE] },
  { re: /irregular-income/, label: 'Irregular income', pillars: [IRREG, AHEAD] },
  { re: /month-ahead/, label: 'Getting a month ahead', pillars: [AHEAD, MONTHLY] },
  { re: /take-home/, label: 'Take-home, not salary', pillars: [MONTHLY, T_503020] },
  { re: /where-does-it-go/, label: 'Where does it go?', pillars: [BILLCAL, ZBB] },
  { re: /credit-cards/, label: 'Credit cards for the points', pillars: [ZBB, MULTI] },
  { re: /moving|renovating/, label: 'Moving, renovating, extending', pillars: [SINK, T_SAVE] },
  { re: /money-conversations/, label: 'Money conversations', pillars: [MULTI, ZBB] },
  { re: /statement-day/, label: 'Statement day', pillars: [BILLCAL, ZBB] },
  { re: /rich-on-paper/, label: 'Rich on paper, tight on Tuesday', pillars: [T_NETWORTH, ZBB] },
  { re: /runway/, label: 'Runway', pillars: [EMERG, EMERG_DEBT] },
  { re: /new-baby|parental/, label: 'New baby, parental leave', pillars: [MONTHLY, EMERG] },
  { re: /tax-bill/, label: 'The tax bill for the self-employed', pillars: [IRREG, SINK] },
  { re: /debt-on/, label: 'Debt on a normal income', pillars: [MINPAY, T_DEBT] },
  { re: /first-month/, label: 'The first month', pillars: [ZBB, T_ZBB] },
  { re: /why-offline/, label: 'Why offline', pillars: [PRIVATE, OFFLINE] },
  { re: /big-decisions/, label: 'Big decisions, monthly-ised', pillars: [ZBB, T_SAVE] },
];
export const DEFAULT_THEME = { label: null, pillars: [ZBB, ENV] };

const GENERIC_TAGS = new Set(['zeroed shorts', 'budgeting uk']);
export const tagSlug = (tag) => tag.toLowerCase().replace(/ & /g, '-').replace(/ /g, '-');

/** The theme tag of a Shorts article: the first tag that is not one of the two fixed ones. */
export function themeTagOf(post) {
  return (post.data.tags || []).find((t) => !GENERIC_TAGS.has(t.toLowerCase())) || null;
}

/** { tag, slug, label, pillars } for a Shorts article's theme, with the routine's wording as the fallback label. */
export function themeOf(post) {
  const tag = themeTagOf(post);
  if (!tag) return { tag: null, slug: null, ...DEFAULT_THEME, label: 'Worked examples' };
  const slug = tagSlug(tag);
  const known = THEMES.find((t) => t.re.test(slug));
  return { tag, slug, label: known?.label || tag, pillars: (known || DEFAULT_THEME).pillars };
}

/** Hub anchor for a theme's group in "Worked examples". */
export const themeAnchor = (slug) => `theme-${slug}`;
