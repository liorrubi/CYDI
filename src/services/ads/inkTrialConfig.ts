// Client side of the Rewarded Ink Trial remote config (0.58.0+). The value rides the existing
// `GET /api/config/ads/interstitial?v=3` answer as its own top-level `ink` key (no extra request); this module
// observes that answer and parses ONLY `ink`, with its own validator (inkTrialConfigSchema.ts).
//
// Independent by construction: nothing here reads the interstitial base, its experiment, cadence, cap, rollout or
// cells, and the interstitial modules never read this one.
//
// FAIL-CLOSED: before any answer, after a 404, or with a missing/invalid `ink`, no NEW Ink offer is made anywhere.
// Trials already granted keep running whatever this says (inkTrialStore.ts) - turning Ink off stops offers, never
// takes back what a player earned.
//
// LIVE, not frozen: the latest answer always applies, so a switch-off reaches running apps on the next refresh
// (startup, and resume at most every 10 minutes - the interstitial config's own schedule).

import { getPersistedInstallationId, isQaBuild } from "../analyticsIdentity";
import { observeConfigBody } from "./interstitialConfig";
import {
  DEFAULT_CLASSIC_ROTATION,
  parseClientInkTrialConfig,
  type InkRotationSlot,
  type InkSurface,
  type InkTrialConfig,
} from "./inkTrialConfigSchema";

let liveConfig: InkTrialConfig | null = null;
/** Whether any config answer (with or without `ink`, or a 404) has arrived in this run. */
let answered = false;
let installationIdSource: () => string | null = () => getPersistedInstallationId();

/** Feeds this module from the v3 config answers. Called once at native startup, before the first refresh. */
export function installInkTrialConfigObserver(): void {
  observeConfigBody((body) => {
    const ink = body !== null && typeof body === "object" ? (body as Record<string, unknown>).ink : undefined;
    liveConfig = parseClientInkTrialConfig(ink);
    answered = true;
  });
}

/**
 * Has this run heard the server's answer yet? Before it, "OFF" only means "not known yet" - a caller holding
 * something for later (a post-session offer) keeps it rather than dropping it.
 */
export function hasInkConfigAnswer(): boolean {
  return answered || readQaOverride() !== undefined;
}

// --- QA / dev override ----------------------------------------------------------------

export const INK_TRIAL_QA_OVERRIDE_KEY = "cydi.qa.inkTrialConfig.v1";

/** Dev server only. `import.meta.env.DEV` is replaced at build time, so this is false in every production bundle. */
function isDevBuild(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

/**
 * A debuggable APK (Capacitor.DEBUG) or the dev server may replace the network answer with a JSON value under
 * INK_TRIAL_QA_OVERRIDE_KEY (the client config shape). A Play build can never honour it. Malformed = OFF.
 * Returns undefined when no override applies.
 */
function readQaOverride(): InkTrialConfig | null | undefined {
  if (!isQaBuild() && !isDevBuild()) return undefined;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(INK_TRIAL_QA_OVERRIDE_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    return parseClientInkTrialConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

// --- Reads ----------------------------------------------------------------------------

export function getInkTrialConfig(): InkTrialConfig | null {
  const qa = readQaOverride();
  return qa !== undefined ? qa : liveConfig;
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Ink's OWN installation bucket (salted, never the interstitial assignment). 0..99. */
export function inkRolloutBucket(installationId: string): number {
  return fnv1a(`ink-trial-v1:${installationId}`) % 100;
}

/** In the rollout: 100 = everyone (no id needed), 0 = no one, otherwise the stable bucket; no id = out. */
export function isInInkRollout(rolloutPercent: number, installationId: string | null): boolean {
  if (rolloutPercent >= 100) return true;
  if (rolloutPercent <= 0 || installationId === null) return false;
  return inkRolloutBucket(installationId) < rolloutPercent;
}

/** May a NEW Ink Trial be offered on this surface right now? (Config only - eligibility is inkTrialPolicy's job.) */
export function isInkOfferSurfaceOn(surface: InkSurface): boolean {
  const config = getInkTrialConfig();
  if (config === null || !config.enabled || !config.surfaces[surface]) return false;
  return isInInkRollout(config.rolloutPercent, installationIdSource());
}

/**
 * Does an ACTIVE Trial apply on this surface? Classic, Play Together and 2 Players always (a granted Trial is
 * honoured whatever the config says now). Daily only while the config enables the Daily surface (D6).
 */
export function doesActiveTrialApplyOn(surface: InkSurface): boolean {
  if (surface !== "daily") return true;
  const config = getInkTrialConfig();
  return config !== null && config.enabled && config.surfaces.daily;
}

/** The Classic coin/ink rotation (default 1:1 when no config answer is present). */
export function getClassicRotation(): readonly InkRotationSlot[] {
  return getInkTrialConfig()?.classicRotation ?? DEFAULT_CLASSIC_ROTATION;
}

export function _resetInkTrialConfigForTests(options: { config?: InkTrialConfig | null; installationId?: string | null } = {}): void {
  liveConfig = options.config ?? null;
  answered = options.config !== undefined;
  const id = options.installationId === undefined ? "test-installation" : options.installationId;
  installationIdSource = () => id;
}
