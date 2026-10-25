# Data retention policy: the household licence service (RankUp Chess)

**Status: DRAFT for the founder to adopt (written 25 October 2026, KL.8).** The COPPA Rule (16 CFR 312.10, as amended 22 April 2025) asks for a written policy that says why children's personal information is collected, the business need to keep it, and when it is deleted, and it forbids keeping it indefinitely. The policy's summary is printed in the privacy policy (`/privacy/`, RankUp section, "How Long We Keep It").

- **Owner:** the founder (Stillware Ltd).
- **Adopted:** `[FOUNDER: date]`.
- **Next review:** one year after adoption, and whenever the service starts keeping something new.
- **Where it is enforced:** `netlify/functions/household-purge.ts` (hourly, at 17 minutes past), `lib/household-store.ts` and `lib/household-config.ts`. The tests in `tests/licence/purge.test.ts` and `consent.test.ts` hold the figures.

## What the service holds, and for how long

RankUp Chess is directed to children, so the service treats an email typed into the app as if a child might have typed it. It never holds an email address in the clear.

| Record | Why it is collected | Why it is kept | Deleted |
|---|---|---|---|
| **A code request** (`household_codes`): a keyed hash of the address, a salted hash of the code, tries, times | To send and check a sign-in, link or removal code | Only while the code can be used (10 minutes, once) | Within 25 hours of the code no longer working: the hourly run deletes rows 24 hours after that. Also for an address that matched nothing (a decoy) |
| **A rate-limit hit** (`household_hits`): a keyed hash of an address, an IP address or an app user id, and a time | To stop abuse (5 codes an hour per address, 20 requests an hour per IP) | They count for 1 hour | Within 25 hours |
| **A linked email** (`household_email_links`): a keyed hash of the address, the app user id, the notice version agreed to, the consent time, the last sign-in | A parent chose to link it, so the family can sign in on another device | So that sign-in keeps working | **730 days after the last sign-in** (or the linking, if never used); **at once** when the family removes it (in the app or through support); **at once** when its purchase is refunded and the household has none left; and by the hourly run when its purchase is gone |
| **A store purchase** (`household_store_entitlements`): app user id, product, store, purchase date, transaction id, sandbox or not, revoked or not | RevenueCat's webhook records an Every device purchase | It is the purchase: it lets a family restore it | **Active:** while RankUp Chess is sold, and up to 12 months after it is withdrawn. **Refunded:** 395 days (13 months) after the refund, for disputes and chargebacks. **On request:** at once, after telling the person what it means |
| **An issued record and its device count** (`household_issued`, `household_devices`) | The signed record a device keeps, and the sign-ins counted against the cap | As long as its purchase | With its purchase (above) |
| **A cached price** (`household_price_cache`) | Public prices for a country; no visitor data | Used for 1 hour | Within 25 hours |

**Not held here:** a website (Paddle) buyer's address. Paddle holds it as the merchant of record, and the sign-in asks Paddle without copying it. Resend keeps its own delivery records of the emails it sends for the service, under its own terms (`service-providers.md`).

## Rules

1. Nothing is kept "just in case". A new kind of record needs a row in this table before it ships.
2. Deletion is automatic where the table says so. The hourly run also works while `HOUSEHOLD_ENABLED` is off.
3. A request to delete is answered within 30 days. The steps are in `docs/household-licence-server.md`, "Delete a family's linked email". The reply says what was deleted and when.
4. Backups: `[FOUNDER: Turso's point-in-time restore window for the plan in use]`. A deleted row can survive in a backup until that window passes; it is never restored into the live database except to recover from a fault, and then the purge runs again before the service reopens.
5. A change to a figure here changes the privacy policy in the same deploy, and `NOTICE_VERSION` in `lib/household-config.ts` when it changes what a parent agreed to.

## The founder's open choices (F3)

- 730 days for a link after its last sign-in (the plan's D5).
- 13 months for a refunded purchase; active purchases while sold plus 12 months (D6).
- Whether to delete an active purchase record on request, knowing the household then cannot restore on another device.
