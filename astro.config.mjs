import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import rehypeTrailingSlash from './src/plugins/rehype-trailing-slash.mjs';
import rehypeImgAttrs from './src/plugins/rehype-img-attrs.mjs';
import rehypeImgFigure from './src/plugins/rehype-img-figure.mjs';
import { thinTagSlugs } from './src/lib/tags.mjs';
import { sitemapLastmods } from './src/lib/post-dates.mjs';

// Tag pages with only a few posts are noindex (see blog/tag/[tag].astro), so keep them out of the sitemap too.
const thinTags = thinTagSlugs();
// <lastmod> only where there is a real date: articles (frontmatter `updated`, else `date`), /blog/ and tag pages (the newest
// article they list). Everything else gets none; the build time would claim every page changed on every deploy.
const lastmods = sitemapLastmods();

export default defineConfig({
  site: 'https://www.stillwareltd.com',
  integrations: [
    sitemap({
      // Transactional pages should not be discoverable via the sitemap.
      // They also carry `<meta name="robots" content="noindex, nofollow">`.
      // /get/ is a redirect to the right app store, not a page to rank.
      // /success/ is the form-submitted confirmation page.
      filter: (page) => {
        const { pathname } = new URL(page);
        if (pathname.includes('/buy/') || pathname === '/get/' || pathname === '/success/') return false;
        const tag = pathname.match(/^\/blog\/tag\/([^/]+)\/$/);
        return !(tag && thinTags.has(tag[1]));
      },
      serialize(item) {
        const lastmod = lastmods.get(new URL(item.url).pathname);
        if (lastmod) item.lastmod = lastmod;
        return item;
      },
    }),
  ],
  output: 'static',
  markdown: {
    rehypePlugins: [rehypeTrailingSlash, rehypeImgFigure, rehypeImgAttrs],
  },
  // Legacy /zeroed/* URLs (privacy, terms, support, delete-account) are 301'd in netlify.toml.
  // Astro's `redirects` option only writes a meta-refresh page (HTTP 200), which Search Console reports as a redirect error.
});
