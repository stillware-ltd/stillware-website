// The two app guides (31 Oct 2026). Each guide is an HTML page with the same content as a printable A4 PDF:
// /rankupchess/guide/ and /zeroed/guide/. The PDFs and the screens in public/guides/ are built in the Marketing hubs
// (Marketing/Rank_Up_Chess/Assets/app-guide/ and Marketing/Zeroed/Assets/app-guide/, build_guide.py); rebuild there and
// copy here, never edit them by hand. Research and placements: Marketing/Rank_Up_Chess/SEO/research/app-guides-2026-10-31.md.
// netlify.toml sends each PDF with rel="canonical" to its page; Layout.astro records the guide_pdf_download event.
export const GUIDES = {
  rankup: {
    page: '/rankupchess/guide/',
    pdf: '/guides/rankup-chess-grown-ups-guide.pdf',
    label: 'PDF, 4 pages, 2 MB',
    version: '0.11',
  },
  zeroed: {
    page: '/zeroed/guide/',
    pdf: '/guides/zeroed-getting-started-guide.pdf',
    label: 'PDF, 4 pages, 1.4 MB',
    version: '1.7',
  },
} as const;

export const GUIDES_CHECKED = '31 October 2026';
