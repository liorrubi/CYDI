// Shared wire format for the remote ads kill switch (worker/index.ts's
// GET/PUT /api/config/ads), used by both the client (remoteKillSwitch.ts) and the
// Worker - same "shared, dependency-free schema module" pattern as
// analyticsSchema.ts/catalogSchema.ts. No import.meta.env, no browser APIs, so the
// Worker and plain-Node tests can import it directly.
//
// Deliberately NOT part of catalogSchema.ts/CONTENT_KV's content-release concept -
// this is an unrelated, much simpler piece of config (one boolean) that happens to
// reuse the same KV namespace and admin token as an operational convenience, not
// because it IS a content release.

export const ADS_CONFIG_KV_KEY = "config:ads";

export type RemoteAdsConfig = { enabled: boolean };

/** Strict, all-or-nothing validation: exactly one key, `enabled`, and it must be a boolean. */
export function isValidRemoteAdsConfig(value: unknown): value is RemoteAdsConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>).enabled === "boolean"
  );
}

/** Parses raw JSON text (KV value or HTTP body) and validates it, without ever throwing. Returns null on any failure. */
export function parseRemoteAdsConfig(raw: string): RemoteAdsConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isValidRemoteAdsConfig(parsed) ? parsed : null;
}
