// Responsive image helpers. Blog heroes live in public/blog/images/<slug>/hero.<ext>; scripts/optimize-heroes.mjs writes
// hero-480.webp and hero-960.webp next to each one before every build and dev run.

/**
 * srcset for a blog hero, or null when the path does not follow the convention (then use the plain src).
 * `originalWidth` (from the file's metadata) adds the untouched original as the largest candidate.
 */
export function heroSrcset(heroImage, originalWidth) {
  const m = typeof heroImage === 'string' && heroImage.match(/^(\/blog\/images\/[^/]+\/)hero\.(?:webp|png|jpe?g)$/i);
  if (!m) return null;
  const parts = [`${m[1]}hero-480.webp 480w`, `${m[1]}hero-960.webp 960w`];
  if (originalWidth && originalWidth > 960) parts.push(`${heroImage} ${originalWidth}w`);
  return parts.join(', ');
}
