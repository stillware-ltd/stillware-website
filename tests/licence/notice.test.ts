import test from "node:test";
import assert from "node:assert/strict";
import {
  householdCodeMessage,
  householdConfirmationMessage,
  mailDate,
} from "../../netlify/functions/lib/email.js";
import { PRODUCTS } from "../../netlify/functions/lib/products.js";

// KL.8: the code mail is the direct notice to the parent (16 CFR 312.4(c)(1)), and the
// confirmation is the "plus" of email plus (312.5(b)(2)(viii)). These tests check each element the
// Rule asks for, in every purpose, so a later edit to the words cannot quietly drop one.

const P = PRODUCTS.rankup;

/** The elements of 312.4(c)(1) for a mail that asks consent to use or keep the address. */
function assertDirectNotice(text: string, what: { keeps: RegExp; recipients: RegExp }) {
  // (i) that this address was entered, and in what
  assert.match(text, /Someone typed this email address into RankUp Chess, a chess app for children,/, "(i)");
  // (ii) a parent's agreement is needed; nothing is used or kept without it
  assert.match(text, /We need a parent's or guardian's agreement before we (use|keep) it\./, "(ii)");
  assert.match(text, /If you don't enter the code, nothing is (used|kept)/, "(ii) declining");
  // (iii) what is kept or used, and why
  assert.match(text, what.keeps, "(iii)");
  assert.match(text, /We collect nothing about your child\./, "(iii) nothing about the child");
  // (iv) who receives it, and why
  assert.match(text, what.recipients, "(iv)");
  // (v) a link to the privacy notice
  assert.ok(text.includes("https://www.stillwareltd.com/privacy/"), "(v)");
  // (vi) how to agree
  assert.match(text, /If you enter the code in the app and tap "Agree and (sign in|add email)", you agree/, "(vi)");
  // (vii) an unused request is deleted, and when
  assert.match(text, /the request is deleted within 25 hours/, "(vii)");
  // and how to ask a question or take consent back
  assert.ok(text.includes("reply to this email or write to support@stillwareltd.com"), "contact");
}

test("the sign-in mail is a direct notice: every element of 312.4(c)(1)", () => {
  const { text } = householdCodeMessage(P, "signin", "123456");
  assertDirectNotice(text, {
    keeps: /we use this address only to find your purchase and restore it\..*We keep no copy of the address/s,
    recipients: /Resend \(it sends this email\), Netlify and Turso \(they host our licence service\) and Paddle/,
  });
  assert.match(text, /for a purchase made on our website, with Paddle, which sold it/, "the Paddle match is named");
});

test("the link mail is a direct notice: every element, and what is kept, for how long", () => {
  const { text } = householdCodeMessage(P, "link", "654321");
  assertDirectNotice(text, {
    keeps: /we keep a scrambled form of this address \(not the address itself\) next to an anonymous purchase number/,
    recipients: /Resend \(it sends this email\), and Netlify and Turso \(they host our licence service\)/,
  });
  assert.match(text, /We use it for nothing else\. We delete it 2 years after its last sign-in, when you remove it, or if the purchase is refunded\./);
  assert.equal(/Paddle/.test(text), false, "a link never asks Paddle");
});

test("the remove mail: the code, what it does, and that ignoring it changes nothing", () => {
  const { text } = householdCodeMessage(P, "remove", "111222");
  assert.match(text, /^Your RankUp Chess code is 111222\. It works for 10 minutes\./);
  assert.match(text, /Someone asked to remove this email address from RankUp Chess\. Enter the code in the app to remove it\./);
  assert.match(text, /If you didn't ask, ignore this email: nothing changes, and the request is deleted within 25 hours\./);
  assert.ok(text.includes("https://www.stillwareltd.com/privacy/"));
});

test("the confirmation after a link is the 'plus': what happened, what is kept, and how to take it back", () => {
  const at = new Date("2026-11-01T09:30:00Z");
  const { subject, text } = householdConfirmationMessage(P, "link", at);
  assert.equal(subject, "Your email is linked to RankUp Chess");
  assert.match(text, /^On 1 November 2026 this address was linked to a RankUp Chess purchase/);
  assert.match(text, /We keep only a scrambled form of the address/);
  // the notice that consent can be taken back (312.5(b)(2)(viii)), with two ways to do it
  assert.match(text, /You can take back your agreement at any time: in RankUp Chess, open Settings, then Restore Purchases, then Remove my email\. Or reply to this email\./);
  assert.match(text, /If this wasn't you, reply to this email and we will remove it\./);
  assert.ok(text.includes("https://www.stillwareltd.com/privacy/"));
});

test("the confirmation after a sign-in, and after a removal", () => {
  const at = new Date("2026-11-01T23:59:00Z");
  const signin = householdConfirmationMessage(P, "signin", at);
  assert.equal(signin.subject, "RankUp Chess Premium was restored with your email");
  assert.match(signin.text, /^On 1 November 2026 this address was used to restore RankUp Chess Premium on a device\. We kept no copy/);
  assert.match(signin.text, /If this wasn't you, reply to this email\./);
  assert.match(signin.text, /Remove my email/);
  const removed = householdConfirmationMessage(P, "remove", at);
  assert.equal(removed.subject, "Your email is removed from RankUp Chess");
  assert.match(removed.text, /We no longer keep any form of it\. Devices that already have Premium keep it/);
});

test("mail dates are UTC calendar days, written out", () => {
  assert.equal(mailDate(new Date("2026-11-01T00:00:00Z")), "1 November 2026");
  assert.equal(mailDate(new Date("2026-11-01T23:59:59Z")), "1 November 2026");
  assert.equal(mailDate(new Date("2027-01-09T12:00:00Z")), "9 January 2027");
});

test("every household mail is plain text with the privacy notice as its only link, and no marketing", () => {
  const at = new Date("2026-11-01T09:30:00Z");
  const all = [
    householdCodeMessage(P, "signin", "123456"),
    householdCodeMessage(P, "link", "123456"),
    householdCodeMessage(P, "remove", "123456"),
    householdConfirmationMessage(P, "link", at),
    householdConfirmationMessage(P, "signin", at),
    householdConfirmationMessage(P, "remove", at),
  ];
  for (const m of all) {
    assert.deepEqual(m.text.match(/https?:\/\/\S+/g), ["https://www.stillwareltd.com/privacy/"], m.subject);
    assert.equal(/<|price|\$|offer|buy|discount|upgrade/i.test(m.text), false, m.subject);
    assert.ok(m.text.endsWith("Stillware Ltd\n"), m.subject);
  }
});
