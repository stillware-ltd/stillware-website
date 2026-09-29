// Netlify serves pretty URLs with a trailing slash and 301s the slashless form, so every internal link
// written as "/zeroed" costs the reader (and Googlebot) an extra hop and lands in Search Console as
// "Page with redirect". Article markdown is written by hand and by the content routines, so normalise
// internal links here rather than trusting every author to remember the slash.
//
// Links to the site's own host ("https://stillwareltd.com/zeroed?ref=..." or the www form) are made
// site-relative first: the apex host 301s to www, so an absolute apex link costs two hops. The query
// string (used for ?ref= attribution) is kept.
//
// Untouched: other hosts, "//host" links, mailto:, fragment-only links, and links whose last segment
// has a file extension (images, downloads, rss.xml).
const OWN_HOST = /^https?:\/\/(?:www\.)?stillwareltd\.com(?=[/?#]|$)/i;

function fix(href) {
  if (typeof href !== 'string') return href;
  if (OWN_HOST.test(href)) {
    href = href.replace(OWN_HOST, '');
    if (!href.startsWith('/')) href = `/${href}`; // '' -> '/', '?x' -> '/?x'
  }
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const [, path, rest = ''] = href.match(/^([^?#]*)(.*)$/);
  if (path.endsWith('/') || /\.[a-z0-9]+$/i.test(path.split('/').pop() || '')) return href;
  return `${path}/${rest}`;
}

// Raw HTML written inside the markdown (e.g. <a href="/zeroed">) is still an unparsed "raw" node when
// user rehype plugins run, so rewrite the anchors in its source text as well.
const RAW_ANCHOR_HREF = /(<a\b[^>]*?\shref=)(["'])([^"']*)\2/gi;

function walk(node) {
  if (node.type === 'element' && node.tagName === 'a' && node.properties && 'href' in node.properties) {
    node.properties.href = fix(node.properties.href);
  }
  if (node.type === 'raw' && typeof node.value === 'string') {
    node.value = node.value.replace(RAW_ANCHOR_HREF, (_m, pre, quote, href) => `${pre}${quote}${fix(href)}${quote}`);
  }
  if (node.children) node.children.forEach(walk);
}

export default function rehypeTrailingSlash() {
  return (tree) => walk(tree);
}
