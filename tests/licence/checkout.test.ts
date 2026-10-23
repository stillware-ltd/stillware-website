import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EVERY_DEVICE_PADDLE_PRICE_IDS,
  EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS,
  PRICE_ID_TO_PRODUCT,
} from "../../netlify/functions/lib/products.js";
import { PADDLE_PRODUCTS, isComingSoon, type CheckoutSlug } from "../../src/config/paddle.js";

// The buy pages (src/pages/buy/[product].astro, src/config/paddle.ts): the two new Every device pages,
// and the ?licence= parameter that only the upgrade page passes to Paddle as custom data.

const PAGE = readFileSync(new URL("../../src/pages/buy/[product].astro", import.meta.url), "utf8");
const SUCCESS = readFileSync(new URL("../../src/pages/buy/success.astro", import.meta.url), "utf8");
const HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/** The inline script's own text: licenceFromSearch and the function that opens the checkout. */
function checkoutScript(): string {
  const start = PAGE.indexOf("function licenceFromSearch(search)");
  const end = PAGE.indexOf("})();", start);
  assert.ok(start > 0 && end > start, "the checkout script is there");
  return PAGE.slice(start, end + "})();".length);
}

function licenceFromSearch(): (search: string) => string | null {
  const text = checkoutScript();
  const fnEnd = text.indexOf("(function () {");
  return new Function(`${text.slice(0, fnEnd)}; return licenceFromSearch;`)();
}

interface Opened {
  options: any;
  initialised: any;
  noKey: { hidden: boolean; innerText: string };
  heading: { innerText: string };
}

/** Runs the page's script as the browser would, with a fake Paddle, for one buy page and one address. */
function open(slug: CheckoutSlug, search: string): Opened {
  const config = PADDLE_PRODUCTS[slug];
  const out: Opened = {
    options: null,
    initialised: null,
    noKey: { hidden: true, innerText: "" },
    heading: { innerText: "" },
  };
  const elements: Record<string, any> = {
    "checkout-status": { innerText: "", innerHTML: "" },
    "checkout-heading": out.heading,
    "checkout-no-key": out.noKey,
  };
  const Paddle = {
    Initialize: (o: unknown) => void (out.initialised = o),
    Checkout: { open: (o: unknown) => void (out.options = o) },
  };
  const window = { location: { search, origin: "https://www.stillwareltd.com" } };
  const document = { getElementById: (id: string) => elements[id] ?? null };
  // define:vars gives these names to the script; a stand-in price id lets every page run it
  new Function("token", "priceId", "productName", "passLicence", "successPath", "document", "window", "Paddle", checkoutScript())(
    "test_token", "pri_stand_in", config.name, config.passesLicence === true, config.successPath ?? "/buy/success", document, window, Paddle
  );
  return out;
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
  // the page opens no checkout (no Paddle script at all) when it is coming soon
  assert.match(PAGE, /\{!comingSoon && \(/);
  assert.match(PAGE, /comingSoon \? unavailableHeading/);
  assert.match(PAGE, /comingSoon \? unavailableText/);
});

test("the three checkouts that exist today are exactly as they were", () => {
  assert.equal(isComingSoon(PADDLE_PRODUCTS.zeroed), false);
  assert.equal(isComingSoon(PADDLE_PRODUCTS.rankup), false);
  assert.equal(isComingSoon(PADDLE_PRODUCTS["rankup-mac"]), false);
  assert.equal(PADDLE_PRODUCTS.zeroed.priceId, "pri_01knnyfj5zezrch30qqbzkc378");
  assert.equal(PADDLE_PRODUCTS.rankup.priceId, "pri_01knztpnwdqxx8ecnbrjt4zkzq");
  assert.equal(PADDLE_PRODUCTS["rankup-mac"].priceId, "pri_01m194cc17phxmgqdqs737mw2p");
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

test("only the upgrade page is set to pass ?licence=", () => {
  const passing = Object.entries(PADDLE_PRODUCTS).filter(([, c]) => c.passesLicence === true).map(([slug]) => slug);
  assert.deepEqual(passing, ["rankup-upgrade"]);
  assert.match(PAGE, /passLicence: config\.passesLicence === true,/);
});

test("licenceFromSearch: exactly 64 hex characters, nothing else", () => {
  const f = licenceFromSearch();
  assert.equal(f(`?licence=${HASH}`), HASH);
  assert.equal(f(`licence=${HASH}`), HASH, "with or without the question mark");
  assert.equal(f(`?licence=${HASH.toUpperCase()}`), HASH, "upper-case hex is accepted and lower-cased");
  assert.equal(f(`?discount_code=X&licence=${HASH}&utm_source=app`), HASH, "among other parameters");
  assert.equal(f(`?licence=${HASH.replace(/./g, (c, i) => (i % 2 ? c : c.toUpperCase()))}`), HASH);
  for (const bad of [
    "",
    "?",
    "?licence=",
    `?licence=${HASH.slice(1)}`, // 63
    `?licence=${HASH}0`, // 65
    `?licence=${HASH.slice(0, 63)}g`, // not hex
    `?licence=${HASH.slice(0, 63)}%20`,
    `?licence=%20${HASH}`,
    `?licence=${HASH}%0A`,
    `?licence=${HASH}${HASH}`,
    "?licence=abc",
    "?licence=<script>alert(1)</script>",
    `?licence[]=${HASH}`,
    `?licences=${HASH}`,
    `?license=${HASH}`, // the American spelling is not the parameter
    `?Licence=${HASH}`,
    `?licence=0x${HASH.slice(2)}`,
    "?licence=" + "0".repeat(64) + "&licence=short",
  ]) {
    // (the last case: the first value is a good one, URLSearchParams.get returns the first)
    const got = f(bad);
    if (bad === "?licence=" + "0".repeat(64) + "&licence=short") assert.equal(got, "0".repeat(64));
    else assert.equal(got, null, JSON.stringify(bad));
  }
});

test("the upgrade page passes a good ?licence= to Paddle as customData; every other page ignores it", () => {
  for (const slug of Object.keys(PADDLE_PRODUCTS) as CheckoutSlug[]) {
    const opened = open(slug, `?licence=${HASH}`);
    assert.ok(opened.options, `${slug} opened a checkout`);
    assert.deepEqual(opened.options.items, [{ priceId: "pri_stand_in", quantity: 1 }]);
    if (slug === "rankup-upgrade") {
      assert.deepEqual(opened.options.customData, { licence: HASH });
      assert.equal(opened.noKey.hidden, true, "no warning when the key hash is there");
    } else {
      assert.equal("customData" in opened.options, false, `${slug} must not pass the parameter`);
    }
  }
});

test("the upgrade page with a missing or malformed value still opens, with no customData, and says what will happen", () => {
  for (const search of ["", "?", "?licence=", `?licence=${HASH.slice(1)}`, `?licence=${HASH}x`, "?licence=nope", `?license=${HASH}`]) {
    const opened = open("rankup-upgrade", search);
    assert.ok(opened.options, `opened for ${JSON.stringify(search)}`);
    assert.equal("customData" in opened.options, false, JSON.stringify(search));
    assert.equal(opened.noKey.hidden, false);
    assert.match(opened.noKey.innerText, /new Every device key by email/);
  }
});

test("the checkout is otherwise as it was: the token, the discount code and the success page", () => {
  const plain = open("rankup", "?discount_code=SAVE10");
  assert.deepEqual(plain.initialised, { token: "test_token" });
  assert.equal(plain.options.discountCode, "SAVE10");
  assert.equal(plain.options.settings.successUrl, "https://www.stillwareltd.com/buy/success");
  assert.equal("customData" in plain.options, false);

  const up = open("rankup-upgrade", `?licence=${HASH}&discount_code=SAVE10`);
  assert.equal(up.options.discountCode, "SAVE10");
  assert.equal(up.options.settings.successUrl, "https://www.stillwareltd.com/buy/success?upgrade=1");
  assert.equal(open("rankup-every-device", "").options.settings.successUrl, "https://www.stillwareltd.com/buy/success");
});

test("customData is set in one place only, inside the passLicence branch", () => {
  const text = checkoutScript();
  assert.equal((text.match(/customData/g) ?? []).length, 1);
  assert.match(text, /if \(passLicence\) \{\s*const licence = licenceFromSearch\(window\.location\.search\);\s*if \(licence\) \{\s*checkoutOptions\.customData = \{ licence: licence \};/);
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
