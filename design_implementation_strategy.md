# Stillware Ltd Website - Astro Implementation Strategy

## Current State Summary

The site is a **single-product landing page** for Zeroed, served at `/zeroed` with a 302 redirect from `/`. Built with vanilla HTML/CSS/JS, bundled by Vite, and deployed on Netlify. It includes a hero carousel, comparison table, mobile slides, features grid, pricing, testimonials, FAQ, and legal pages (privacy, terms, delete-account). The design uses glass-morphism, scroll-reveal animations, and a blue/navy color palette with Inter font.

## Target State Summary

A **highly performant, static, multi-page company website** for Stillware Ltd built with **Astro**. It will serve as the hub for a movement against subscription software. The site will include a brand-level homepage, an apps directory, a manifesto page, a **Markdown-powered blog** for organic inbound marketing, and dedicated per-app pages (starting with `/zeroed`). The architecture prioritizes **$0/month running costs**, zero third-party tracking, and blazing-fast load times.

## Tech Stack & Cost Breakdown

| Layer            | Choice                          | Cost      |
|------------------|---------------------------------|-----------|
| Framework        | Astro (Static Site Generation)  | Free      |
| Styling          | Vanilla CSS (CSS Variables)     | Free      |
| Icons            | Inline SVGs (Lucide/Phosphor)   | Free      |
| Content          | Markdown (Astro Content Collections) | Free |
| Hosting          | Netlify (Starter Tier)          | Free      |
| Email Collection | Netlify Forms                   | Free      |
| Analytics        | Netlify Server Analytics (or Plausible later) | Free |
| **Monthly Total** |                                | **$0.00** |

**Explicitly banned:** Google Analytics, Meta Pixels, any cookie/IP-logging tracker.

---

## Phase 1: Foundation & Astro Migration

**Goal:** Migrate the existing Vite-bundled vanilla HTML/CSS/JS into a scalable Astro architecture with shared components and proper routing.

### 1.1 Astro Setup & Routing

- Initialize a new Astro project (`npm create astro@latest`)
- Remove the old `_redirects` file that forces `/` to `/zeroed` — the root domain (`/`) will now host the Stillware company homepage
- Remove Vite config (`vite.config.js`), `post-build.js`, and the `chart.js` dependency
- Establish the Astro page routing structure in `src/pages/`:
  - `index.astro` — Company Homepage (`/`)
  - `manifesto.astro` — The Manifesto (`/manifesto`)
  - `apps.astro` — App Directory (`/apps`)
  - `zeroed.astro` — Zeroed App Page (`/zeroed`)
  - `support.astro` — Support / Docs (`/support`)
  - `blog/index.astro` — Blog listing (`/blog`)
  - `blog/[slug].astro` — Individual blog posts (`/blog/:slug`)
  - Existing legal pages: `privacy.astro`, `terms.astro`, `delete-account.astro`
- Update `netlify.toml` for Astro's build command and output directory
- Set up legacy redirects for any existing `/zeroed/*` URLs that may change

### 1.2 Component Extraction (The Astro Way)

- Create a global `Layout.astro` wrapper to handle:
  - `<head>` with charset, viewport, canonical URL
  - SEO meta tags (title, description, OG, Twitter Card) via props
  - Google Fonts (Inter) preload
  - Global CSS import
  - Shared page structure (`<slot />` for content)
- Extract navigation into a `<Header />` component:
  - Links: **Home** (Logo), **Apps**, **Manifesto**, **Blog**, **Support**, **[Get Zeroed]** (Primary CTA)
  - Keep the glass-morphism navbar style, but rebrand from Zeroed-specific to Stillware-neutral
  - Mobile hamburger menu with slide-in panel (port existing JS logic)
  - Active page highlighting via `Astro.url.pathname`
- Extract footer into a `<Footer />` component:
  - Links: Home, Apps, Manifesto, Blog, Support, Privacy, Terms, Delete Account
  - "Join the Rebellion" newsletter signup form (`data-netlify="true"`)
  - Anti-tracking badge: "This site is tracked without cookies or IP logging."
  - Copyright with current year

### 1.3 CSS Migration

- **Maintain the vanilla CSS approach** — no Tailwind, no CSS framework
- Move shared styles into `src/styles/global.css`:
  - CSS custom properties (color palette, typography, spacing, shadows, gradients)
  - Reset / base styles
  - Utility classes (`.text-gradient`, `.reveal`, `.reveal-up`, `.container`)
  - Button styles (`.btn-primary`, `.btn-secondary`, `.btn-text`)
  - Animation keyframes (pulse, float, fade-in)
- Use **Astro's scoped styling** (`<style>` tags inside `.astro` components) for page-specific CSS to prevent bleed between pages
- Port the existing responsive breakpoints (1024px, 768px)

### 1.4 Shared JS Migration

- Port scroll-reveal IntersectionObserver logic into a shared `<script>` in `Layout.astro` or a dedicated `src/scripts/reveal.js` module
- Port mobile hamburger menu toggle into `<Header />` component's `<script>` tag
- Remove dead code (Chart.js imports, unused event listeners)
- Astro's island architecture means most JS stays minimal — no framework overhead

**Deliverables:** Working Astro project with Layout, Header, Footer components, global CSS, routing for all pages (placeholder content), and successful Netlify deploy.

---

## Phase 2: Company Homepage (`/`)

**Goal:** Build the Stillware Ltd homepage to funnel visitors toward apps while establishing the "Digital Sovereign" brand identity.

### 2.1 Hero Section

- Dark mode, minimalist design with crisp Inter typography
- **Headline:** "Software you own. Not software you rent."
- **Sub-headline:** "Stillware builds premium, offline-first applications. No subscriptions. No data mining. Just incredibly fast, native tools that belong entirely to you."
- **CTAs:** `[ View Our Apps ]` `[ Read The Manifesto ]`
- Design: Dark background using existing `--gradient-obsidian` (135deg, #0F172A to #1E293B), large bold Inter typography, subtle ambient blob animation
- No product-specific imagery in the hero — this is the company-level identity

### 2.2 The Four Pillars Section

- Four icon cards laid out horizontally (2x2 grid on mobile):
  1. **Pay Once, Own Forever.** "No recurring fees. Ever."
  2. **Zero Telemetry.** "We literally cannot see your data. It lives on your device."
  3. **Local-First Native.** "Lightning fast. Works flawlessly in a concrete bunker without Wi-Fi."
  4. **Your Cloud, Your Rules.** "Sync between devices using your Google Drive or iCloud, not ours."
- Use **inline SVGs** from Lucide or Phosphor icon sets, colored via CSS `currentColor`
- Apply scroll-reveal animations (reuse `.reveal` / `.reveal-up` system)

### 2.3 Flagship Spotlight (Zeroed) & Ecosystem

- **Zeroed Spotlight:**
  - **Heading:** "Meet Zeroed: The Zero-Trust Financial Ledger."
  - **Visual:** High-quality mockup of Zeroed on phone + laptop (composite from existing screenshots)
  - **Copy:** Highlight AES-256 encryption and 34-day free trial
  - **Button:** `[ Explore Zeroed ]` linking to `/zeroed`

- **Ecosystem Teasers:**
  - Muted "Coming Soon" cards (visually distinct from the live Zeroed spotlight):
    - **Estate Keep** (Homeowner Database) — "In Development"
    - **Fort Knox Diary** (Encrypted Journal) — "Coming Soon"
  - Each card includes a "Notify Me" email input (`data-netlify="true"`)
  - Cards should feel intentional as teasers, not empty placeholders

### 2.4 Anti-SaaS Social Proof

- Curated testimonial quotes specifically about privacy and no-subscription benefits
- Adapt existing testimonials from the current Zeroed page
- Emphasize quotes praising the anti-subscription / data-ownership model

**Deliverables:** Complete company homepage with Hero, Four Pillars, Flagship Spotlight, Ecosystem teasers, and Social Proof sections.

---

## Phase 3: The Manifesto (`/manifesto`)

**Goal:** Create a compelling, text-heavy editorial page articulating the Stillware philosophy and building emotional connection with visitors.

### 3.1 Page Design

- Long-form, narrow-column reading layout (~700px max-width)
- Dark or muted background to feel "serious" and editorially distinct
- Large typographic pull-quotes throughout
- Minimal imagery — let the words carry the weight
- Scoped CSS for the editorial typography (larger body text, generous line-height)

### 3.2 Content Flow

Structure the manifesto as a flowing narrative:

1. **The Death of Software Ownership** — How the internet shifted from ownership to rental
2. **Subscription Fatigue** — The hidden cost of SaaS on individuals and families
3. **The Data Trust Problem** — Why trusting startups with sensitive personal/financial data is dangerous
4. **The Stillware Pledge** — "If Stillware Ltd goes out of business tomorrow, every app you bought from us will continue to work perfectly on your device."
5. **The Four Rules** — Restate the four pillars with deeper explanation and conviction
6. **Call to Action** — "Join us. Try Zeroed." with links to the app and newsletter

### 3.3 Design & Privacy Rules

- Subtle scroll-triggered text reveals for key statements
- Pull-quote styling for impactful sentences
- Signature / sign-off element at the bottom (founder attribution)
- **Strict rule:** Absolutely no third-party share widgets (Twitter/Facebook embeds) to maintain the zero-tracking pledge. Use **static HTML intent links** only (e.g., `https://twitter.com/intent/tweet?text=...`)

**Deliverables:** Complete manifesto page with editorial layout, all content sections, and zero third-party embeds.

---

## Phase 4: The "Anti-SaaS" Content Engine (Blog)

**Goal:** Implement a Markdown-based publishing system for organic SEO and guerrilla marketing content (Hacker News, Reddit, indie hacker communities).

### 4.1 Astro Content Collections

- Set up `src/content/blog/` directory to house all `.md` blog post files
- Configure `src/content/config.ts` to enforce frontmatter schema:
  ```typescript
  {
    title: string,
    date: Date,
    description: string,
    author: string
  }
  ```
- This gives type-safe content queries and build-time validation of all posts

### 4.2 Blog Routing & Discovery

- Build `/blog/index.astro` — chronological article listing page with title, date, description, and read-more link for each post
- Build `/blog/[slug].astro` — dynamic route that generates individual post pages from Markdown content
- Apply the shared `Layout.astro` wrapper for consistent nav/footer/SEO on all blog pages
- Style blog posts with the same editorial typography as the manifesto (narrow column, generous spacing)

### 4.3 RSS & Sitemap

- Install `@astrojs/rss` — generate a `feed.xml` at build time for RSS readers
- Install `@astrojs/sitemap` — auto-generate `sitemap.xml` for Google indexing
- Link RSS feed in the `<head>` of all pages (`<link rel="alternate" type="application/rss+xml" />`)
- Add RSS icon/link in blog listing page and footer

### 4.4 Seed Content

- Write 2-3 launch posts to ship with the blog:
  - "Why We Don't Do Subscriptions" (manifesto-adjacent, shareable)
  - "How Zeroed Encrypts Your Data Without a Server" (technical credibility)
  - "The True Cost of YNAB Over 5 Years" (comparison/SEO play)

**Deliverables:** Working blog with Content Collections, dynamic routing, RSS feed, sitemap, and 2-3 seed posts.

---

## Phase 5: Zeroed App Page Refinement (`/zeroed`)

**Goal:** Adapt the existing Zeroed landing page into the new Astro ecosystem, following the high-converting app page template.

### 5.1 Page Structure Reorganization

Port and reorganize the existing Zeroed content into `zeroed.astro`:

1. **Hero:** App name, one-sentence pitch, massive "Download Free 34-Day Trial" button
2. **Features / UI:** Visuals of the app UI focusing on offline speed and encryption (adapt existing features section + mobile slides carousel)
3. **The Math:** Comparison table — Zeroed ($X one-time) vs. YNAB ($100+/year), show 5-year savings (adapt existing comparison section)
4. **Testimonials:** Existing testimonials section (keep as-is, minor styling updates)
5. **FAQ:** Address common objections, ensure "How does it sync without servers?" is prominent
6. **Final CTA:** Download/trial button banner

### 5.2 Content Deduplication

- **Remove** sections that now live on the homepage or manifesto:
  - Social proof strip → homepage Four Pillars covers this
  - Security/privacy deep-dive → manifesto covers this
  - Migration flow → can move to support page or keep if conversion-relevant
- Keep the Zeroed page laser-focused: what it does, why it's better, how much you save, download now

### 5.3 Navigation Context

- Global nav highlights **Apps** when on this page
- Subtle breadcrumb: Apps > Zeroed
- The `[Get Zeroed]` nav CTA transforms to a secondary style (user is already here)

**Deliverables:** Restructured Zeroed page in Astro with streamlined content and proper navigation context.

---

## Phase 6: Email & Support Infrastructure

**Goal:** Capture leads and support users with $0 monthly overhead using Netlify's built-in capabilities.

### 6.1 Netlify Forms Integration

- Add `data-netlify="true"` attribute to:
  - Footer "Join the Rebellion" newsletter form (present on every page)
  - Ecosystem "Notify Me" forms on homepage (one per upcoming app)
- Create a `/success` page for post-submission confirmation
- Add basic client-side form validation (email format) and success/error states
- No backend required — submissions are stored in the Netlify dashboard and can trigger email notifications for free

### 6.2 Support Hub (`/support`)

- Lightweight directory-style page covering:
  - **Getting Started** — Quick-start guide for Zeroed
  - **Local Sync Setup** — How to configure Google Drive / iCloud sync
  - **Data Export** — How to export your data from any Stillware app
  - **FAQ** — Common questions (can link to per-app FAQs on `/zeroed`)
  - **Contact** — Support email or Netlify form
- Initially minimal; structured to grow as more apps launch

**Deliverables:** Working newsletter/notification forms, form success page, support hub page.

---

## Phase 7: Visual Polish, Performance & Ethics

**Goal:** Achieve perfect Lighthouse scores, lock down the zero-tracking commitment, and prove the brand's technical competence.

### 7.1 Image Optimization

- Convert all existing `.png` assets to `.webp` format
- Use Astro's native `<Image />` component for:
  - Automatic format optimization
  - Responsive `srcset` generation
  - Lazy loading by default
  - Proper `width`/`height` attributes (prevents CLS)
- Remove any unused image assets from the migration

### 7.2 Icon System

- Strictly use **inline SVGs** to save HTTP requests (no icon fonts, no external sprite sheets)
- Source from Lucide or Phosphor icon sets
- Color via CSS `currentColor` for theme consistency
- Create reusable Astro components for commonly used icons if needed

### 7.3 Analytics & Privacy Compliance

- **Explicitly ban** Google Analytics and Meta Pixels site-wide
- Add footer badge: "This site is tracked without cookies or IP logging."
- Rely on Netlify's built-in server-side analytics (or add Plausible Analytics later — it's cookie-free and GDPR-compliant)
- Ensure no third-party scripts load on any page (audit with browser DevTools Network tab)
- Manifesto share links use static HTML intent URLs only, no embedded widgets

### 7.4 SEO & Meta Tags

- Ensure unique meta titles and descriptions for every `.astro` page
- Open Graph and Twitter Card meta tags for social sharing (via `Layout.astro` props)
- Structured data (JSON-LD) for Organization and Product schemas
- `@astrojs/sitemap` generates `sitemap.xml` automatically (set up in Phase 4)
- Update `robots.txt` for new page structure
- Blog posts get their own OG images and descriptions from frontmatter

### 7.5 Performance Audit

- Target **100/100 Lighthouse** scores across all pages (Performance, Accessibility, Best Practices, SEO)
- Preload critical assets (Inter font files, hero background)
- Verify zero layout shift (CLS) with proper image dimensions
- Add caching headers in `netlify.toml` for static assets
- Astro ships zero JS by default — verify no unnecessary client-side JS is included

**Deliverables:** Optimized images, inline SVG icons, zero-tracking compliance, full SEO metadata, Lighthouse 100 scores.

---

## Phase Summary & Dependency Map

```
Phase 1: Foundation & Astro Migration
  │
  ├── Phase 2: Company Homepage
  │     │
  │     ├── Phase 3: Manifesto (can parallel with Phase 4 & 5)
  │     │
  │     └── Phase 4: Blog / Content Engine (can parallel with Phase 3 & 5)
  │
  ├── Phase 5: Zeroed Page Refinement (can parallel with Phase 3 & 4)
  │
  └── Phase 6: Email & Support Infrastructure (can parallel with Phases 3-5)
        │
        └── Phase 7: Visual Polish, Performance & Ethics (after all pages exist)
```

### Parallelization Opportunities

- **Phases 3, 4, and 5** can all be developed simultaneously after Phase 2
- **Phase 6** (Netlify Forms, support page) has no hard dependency on Phases 3-5 and can run in parallel
- **Phase 7** tasks (image optimization, SEO) can begin incrementally during any phase but the final audit happens last
- **Blog seed content** (Phase 4.4) can be written in parallel with any development phase

### Risk Areas

| Risk | Mitigation |
|------|-----------|
| Astro migration breaks existing Zeroed page functionality | Port section-by-section, test carousel/animations in Astro before removing old code |
| Old `/zeroed/*` URLs break after restructure | Add legacy redirects in `_redirects` or Astro config for old paths |
| Scoped CSS conflicts with ported global styles | Clearly separate global tokens from component styles during Phase 1.3 |
| Blog content quality affects brand perception | Write and review seed posts before launch; quality > quantity |
| Ecosystem "Coming Soon" cards feel hollow | Design them as intentional teasers with status badges, not empty placeholders |
| Manifesto copywriting is critical path | Draft manifesto content early (can be done independently of code) |
| Netlify Forms has 100 submissions/month free limit | Sufficient for early stage; monitor and upgrade only if needed |

### Decisions Already Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Astro (SSG) | Zero JS by default, Content Collections for blog, $0 hosting |
| CSS approach | Vanilla CSS | Current CSS is well-structured; framework adds unnecessary complexity |
| Email collection | Netlify Forms | Zero backend, zero cost, built into existing hosting |
| Icons | Inline SVGs (Lucide/Phosphor) | Zero HTTP requests, CSS-colorable, no external dependencies |
| Analytics | Netlify server analytics | Zero cookies, zero client-side tracking, aligns with brand pledge |
| Content format | Markdown + Astro Content Collections | Type-safe, git-native, no CMS dependency |
| Third-party embeds | Banned | Static HTML intent links only — maintains zero-tracking pledge |
