import { Resend } from "resend";
import type { ProductConfig } from "./products.js";

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("Missing RESEND_API_KEY");
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

export async function sendLicenseEmail(
  to: string,
  licenseKey: string,
  product: ProductConfig
): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL || "Stillware <noreply@stillwareltd.com>";

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
      <p>Thank you for purchasing ${product.name}! Here is your lifetime license key:</p>
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
      <p>You can activate this key on up to <strong>${product.maxActivations} devices</strong>. If you need to move it to a new machine, deactivate an existing one first.</p>
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
