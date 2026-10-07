// A markdown image with a title becomes a captioned figure (2026-10-07):
//
//   ![Alt text](/blog/images/<slug>/photo-03.webp "Caption shown under the picture")
//
//   -> <figure><img src alt ...><figcaption>Caption shown under the picture</figcaption></figure>
//
// The title attribute moves into the <figcaption> (the browser tooltip would only repeat it). The alt text stays on the
// <img>: the caption is for the reader, the alt is for the reader who cannot see the picture, and they should differ.
//
// Only a paragraph that holds nothing but the image (or the image inside a link) is turned into a figure: a <figure> cannot
// live inside a <p>, and an image in the middle of a sentence is not a captioned picture. An image without a title, and raw
// <img> HTML written inside the markdown, are left exactly as they were. Runs next to rehype-img-attrs.mjs, which still
// gives the <img> its lazy loading, async decoding and natural width/height wherever it sits.
const isBlank = (n) => n.type === 'text' && !n.value.trim();
const isElement = (n, tag) => n.type === 'element' && n.tagName === tag;

// The one titled <img> a paragraph consists of, directly or inside a single link; otherwise null.
function soleTitledImage(p) {
  const kids = (p.children || []).filter((c) => !isBlank(c));
  if (kids.length !== 1) return null;
  let img = kids[0];
  if (isElement(img, 'a')) {
    const inner = (img.children || []).filter((c) => !isBlank(c));
    if (inner.length !== 1) return null;
    img = inner[0];
  }
  if (!isElement(img, 'img')) return null;
  const title = img.properties && img.properties.title;
  return typeof title === 'string' && title.trim() ? { node: kids[0], img, caption: title.trim() } : null;
}

function walk(node) {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (isElement(child, 'p')) {
      const hit = soleTitledImage(child);
      if (hit) {
        delete hit.img.properties.title;
        return {
          type: 'element',
          tagName: 'figure',
          properties: {},
          children: [
            { type: 'text', value: '\n' },
            hit.node,
            { type: 'text', value: '\n' },
            { type: 'element', tagName: 'figcaption', properties: {}, children: [{ type: 'text', value: hit.caption }] },
            { type: 'text', value: '\n' },
          ],
        };
      }
    }
    walk(child);
    return child;
  });
}

export default function rehypeImgFigure() {
  return (tree) => walk(tree);
}
