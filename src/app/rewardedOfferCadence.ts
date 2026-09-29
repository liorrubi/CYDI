/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Rewarded Ads Experiment v1 - WHEN the Classic result offer appears, and WHAT it is worth.
//
// ONE SYSTEM, TWO ARMS. Every player gets the same placement (the Shape Challenge result
// screen), the same timing, the same UI and the same availability/collision rules. The only
// difference is the reward value:
//   A "x3"      (control) - watching the ad triples the round's coins
//   B "plus100" (variant) - watching the ad adds a flat 100 coins
// Assignment is a stable hash of the persisted installation id (same FNV-1a bucketing as the
// interstitial experiment, with its own salt), so a device stays in one arm for the whole
// experiment and the arms are independent of the interstitial arms.
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

// --- Assignment --------------------------------------------------------------------------

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Stable 50/50 split. A device with no persisted installation id gets the control arm (never switches arms mid-session). */
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
};

export function freshState(sessionId: string): CadenceState {
  return { sessionId, gamesSinceLastOffer: 0, offersShown: 0, sessionGames: 0 };
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
  return { ...state, gamesSinceLastOffer: 0, offersShown: state.offersShown + 1 };
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
  return arm === "x3" ? baseCoins * X3_MULTIPLIER : baseCoins + PLUS_BONUS_COINS;
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
  return typeof s.sessionId === "string" && [s.gamesSinceLastOffer, s.offersShown, s.sessionGames].every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0);
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

export function getRewardedArm(): RewardedArm {
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
