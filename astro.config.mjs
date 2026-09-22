import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.stillwareltd.com',
  integrations: [
    sitemap({
      // Transactional pages should not be discoverable via the sitemap.
      // They also carry `<meta name="robots" content="noindex, nofollow">`.
      // /get/ is a redirect to the right app store, not a page to rank.
      filter: (page) => !page.includes('/buy/') && !page.endsWith('/get/'),
    }),
  ],
  output: 'static',
  redirects: {
    '/zeroed/delete-account.html': '/delete-account/',
  },
});
