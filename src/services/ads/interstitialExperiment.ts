// The interstitial experiment's pure decision logic and its persisted state. No
// SDK, no network, no React - interstitialController.ts is the only caller, and the
// tests drive this directly.
//
// Three things live here:
//   1. Assignment - a stable hash of the persisted installationId into 10,000
//      buckets. Deterministic, and monotonic as the rollout grows.
//   2. Cadence - `eligibleGamesSinceLastOpportunity`, persisted, advanced ONLY by a
//      completed eligible game. Never lifetime-total modulo cadence.
//   3. The per-session opportunity count and the continuation marker.

import {
  INTERSTITIAL_MAX_ROLLOUT_PERCENT,
  isInterstitialArm,
  isInterstitialCadence,
  isInterstitialOutcome,
  type InterstitialArm,
  type InterstitialAssignment,
  type InterstitialCadence,
  type InterstitialOutcome,
} from "./interstitialConfigSchema";

// --- Assignment ---------------------------------------------------------------------

const BUCKETS = 10_000;
const BUCKETS_PER_PERCENT = BUCKETS / 100;
/** Changing the salt re-randomizes every installation - only ever for a NEW experiment. */
const ASSIGNMENT_SALT = "cydi-interstitial-v1";

/** FNV-1a (32-bit). Not cryptographic, and does not need to be: it only has to spread ids evenly and never change. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function assignmentBucket(installationId: string): number {
  return fnv1a(`${ASSIGNMENT_SALT}:${installationId}`) % BUCKETS;
}

/**
 * Treatment = [0, p), control = [50%, 50% + p). Raising p only ever ADDS buckets to
 * both ranges, so 5 -> 20 -> 50 keeps every installation already selected, in the
 * same arm, and the two arms are always the same size. Everything else is
 * "unassigned" and takes no part at all.
 *
 * A null id (no stable persisted installationId) is always unassigned: an id that
 * changes on every launch would move the same person between arms.
 */
export function assignArm(installationId: string | null, rolloutPercent: number): InterstitialAssignment {
  if (installationId === null) return "unassigned";
  const percent = Math.max(0, Math.min(INTERSTITIAL_MAX_ROLLOUT_PERCENT, Math.floor(rolloutPercent)));
  const width = percent * BUCKETS_PER_PERCENT;
  const bucket = assignmentBucket(installationId);
  if (bucket < width) return "treatment";
  const controlStart = INTERSTITIAL_MAX_ROLLOUT_PERCENT * BUCKETS_PER_PERCENT;
  if (bucket >= controlStart && bucket < controlStart + width) return "control";
  return "unassigned";
}

// --- Persisted state ----------------------------------------------------------------

export const INTERSTITIAL_STATE_KEY = "cydi.interstitial.v1";

/** Written synchronously BEFORE navigation, consumed by the next eligible game_started. No opportunity id - nothing high-cardinality. */
export type ContinuationMarker = {
  sessionId: string;
  arm: InterstitialArm;
  outcome: InterstitialOutcome;
  gamesBetweenAds: InterstitialCadence;
};

export type InterstitialPersistedState = {
  eligibleGamesSinceLastOpportunity: number;
  /** Opportunities consumed in `sessionId`. A different current session means zero. */
  session: { sessionId: string; opportunities: number } | null;
  marker: ContinuationMarker | null;
};

const EMPTY_STATE: InterstitialPersistedState = { eligibleGamesSinceLastOpportunity: 0, session: null, marker: null };

/** Kept well above any cadence; only here so a corrupt value can never become a huge number. */
const MAX_SINCE_LAST = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMarker(value: unknown): ContinuationMarker | null {
  if (!isRecord(value)) return null;
  const { sessionId, arm, outcome, gamesBetweenAds } = value;
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 32) return null;
  if (!isInterstitialArm(arm) || !isInterstitialOutcome(outcome) || !isInterstitialCadence(gamesBetweenAds)) return null;
  return { sessionId, arm, outcome, gamesBetweenAds };
}

/** Tolerant parse: every field falls back independently, so one corrupt field never resets the others. */
export function parseInterstitialState(raw: string | null): InterstitialPersistedState {
  if (raw === null) return { ...EMPTY_STATE };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_STATE };
  }
  if (!isRecord(parsed)) return { ...EMPTY_STATE };
  const since = parsed.eligibleGamesSinceLastOpportunity;
  const session = parsed.session;
  return {
    eligibleGamesSinceLastOpportunity:
      typeof since === "number" && Number.isInteger(since) && since >= 0 ? Math.min(since, MAX_SINCE_LAST) : 0,
    session:
      isRecord(session) &&
      typeof session.sessionId === "string" &&
      typeof session.opportunities === "number" &&
      Number.isInteger(session.opportunities) &&
      session.opportunities >= 0
        ? { sessionId: session.sessionId, opportunities: session.opportunities }
        : null,
    marker: parseMarker(parsed.marker),
  };
}

export type InterstitialStorage = {
  read(): string | null;
  /** Synchronous; returns false when the write did not persist. */
  write(value: string): boolean;
};

export const localInterstitialStorage: InterstitialStorage = {
  read() {
    try {
      return localStorage.getItem(INTERSTITIAL_STATE_KEY);
    } catch {
      return null;
    }
  },
  write(value) {
    try {
      localStorage.setItem(INTERSTITIAL_STATE_KEY, value);
      return true;
    } catch {
      return false;
    }
  },
};

export function loadState(storage: InterstitialStorage): InterstitialPersistedState {
  return parseInterstitialState(storage.read());
}

export function saveState(storage: InterstitialStorage, state: InterstitialPersistedState): boolean {
  return storage.write(JSON.stringify(state));
}

export function opportunitiesInSession(state: InterstitialPersistedState, sessionId: string): number {
  return state.session?.sessionId === sessionId ? state.session.opportunities : 0;
}

// --- Cadence ------------------------------------------------------------------------

export type CompletionDecision = {
  state: InterstitialPersistedState;
  /** The checkpoint of THIS result cycle may consume an opportunity. */
  due: boolean;
  /** Treatment should warm an ad for the upcoming opportunity (if it has not already tried). */
  preload: boolean;
};

/**
 * One completed eligible game. The ONLY thing that advances the cadence, and the
 * only thing that can make an opportunity due - so an app open, a config fetch, a
 * cold start or a new session cannot create one by themselves.
 *
 * `cadence` is read from the run's frozen config at the moment of the completion,
 * against the PERSISTED progress, so a remote change keeps whatever progress exists:
 *   7 -> 10 with 6 done: the 7th completion is 7 < 10, three more are needed after it.
 *   10 -> 5 with 8 done: nothing happens at startup; the next completion (9 >= 5) is due.
 */
export function recordEligibleCompletion(
  state: InterstitialPersistedState,
  cadence: InterstitialCadence,
  sessionCap: number,
  sessionId: string,
  arm: InterstitialArm,
): CompletionDecision {
  const since = Math.min(state.eligibleGamesSinceLastOpportunity + 1, MAX_SINCE_LAST);
  const next: InterstitialPersistedState = { ...state, eligibleGamesSinceLastOpportunity: since };
  const sessionOpen = opportunitiesInSession(next, sessionId) < sessionCap;
  return {
    state: next,
    due: sessionOpen && since >= cadence,
    // From cadence-1 on: the preferred trigger is exactly cadence-1 (the ad loads while
    // the next game is played); being already at/over cadence covers a run that
    // started past that point, so the upcoming opportunity still gets its one attempt.
    preload: arm === "treatment" && sessionOpen && since >= cadence - 1,
  };
}

/** Consume one opportunity (every outcome does): the counter restarts and the session count rises. */
export function consumeOpportunity(state: InterstitialPersistedState, sessionId: string): InterstitialPersistedState {
  return {
    ...state,
    eligibleGamesSinceLastOpportunity: 0,
    session: { sessionId, opportunities: opportunitiesInSession(state, sessionId) + 1 },
  };
}
