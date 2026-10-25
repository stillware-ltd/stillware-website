import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EVERY_DEVICE_PADDLE_PRICE_IDS,
  EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS,
  PRICE_ID_TO_PRODUCT,
} from "../../netlify/functions/lib/products.js";
import { PADDLE_PRODUCTS, isComingSoon, type CheckoutSlug } from "../../src/config/paddle.js";

// The buy pages (src/pages/buy/[product].astro, src/config/paddle.ts): the two Every device pages, and
// the ?licence= parameter that only the upgrade page takes, keeps for its tab and passes to Paddle as
// custom data. The page's own inline scripts are run here with a fake window, history, storage and Paddle.

// Read with LF endings: a Windows checkout (core.autocrlf) gives CRLF, and the scripts are found by text.
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const PAGE = source("../../src/pages/buy/[product].astro");
const SUCCESS = source("../../src/pages/buy/success.astro");
const LAYOUT = source("../../src/layouts/Layout.astro");
const HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const SITE = "https://www.stillwareltd.com";
const STORAGE_KEY = "rankup-upgrade-licence";

const HAND_OVER_OPEN = '<script is:inline id="licence-hand-over">';

/** The hand-over script's text: it takes ?licence= out of the address and keeps it for the tab. */
function handOverScript(): string {
  const start = PAGE.indexOf(HAND_OVER_OPEN);
  const end = PAGE.indexOf("</script>", start);
  assert.ok(start > 0 && end > start, "the hand-over script is there");
  return PAGE.slice(start + HAND_OVER_OPEN.length, end);
}

/** The checkout script's text: opens Paddle with the options. */
function checkoutScript(): string {
  const start = PAGE.indexOf("(function () {\n          const status");
  const end = PAGE.indexOf("})();", start);
  assert.ok(start > 0 && end > start, "the checkout script is there");
  return PAGE.slice(start, end + "})();".length);
}

/** One browser tab: its address, its sessionStorage (shared by reloads, not by other tabs), and what was done to them. */
class Tab {
  url: URL = new URL(SITE + "/");
  storage = new Map<string, string>();
  blocked = false;
  replaceThrows = false;
  replaced: string[] = [];
  reads: string[] = [];
  writes: string[] = [];

  window(): any {
    const tab = this;
    const storageApi = {
      getItem(k: string) {
        tab.reads.push(k);
        return tab.storage.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        tab.writes.push(k);
        tab.storage.set(k, v);
      },
      removeItem(k: string) {
        tab.writes.push(k);
        tab.storage.delete(k);
      },
    };
    const w: any = {
      location: {
        get search() { return tab.url.search; },
        get pathname() { return tab.url.pathname; },
        get hash() { return tab.url.hash; },
        get origin() { return tab.url.origin; },
      },
      history: {
        state: null,
        replaceState(_state: unknown, _title: string, url: string) {
          if (tab.replaceThrows) throw new DOMException("not allowed", "SecurityError");
          tab.replaced.push(url);
          tab.url = new URL(url, tab.url);
        },
      },
    };
    Object.defineProperty(w, "sessionStorage", {
      get() {
        if (tab.blocked) throw new DOMException("storage is blocked", "SecurityError");
        return storageApi;
      },
    });
    return w;
  }
}

interface Visit {
  options: any;
  initialised: any;
  noKey: { hidden: boolean; innerText: string };
  handOverRan: boolean;
  window: any;
}

/**
 * Loads a buy page in `tab` at `address`, as a browser would: the hand-over script (only if the page
 * renders it, which the source test checks) and then, unless the page says "not available yet", the
 * checkout script with a stand-in price id so that every page can be run.
 */
function visit(slug: CheckoutSlug, address: string, tab: Tab = new Tab(), o: { comingSoon?: boolean } = {}): Visit & { tab: Tab } {
  const config = PADDLE_PRODUCTS[slug];
  tab.url = new URL(address, SITE);
  const window = tab.window();
  const out: Visit = {
    options: null,
    initialised: null,
    noKey: { hidden: true, innerText: "" },
    handOverRan: false,
    window,
  };
  if (config.passesLicence) {
    new Function("window", handOverScript())(window);
    out.handOverRan = true;
  }
  if (!o.comingSoon) {
    const elements: Record<string, any> = {
      "checkout-status": { innerText: "", innerHTML: "" },
      "checkout-heading": { innerText: "" },
      "checkout-no-key": out.noKey,
    };
    const Paddle = {
      Initialize: (x: unknown) => void (out.initialised = x),
      Checkout: { open: (x: unknown) => void (out.options = x) },
    };
    const document = { getElementById: (id: string) => elements[id] ?? null };
    // define:vars gives these names to the script
    new Function("token", "priceId", "productName", "passLicence", "successPath", "document", "window", "Paddle", checkoutScript())(
      "test_token", "pri_stand_in", config.name, config.passesLicence === true, config.successPath ?? "/buy/success", document, window, Paddle
    );
  }
  return { ...out, tab };
}

test("the two new pages exist, grant a rankup licence, and say 'not available yet' until KL.3 gives them a price id", () => {
  for (const slug of ["rankup-every-device", "rankup-upgrade"] as const) {
    const c = PADDLE_PRODUCTS[slug];
    assert.ok(c, slug);
    assert.equal(c.slug, "rankup");
    assert.equal(c.priceId, "", `${slug}: no price id until KL.3`);
    assert.equal(isComingSoon(c), true, `${slug}: opens no checkout`);
    assert.match(c.unavailableHeading ?? "", /Not available yet/);
    assert.match(c.unavailableText ?? "", /isn't available/);
    assert.match(c.unavailableText ?? "", /Nothing has been charged/);
  }
  assert.match(PAGE, /\{!comingSoon && \(/);
  assert.match(PAGE, /comingSoon \? unavailableHeading/);
  assert.match(PAGE, /comingSoon \? unavailableText/);
});

test("the Windows and Mac pages are the Only-on tiers: new names and notes, no 'separate purchase', the same prices", () => {
  assert.equal(PADDLE_PRODUCTS.rankup.name, "RankUp Chess: Only on Windows");
  assert.equal(PADDLE_PRODUCTS["rankup-mac"].name, "RankUp Chess: Only on Mac");
  assert.equal(PADDLE_PRODUCTS.rankup.licenceNote, "Only on Windows: this licence unlocks RankUp Chess on up to 3 Windows or Linux computers.");
  assert.equal(PADDLE_PRODUCTS["rankup-mac"].licenceNote, "Only on Mac: this licence unlocks RankUp Chess on up to 3 Macs.");
  // which Paddle price each page opens did not change
  assert.equal(PADDLE_PRODUCTS.rankup.priceId, "pri_01knztpnwdqxx8ecnbrjt4zkzq");
  assert.equal(PADDLE_PRODUCTS["rankup-mac"].priceId, "pri_01m194cc17phxmgqdqs737mw2p");
  assert.equal(PADDLE_PRODUCTS.rankup.slug, "rankup");
  assert.equal(PADDLE_PRODUCTS["rankup-mac"].slug, "rankup");
  for (const [slug, c] of Object.entries(PADDLE_PRODUCTS)) {
    assert.equal(/separate purchase/i.test(`${c.name} ${c.licenceNote ?? ""} ${c.unavailableText ?? ""}`), false, slug);
    assert.equal(/for Windows and Linux|for macOS/.test(c.name), false, `${slug}: the old name is gone`);
  }
});

test("the three checkouts that exist today still open as they did", () => {
  assert.equal(isComingSoon(PADDLE_PRODUCTS.zeroed), false);
  assert.equal(isComingSoon(PADDLE_PRODUCTS.rankup), false);
  assert.equal(isComingSoon(PADDLE_PRODUCTS["rankup-mac"]), false);
  assert.equal(PADDLE_PRODUCTS.zeroed.priceId, "pri_01knnyfj5zezrch30qqbzkc378");
  assert.equal(PADDLE_PRODUCTS.zeroed.name, "Zeroed");
  assert.equal(isComingSoon({ ...PADDLE_PRODUCTS.rankup, priceId: " " }), true);
  assert.equal(isComingSoon({ ...PADDLE_PRODUCTS.rankup, priceId: "pri_PLACEHOLDER" }), true);
  assert.equal(isComingSoon({ ...PADDLE_PRODUCTS.rankup, comingSoon: true }), true);
});

test("price ids, once filled in, match the licence server's lists (and every id on those lists has a page)", () => {
  for (const [slug, c] of Object.entries(PADDLE_PRODUCTS)) {
    if (!c.priceId) continue;
    assert.equal(PRICE_ID_TO_PRODUCT[c.priceId], c.slug, `${slug}: the webhook must know this price (PRICE_ID_TO_PRODUCT)`);
  }
  const every = PADDLE_PRODUCTS["rankup-every-device"].priceId;
  const upgrade = PADDLE_PRODUCTS["rankup-upgrade"].priceId;
  if (every) assert.ok(EVERY_DEVICE_PADDLE_PRICE_IDS.includes(every), "Every device's price id belongs on EVERY_DEVICE_PADDLE_PRICE_IDS");
  if (upgrade) assert.ok(EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS.includes(upgrade), "the upgrade's price id belongs on EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS");
  for (const id of EVERY_DEVICE_PADDLE_PRICE_IDS) assert.equal(id, every, "an Every device price with no buy page");
  for (const id of EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS) assert.equal(id, upgrade, "an upgrade price with no buy page");
});

test("only the upgrade page is set to take ?licence=, and the page renders the hand-over script for it alone", () => {
  const passing = Object.entries(PADDLE_PRODUCTS).filter(([, c]) => c.passesLicence === true).map(([slug]) => slug);
  assert.deepEqual(passing, ["rankup-upgrade"]);
  assert.match(PAGE, /passLicence: config\.passesLicence === true,/);
  // the hand-over script sits inside {config.passesLicence && (...)}, and it is rendered whether or not the checkout is
  const at = PAGE.indexOf(HAND_OVER_OPEN);
  assert.match(PAGE.slice(Math.max(0, at - 40), at), /\{config\.passesLicence && \(\s*$/);
  assert.equal(/comingSoon/.test(PAGE.slice(Math.max(0, at - 200), at)), false, "not tied to the checkout being available");
});

test("nothing outside the hand-over script touches storage, and nothing but it reads ?licence=", () => {
  const outside = PAGE.replace(handOverScript(), "");
  assert.equal(/sessionStorage|localStorage|indexedDB|document\.cookie/.test(outside), false);
  assert.equal(/get\('licence'\)|has\('licence'\)|[?&]licence=/.test(outside), false, "only the hand-over script reads the parameter");
  assert.equal(/sessionStorage|localStorage/.test(checkoutScript()), false);
  // the success page and the pages around never store or read it
  assert.equal(/licence|sessionStorage|localStorage/.test(SUCCESS.replace(/license|Licence note/gi, "")), false);
});

test("the address is cleaned, at once, while the page is still being parsed (before Umami's deferred tracker)", () => {
  // Umami's tracker is `defer`red in the head: it runs after the document is parsed, so after every plain inline
  // script in the body. The hand-over script is plain inline (no defer, async or module), so it runs first, and
  // Umami reads the cleaned address when it starts.
  assert.match(LAYOUT, /<script\s+is:inline\s+defer\s+src=\{UMAMI\.scriptSrc\}/);
  assert.equal(HAND_OVER_OPEN.includes("defer") || HAND_OVER_OPEN.includes("async") || HAND_OVER_OPEN.includes("module"), false);
  assert.match(handOverScript(), /window\.history\.replaceState\(/);
  // and it needs no event, timer or fetch to do it
  assert.equal(/addEventListener|setTimeout|Promise|await|fetch\(/.test(handOverScript()), false);
});

test("the upgrade page: a good ?licence= is taken out of the address and passed to Paddle as customData", () => {
  const v = visit("rankup-upgrade", `/buy/rankup-upgrade/?licence=${HASH}`);
  assert.equal(v.handOverRan, true);
  assert.equal(v.tab.url.search, "", "the address no longer has it");
  assert.deepEqual(v.tab.replaced, ["/buy/rankup-upgrade/"]);
  assert.equal(v.tab.url.href.includes(HASH), false);
  assert.deepEqual(v.options.customData, { licence: HASH });
  assert.equal(v.noKey.hidden, true);
  assert.equal(v.tab.storage.get(STORAGE_KEY), HASH, "kept for this tab");
});

test("other parameters and the #fragment stay in the address; only licence goes", () => {
  const v = visit("rankup-upgrade", `/buy/rankup-upgrade/?discount_code=SAVE10&licence=${HASH}&ref=app#top`);
  assert.deepEqual(v.tab.replaced, ["/buy/rankup-upgrade/?discount_code=SAVE10&ref=app#top"]);
  assert.equal(v.options.discountCode, "SAVE10");
  assert.deepEqual(v.options.customData, { licence: HASH });
  // two licence parameters: both go
  const twice = visit("rankup-upgrade", `/buy/rankup-upgrade/?licence=${HASH}&licence=${OTHER}`);
  assert.equal(twice.tab.url.search, "");
});

test("a reload in the same tab still passes the hash; another tab does not have it", () => {
  const first = visit("rankup-upgrade", `/buy/rankup-upgrade/?licence=${HASH}`);
  const tab = first.tab;
  // the reload loads the cleaned address in the same tab (same sessionStorage)
  const reload = visit("rankup-upgrade", tab.url.href, tab);
  assert.deepEqual(reload.options.customData, { licence: HASH });
  assert.equal(reload.noKey.hidden, true);
  assert.deepEqual(visit("rankup-upgrade", tab.url.href, tab).options.customData, { licence: HASH }, "and again");
  assert.deepEqual(reload.tab.replaced, ["/buy/rankup-upgrade/"], "the reload had nothing to clean");

  // a new tab opening the cleaned address has no hash: the fallback
  const elsewhere = visit("rankup-upgrade", "/buy/rankup-upgrade/");
  assert.equal("customData" in elsewhere.options, false);
  assert.equal(elsewhere.noKey.hidden, false);
  assert.match(elsewhere.noKey.innerText, /new Every device key by email/);
});

test("storage that is blocked: the first load still passes the hash and cleans the address; a reload falls back", () => {
  const tab = new Tab();
  tab.blocked = true;
  const first = visit("rankup-upgrade", `/buy/rankup-upgrade/?licence=${HASH}`, tab);
  assert.deepEqual(first.options.customData, { licence: HASH }, "held in memory for this load");
  assert.equal(first.tab.url.search, "", "the address is cleaned all the same");
  assert.equal(first.window.stillwareUpgradeLicence, HASH);

  const reload = visit("rankup-upgrade", tab.url.href, tab);
  assert.ok(reload.options, "the checkout still opens");
  assert.equal("customData" in reload.options, false, "but without custom data: the fallback");
  assert.equal(reload.noKey.hidden, false);
  assert.match(reload.noKey.innerText, /new Every device key by email/);
});

test("an address that cannot be rewritten does not stop the checkout", () => {
  const tab = new Tab();
  tab.replaceThrows = true;
  const v = visit("rankup-upgrade", `/buy/rankup-upgrade/?licence=${HASH}`, tab);
  assert.deepEqual(v.options.customData, { licence: HASH });
  assert.ok(v.tab.url.search.includes("licence"), "the address stays as it was");
});

test("a new ?licence= replaces what the tab held; a bad one drops it; a tampered stored value is ignored", () => {
  const tab = new Tab();
  visit("rankup-upgrade", `/buy/rankup-upgrade/?licence=${HASH}`, tab);
  const changed = visit("rankup-upgrade", `/buy/rankup-upgrade/?licence=${OTHER}`, tab);
  assert.deepEqual(changed.options.customData, { licence: OTHER });
  assert.equal(tab.storage.get(STORAGE_KEY), OTHER);

  const bad = visit("rankup-upgrade", "/buy/rankup-upgrade/?licence=nope", tab);
  assert.equal("customData" in bad.options, false, "an old key's hash is never used for a new, bad address");
  assert.equal(tab.storage.has(STORAGE_KEY), false);
  assert.equal(bad.tab.url.search, "", "the bad value is taken out of the address too");

  tab.storage.set(STORAGE_KEY, "not-a-hash");
  assert.equal("customData" in visit("rankup-upgrade", "/buy/rankup-upgrade/", tab).options, false);
  tab.storage.set(STORAGE_KEY, HASH.toUpperCase());
  assert.deepEqual(visit("rankup-upgrade", "/buy/rankup-upgrade/", tab).options.customData, { licence: HASH });
});

test("exactly 64 hex characters, nothing else, in the address", () => {
  const pass = (value: string) => visit("rankup-upgrade", `/buy/rankup-upgrade/?licence=${value}`).options.customData?.licence ?? null;
  assert.equal(pass(HASH), HASH);
  assert.equal(pass(HASH.toUpperCase()), HASH, "upper-case hex is accepted and lower-cased");
  assert.equal(pass(HASH.replace(/./g, (c, i) => (i % 2 ? c : c.toUpperCase()))), HASH);
  for (const bad of [
    "",
    HASH.slice(1), // 63
    HASH + "0", // 65
    HASH.slice(0, 63) + "g", // not hex
    HASH.slice(0, 63) + "%20",
    "%20" + HASH,
    HASH + "%0A",
    HASH + HASH,
    "abc",
    "<script>alert(1)</script>",
    "0x" + HASH.slice(2),
  ]) {
    assert.equal(pass(bad), null, JSON.stringify(bad));
  }
  // the parameter's name and spelling
  for (const search of [`?licences=${HASH}`, `?license=${HASH}`, `?Licence=${HASH}`, `?licence[]=${HASH}`]) {
    const v = visit("rankup-upgrade", `/buy/rankup-upgrade/${search}`);
    assert.equal("customData" in v.options, false, search);
    assert.ok(v.tab.url.search.includes(search.slice(1, 8)) || v.tab.url.search === "", search);
  }
});

test("a missing or malformed value still opens the upgrade checkout, with no custom data and a plain explanation", () => {
  for (const address of ["/buy/rankup-upgrade/", "/buy/rankup-upgrade/?", "/buy/rankup-upgrade/?licence=", `/buy/rankup-upgrade/?licence=${HASH}x`]) {
    const v = visit("rankup-upgrade", address);
    assert.ok(v.options, address);
    assert.equal("customData" in v.options, false, address);
    assert.equal(v.noKey.hidden, false);
    assert.match(v.noKey.innerText, /new Every device key by email/);
  }
});

test("'not available yet' (no price id): the address is still cleaned and the hash kept, but no checkout opens", () => {
  const v = visit("rankup-upgrade", `/buy/rankup-upgrade/?licence=${HASH}`, new Tab(), { comingSoon: true });
  assert.equal(v.handOverRan, true);
  assert.equal(v.options, null);
  assert.equal(v.tab.url.search, "");
  assert.equal(v.tab.storage.get(STORAGE_KEY), HASH);
});

test("every other page never stores, reads or removes the parameter, and ignores it", () => {
  for (const slug of Object.keys(PADDLE_PRODUCTS) as CheckoutSlug[]) {
    if (slug === "rankup-upgrade") continue;
    const tab = new Tab();
    const address = `/buy/${slug}/?licence=${HASH}&discount_code=SAVE10`;
    const v = visit(slug, address, tab);
    assert.equal(v.handOverRan, false, `${slug}: the hand-over script does not run`);
    assert.deepEqual(tab.reads, [], `${slug}: storage was not read`);
    assert.deepEqual(tab.writes, [], `${slug}: storage was not written`);
    assert.equal(tab.storage.size, 0);
    assert.deepEqual(tab.replaced, [], `${slug}: the address was left alone`);
    assert.equal(v.window.stillwareUpgradeLicence, undefined);
    assert.ok(v.options, `${slug} opened a checkout`);
    assert.equal("customData" in v.options, false, `${slug} must not pass the parameter`);
    assert.equal(v.options.discountCode, "SAVE10");
  }
  // even if a hash is waiting in the tab's storage, another page does not pick it up
  const tab = new Tab();
  tab.storage.set(STORAGE_KEY, HASH);
  const v = visit("rankup", "/buy/rankup/", tab);
  assert.equal("customData" in v.options, false);
  assert.deepEqual(tab.reads, []);
});

test("the checkout is otherwise as it was: the token, the discount code and the success page", () => {
  const plain = visit("rankup", "/buy/rankup/?discount_code=SAVE10");
  assert.deepEqual(plain.initialised, { token: "test_token" });
  assert.equal(plain.options.discountCode, "SAVE10");
  assert.equal(plain.options.settings.successUrl, "https://www.stillwareltd.com/buy/success");
  assert.deepEqual(plain.options.items, [{ priceId: "pri_stand_in", quantity: 1 }]);

  const up = visit("rankup-upgrade", `/buy/rankup-upgrade/?licence=${HASH}&discount_code=SAVE10`);
  assert.equal(up.options.discountCode, "SAVE10");
  assert.equal(up.options.settings.successUrl, "https://www.stillwareltd.com/buy/success?upgrade=1");
  assert.equal(visit("rankup-every-device", "/buy/rankup-every-device/").options.settings.successUrl, "https://www.stillwareltd.com/buy/success");
});

test("customData is set in one place only, inside the passLicence branch, from the hand-over value", () => {
  const text = checkoutScript();
  assert.equal((text.match(/customData/g) ?? []).length, 1);
  assert.match(text, /if \(passLicence\) \{\s*const licence = window\.stillwareUpgradeLicence \|\| null;\s*if \(licence\) \{\s*checkoutOptions\.customData = \{ licence: licence \};/);
});

test("the success page: the key-email text stays, and ?upgrade=1 swaps in the upgrade wording", () => {
  const start = SUCCESS.indexOf("<script is:inline>");
  const end = SUCCESS.indexOf("</script>", start);
  assert.ok(start > 0);
  const body = SUCCESS.slice(start + "<script is:inline>".length, end);

  const run = (search: string) => {
    const lead = { innerText: "default lead" };
    const how = { innerText: "default how" };
    const document = { getElementById: (id: string) => (id === "success-lead" ? lead : id === "success-how" ? how : null) };
    new Function("document", "window", body)(document, { location: { search } });
    return { lead: lead.innerText, how: how.innerText };
  };
  assert.deepEqual(run(""), { lead: "default lead", how: "default how" });
  assert.deepEqual(run("?upgrade=0"), { lead: "default lead", how: "default how" });
  const up = run("?upgrade=1");
  assert.match(up.lead, /Every device is now on for the key you already have/);
  assert.match(up.how, /could not match your key, we've emailed you a new Every device key/);
  assert.match(SUCCESS, /We've sent your license key to the email/, "the usual text is still the default");
});
