// Shared wire format for the Rewarded Ink Trial remote config (0.58.0+), used by the client
// (inkTrialConfig.ts) and the Worker (PUT /api/config/ads/ink, and the `ink` key of the
// `GET /api/config/ads/interstitial?v=3` body). Same "shared, dependency-free schema module" rule
// as interstitialConfigSchema.ts: no imports, no import.meta.env, no browser APIs.
//
// INDEPENDENT of the interstitial config and of its experiment: its own KV key, its own validator,
// its own top-level key in the v3 body. It only RIDES the v3 response so no new request exists.
// Nothing here reads, or is read by, the interstitial cadence / cap / rollout / cells.
//
// ABSENT = OFF. A missing, unreadable or invalid value means "no new Ink offers anywhere"; Trials
// already granted keep running (that is the client's rule, see inkTrialStore.ts).

export const INK_TRIAL_KV_KEY = "config:ads:ink";

/** Where an Ink Trial can be OFFERED (and, for Daily, where an active Trial applies at all). */
export const INK_SURFACES = ["classic", "playTogether", "twoPlayers", "daily"] as const;
export type InkSurface = (typeof INK_SURFACES)[number];

/** What one legal Classic Rewarded opportunity carries, in the rotation's own words. */
export const INK_ROTATION_SLOTS = ["coin", "ink"] as const;
export type InkRotationSlot = (typeof INK_ROTATION_SLOTS)[number];

/** The rotation is a short, explicit cycle: ["coin","ink"] = 1:1, ["coin","coin","ink"] = 2:1. */
export const INK_ROTATION_MIN_LENGTH = 1;
export const INK_ROTATION_MAX_LENGTH = 6;
export const DEFAULT_CLASSIC_ROTATION: readonly InkRotationSlot[] = ["coin", "ink"];

export type InkTrialConfig = {
  enabled: boolean;
  /** Bumped by the operator on any change; reported nowhere today, kept for audits. */
  version: number;
  /** 0..100, an installation-stable bucket of its own (never the interstitial's). 100 = everyone. */
  rolloutPercent: number;
  /** Per-mode switches. A surface missing from a CLIENT answer is OFF. */
  surfaces: Record<InkSurface, boolean>;
  classicRotation: InkRotationSlot[];
};

const REQUIRED_KEYS = ["enabled", "version", "rolloutPercent", "surfaces", "classicRotation"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function isInkSurface(value: unknown): value is InkSurface {
  return typeof value === "string" && (INK_SURFACES as readonly string[]).includes(value);
}

export function isInkRotationSlot(value: unknown): value is InkRotationSlot {
  return typeof value === "string" && (INK_ROTATION_SLOTS as readonly string[]).includes(value);
}

function isValidRotation(value: unknown): value is InkRotationSlot[] {
  return (
    Array.isArray(value) &&
    value.length >= INK_ROTATION_MIN_LENGTH &&
    value.length <= INK_ROTATION_MAX_LENGTH &&
    value.every(isInkRotationSlot)
  );
}

/**
 * The STORED object (admin PUT): strict. Exactly the five keys, `surfaces` exactly the four modes,
 * every value in range. A typo can never be stored.
 */
export function isValidStoredInkTrialConfig(value: unknown): value is InkTrialConfig {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== REQUIRED_KEYS.length || !REQUIRED_KEYS.every((k) => keys.includes(k))) return false;
  if (typeof value.enabled !== "boolean") return false;
  if (!isIntInRange(value.version, 1, 1_000_000) || !isIntInRange(value.rolloutPercent, 0, 100)) return false;
  if (!isValidRotation(value.classicRotation)) return false;
  const surfaces = value.surfaces;
  if (!isRecord(surfaces)) return false;
  const surfaceKeys = Object.keys(surfaces);
  if (surfaceKeys.length !== INK_SURFACES.length || !INK_SURFACES.every((s) => typeof surfaces[s] === "boolean")) return false;
  return true;
}

/** Worker side: the stored text -> a valid config, or null (absent, unparseable or invalid all mean OFF). */
export function parseStoredInkTrialConfig(raw: string): InkTrialConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isValidStoredInkTrialConfig(parsed) ? parsed : null;
}

/**
 * Client side: the `ink` value of a v3 body -> a config, or null (= Ink OFF). Tolerant of UNKNOWN keys (at the
 * top level and inside `surfaces`), so a later Worker can add a knob without switching this build off; strict
 * about every KNOWN key, so a malformed value is OFF rather than half-applied. A surface the answer does not
 * name is OFF. Never throws.
 */
export function parseClientInkTrialConfig(value: unknown): InkTrialConfig | null {
  if (!isRecord(value)) return null;
  if (typeof value.enabled !== "boolean") return null;
  if (!isIntInRange(value.version, 1, 1_000_000) || !isIntInRange(value.rolloutPercent, 0, 100)) return null;
  if (!isValidRotation(value.classicRotation)) return null;
  if (!isRecord(value.surfaces)) return null;
  const rawSurfaces = value.surfaces;
  const surfaces = {} as Record<InkSurface, boolean>;
  for (const surface of INK_SURFACES) {
    const flag = rawSurfaces[surface];
    if (flag !== undefined && typeof flag !== "boolean") return null;
    surfaces[surface] = flag === true;
  }
  return {
    enabled: value.enabled,
    version: value.version,
    rolloutPercent: value.rolloutPercent,
    surfaces,
    classicRotation: [...value.classicRotation],
  };
}
