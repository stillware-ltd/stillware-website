import { Resend } from "resend";
import { CODE_TTL_MINUTES } from "./household-config.js";
import type { CodePurpose } from "./household-store.js";
import { PLATFORM_LABEL, type LicensePlatform, type ProductConfig } from "./products.js";

let resendClient: Resend | null = null;

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

  await getResend().emails.send({
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
}

/**
 * The mail that carries a 6-digit sign-in or link code (household licence, KL.2). Plain words,
 * plain text, nothing else in it.
 */
export function householdCodeMessage(
  product: ProductConfig,
  purpose: CodePurpose,
  code: string
): { subject: string; text: string } {
  const what = purpose === "link" ? "confirmation code" : "sign-in code";
  return {
    subject: `Your ${product.name} ${what}`,
    text:
      `Your ${product.name} ${what} is ${code}. It works for ${CODE_TTL_MINUTES} minutes.\n\n` +
      "If you did not ask for this, you can ignore this email.\n",
  };
}

/** Sends the code mail. Throws if Resend refuses it, so the caller can log it. */
export async function sendHouseholdCodeEmail(
  to: string,
  code: string,
  product: ProductConfig,
  purpose: CodePurpose
): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL || "Stillware <noreply@stillwareltd.com>";
  const { subject, text } = householdCodeMessage(product, purpose, code);
  // Resend reports a refused mail in `error` instead of throwing.
  const { error } = await getResend().emails.send({ from, to, subject, text });
  if (error) throw new Error(`Resend refused the mail: ${error.name}`);
}
