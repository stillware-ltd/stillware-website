# Stillware website: rules for anyone editing this repo (people, agents, routines)

Astro site on Netlify (www.stillwareltd.com). The search strategy of record is `../SEO_STRATEGY.md` (adopted 2026-10-07); read its sections 1, 2 and 5 before touching content, redirects or templates. Founder rule behind all of it: **"Do not delete any working article or page. We have incurred huge effect due to such decisions."**

## Working in this repo

- **The daily routine pushes `main`** (it runs `git checkout main && git pull` at 00:10, 06:10, 12:10 and 18:10). Never do feature work in the main checkout. Use a git worktree on a branch (`git worktree add ../stillware-website-wt/<name> -b <branch> origin/main`), commit there, and leave the main checkout on `main`.
- Deploys are metered: batch changes into one push per working session. Never push a branch per small fix.
- `npm run build` must pass before anything is merged. It runs `verify-content`, `optimize-heroes`, `astro build`, `verify-sitemap`, `verify-links` and `verify-protected`. Emergency escape hatches exist (`SKIP_LINK_CHECK=1`, `SKIP_PROTECTED_CHECK=1`); using one needs a reason logged in `seo/CHANGES.md`.

## Non-negotiable SEO rules (from SEO_STRATEGY.md section 2)

1. **Never remove a working page.** A working page is any URL with at least 1 Search Console impression in the last 16 months; the list is `seo/protected-urls.txt` (refreshed weekly by the SEO routine, which only ever adds paths). Do not delete, 404, 410, noindex, canonicalise away, redirect or change the slug of a protected page.
   - The only exception is a dated, founder-written line in `seo/approved-removals.txt` (`<path> | <YYYY-MM-DD> | <who> | <reason>`).
   - `scripts/verify-protected.mjs` fails the build if a protected path has no built page, matches a 301/302/404/410 rule in `public/_redirects` or `netlify.toml`, is noindexed (meta or `X-Robots-Tag`), or has a canonical pointing elsewhere.
2. **Rewrites keep what ranks.** On a working page keep the URL, the H1 and the exact words of its top-3 queries in the `<title>`; do not cut more than 15% of the words. Log every edit in `seo/CHANGES.md` (date, URL, what changed, why, baseline impressions). The weekly routine compares the 14 and 28 days after the edit with the 28 days before; if impressions fall by more than 30% while the site as a whole did not, the edit is rolled back (title and description first, then body).
3. **Consolidate only with a founder sign-off**, and only by 301 to a page that answers the same query better. A retired URL with zero impressions may become a 301 to its close match; unrelated ones stay 410. Never 301 to the homepage.
4. **One page per intent.** Before writing, search the site for the primary keyword. `verify-content` already fails duplicate `primaryKeyword`. If the intent exists, improve that page instead of creating a new one.
5. **Facts are verified or omitted.** Prices and features of other apps are checked on the day and dated in the text ("prices checked 7 Oct 2026"). Stillware facts come only from the single facts list (SEO_STRATEGY.md section 5.4: the app pages are the source of truth). Never claim a product, feature or result that does not exist; no invented research, surveys or statistics.
6. **Every page is written answer-first** (SEO_STRATEGY.md section 5.1): query in the title and H1, a 40 to 60 word answer first, question-shaped H2s, a table or list of facts, a dated "checked" line, a sources line, an FAQ, one relevant Stillware CTA only where the product genuinely answers the query.
7. **Never link to a redirect.** Internal links use the canonical relative form `/path/` (with the trailing slash) or `https://www.stillwareltd.com/<path>/`. `verify-links` enforces it. YouTube descriptions use the same final URL plus UTM parameters, never the apex host or a slashless path.
8. **Deploys are metered** (see above).
9. **Ask the founder before** spending money, creating accounts or profiles off-site, posting on Reddit or forums as Stillware, changing locked brand lines, or removing anything.
10. **Measure before and after.** Every change ships with a baseline row in `seo/CHANGES.md`.

## Articles (`src/content/blog/*.md`)

- The template prints `title` as the only H1: no `# ` line in the body.
- `appCluster` is one of `zeroed | rankup-chess | held | rankup-maths | general` (`src/content/config.ts`).
- The tags "Anti-SaaS", "Comparison" and "Personal Finance" show the Zeroed promo, and any tag containing "chess" shows the RankUp Chess promo: use them only on money and chess posts. Tag pages with fewer than 5 posts are noindex by design; do not reuse the retired tag slugs listed in `public/_redirects`.
- Images: set `heroImage: "/blog/images/<slug>/hero.webp"`, a raster at least 1200 px wide (1600x900 or larger is better; no text overlay, no logo). `scripts/optimize-heroes.mjs` then makes the srcset copies and the 16:9, 4:3 and 1:1 crops that become `og:image` and the BlogPosting `image`. An SVG is never used for og:image or schema; `verify-content` warns about posts with no hero. A section image with a caption is `![alt](/blog/images/<slug>/photo-03.webp "Caption")` (the title becomes a `<figcaption>`).
- `relatedSlugs` and every internal link must point at an existing page; set `updated:` (date of the last substantive revision) when facts are refreshed.
- Retiring a page: do not. If a page truly must go, ask the founder, add the dated line to `seo/approved-removals.txt`, then add the 410 or 301 to `public/_redirects`.

## Files that guard the rules

| File | Role |
|---|---|
| `seo/protected-urls.txt` | every page with search impressions; never shrinks without a founder line |
| `seo/approved-removals.txt` | the only exceptions to rule 1 |
| `seo/CHANGES.md` | change log with the baseline for each edit |
| `scripts/verify-protected.mjs` | build guard for rule 1 |
| `public/_redirects` | 410 and 301 rules; its header states the policy |
