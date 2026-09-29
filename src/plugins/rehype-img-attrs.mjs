// Article images come from markdown (![alt](/blog/images/<slug>/photo-03.webp)) with no size or loading hints, so the browser
// fetches every image on load and the page jumps as each one arrives (236 of 358 had no width/height). This plugin gives every
// local image lazy loading, async decoding and its natural width/height (read from the file in public/), so the space is
// reserved before the image loads. CSS (`.post-body img { width: 100%; height: auto }`) keeps them responsive.
//
// Untouched: images that already set an attribute, remote images, and raw <img> HTML written inside the markdown.
import { join } from 'node:path';
import sharp from 'sharp';

const sizes = new Map();
async function naturalSize(src) {
  if (sizes.has(src)) return sizes.get(src);
  let result = null;
  try {
    const meta = await sharp(join(process.cwd(), 'public', decodeURIComponent(src.split(/[?#]/)[0]))).metadata();
    if (meta.width && meta.height) result = { width: meta.width, height: meta.height };
  } catch {
    // Missing or unreadable file: leave the tag as it is; scripts/verify-links.mjs reports missing files.
  }
  sizes.set(src, result);
  return result;
}

function collectImages(node, out) {
  if (node.type === 'element' && node.tagName === 'img') out.push(node);
  if (node.children) node.children.forEach((child) => collectImages(child, out));
}

export default function rehypeImgAttrs() {
  return async (tree) => {
    const images = [];
    collectImages(tree, images);
    await Promise.all(
      images.map(async (node) => {
        const props = node.properties || (node.properties = {});
        const src = props.src;
        if (typeof src !== 'string' || !src.startsWith('/') || src.startsWith('//')) return;
        if (props.loading == null) props.loading = 'lazy';
        if (props.decoding == null) props.decoding = 'async';
        if (props.width == null && props.height == null) {
          const size = await naturalSize(src);
          if (size) {
            props.width = size.width;
            props.height = size.height;
          }
        }
      }),
    );
  };
}
