# Service providers: the household licence service (RankUp Chess)

**Status: DRAFT (written 25 October 2026, KL.8). The founder fills in the "Accepted" column (F2).** The COPPA Rule (16 CFR 312.8(c), as amended 22 April 2025) asks an operator to take reasonable steps to release children's personal information only to service providers that can keep it confidential and secure, and to get their written assurance that they will. "Email plus" also depends on there being no disclosure to third parties: every provider below acts only for the service. Nothing is sent to anyone else.

Each DPA link was found on 25 October 2026. Read the current text in the provider's dashboard when you accept it: the version you accept is the one that counts.

| Provider | What it does for the service | What it receives | Written terms | Accepted |
|---|---|---|---|---|
| **Netlify** | Hosts the website and the licence functions; holds the environment variables (the secrets) | Every request in transit: a typed address, a code, the requester's IP address, an app user id. Its own request and function logs (the functions log no address, code or IP) | Data Processing Agreement, part of its subscription agreements: [netlify.com/pdf/netlify-dpa.pdf](https://www.netlify.com/pdf/netlify-dpa.pdf) (dated 1 November 2023); newer copy in its Trust Center | `[FOUNDER: date and plan]` |
| **Turso** | The database | The rows in `data-retention-policy.md`: keyed hashes, anonymous purchase records, signed records. No address in the clear | A DPA on request from Turso's Documents portal. **In March 2024 Turso offered it only on the Scaler, Pro and Enterprise plans** ([turso.tech blog, 20 March 2024](https://turso.tech/blog/secure-compliant-and-ready-for-the-pros)). Check which plan the service is on, and whether the free plan's terms give a written assurance | `[FOUNDER: date and plan; DPA requested?]` |
| **Resend** | Sends the code, confirmation and licence-key emails | The recipient's address and the message (the code, the notice) | Data Processing Addendum, pre-signed and in force on sign-up: [resend.com/legal/dpa](https://resend.com/legal/dpa) (copy in the account's Documents page); sub-processors at resend.com/legal/subprocessors | `[FOUNDER: date]` |
| **RevenueCat** | The app's in-app purchases; its webhook tells the service about Every device purchases; the earlier-buyer lookup | From the app: an anonymous app user id and purchase receipts. To the service: purchase events by app user id | Data Processing Addendum: [revenuecat.com/dpa](https://www.revenuecat.com/dpa) (a June 2026 version; check the live page's date) | `[FOUNDER: date]` |
| **Paddle** | Merchant of record for website (Windows and Mac) purchases; the sign-in asks it whether a typed address made a purchase | The typed address, in the lookup request. Paddle already holds its buyers' addresses as the seller | Data Processing Addendum: [paddle.com/legal/data-processing-addendum](https://www.paddle.com/legal/data-processing-addendum) (dated 1 February 2023) | `[FOUNDER: date]` |

## Questions for the outside check (KL.8e)

1. **Paddle is the seller, not only a processor.** For its own buyers it is a controller of their data. The sign-in sends Paddle an address a parent typed, to find a purchase Paddle already holds. Is that a disclosure to a third party under the Rule, or support for internal operations? The plan names it as the open question (section 10).
2. **Turso's terms on the plan in use.** If no DPA is available on that plan, is its standard agreement enough, or should the service move to a plan that has one?
3. **Where each provider keeps the data** (US, EU, UK), for the privacy policy and for UK GDPR transfers.

## When to update this file

- A new provider, or a provider used for something new: a row here before it ships.
- Once a year with the security program's review: re-read each provider's terms and note any change.
