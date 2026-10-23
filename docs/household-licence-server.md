# Household licence server ("Every device"), KL.2

The server side of the household licence. The contract it builds is `docs/household-licence.md` in the RankUp Chess repo (§3 the signature, §4 the record, §5 the endpoints). Everything here is dark: until `HOUSEHOLD_ENABLED` is `1`, the five endpoints answer `404 {"error":"off"}` and nothing about today's licences changes.

Code: `netlify/functions/household-*.ts`, `revenuecat-webhook.ts`, and `netlify/functions/lib/household*.ts`, `revenuecat.ts`, `paddle-licence.ts`, `paddle-lookup.ts`. Tests: `npm run test:licence`.

## Endpoints

All are `POST` JSON at `https://www.stillwareltd.com/api/household/...` (www only, as `netlify.toml` explains). Each takes `product` (`rankup` today; any other value is `400 unknown_product`).

| URL | In | Out |
|---|---|---|
| `/api/household/fetch` | `product`, `appUserId`, `platform` | 200 the record; 404 `none` |
| `/api/household/signin/start` | `product`, `email` | always 200 `{"ok":true}`; a code is mailed only when a purchase matches |
| `/api/household/signin/verify` | `product`, `email`, `code`, `platform` | 200 the record; 400 `wrong_code` (+ `triesLeft`), `expired`, `too_many_tries`; 404 `none`; 409 `device_cap` |
| `/api/household/link/start` | `product`, `appUserId`, `email` | always 200 `{"ok":true}`; a code is mailed only when the app user id owns an Every device purchase |
| `/api/household/link/verify` | `product`, `appUserId`, `email`, `code` | 200 `{"linked":true}`; the same errors as `signin/verify` except `device_cap` |

Other answers: `400 bad_request` or `bad_email` (a field is missing or malformed), `405` (not POST), `429 rate_limited` (the IP limit), `500 server_misconfigured` (the signing key is missing or unusable).

The record on the wire is `{"record": {...}, "kid": "...", "sig": "<base64url, no padding>"}`. `license-activate` carries the same object as `household` in its answer when the licence is Every device.

`POST /webhooks/revenuecat` is RevenueCat's webhook (see below).

## How a household gets a record

| Who | How | `via` |
|---|---|---|
| Store buyer, same app user id | RevenueCat tells `revenuecat-webhook` about the purchase; the app calls `fetch` | `app_store`, `play` |
| Store buyer, another device | `link/start` + `link/verify` link an address once; `signin/start` + `signin/verify` then work on any device | `app_store`, `play` |
| Paddle buyer of an Every device price | `paddle-webhook` tags the licence `tier = 'every_device'`; the buyer signs in with the address Paddle holds, or activates the key | `paddle` |
| Earlier Paddle buyer | free upgrade: any RankUp Paddle licence created before `HOUSEHOLD_UPGRADE_BEFORE` | `upgrade` |

The sign-in finds Paddle purchases by asking Paddle (as `license-resend-key` does). The server stores no buyer address: a linked address is kept only as a SHA-256 of the lower-cased, trimmed text.

## Environment variables

Set in Netlify (never in the repository). A changed variable reaches functions with the next deploy.

| Variable | Needed for | Notes |
|---|---|---|
| `HOUSEHOLD_ENABLED` | the switch | `1` is on. Anything else, or unset, is off. |
| `HOUSEHOLD_SIGNING_KEY` | signing | Ed25519 private key, PKCS#8 DER, base64. A PEM also works. |
| `HOUSEHOLD_SIGNING_KID` | signing | The key id the app holds the public key under, for example `rk-2026-1`. |
| `HOUSEHOLD_DEVICE_CAP` | optional | Devices per licence. Default 10 (KD-13). Also the desktop activations of an Every device licence. |
| `HOUSEHOLD_UPGRADE_BEFORE` | optional | `YYYY-MM-DD`, the switch date. RankUp Paddle licences created before it count as Every device (`upgrade`). Unset: nobody is upgraded. |
| `REVENUECAT_WEBHOOK_AUTH` | the webhook | The exact `Authorization` header value RevenueCat sends, for example `Bearer <long random string>`. Unset: the webhook answers 500 and accepts nothing. |

Already set for the licence server and used here: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (optional), `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`.

Make a key pair on your own machine (the private key goes straight into Netlify; the public key goes into the app's `licence_keys.dart` under the same `kid`):

```
node -e "const c=require('node:crypto');const k=c.generateKeyPairSync('ed25519');console.log('private (HOUSEHOLD_SIGNING_KEY):',k.privateKey.export({type:'pkcs8',format:'der'}).toString('base64'));console.log('public (raw 32 bytes, base64):',k.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64'))"
```

Rotation: set the new key and a new `kid`, and add the new public key to the app. The server signs under the new `kid` from then on (a record is kept per licence and `kid`); older records keep verifying in the app unless it lists their `kid` as revoked.

## What the founder fills in at KL.3

In `netlify/functions/lib/products.ts`, both lists are empty on purpose:

- `EVERY_DEVICE_STORE_PRODUCT_IDS`: the RevenueCat product ids of **Every device** and **Every device upgrade** (App Store and Play), each mapped to `"rankup"`. Do not list the One platform product.
- `EVERY_DEVICE_PADDLE_PRICE_IDS`: the Paddle price id of Every device. Also add it to `PRICE_ID_TO_PRODUCT` (the webhook refuses an unknown price) and do not add it to `PRICE_ID_TO_PLATFORM`.

In RevenueCat: add a webhook to `https://www.stillwareltd.com/webhooks/revenuecat` with the authorization header value you set as `REVENUECAT_WEBHOOK_AUTH`.

## The RevenueCat webhook

Not behind the flag: it is the ledger of what was bought, and it writes only for product ids in the list above. It answers 401 to a missing or wrong `Authorization` header (constant-time compare), and 200 to everything it handles or ignores.

- `NON_RENEWING_PURCHASE`, `INITIAL_PURCHASE` for a listed product: records app user id, product id, store, purchase date (UTC), transaction id and environment. Sandbox purchases are recorded too (marked `SANDBOX`). The same transaction twice is recorded once.
- Refund (`CANCELLATION` with `cancel_reason` `CUSTOMER_SUPPORT`, or a `REFUND` event): the entitlement is revoked. No new record, sign-in or link for it. Records already issued stay valid.
- `TRANSFER`: the entitlements (and linked addresses) of the `transferred_from` ids move to `transferred_to`.
- Anything else: ignored, 200.

## Tables

Created on first use by `lib/household-store.ts`, and written out in `lib/schema.sql` (a test keeps the two equal). `licenses` gains a `tier` column the same way (`every_device` or NULL).

`household_store_entitlements`, `household_email_links`, `household_codes` (salted hash, expiry, tries, single use), `household_issued` (the exact signed text and signature, per licence and `kid`), `household_devices` (sign-ins per licence), `household_hits` (rate-limit hits, hashed address and hashed IP, about two hours).

## Limits

- 5 codes an hour per address (sign-in and link together). Past that, `start` still answers 200 and sends nothing.
- 20 requests an hour per IP to the four email-code endpoints. Past that, 429. `fetch` is not counted.
- 5 tries per code; the fifth wrong one uses the code up. A code lasts 10 minutes and works once.
- The household cap: each successful `signin/verify` counts one device for the licence (no device id is sent). At the cap, 409 `device_cap`. To give a family room: `UPDATE household_devices SET devices = 0 WHERE lid = '<lid>'` (the `lid` is in the record they hold).
- An address with no purchase gets the same answer as one with a purchase, and a stored code that can never match, so trying codes tells nothing. `start` also takes at least 1.5 s to answer, whatever it did.

## Rollback

To stop issuing records: unset `HOUSEHOLD_ENABLED` (or set it to anything but `1`) and redeploy. A deploy is metered, so this is one deploy.

What that does:
- `household-fetch`, `signin-start`, `signin-verify`, `link-start`, `link-verify` answer `404 {"error":"off"}`.
- `license-activate` stops returning `household` and goes back to the plain rules (the platform check, the licence's own activation limit).
- `paddle-webhook` still tags an Every device licence but no longer signs a record with it.
- `revenuecat-webhook` keeps recording and revoking (it signs nothing).

What stays valid:
- Every record already issued. The app checks the signature offline; there is no revocation list (the contract's honour-based rule), so a refund or a rollback does not take a record back.
- Every desktop key, store purchase and classroom key, which this change did not touch.
- All rows in the tables above. Nothing is deleted, so switching on again carries on where it stopped.

To go further back, revert the commit. The new tables and the `tier` column stay and do no harm. To stop one key (not just the feature), retire its `kid` in the app's key list and issue under a new one.

## Choices the contract left open

Drafted as KD-40 in the KL.2 report: `platform` is checked and not kept; `fetch` is not under the IP limit; the fifth wrong code answers `too_many_tries`; `link/start` mails only for an app user id that owns a purchase; a licence has one record per `kid`; the free upgrade of earlier buyers covers Paddle licences only; refunds are read as `CANCELLATION` with `CUSTOMER_SUPPORT`.
