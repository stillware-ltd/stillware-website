import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The switch-day RankUp page (src/pages/rankupchess.astro): the HTML has no price figure, and the
// small script fills in the visitor's own price from /api/household/prices. The script is run here
// with a fake document and a fake fetch; the HTML is checked from the source.

const SOURCE = readFileSync(new URL("../../src/pages/rankupchess.astro", import.meta.url), "utf8");

/** The pricing section's markup, from the source. */
function pricingMarkup(): string {
  const start = SOURCE.indexOf('<section class="pricing-section');
  const end = SOURCE.indexOf("<!-- FAQ -->", start);
  assert.ok(start > 0 && end > start, "the pricing section is there");
  return SOURCE.slice(start, end);
}

/** The text of showLocalPrices(), cut out of the page's script. */
function scriptSource(): string {
  const start = SOURCE.indexOf("async function showLocalPrices()");
  assert.ok(start > 0, "the price script is there");
  let depth = 0;
  for (let i = SOURCE.indexOf("{", start); i < SOURCE.length; i++) {
    if (SOURCE[i] === "{") depth++;
    if (SOURCE[i] === "}" && --depth === 0) return SOURCE.slice(start, i + 1);
  }
  throw new Error("unbalanced braces");
}

class FakeEl {
  textContent: string;
  hidden: boolean;
  dataset: Record<string, string>;
  constructor(name: string, text: string, hidden: boolean) {
    this.textContent = text;
    this.hidden = hidden;
    this.dataset = { price: name };
  }
}

function page() {
  const every = new FakeEl("every_device", "", true);
  const mine = new FakeEl("this_device", "", true);
  const upgrade = new FakeEl("upgrade", "a smaller extra payment", false);
  const note = { textContent: "Your price is shown at checkout." };
  const doc = {
    querySelectorAll: (sel: string) => (sel === "[data-price]" ? [every, mine, upgrade] : []),
    querySelector: (sel: string) => (sel === "[data-price-note]" ? note : null),
  };
  return { every, mine, upgrade, note, doc };
}

async function run(fetchImpl: (url: string, init: any) => Promise<any>) {
  const p = page();
  const calls: Array<{ url: string; init: any }> = [];
  const fetchSpy = async (url: string, init: any) => {
    calls.push({ url, init });
    return fetchImpl(url, init);
  };
  const fn = new Function("document", "fetch", "AbortController", "setTimeout", "clearTimeout", `${scriptSource()}; return showLocalPrices;`)(
    p.doc, fetchSpy, AbortController, setTimeout, clearTimeout
  );
  await fn();
  return { ...p, calls };
}

const ok = (body: unknown) => async () => ({ ok: true, json: async () => body });

test("the HTML shows no price figure: a currency symbol and digits never appear in the pricing section", () => {
  const markup = pricingMarkup();
  // strip the frontmatter-style expressions: only literal text is checked
  assert.equal(/[$£€¥]\s?\d/.test(markup), false, "no figure with a currency sign");
  assert.equal(/\d+[.,]\d{2}\s?(USD|GBP|EUR|dollars|pounds|euros)/i.test(markup), false);
  assert.match(markup, /Your price is shown at checkout\./);
  assert.match(markup, /<h4>Every device<\/h4>/);
  assert.match(markup, /<span class="price-terms">one payment<\/span>/);
  assert.match(markup, /Only on one kind of device/);
  assert.match(markup, /Best for families/);
  assert.match(markup, /every phone, tablet and computer your family owns/);
  for (const line of [
    "Only on Windows (up to 3 Windows or Linux PCs)",
    "Only on Mac (up to 3 Macs)",
    "Only on Android (Google Play)",
    "Only on iPhone and iPad (App Store)",
  ]) {
    assert.ok(markup.includes(line), line);
  }
  assert.match(markup, /Own one and want them all\? Add Every device for/);
  // the slots the script fills start without a figure
  assert.match(markup, /data-price="every_device" hidden/);
  assert.match(markup, /data-price="this_device" hidden/);
  assert.match(markup, /data-price="upgrade">a smaller extra payment</);
});

test("no dollar figure anywhere in the page's own copy for the tiers (key facts and FAQ included)", () => {
  const frontmatter = SOURCE.slice(0, SOURCE.indexOf("---", 4));
  const priceFact = frontmatter.match(/term: 'Price', detail: '([^']*)'/)?.[1] ?? "";
  assert.ok(priceFact.length > 0);
  assert.equal(/\$\s?\d/.test(priceFact), false);
  const subscriptionFaq = frontmatter.match(/q: 'Is there a subscription[^']*', a: '([^']*)'/)?.[1] ?? "";
  assert.match(subscriptionFaq, /every device your family owns, or only for the kind of device you use\. Either way you pay once\./);
  assert.equal(/\$\s?\d/.test(subscriptionFaq), false);
});

test("the owner line needs the switch date: none is printed with a blank date", () => {
  assert.match(SOURCE, /const RANKUP_SWITCH_DATE: string \| null = (null|'\d{4}-\d{2}-\d{2}');/);
  assert.match(pricingMarkup(), /\{RANKUP_SWITCH_DATE_TEXT && \(/);
  assert.match(pricingMarkup(), /Bought RankUp before \{RANKUP_SWITCH_DATE_TEXT\}\? You already have Every device, free\./);
});

test("the page no longer says it has no central servers (a licence server exists), and says what it does collect", () => {
  assert.equal(/central servers?/i.test(SOURCE), false, "no 'central server' claim anywhere on the page");
  assert.equal(/literally cannot track/i.test(SOURCE), false);
  // The wording is deploy A's (24 October, live; seo/CHANGES.md): it replaced this branch's earlier drafts.
  const frontmatter = SOURCE.slice(0, SOURCE.indexOf("---", 4));
  assert.match(frontmatter, /No account, no chat rooms and no data harvesting: games and progress stay on the device\./);
  assert.match(frontmatter, /Games and progress stay on the device, and it has no chat rooms\./);
  assert.match(frontmatter, /RankUp Chess has no account, no chat rooms and no analytics/);
  assert.match(SOURCE, /No account, no chat rooms and no analytics: your child's games and progress never leave the device\./);
  assert.equal(/safest digital environment possible/i.test(SOURCE), false, "dropped in deploy A: not verifiable");
  assert.match(SOURCE, /Up to 8 family profiles on one device, with no child accounts/);
});

test("title, H1 and URL are the page's own, unchanged", () => {
  assert.match(SOURCE, /title="RankUp Chess — The Offline Chess Academy for Kids"/);
  assert.match(SOURCE, /canonical="https:\/\/www\.stillwareltd\.com\/rankupchess\/"/);
  assert.match(SOURCE, /<h1 class="text-gradient-gold">Stop renting your kids' educational apps\.<\/h1>/);
});

test("script: asks for platform web, and fills in the figures it is given (card 2 included)", async () => {
  const r = await run(ok({ country: "GB", currency: "GBP", prices: { every_device: "£19.99", this_device: "£11.99", upgrade: "£7.99" } }));
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, "/api/household/prices");
  assert.equal(r.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(r.calls[0].init.body), { product: "rankup", platform: "web" });
  assert.equal(r.every.textContent, "£19.99");
  assert.equal(r.every.hidden, false);
  assert.equal(r.upgrade.textContent, "£7.99");
  // card 2 gets the single Only-on price, from this_device
  assert.equal(r.mine.textContent, "£11.99");
  assert.equal(r.mine.hidden, false);
  assert.match(r.note.textContent, /for your country, in your currency/);
});

test("script: another currency is shown as Paddle formatted it", async () => {
  const r = await run(ok({ prices: { every_device: "19,99 €", this_device: "11,99 €", upgrade: "7,99 €" } }));
  assert.equal(r.every.textContent, "19,99 €");
  assert.equal(r.mine.textContent, "11,99 €");
  assert.equal(r.upgrade.textContent, "7,99 €");
});

test("script: a price that is missing from the answer leaves its own slot empty, and the others filled", async () => {
  const r = await run(ok({ prices: { every_device: "£19.99", upgrade: "£7.99" } }));
  assert.equal(r.every.textContent, "£19.99");
  assert.equal(r.mine.textContent, "");
  assert.equal(r.mine.hidden, true);
});

test("script: any failure leaves the page as the server wrote it (no figure, 'shown at checkout')", async () => {
  const cases: Array<[string, (url: string, init: any) => Promise<any>]> = [
    ["a network error", async () => { throw new TypeError("Failed to fetch"); }],
    ["a 503", async () => ({ ok: false, status: 503, json: async () => ({ error: "try_later" }) })],
    ["a 400", async () => ({ ok: false, status: 400, json: async () => ({ error: "bad_request" }) })],
    ["bad JSON", async () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected token"); } })],
    ["no prices key", ok({ country: "GB" })],
    ["null", ok(null)],
    ["empty prices (the Every device prices do not exist yet)", ok({ country: "GB", currency: null, prices: {} })],
    ["prices as a string", ok({ prices: "£19.99" })],
  ];
  for (const [name, impl] of cases) {
    const r = await run(impl);
    assert.equal(r.every.textContent, "", name);
    assert.equal(r.every.hidden, true, name);
    assert.equal(r.mine.hidden, true, name);
    assert.equal(r.upgrade.textContent, "a smaller extra payment", name);
    assert.equal(r.note.textContent, "Your price is shown at checkout.", name);
  }
});

test("script: only text that looks like a price goes in", async () => {
  const r = await run(ok({ prices: { every_device: "<img src=x onerror=alert(1)>", this_device: "free", upgrade: "£".padEnd(40, "9") } }));
  assert.equal(r.every.hidden, true);
  assert.equal(r.every.textContent, "", "markup with no digits is refused");
  assert.equal(r.mine.hidden, true);
  assert.equal(r.upgrade.textContent, "a smaller extra payment", "an over-long string is refused");
  assert.equal(r.note.textContent, "Your price is shown at checkout.");
  // text with digits is still put in as text, never as markup
  const r2 = await run(ok({ prices: { every_device: "<b>9</b>" } }));
  assert.equal(r2.every.textContent, "<b>9</b>");
  assert.match(scriptSource(), /el\.textContent = text/);
  assert.equal(/innerHTML|insertAdjacentHTML/.test(scriptSource()), false);
});

test("script: it gives up after five seconds", () => {
  assert.match(scriptSource(), /setTimeout\(\(\) => controller\.abort\(\), 5000\)/);
});
