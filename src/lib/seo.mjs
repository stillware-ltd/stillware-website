// Shared SEO helpers: titles that fit a search result, and author typing for structured data.
export const SITE = 'https://www.stillwareltd.com';
export const BRAND = 'Stillware Ltd';
// Google shows roughly 60 characters of a title; beyond that it cuts it mid-word.
export const TITLE_MAX = 60;

/** Append the brand only when the whole title still fits; a long title is better without the suffix than truncated. */
export function brandTitle(title, sep = ' — ') {
  const full = `${title}${sep}${BRAND}`;
  return full.length <= TITLE_MAX ? full : title;
}

/**
 * Search-result title for an article: explicit `seoTitle` wins; the daily chess puzzle posts (titles of 65-90
 * characters that list every theme) fall back to "Daily Chess Puzzle #N: <first theme>"; everything else uses its title.
 */
export function postSeoTitle({ title, seoTitle, pillar }) {
  if (seoTitle) return seoTitle;
  if (pillar === 'daily-puzzle') {
    const m = title.match(/^(Daily Chess Puzzle #\d+):\s*(.+)$/i);
    if (m) {
      const firstTheme = m[2].split(/,\s*|\s+and\s+/i)[0].trim();
      const short = `${m[1]}: ${firstTheme}`;
      if (short.length < title.length) return short;
    }
  }
  return title;
}

/** Posts credited to the team are an Organization in schema.org terms; a named human is a Person. */
export const isOrgAuthor = (name = '') => /^stillware\b/i.test(name.trim());
