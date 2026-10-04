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
  INTERSTITIAL_MAX_ROLLOUT_PERCENT_V2,
  isInterstitialArm,
  isEffectiveInterstitialCadence,
  isInterstitialOutcome,
  type InterstitialArm,
  type InterstitialAssignment,
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

/**
 * The one bucketing primitive: fnv1a(`${salt}:${id}`) mod 10,000. Every salted bucket in the
 * interstitial experiments (arm, second opportunity, cell gate, cell pick) goes through it, and
 * assignmentBucket() below is pinned bit-identical by a regression test - a live installation's
 * arm must never move.
 */
export function stableBucket(salt: string, id: string): number {
  return fnv1a(`${salt}:${id}`) % BUCKETS;
}

export function assignmentBucket(installationId: string): number {
  return stableBucket(ASSIGNMENT_SALT, installationId);
}

/**
 * Treatment = [0, p), control = [50%, 50% + p). Raising p only ever ADDS buckets to
 * both ranges, so 5 -> 20 -> 50 keeps every installation already selected, in the
 * same arm, and the two arms are always the same size. Everything else is
 * "unassigned" and takes no part at all.
 *
 * Above 50 (0.56+, the full 0-100 range) the holdback shrinks instead of growing: treatment
 * is [0, p) and control the remainder [p, 100%), so at 100 everyone is in treatment and no
 * control remains. It continues the p = 50 split exactly (treatment [0, 50), control
 * [50, 100)); installations in [50, p) move from control to treatment as p rises, which is
 * the point of rolling the experiment out. 50 or below behaves exactly as before.
 *
 * A null id (no stable persisted installationId) is always unassigned: an id that
 * changes on every launch would move the same person between arms.
 */
export function assignArm(installationId: string | null, rolloutPercent: number): InterstitialAssignment {
  if (installationId === null) return "unassigned";
  const percent = Math.max(0, Math.min(INTERSTITIAL_MAX_ROLLOUT_PERCENT_V2, Math.floor(rolloutPercent)));
  const width = percent * BUCKETS_PER_PERCENT;
  const bucket = assignmentBucket(installationId);
  if (bucket < width) return "treatment";
  const controlStart = INTERSTITIAL_MAX_ROLLOUT_PERCENT * BUCKETS_PER_PERCENT;
  if (percent <= INTERSTITIAL_MAX_ROLLOUT_PERCENT) {
    if (bucket >= controlStart && bucket < controlStart + width) return "control";
    return "unassigned";
  }
  return bucket >= width ? "control" : "unassigned";
}

// --- Second opportunity ---------------------------------------------------------------

/** Independent of the arm hash, so each arm gets the same share of second-opportunity installations. */
const SECOND_OPPORTUNITY_SALT = "cydi-interstitial-second-v1";

/**
 * Whether this installation may have a SECOND (or later) opportunity in a session, for a
 * `secondOpportunityRolloutPercent` of 0-100. Stable per installation and monotonic as the
 * percentage grows. The first opportunity of a session is never gated by this.
 */
export function isSecondOpportunityEligible(installationId: string | null, percent: number): boolean {
  if (percent >= 100) return true;
  if (installationId === null || percent <= 0) return false;
  const bucket = stableBucket(SECOND_OPPORTUNITY_SALT, installationId);
  return bucket < Math.floor(percent) * BUCKETS_PER_PERCENT;
}

// --- Persisted state ----------------------------------------------------------------

export const INTERSTITIAL_STATE_KEY = "cydi.interstitial.v1";

/** Written synchronously BEFORE navigation, consumed by the next eligible game_started. No opportunity id - nothing high-cardinality. */
export type ContinuationMarker = {
  sessionId: string;
  arm: InterstitialArm;
  outcome: InterstitialOutcome;
  /** The EFFECTIVE cadence of the session (any integer 3..20). */
  gamesBetweenAds: number;
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
  if (!isInterstitialArm(arm) || !isInterstitialOutcome(outcome) || !isEffectiveInterstitialCadence(gamesBetweenAds)) return null;
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
  cadence: number,
  sessionCap: number,
  sessionId: string,
  arm: InterstitialArm,
  secondOpportunityEligible = true,
): CompletionDecision {
  const since = Math.min(state.eligibleGamesSinceLastOpportunity + 1, MAX_SINCE_LAST);
  const next: InterstitialPersistedState = { ...state, eligibleGamesSinceLastOpportunity: since };
  const used = opportunitiesInSession(next, sessionId);
  // The session cap, and - past the first opportunity - the second-opportunity rollout.
  const sessionOpen = used < sessionCap && (used === 0 || secondOpportunityEligible);
  return {
    state: next,
    due: sessionOpen && since >= cadence,
    // From cadence-2 on: attempt 1 at cadence-2, the retry opportunity at cadence-1, the
    // checkpoint at cadence. Being already past that point (a run that started late, or a
    // shortened cadence) still gives the upcoming opportunity its attempts; the controller
    // bounds them at two per opportunity.
    preload: arm === "treatment" && sessionOpen && since >= cadence - 2,
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
