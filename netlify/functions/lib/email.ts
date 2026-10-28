import { Resend } from "resend";
import { CODE_TTL_MINUTES, LINK_RETENTION_DAYS, PRIVACY_URL, SUPPORT_EMAIL } from "./household-config.js";
import { RETENTION_HOURS, type CodePurpose } from "./household-store.js";
import { MailError } from "./mail-outbox.js";
import { PLATFORM_LABEL, type LicensePlatform, type ProductConfig } from "./products.js";

let resendClient: Resend | null = null;

/** Resend answers a refused mail with `error` instead of throwing: turn it into a MailError carrying its name. */
function refused(error: { name?: unknown } | null | undefined): void {
  if (!error) return;
  const code = typeof error.name === "string" && error.name ? error.name : "refused";
  throw new MailError(code, `Resend refused the mail: ${code}`);
}

function getResend(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("Missing RESEND_API_KEY");
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

/**
 * Emails a licence key. `reissue` is for lost-key recovery (license-resend-key.ts): the key is
 * a new one for an earlier purchase, and any key sent before keeps working. `platform` names
 * the platform a per-platform licence is for (lib/products.ts); null means any platform.
 */
export async function sendLicenseEmail(
  to: string,
  licenseKey: string,
  product: ProductConfig,
  { reissue = false, platform = null }: { reissue?: boolean; platform?: LicensePlatform | null } = {}
): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL || "Stillware <noreply@stillwareltd.com>";
  const intro = reissue
    ? `You asked for your ${product.name} license key again. Here is a new key for your purchase. Any key we sent you before still works:`
    : `Thank you for purchasing ${product.name}! Here is your lifetime license key:`;
  const devices = platform
    ? `This key is for ${product.name} on <strong>${PLATFORM_LABEL[platform].on}</strong>. You can activate it on up to <strong>${product.maxActivations} ${PLATFORM_LABEL[platform].devices}</strong>.`
    : `You can activate this key on up to <strong>${product.maxActivations} devices</strong>.`;

  // Until 28 October 2026 the answer was ignored, so a refused key mail was not even logged.
  const { error } = await getResend().emails.send({
    from,
    to,
    subject: `Your ${product.name} License Key`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #334155; line-height: 1.6; margin: 0; padding: 0; background: #f8fafc; }
    .container { max-width: 520px; margin: 40px auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
    .header { background: #0f172a; padding: 28px 32px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 20px; margin: 0; font-weight: 700; letter-spacing: 0.5px; }
    .body { padding: 32px; }
    .key-box { background: #f1f5f9; border: 2px dashed #2563eb; border-radius: 10px; padding: 20px; text-align: center; margin: 24px 0; }
    .key-box code { font-size: 18px; font-weight: 700; color: #0f172a; letter-spacing: 2px; word-break: break-all; }
    .steps { margin: 24px 0; padding-left: 0; list-style: none; }
    .steps li { padding: 6px 0; padding-left: 24px; position: relative; }
    .steps li::before { content: attr(data-step); position: absolute; left: 0; font-weight: 700; color: #2563eb; }
    .footer { padding: 20px 32px; background: #f8fafc; text-align: center; font-size: 13px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${product.name} — License Key</h1>
    </div>
    <div class="body">
      <p>${intro}</p>
      <div class="key-box">
        <code>${licenseKey}</code>
      </div>
      <p><strong>To activate:</strong></p>
      <ul class="steps">
        <li data-step="1.">Open ${product.name} on your desktop</li>
        <li data-step="2.">Go to the Paywall or Settings screen</li>
        <li data-step="3.">Tap <strong>"I have a License Key"</strong></li>
        <li data-step="4.">Paste the key above and tap <strong>Activate</strong></li>
      </ul>
      <p>${devices} If you need to move it to a new machine, deactivate an existing one first.</p>
      <p>Keep this email safe — it's your proof of purchase.</p>
    </div>
    <div class="footer">
      Questions? <a href="mailto:support@stillwareltd.com">support@stillwareltd.com</a><br>
      Stillware Ltd &mdash; ${product.tagline}
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
  refused(error);
}

// ---------------------------------------------------------------------------------------------
// The household licence's mails (KL.2, made verifiable parental consent by "email plus" in KL.8).
// Plain text only: no markup, no tracking, no link but the privacy notice. Replies go to support,
// so "reply to this email" is a real way to ask a question or take consent back.

/** What the app is, for a parent who did not expect the mail. */
const APP_LINE: Partial<Record<ProductConfig["slug"], string>> = { rankup: "a chess app for children" };

/** Codes and their requests are gone within this many hours of stopping to work (the hourly purge). */
const GONE_WITHIN_HOURS = RETENTION_HOURS + 1;

/** How long a linked email is kept after its last sign-in, in years, for the mails' words. */
const LINK_YEARS = LINK_RETENTION_DAYS / 365;

const FOOTER =
  `How we use information: ${PRIVACY_URL}\n` +
  `Questions, or to remove your email at any time: reply to this email or write to ${SUPPORT_EMAIL}.\n\n` +
  "Stillware Ltd\n";

const appNamed = (product: ProductConfig) =>
  APP_LINE[product.slug] ? `${product.name}, ${APP_LINE[product.slug]},` : product.name;

/**
 * The mail that carries a 6-digit code: also the direct notice to the parent that 16 CFR
 * 312.4(c)(1) requires before consent. It says (i) that this address was entered, and where;
 * (ii) that a parent's agreement is needed and nothing is used without it; (iii, iv) what is kept,
 * why, and the services that handle it; (v) the privacy notice; (vi) how to agree (the code);
 * (vii) that an unused request is deleted. A test checks each element for every purpose.
 */
export function householdCodeMessage(
  product: ProductConfig,
  purpose: CodePurpose,
  code: string
): { subject: string; text: string } {
  const first = (what: string) =>
    `Your ${product.name} ${what} is ${code}. It works for ${CODE_TTL_MINUTES} minutes.\n\n`;
  if (purpose === "remove") {
    return {
      subject: `Your ${product.name} code to remove your email`,
      text:
        first("code") +
        `Someone asked to remove this email address from ${product.name}. Enter the code in the app to remove it.\n\n` +
        `If you didn't ask, ignore this email: nothing changes, and the request is deleted within ${GONE_WITHIN_HOURS} hours.\n\n` +
        FOOTER,
    };
  }
  if (purpose === "link") {
    return {
      subject: `Your ${product.name} confirmation code`,
      text:
        first("confirmation code") +
        `Someone typed this email address into ${appNamed(product)} to link it to a purchase, so that the ` +
        "family's other devices can restore it. We need a parent's or guardian's agreement before we keep it.\n\n" +
        'If you enter the code in the app and tap "Agree and add email", you agree that we keep a scrambled form ' +
        "of this address (not the address itself) next to an anonymous purchase number, so that you can sign in " +
        `on your other devices. We use it for nothing else. We delete it ${LINK_YEARS} years after its last ` +
        "sign-in, when you remove it, or if the purchase is refunded.\n\n" +
        "We collect nothing about your child. We share the address with no one except the services that run " +
        "this for us: Resend (it sends this email), and Netlify and Turso (they host our licence service).\n\n" +
        `If you don't enter the code, nothing is kept, and the request is deleted within ${GONE_WITHIN_HOURS} hours.\n\n` +
        FOOTER,
    };
  }
  return {
    subject: `Your ${product.name} sign-in code`,
    text:
      first("sign-in code") +
      `Someone typed this email address into ${appNamed(product)} to restore a purchase on another device. ` +
      "We need a parent's or guardian's agreement before we use it.\n\n" +
      'If you enter the code in the app and tap "Agree and sign in", you agree that we use this address only ' +
      "to find your purchase and restore it. We check it against our purchase records and, for a purchase made " +
      "on our website, with Paddle, which sold it. We keep no copy of the address: the request is deleted " +
      `within ${GONE_WITHIN_HOURS} hours.\n\n` +
      "We collect nothing about your child. We share the address with no one except the services that run " +
      "this for us: Resend (it sends this email), Netlify and Turso (they host our licence service) and Paddle.\n\n" +
      `If you don't enter the code, nothing is used, and the request is deleted within ${GONE_WITHIN_HOURS} hours.\n\n` +
      FOOTER,
  };
}

/** What a confirmation follows: a link, a sign-in, or a removal. */
export type ConfirmationKind = "link" | "signin" | "remove";

/** A date as a parent reads it: "1 November 2026" (UTC, as the server keeps dates). */
export function mailDate(at: Date): string {
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The "plus" of email plus (16 CFR 312.5(b)(2)(viii)): the confirmation sent after the parent's
 * consent, with the notice that consent can be taken back. Also sent after a removal.
 */
export function householdConfirmationMessage(
  product: ProductConfig,
  kind: ConfirmationKind,
  at: Date
): { subject: string; text: string } {
  const day = mailDate(at);
  const removeSteps = `in ${product.name}, open Settings, then Restore Purchases, then Remove my email`;
  if (kind === "remove") {
    return {
      subject: `Your email is removed from ${product.name}`,
      text:
        `On ${day} this address was removed from ${product.name}. We no longer keep any form of it. ` +
        "Devices that already have Premium keep it, and you can add the address again at any time.\n\n" +
        FOOTER,
    };
  }
  if (kind === "link") {
    return {
      subject: `Your email is linked to ${product.name}`,
      text:
        `On ${day} this address was linked to a ${product.name} purchase, so devices in your family can ` +
        "restore Premium by signing in with it.\n\n" +
        "We keep only a scrambled form of the address, next to an anonymous purchase number, and delete it " +
        `${LINK_YEARS} years after its last sign-in.\n\n` +
        `You can take back your agreement at any time: ${removeSteps}. Or reply to this email. ` +
        "Devices that already have Premium keep it.\n\n" +
        "If this wasn't you, reply to this email and we will remove it.\n\n" +
        FOOTER,
    };
  }
  return {
    subject: `${product.name} Premium was restored with your email`,
    text:
      `On ${day} this address was used to restore ${product.name} Premium on a device. We kept no copy of ` +
      "the address for this sign-in.\n\n" +
      `If you linked this address to a purchase earlier and want it removed: ${removeSteps}. ` +
      "Or reply to this email.\n\n" +
      "If this wasn't you, reply to this email.\n\n" +
      FOOTER,
  };
}

/** Sends one household mail. Replies go to support. Throws if Resend refuses it, so the caller can log it. */
async function sendHouseholdMail(to: string, message: { subject: string; text: string }): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL || "Stillware <noreply@stillwareltd.com>";
  const { error } = await getResend().emails.send({ from, to, replyTo: SUPPORT_EMAIL, ...message });
  refused(error);
}

/** Sends the code mail (the direct notice). Throws if Resend refuses it, so the caller can log it. */
export async function sendHouseholdCodeEmail(
  to: string,
  code: string,
  product: ProductConfig,
  purpose: CodePurpose
): Promise<void> {
  await sendHouseholdMail(to, householdCodeMessage(product, purpose, code));
}

/** Sends the confirmation after a link, a sign-in or a removal. Throws if Resend refuses it. */
export async function sendHouseholdConfirmationEmail(
  to: string,
  product: ProductConfig,
  kind: ConfirmationKind,
  at: Date
): Promise<void> {
  await sendHouseholdMail(to, householdConfirmationMessage(product, kind, at));
}

/** The daily failed-mail summary to the founder (lib/mail-outbox.ts dailyMailAlert). Plain text. */
export async function sendAlertEmail(to: string, subject: string, text: string): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL || "Stillware <noreply@stillwareltd.com>";
  const { error } = await getResend().emails.send({ from, to, subject, text });
  refused(error);
}
