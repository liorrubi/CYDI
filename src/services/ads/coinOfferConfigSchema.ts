// Shared wire format for the 0.59.0 coin-offer remote flags, used by the client (coinOfferConfig.ts) and the
// Worker (PUT /api/config/ads/coin, and the `coin` key of the `GET /api/config/ads/interstitial?v=3` body).
// Same "shared, dependency-free schema module" rule as inkTrialConfigSchema.ts: no imports, no browser APIs.
//
// Two switches, one object:
//   runX3     - the Classic coin-offer A/B: half of installations get "x3run" (×3 of the run since the last offer,
//               min +50 at most 3 times a day, max +400), the other half the current "x3". OFF = everyone "x3".
//   unlockNow - Category "Unlock Now": one loaded rewarded ad pays the exact shortfall (max 250) and unlocks.
//
// ABSENT = OFF. A missing, unreadable or invalid value means both switches are off, i.e. exactly the 0.58 behaviour.
// Its own KV key: it never touches the interstitial config, its experiment or the Ink Trial config.

export const COIN_OFFER_KV_KEY = "config:ads:coin";

export type CoinOfferConfig = {
  /** Bumped by the operator on any change; kept for audits. */
  version: number;
  runX3: boolean;
  unlockNow: boolean;
};

const KEYS = ["version", "runX3", "unlockNow"] as const;
const MAX_VERSION = 1_000_000;

/** Exactly the three keys, each of the right type - anything else is invalid (a typo must not silently switch off). */
export function isValidStoredCoinOfferConfig(value: unknown): value is CoinOfferConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length !== KEYS.length || !KEYS.every((k) => keys.includes(k))) return false;
  return (
    typeof v.version === "number" &&
    Number.isInteger(v.version) &&
    v.version >= 1 &&
    v.version <= MAX_VERSION &&
    typeof v.runX3 === "boolean" &&
    typeof v.unlockNow === "boolean"
  );
}

/** A stored KV string -> the config, or null (absent/invalid = OFF). Never throws. */
export function parseStoredCoinOfferConfig(raw: string): CoinOfferConfig | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidStoredCoinOfferConfig(parsed) ? { version: parsed.version, runX3: parsed.runX3, unlockNow: parsed.unlockNow } : null;
  } catch {
    return null;
  }
}

/** The `coin` key of a v3 answer -> the config, or null (absent/invalid = OFF). Never throws. */
export function parseClientCoinOfferConfig(value: unknown): CoinOfferConfig | null {
  return isValidStoredCoinOfferConfig(value) ? { version: value.version, runX3: value.runX3, unlockNow: value.unlockNow } : null;
}
