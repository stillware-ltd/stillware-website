import { DEFAULT_LEGACY_ENTITLEMENT } from "./revenuecat-lookup.js";

// Settings of the household licence server (KL.2). Read from the environment on every request,
// never at import time, so a test can set them per case and a flag that is off costs nothing.

export type Env = Record<string, string | undefined>;

/** The household cap when HOUSEHOLD_DEVICE_CAP is unset or not a positive whole number. KD-13 may change it. */
export const DEFAULT_DEVICE_CAP = 10;

/** A sign-in or link code works for this long. */
export const CODE_TTL_MINUTES = 10;

/** Wrong guesses allowed per code. */
export const MAX_TRIES = 5;

/** Codes mailed per address per hour (sign-in and link together). */
export const CODES_PER_EMAIL_PER_HOUR = 5;

/** Requests per IP address per hour to the four email-code endpoints. */
export const REQUESTS_PER_IP_PER_HOUR = 20;

/** RevenueCat lookups per app user id per hour (an earlier buyer's first `fetch`), so a loop cannot hammer RevenueCat. */
export const LEGACY_LOOKUPS_PER_ID_PER_HOUR = 3;

/**
 * The /start endpoints take at least this long to answer, so an address that gets a mail (a
 * Paddle lookup, a database write and a send) cannot be told from one that gets nothing by
 * how long the answer takes. A real one is about 0.5-1.2 s; this is a little above.
 */
export const START_MIN_MS = 1500;

export interface HouseholdSettings {
  /** HOUSEHOLD_ENABLED === "1". Anything else, or unset, is off. */
  enabled: boolean;
  /** Devices per licence (HOUSEHOLD_DEVICE_CAP). */
  deviceCap: number;
  /**
   * HOUSEHOLD_UPGRADE_BEFORE, YYYY-MM-DD, the switch date: an earlier buyer is upgraded free to
   * Every device (record `via: "upgrade"`). That is a RankUp Paddle licence created before it, or
   * a store purchase of the legacy entitlement first bought before it (found through RevenueCat's
   * REST API on the first `fetch`). Unset: nobody is upgraded, and RevenueCat is never asked.
   */
  upgradeBefore: string | null;
  /** HOUSEHOLD_LEGACY_ENTITLEMENT: the RevenueCat entitlement of the One platform purchase. */
  legacyEntitlement: string;
}

export function householdSettings(env: Env): HouseholdSettings {
  const cap = Number(env.HOUSEHOLD_DEVICE_CAP);
  const upgradeBefore = (env.HOUSEHOLD_UPGRADE_BEFORE ?? "").trim();
  return {
    legacyEntitlement: (env.HOUSEHOLD_LEGACY_ENTITLEMENT ?? "").trim() || DEFAULT_LEGACY_ENTITLEMENT,
    enabled: env.HOUSEHOLD_ENABLED === "1",
    deviceCap: Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_DEVICE_CAP,
    upgradeBefore: /^\d{4}-\d{2}-\d{2}$/.test(upgradeBefore) ? upgradeBefore : null,
  };
}
