# Information security program: the household licence service (RankUp Chess)

**Status: DRAFT for the founder to adopt (written 25 October 2026, KL.8).** The COPPA Rule (16 CFR 312.8(b), as amended 22 April 2025) asks an operator to keep a written program with safeguards suited to its size and to the sensitivity of what it holds. It names a coordinator, a risk assessment at least once a year, safeguards for the risks found, regular testing and monitoring, and a yearly review. This is that program for the one Stillware service that handles a parent's email: the household licence functions in this repo and their database.

- **Coordinator:** the founder (Stillware Ltd), who runs and answers for the program.
- **Adopted:** `[FOUNDER: date]`.
- **First risk assessment:** at the release that turns the RankUp sign-in on (below). Then once a year.
- **Yearly review:** one year after adoption, and after any incident or any new kind of data.

## 1. What is protected

- **Data:** the records in `data-retention-policy.md`: keyed hashes of addresses, IPs and app user ids; salted code hashes; anonymous purchase records; signed household records.
- **Secrets:** `HOUSEHOLD_EMAIL_KEY` (the hashing key), `HOUSEHOLD_SIGNING_KEY` (the record's signing key), `TURSO_AUTH_TOKEN`, `RESEND_API_KEY`, `PADDLE_API_KEY`, `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_AUTH`.
- **In transit only (never stored):** the address a parent types, the code, the IP address of a request.

## 2. Risks, and the safeguard for each

| Risk | Safeguard | Where |
|---|---|---|
| Someone reads the database | No address is stored. Addresses, IPs and app user ids are HMAC-SHA-256 under `HOUSEHOLD_EMAIL_KEY`, which lives only in Netlify, so a copy of the database cannot be turned back into addresses. Codes are salted, hashed, expire in 10 minutes and work once | `lib/household-store.ts` |
| The hashing key is missing or weak | Fail closed: every email endpoint answers `500 server_misconfigured` and writes nothing if the key is missing or under 32 bytes | `lib/household-http.ts`, `parseEmailKey` |
| Guessing codes, or using the forms to find whose email is on file | 5 tries per code; 5 codes an hour per address; 20 requests an hour per IP; every `start` answers the same, padded to 1.5 s, with decoy codes | `lib/household.ts`, `lib/household-http.ts` |
| Addresses or IPs in logs | The functions never log an address, a code or an IP. A provider's error is logged by name, or by its message with the address and the code taken out (`failureText`), since a provider's error can quote the request. Tests pin the Paddle outage and the failed-mail lines | `lib/household.ts`; `tests/licence/signin.test.ts`, `consent.test.ts` |
| Data kept too long | The hourly purge and the retention table | `household-purge.ts`, `data-retention-policy.md` |
| A forged webhook | RevenueCat's `Authorization` header is checked in constant time; Paddle's webhook is signature-checked | `lib/revenuecat.ts`, `paddle-webhook` |
| A forged household record | Records are signed with Ed25519; the app checks the signature against keys built into it | KD-12 in the RankUp repo |
| Interception | HTTPS only (Netlify), `www` only | `netlify.toml` |
| A provider misuses data | Only the providers in `service-providers.md`, each under written terms; nothing is sent to anyone else | `service-providers.md` |
| Account takeover of a dashboard | Two-factor sign-in on every dashboard that reaches the data, the logs or the secrets. **Checked 25 October 2026 (read-only):** the Google account the founder signs in with has 2-Step Verification on (since 26 December 2025), which covers **Resend** and **Turso** (both sign in only through Google); **Netlify, Paddle and RevenueCat: off**, to turn on; **GitHub: not confirmed**. `[FOUNDER: confirm when all six are on]` | the dashboards |
| Too many people with access | Only the founder can read the database, the environment variables and the function logs | the dashboards |

**Data minimisation is a safeguard too:** the service asks for an email only when a grown-up chooses, keeps none for a sign-in, and never receives anything about a child.

## 3. Testing and monitoring

- **On every change:** `npm run test:licence` (the hashing, the fail-closed key, the limits, the notices, the confirmations, removal, the purge) and `npm run build` must pass before a merge.
- **Monthly:** the founder reads the household functions' logs in Netlify for errors and unusual volume (many `start` calls, many 429s), and checks that the purge ran (its hourly log line).
- **After any change to a provider:** re-read its terms (`service-providers.md`).

## 4. Incidents

1. Stop the leak: turn `HOUSEHOLD_ENABLED` off (one deploy); rotate the affected secret.
2. Rotating `HOUSEHOLD_EMAIL_KEY` makes every link unusable (they no longer match); delete `household_email_links` and tell families they can link again. Rotating the signing key needs an app release with the new public key (KD-12).
3. Within 72 hours: decide whether to notify the ICO (UK GDPR). Notify affected parents where the law requires it. US: check the FTC's guidance at the time.
4. Write down what happened, when, what was done, and what changes, and review this program.

## 5. The risk assessment (first one at release)

`[FOUNDER: date]`. Read section 2 against the service as deployed: is each safeguard in place, is any new risk missing, does the access list hold? Record the answer and any change here, with the date.
