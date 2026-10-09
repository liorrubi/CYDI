/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Rewarded Ads Experiment v1 - WHEN the Classic result offer appears, and WHAT it is worth.
//
// RETIRED IN 0.57.0: the +100 arm. The experiment had two arms that differed only in reward value:
//   A "x3"      - watching the ad triples the round's coins
//   B "plus100" - watching the ad adds a flat 100 coins
// Every player is now on "x3" (getRewardedArm always returns it). assignRewardedArm, the "plus100"
// arm value, the salt and the analytics validators/enum stay exactly as they were so history (and
// builds still in the field that report "plus100") keeps decoding; nothing live assigns that arm.
// The hash assignment is kept as getLegacyRewardedAssignment() for reference and tests only.
//
// CADENCE (identical for both arms - this is NOT a frequency experiment):
//   first offer after 3 completed Classic games in the session, then after every 5 more.
//   games 3, 8, 13, 18 ... with no session cap.
// - "Session" is the analytics session (30 min idle timeout): a new session starts the count
//   over from zero with the first-offer threshold of 3. Leaving a screen, Back, or navigating
//   does NOT start a session.
// - An offer that comes due stays PENDING until one is actually rendered. It is not consumed
//   by a round that paid no coins, by a result where no rewarded ad can be served, or by a
//   result where an interstitial is due (the interstitial has priority; see decideResultOffer).
// - The counter restarts ONLY when an offer is genuinely rendered (markOfferShown). Rendering
//   is the exposure: a player who then presses Back, Back to Map, header back, Android Back or
//   leaves any other way without starting the ad has seen and skipped it, so the next offer is
//   5 games away and the same due offer can never be re-shown by navigating.
//
// Only normal Shape Challenge counts ("shapeChallenge" game type) - the same eligibility the
// interstitial uses, so the two cadences count the same games and can be collision-checked.
// Chest, shop, Special, Mega and Artist Pack offers are untouched and keep their ×2.

import { getPersistedInstallationId, getSessionId } from "../services/analyticsIdentity";
import { REWARD_EXPERIMENT_ARMS, type RewardExperimentArm, type RewardOfferOutcome } from "../services/analyticsSchema";

export const REWARDED_ARMS = REWARD_EXPERIMENT_ARMS;
export type RewardedArm = RewardExperimentArm;

export const FIRST_OFFER_AFTER_GAMES = 3;
export const OFFER_EVERY_GAMES = 5;
/** Arm A: the round's coins are multiplied by this. */
export const X3_MULTIPLIER = 3;
/** Arm B: this many coins are added on top of the round's coins. */
export const PLUS_BONUS_COINS = 100;

export const REWARDED_CADENCE_KEY = "cydi.rewardedCadence.v1";
const ASSIGNMENT_SALT = "rewarded-value-v1";

// --- 0.59.0: the accumulated ("run") ×3 A/B --------------------------------------------------
// While the remote flag `coin.runX3` is on, installations split 50/50 (own salt) between today's "x3" (×3 of THIS
// round) and "x3run": the offer triples the Classic coins of the whole run since the last rendered offer. The ad
// adds 2 × run, at most RUN_BONUS_MAX; when that is under RUN_BONUS_MIN the ad adds a flat RUN_BONUS_MIN instead,
// at most RUN_MIN_GRANTS_PER_DAY granted times a local day (adDailyLimitsStore.ts). Flag off = everyone "x3".
// The run is the same window as the cadence: it restarts whenever an offer (coin OR Ink) is rendered.

export const RUN_BONUS_MIN = 50;
export const RUN_BONUS_MAX = 400;
export const RUN_MIN_GRANTS_PER_DAY = 3;
const RUN_ASSIGNMENT_SALT = "rewarded-run-v1";

/** The x3run bonus for a run of `runCoins` coins. `minAvailable` = a minimum grant is still left today. */
export function runOfferBonus(runCoins: number, minAvailable: boolean): { bonus: number; minApplied: boolean } {
  const run = Number.isFinite(runCoins) ? Math.max(0, Math.round(runCoins)) : 0;
  const tripled = Math.min(2 * run, RUN_BONUS_MAX);
  if (tripled >= RUN_BONUS_MIN) return { bonus: tripled, minApplied: false };
  if (minAvailable) return { bonus: RUN_BONUS_MIN, minApplied: true };
  return { bonus: tripled, minApplied: false };
}

/** 50/50 by installation, stable, its own salt (never the retired value split or the interstitial/Ink buckets). */
export function assignRunArm(installationId: string | null): RewardedArm {
  if (installationId === null) return "x3";
  return fnv1a(`${RUN_ASSIGNMENT_SALT}:${installationId}`) % 2 === 0 ? "x3" : "x3run";
}

// --- Assignment --------------------------------------------------------------------------

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Retired 50/50 split (see the header): stable per installation, null -> "x3". No longer used to assign anything. */
export function assignRewardedArm(installationId: string | null): RewardedArm {
  if (installationId === null) return "x3";
  return fnv1a(`${ASSIGNMENT_SALT}:${installationId}`) % 2 === 0 ? "x3" : "plus100";
}

// --- Pure state machine ------------------------------------------------------------------

export type CadenceState = {
  sessionId: string;
  /** Eligible completed games since the session began or since the last rendered offer. */
  gamesSinceLastOffer: number;
  /** Offers rendered in this session (so the next one is offer number offersShown + 1). */
  offersShown: number;
  /** Eligible completed games in this session - telemetry only (heavy-user analysis). */
  sessionGames: number;
  /** 0.59.0: Classic coins earned since the last rendered offer (the x3run base). Absent on older stored states = 0. */
  runCoins?: number;
};

export function freshState(sessionId: string): CadenceState {
  return { sessionId, gamesSinceLastOffer: 0, offersShown: 0, sessionGames: 0, runCoins: 0 };
}

/** The state for `sessionId`: a stored state from another session is replaced by a fresh one. */
export function forSession(state: CadenceState | null, sessionId: string): CadenceState {
  return state && state.sessionId === sessionId ? state : freshState(sessionId);
}

export function threshold(state: CadenceState): number {
  return state.offersShown === 0 ? FIRST_OFFER_AFTER_GAMES : OFFER_EVERY_GAMES;
}

export function isOfferDue(state: CadenceState): boolean {
  return state.gamesSinceLastOffer >= threshold(state);
}

export function afterGameCompleted(state: CadenceState): CadenceState {
  return { ...state, gamesSinceLastOffer: state.gamesSinceLastOffer + 1, sessionGames: state.sessionGames + 1 };
}

export function afterOfferShown(state: CadenceState): CadenceState {
  return { ...state, gamesSinceLastOffer: 0, offersShown: state.offersShown + 1, runCoins: 0 };
}

export type ResultOfferDecision = "show" | "pending_interstitial" | "pending_no_coins" | "pending_no_ad" | "not_due";

/**
 * What one Classic result screen does with the rewarded offer. Only "show" renders it; every
 * pending_* keeps it due for the next suitable result without touching the counter.
 * The interstitial wins a collision: an interstitial is due on this result's exit, so no
 * rewarded offer is rendered here and the two can never follow each other in one result flow.
 */
export function decideResultOffer(input: { due: boolean; interstitialDue: boolean; coinsEarned: number; canOfferAd: boolean }): ResultOfferDecision {
  if (!input.due) return "not_due";
  if (input.interstitialDue) return "pending_interstitial";
  if (input.coinsEarned <= 0) return "pending_no_coins";
  if (!input.canOfferAd) return "pending_no_ad";
  return "show";
}

/** Total coins the player ends up with if the ad is completed. */
export function rewardedFinalAmount(arm: RewardedArm, baseCoins: number): number {
  // "x3run" is priced by runOfferBonus at the offer; without that context it reads as a plain ×3.
  return arm === "plus100" ? baseCoins + PLUS_BONUS_COINS : baseCoins * X3_MULTIPLIER;
}

/** The coins the ad itself adds (what Rewarded injects into the economy). */
export function rewardedBonusCoins(arm: RewardedArm, baseCoins: number): number {
  return rewardedFinalAmount(arm, baseCoins) - baseCoins;
}

// --- Persistence + gameplay hooks ----------------------------------------------------------

export type CadenceStorage = { get(): string | null; set(value: string): void };

const localCadenceStorage: CadenceStorage = {
  get: () => {
    try {
      return localStorage.getItem(REWARDED_CADENCE_KEY);
    } catch {
      return null;
    }
  },
  set: (value) => {
    try {
      localStorage.setItem(REWARDED_CADENCE_KEY, value);
    } catch {
      // Storage full/blocked: the cadence falls back to memory for this run.
    }
  },
};

let storage: CadenceStorage = localCadenceStorage;
let memoryState: CadenceState | null = null;
let sessionIdSource: () => string = () => getSessionId();
let installationIdSource: () => string | null = () => getPersistedInstallationId();

function isCadenceState(v: unknown): v is CadenceState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  const runOk = s.runCoins === undefined || (typeof s.runCoins === "number" && Number.isFinite(s.runCoins) && s.runCoins >= 0);
  return runOk && typeof s.sessionId === "string" && [s.gamesSinceLastOffer, s.offersShown, s.sessionGames].every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0);
}

function load(): CadenceState {
  const sessionId = sessionIdSource();
  let stored: CadenceState | null = memoryState;
  const raw = storage.get();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isCadenceState(parsed)) stored = parsed;
    } catch {
      // Corrupt value: start this session fresh.
    }
  }
  return forSession(stored, sessionId);
}

function save(state: CadenceState): void {
  memoryState = state;
  storage.set(JSON.stringify(state));
}

/**
 * The arm the Classic offer runs on: "x3", or - while the 0.59.0 run A/B is switched on (the caller passes the remote
 * flag, coinOfferConfig.isRunX3ExperimentOn, so this module stays free of any config/interstitial import) - this
 * installation's stable "x3" / "x3run" assignment.
 */
export function getRewardedArm(runExperimentOn = false): RewardedArm {
  return runExperimentOn ? assignRunArm(installationIdSource()) : "x3";
}

/** 0.59.0: a scored Classic round credited `coins` - they join the current run (no-op for 0). */
export function addRunCoins(coins: number): void {
  if (!(coins > 0)) return;
  const state = load();
  save({ ...state, runCoins: (state.runCoins ?? 0) + Math.round(coins) });
}

/** The current run: its coins and how many Classic games it spans (both restart with every rendered offer). */
export function getRunInfo(): { runCoins: number; runGames: number } {
  const state = load();
  return { runCoins: state.runCoins ?? 0, runGames: state.gamesSinceLastOffer };
}

/** What the retired 50/50 hash assignment would give this installation. Reference/tests only - nothing live calls it. */
export function getLegacyRewardedAssignment(): RewardedArm {
  return assignRewardedArm(installationIdSource());
}

/** A Classic round was completed and scored. Returns whether an offer is now due. */
export function recordRewardedGameCompleted(): boolean {
  const next = afterGameCompleted(load());
  save(next);
  return isOfferDue(next);
}

/** What the next rendered offer would report: its number in the session and the session's games so far. */
export function upcomingOfferContext(): { offerNumber: number; sessionGames: number } {
  const state = load();
  return { offerNumber: state.offersShown + 1, sessionGames: state.sessionGames };
}

/** An offer was genuinely rendered: the counter restarts and the next offer is 5 games away. */
export function markRewardedOfferShown(): void {
  save(afterOfferShown(load()));
}

// --- Continuation (abandonment after an offer) --------------------------------------------

export type RewardedOutcome = RewardOfferOutcome;
type ContinuationMarker = { sessionId: string; arm: RewardedArm; offerNumber: number; outcome: RewardedOutcome };
let marker: ContinuationMarker | null = null;

/** The offer's outcome is final. The next Classic game_started in this session reports it (see takeContinuation). */
export function setRewardedContinuation(arm: RewardedArm, offerNumber: number, outcome: RewardedOutcome): void {
  marker = { sessionId: sessionIdSource(), arm, offerNumber, outcome };
}

/** Consumed by the next Classic game_started; a marker from an earlier session is dropped. */
export function takeRewardedContinuation(): Omit<ContinuationMarker, "sessionId"> | null {
  const m = marker;
  marker = null;
  if (!m || m.sessionId !== sessionIdSource()) return null;
  return { arm: m.arm, offerNumber: m.offerNumber, outcome: m.outcome };
}

// --- Tests / QA ----------------------------------------------------------------------------

export function getRewardedCadenceDebugInfo(): CadenceState & { arm: RewardedArm; due: boolean; threshold: number } {
  const s = load();
  return { ...s, arm: getRewardedArm(), due: isOfferDue(s), threshold: threshold(s) };
}

export function _resetRewardedCadenceForTests(options: { storage?: CadenceStorage; sessionId?: () => string; installationId?: () => string | null } = {}): void {
  storage = options.storage ?? localCadenceStorage;
  sessionIdSource = options.sessionId ?? (() => getSessionId());
  installationIdSource = options.installationId ?? (() => getPersistedInstallationId());
  memoryState = null;
  marker = null;
}
