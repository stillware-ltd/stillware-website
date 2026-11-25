// RankUp Chess: the release versions and every way to get the app, in one place (13 Nov 2026). A release changes this
// file only: /rankupchess/ (its version lines and its three button groups), every QR landing page's downloads
// (src/components/RankupDownloads.astro) and the blog's early store links all read from here.
//
// The founder (13 Nov 2026): every page a QR short link lands on shows all four downloads, on every device.
// scripts/verify-qr-downloads.mjs fails the build if a RankUp short link's page lacks any of the four. Research note:
// Marketing/Rank_Up_Chess/SEO/research/qr-landing-four-downloads-2026-11-13.md.

// The product version, shown wherever a page states which release this is: the release every platform has
// (Android and the Windows installer are on 0.12.2; the App Store and the Microsoft Store are on 0.12.3; macOS on 0.12.4).
export const RANKUP_VERSION = '0.12.2';

// Windows is the Microsoft Store first (the founder, 25 Nov 2026: "Do as proposed"). The Store build is signed by
// Microsoft, so there is no SmartScreen warning, and it updates itself; buying still goes through the same Paddle
// checkout and licence key as the installer. Product ID 9NNC1515C24X (free, Education), submitted on 2026-11-24 and
// live when checked on 2026-11-25, when the catalog served package 1.12.3.0, which is app version 0.12.3.
// Bump RANKUP_MS_STORE_VERSION when the Store serves a newer package.
export const RANKUP_MS_STORE_ID = '9NNC1515C24X';
export const RANKUP_MS_STORE_URL = `https://apps.microsoft.com/detail/${RANKUP_MS_STORE_ID}`;
export const RANKUP_MS_STORE_VERSION = '0.12.3';

// Download URLs derive from their own per-platform constants, which track the
// release asset that actually exists rather than the product version.
// Windows installer (.exe, unsigned): since 2026-11-25 only the fallback under the buttons ("Or download the Windows
// installer (.exe)"), for PCs where the Microsoft Store is switched off; the Windows button is the Store.
// The earlier installers (0.5.0 and older) were withdrawn with the
// 0.7.0 release; 0.7.0 was published on 2026-09-19 and 0.7.1 the same evening;
// 0.8.0 on 2026-09-25; no Windows installer was built for 0.9.0; 0.10.0 (the
// board-theme update) on 2026-10-13; 0.10.1 (licence keys activate again) on
// 2026-10-14; no Windows installer was built for 0.10.2; 0.10.3 (per-platform
// licences and the voice lead-in) the same day; 0.11.0 (Every device) on release
// day, published (GitHub release v0.11.0, RankUpChess-Setup-0.11.0.exe) before
// this deploy; 0.12.0 (build 37: the Skills Passport, Rook's warm-up, Class vs
// Rook) on 2026-11-04, published (GitHub release v0.12.0) before this deploy,
// first of the platforms; 0.12.1 (build 38: a way back from the Puzzle Maker,
// Esc on more pages) on 2026-11-08, published (GitHub release v0.12.1) before
// this deploy; 0.12.2 (build 39: the same changes as the Mac's 0.12.2 below) on
// 2026-11-14, published (GitHub release v0.12.2) before this deploy. Still 0.12.2 on 2026-11-25, when the
// Microsoft Store became the Windows button.
// Set this to null to drop the .exe fallback line (and its SmartScreen note) if no installer is live; the Windows
// button (the Store) stays, so the QR check still passes.
export const RANKUP_WINDOWS_VERSION: string | null = '0.12.2';
export const RANKUP_WINDOWS_DOWNLOAD = RANKUP_WINDOWS_VERSION
  ? `https://github.com/stillware-ltd/rankup-chess-releases/releases/download/v${RANKUP_WINDOWS_VERSION}/RankUpChess-Setup-${RANKUP_WINDOWS_VERSION}.exe`
  : null;

// macOS ships Developer ID signed and notarised, so it installs without a
// Gatekeeper warning. Universal binary. 0.8.0 (board themes, macOS 10.15+)
// was published on 2026-09-25; 0.9.0 (the family adventure) on 2026-10-07
// needs macOS 12, so Macs on 10.15 or 11 stay on 0.8.0 (linked from the
// release notes and the releases README); 0.10.0 (the board-theme update) on
// 2026-10-13; 0.10.1 (licence keys activate again) on 2026-10-14; 0.10.2 (per-platform
// licences) and 0.10.3 (voice lead-in) the same day; 0.11.0 (Every device) on release
// day; 0.11.1 (Mac only: licence keys are kept when the keychain refuses) on 2026-11-01;
// 0.12.1 (build 38: 0.12.0's Skills Passport and Puzzle Maker, plus the way-back fixes)
// on 2026-11-08, the first platform on 0.12.1. No Mac build of 0.12.0 was published.
// 0.12.2 (build 39: flag-fall draws against a bare king, the Piece Values challenge, the
// Castle Grounds card, the Teacher area's Classroom switch) on 2026-11-14 (the Mac build).
// Every platform is on 0.12.2 (checked 2026-11-16, see the mobile block below).
// 0.12.4 (build 41: age signals where a law requires them, parent-approved purchases unlock at once) on 2026-11-25,
// published (GitHub release v0.12.4-macos) before this deploy; on macOS Apple never applies age features, so it never asks.
// The release v0.12.4-macos must carry RankUpChess-0.12.4-macOS.dmg (the URL below).
export const RANKUP_MACOS_VERSION = '0.12.4';
export const RANKUP_MACOS_DOWNLOAD =
  `https://github.com/stillware-ltd/rankup-chess-releases/releases/download/v${RANKUP_MACOS_VERSION}-macos/RankUpChess-${RANKUP_MACOS_VERSION}-macOS.dmg`;

// Mobile store links. The iOS app went live on the App Store on 2026-09-16
// (iPhone and iPad, iOS 15+); the link is country-neutral so Apple picks the
// visitor's storefront. 0.7.0 went live on 2026-09-19, 0.7.1 on 2026-09-22
// and 0.8.0 on 2026-09-25; 0.9.0 went live on the App Store on 2026-10-12.
// Google Play lists 0.9.0 (build 25), updated 2026-10-07 (checked
// 2026-10-13 on the listing's app-info panel). 0.11.0 (Every device) was released on
// both stores on 30 October 2026 (manual release on both). 0.12.1 went live on the App Store on
// 2026-11-08. 0.12.2 (build 39) went live on the App Store on 2026-11-12 (the store's own
// release date, 16:50 UTC) and on Google Play with the listing's "Updated on" 11 Nov 2026
// (both checked 2026-11-16). 0.12.3 is live on the App Store (checked 2026-11-25); on Google Play 0.12.3 is in
// Google's review, so Android stays on 0.12.2 until the listing serves it.
export const RANKUP_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.stillware.rankup_chess';
export const RANKUP_APP_STORE_URL = 'https://apps.apple.com/app/id6806675796';
export const RANKUP_IOS_VERSION = '0.12.3';
export const RANKUP_ANDROID_VERSION = '0.12.2';

export type RankupPlatform = 'ios' | 'android' | 'windows' | 'mac';

export interface RankupDownload {
  platform: RankupPlatform;
  href: string;
  /** The first words of the label, set small above the store's name. */
  small: string;
  /** The store's or the platform's name. The full label is `${small} ${label}`. */
  label: string;
  /** Store pages open in a new tab; the installers download in place. */
  external: boolean;
}

// The four, in the order shown when the visitor's device is unknown (JavaScript off, or a device the script doesn't
// recognise). The component's script moves the visitor's own to the front and makes it the big button (rule W-L2).
// The labels are the stores' own wording (research note, QD-5): Microsoft's badge reads "Get it from", and the site
// names the store "Microsoft Store", as Zeroed's links do. Windows is the Microsoft Store (25 Nov 2026); the .exe is
// not one of the four but the fallback line under them (RANKUP_WINDOWS_DOWNLOAD, in RankupDownloads.astro).
export const RANKUP_DOWNLOADS: RankupDownload[] = [
  { platform: 'ios', href: RANKUP_APP_STORE_URL, small: 'Download on the', label: 'App Store', external: true },
  { platform: 'android', href: RANKUP_PLAY_STORE_URL, small: 'Get it on', label: 'Google Play', external: true },
  { platform: 'windows', href: RANKUP_MS_STORE_URL, small: 'Get it from the', label: 'Microsoft Store', external: true },
  { platform: 'mac', href: RANKUP_MACOS_DOWNLOAD, small: 'Download for', label: 'Mac', external: false },
];
