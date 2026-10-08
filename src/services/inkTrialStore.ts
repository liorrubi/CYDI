// Rewarded Ink Trial (0.57.1) - the device's Trial state and every write to it.
//
// A Trial is a TEMPORARY OVERLAY on top of the Shop's permanent state. This module never writes
// `progress.unlockedPenColors` or `settings.selectedPenColor` (penColorStore.ts), and the Shop never reads this:
// permanent ownership is the Shop's, read here only to let ownership win (an owned ink is never offered, never
// overlaid, and ends a running Trial on the spot).
//
// Own localStorage key, like the rewarded cadence (rewardedOfferCadence.ts). All lifecycle analytics leave from here
// (one ink_trial row per stage per Trial, guarded by the persisted flags), so a remount, a reconnect or a repeated
// final snapshot can never count twice. Pure rules live in app/inkTrialPolicy.ts.

import { trackEvent } from "./analytics";
import { isColorUnlocked } from "./penColorStore";
import type { PenColorId } from "../app/constants";
import {
  TRIAL_PLAYS,
  activeTrial,
  advancedPointer,
  nextEligibleInk,
  pendingCtaInk,
  scheduledSlot,
  type InkCtaOutcome,
  type InkTrialRecord,
  type InkTrials,
} from "../app/inkTrialPolicy";
import { INK_TRIAL_INKS, type InkTrialInk, type InkTrialStage } from "./analyticsSchema";
import type { InkRotationSlot, InkSurface } from "./ads/inkTrialConfigSchema";
import { doesActiveTrialApplyOn } from "./ads/inkTrialConfig";

export const INK_TRIAL_STORE_KEY = "cydi.inkTrial.v1";
/** Idempotency keys kept for consumed plays/sessions - far more than can ever repeat. */
const MAX_CONSUMED_KEYS = 40;
/** A post-session offer that was never shown expires: a stale card days later would be confusing. */
export const POST_SESSION_PENDING_TTL_MS = 2 * 60 * 60 * 1000;
/** Lifetime render count per ink, for offerNumber analytics only (bounded). */
const MAX_OFFER_NUMBER = 99;

export type PostSessionSurface = "playTogether" | "twoPlayers";

type InkTrialState = {
  v: 1;
  trials: InkTrials;
  /** The player chose another ink during an active Trial: the Trial ink is not drawn with (and not consumed) until re-selected. */
  overlayOff: boolean;
  classicPointer: number;
  rotationKey: string;
  consumed: string[];
  /** A completed session waiting for its safe post-exit surface (timestamp ms), per surface. */
  pending: Partial<Record<PostSessionSurface, number>>;
  offersRendered: Partial<Record<InkTrialInk, number>>;
  /** Sessions that STARTED with the Trial ink (game key -> ink), so a remount/resume that lands on the final
   *  results still consumes exactly once. Bounded (the newest few). */
  pins: Array<[string, InkTrialInk]>;
};

const MAX_PINS = 10;

function freshState(): InkTrialState {
  return { v: 1, trials: {}, overlayOff: false, classicPointer: 0, rotationKey: "", consumed: [], pending: {}, offersRendered: {}, pins: [] };
}

// --- Persistence (injectable for tests) ----------------------------------------------------------

export type InkTrialStorage = { get(): string | null; set(value: string): void };

const localInkStorage: InkTrialStorage = {
  get: () => {
    try {
      return localStorage.getItem(INK_TRIAL_STORE_KEY);
    } catch {
      return null;
    }
  },
  set: (value) => {
    try {
      localStorage.setItem(INK_TRIAL_STORE_KEY, value);
    } catch {
      // Storage full/blocked: this run keeps the state in memory.
    }
  },
};

type Tracker = (stage: InkTrialStage, ink: InkTrialInk, surface: InkSurface) => void;
const defaultTracker: Tracker = (inkStage, ink, inkSurface) => trackEvent("ink_trial", { inkStage, ink, inkSurface });

let storage: InkTrialStorage = localInkStorage;
let memoryState: InkTrialState | null = null;
let isOwned: (ink: InkTrialInk) => boolean = (ink) => isColorUnlocked(ink);
let track: Tracker = defaultTracker;
let now: () => number = () => Date.now();
const listeners = new Set<() => void>();

function isRecordShape(value: unknown): value is InkTrialRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    (r.status === "active" || r.status === "exhausted" || r.status === "closed") &&
    typeof r.usesLeft === "number" &&
    Number.isInteger(r.usesLeft) &&
    r.usesLeft >= 0 &&
    r.usesLeft <= TRIAL_PLAYS &&
    typeof r.started === "boolean" &&
    typeof r.ctaShown === "boolean" &&
    (r.ctaOutcome === null || r.ctaOutcome === "purchased" || r.ctaOutcome === "declined" || r.ctaOutcome === "dismissed")
  );
}

/** Corrupt or foreign values never crash anything: an unreadable store is a fresh one (no Trials). */
function parseState(raw: string | null): InkTrialState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || parsed.v !== 1 || typeof parsed.trials !== "object" || parsed.trials === null) return null;
    const state = freshState();
    for (const ink of INK_TRIAL_INKS) {
      const record = (parsed.trials as Record<string, unknown>)[ink];
      if (isRecordShape(record)) state.trials[ink] = { ...record };
    }
    state.overlayOff = parsed.overlayOff === true;
    if (typeof parsed.classicPointer === "number" && Number.isInteger(parsed.classicPointer) && parsed.classicPointer >= 0) state.classicPointer = parsed.classicPointer;
    if (typeof parsed.rotationKey === "string") state.rotationKey = parsed.rotationKey;
    if (Array.isArray(parsed.consumed)) state.consumed = parsed.consumed.filter((k): k is string => typeof k === "string").slice(-MAX_CONSUMED_KEYS);
    if (parsed.pending && typeof parsed.pending === "object") {
      for (const surface of ["playTogether", "twoPlayers"] as const) {
        const at = (parsed.pending as Record<string, unknown>)[surface];
        if (typeof at === "number" && Number.isFinite(at)) state.pending[surface] = at;
      }
    }
    if (Array.isArray(parsed.pins)) {
      state.pins = parsed.pins
        .filter((p): p is [string, InkTrialInk] => Array.isArray(p) && typeof p[0] === "string" && (INK_TRIAL_INKS as readonly unknown[]).includes(p[1]))
        .slice(-MAX_PINS);
    }
    if (parsed.offersRendered && typeof parsed.offersRendered === "object") {
      for (const ink of INK_TRIAL_INKS) {
        const n = (parsed.offersRendered as Record<string, unknown>)[ink];
        if (typeof n === "number" && Number.isInteger(n) && n >= 0) state.offersRendered[ink] = Math.min(n, MAX_OFFER_NUMBER);
      }
    }
    return state;
  } catch {
    return null;
  }
}

function load(): InkTrialState {
  return parseState(storage.get()) ?? memoryState ?? freshState();
}

function save(state: InkTrialState): void {
  memoryState = state;
  storage.set(JSON.stringify(state));
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A UI listener's bug never breaks a write.
    }
  }
}

/** Re-render hook for the badge, menus and cards: fires after every write. */
export function subscribeInkTrial(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// --- Reads -----------------------------------------------------------------------------------------

export function getActiveInkTrial(): { ink: InkTrialInk; usesLeft: number } | null {
  return activeTrial(load().trials, isOwned);
}

/** The ink the next offer would be for (eligibility only - surface config / rollout / ad capability are the caller's). */
export function getNextEligibleInk(): InkTrialInk | null {
  return nextEligibleInk(load().trials, isOwned);
}

export function getPendingCtaInk(): InkTrialInk | null {
  return pendingCtaInk(load().trials, isOwned);
}

/** Is the Trial overlay on (an active Trial the player has not switched away from)? */
export function isTrialOverlayOn(): boolean {
  return getActiveInkTrial() !== null && !load().overlayOff;
}

/**
 * The ink a play on `surface` actually draws with, resolved at the start of every play / game (Classic round,
 * Try Again, Play Together game incl. a rematch, 2 Players game incl. a rematch, Daily attempt): the active Trial
 * ink when its overlay is on and the Trial applies here, otherwise the permanent selection. `trialInk` is set only
 * when the Trial ink is the one drawn with - the only case a play/session consumes a use (D2).
 */
export function resolveEffectiveInk(surface: InkSurface, permanent: PenColorId): { color: PenColorId; trialInk: InkTrialInk | null } {
  if (!doesActiveTrialApplyOn(surface)) return { color: permanent, trialInk: null };
  const state = load();
  const trial = activeTrial(state.trials, isOwned);
  if (trial === null || state.overlayOff) return { color: permanent, trialInk: null };
  return { color: trial.ink, trialInk: trial.ink };
}

// --- Lifecycle -------------------------------------------------------------------------------------

/**
 * A completed rewarded ad for `ink` on `surface`: grant TRIAL_PLAYS plays and auto-equip the overlay. Refused (false)
 * when the ink is no longer eligible (owned, already granted once, another Trial active) - a stale offer can never
 * grant twice.
 */
export function grantInkTrial(ink: InkTrialInk, surface: InkSurface): boolean {
  const state = load();
  if (nextEligibleInk(state.trials, isOwned) !== ink) return false;
  state.trials[ink] = { status: "active", usesLeft: TRIAL_PLAYS, started: false, ctaShown: false, ctaOutcome: null };
  state.overlayOff = false;
  save(state);
  track("granted", ink, surface);
  return true;
}

/** A play / game on `surface` is starting with the Trial ink: the first one ever emits `started` (once per Trial). */
export function markInkTrialStarted(ink: InkTrialInk, surface: InkSurface): void {
  const state = load();
  const record = state.trials[ink];
  if (!record || record.status !== "active" || record.started) return;
  record.started = true;
  save(state);
  track("started", ink, surface);
}

/**
 * One completed play (Classic) / session (Play Together, 2 Players, Daily) that DREW with the Trial ink: one use.
 * Idempotent per `key` (a remount, reconnect or repeated final snapshot consumes nothing). A Trial pinned at the
 * start of a session is consumed even if this was its last use - it never expires mid-session. Ownership bought in
 * the meantime wins: nothing is consumed. The last use ends the Trial (`completed`, once).
 */
export function consumeInkTrialUse(ink: InkTrialInk, key: string, surface: InkSurface): { consumed: boolean; usesLeft: number; exhausted: boolean } {
  const state = load();
  const record = state.trials[ink];
  if (!record || record.status !== "active" || isOwned(ink)) return { consumed: false, usesLeft: record?.usesLeft ?? 0, exhausted: false };
  if (state.consumed.includes(key)) return { consumed: false, usesLeft: record.usesLeft, exhausted: false };
  state.consumed = [...state.consumed, key].slice(-MAX_CONSUMED_KEYS);
  record.usesLeft = Math.max(0, record.usesLeft - 1);
  // A play that switched to the Trial ink mid-drawing was never "started" at its start: it is now (still once).
  const firstUse = !record.started;
  record.started = true;
  const exhausted = record.usesLeft === 0;
  if (exhausted) {
    record.status = "exhausted";
    state.overlayOff = false;
  }
  save(state);
  if (firstUse) track("started", ink, surface);
  if (exhausted) track("completed", ink, surface);
  return { consumed: true, usesLeft: record.usesLeft, exhausted };
}

/** A multiplayer session (Play Together) started with the Trial ink: remember it by game key, for a resume. */
export function pinInkTrialSession(key: string, ink: InkTrialInk): void {
  const state = load();
  if (state.pins.some(([k]) => k === key)) return;
  state.pins = [...state.pins, [key, ink] as [string, InkTrialInk]].slice(-MAX_PINS);
  save(state);
}

/** The Trial ink a session with this key started with, or null (not pinned / unknown). */
export function getPinnedInkTrialSession(key: string): InkTrialInk | null {
  return load().pins.find(([k]) => k === key)?.[1] ?? null;
}

/** The player picked an ink in a pen menu during an active Trial: the Trial ink turns the overlay on, any other off. */
export function setInkTrialOverlay(on: boolean): void {
  const state = load();
  if (state.overlayOff === !on) return;
  state.overlayOff = !on;
  save(state);
}

/** The Try -> Buy CTA is on screen (once per Trial). */
export function markInkCtaShown(ink: InkTrialInk, surface: InkSurface): void {
  const state = load();
  const record = state.trials[ink];
  if (!record || record.ctaShown) return;
  record.ctaShown = true;
  save(state);
  track("cta_shown", ink, surface);
}

/** The CTA's one outcome: purchased (from the CTA), declined (NOT NOW) or dismissed (left without choosing). */
export function recordInkCtaOutcome(ink: InkTrialInk, outcome: InkCtaOutcome, surface: InkSurface): void {
  const state = load();
  const record = state.trials[ink];
  if (!record || !record.ctaShown || record.ctaOutcome !== null) return;
  record.ctaOutcome = outcome;
  save(state);
  track(outcome === "purchased" ? "cta_purchased" : outcome === "declined" ? "cta_declined" : "cta_dismissed", ink, surface);
}

/** A permanent purchase (from anywhere) wins at once: a running Trial is closed. Exhausted/closed records are kept (never re-granted). */
export function closeInkTrialOnPurchase(ink: InkTrialInk): void {
  const state = load();
  const record = state.trials[ink];
  if (!record || record.status !== "active") return;
  record.status = "closed";
  state.overlayOff = false;
  save(state);
}

// --- Post-session offers (Play Together / 2 Players) -------------------------------------------------

/** Completed sessions per surface in this app run (memory only) - the offer's `sessionGames` analytics context. */
const sessionsThisRun: Record<PostSessionSurface, number> = { playTogether: 0, twoPlayers: 0 };

export function completedSessionsThisRun(surface: PostSessionSurface): number {
  return sessionsThisRun[surface];
}

/**
 * A session completed: an offer is owed at the next SAFE surface (Play Together menu after exit / 2 Players setup).
 * A rematch chain keeps ONE pending offer - the timestamp is simply refreshed.
 */
export function setPostSessionPending(surface: PostSessionSurface): void {
  sessionsThisRun[surface] = Math.min(sessionsThisRun[surface] + 1, 9_999);
  const state = load();
  state.pending[surface] = now();
  save(state);
}

export function hasPostSessionPending(surface: PostSessionSurface): boolean {
  const at = load().pending[surface];
  return at !== undefined && now() - at >= 0 && now() - at < POST_SESSION_PENDING_TTL_MS;
}

/** Consumed when the offer is genuinely rendered (or found to have nothing to offer): one card per pending session chain. */
export function clearPostSessionPending(surface: PostSessionSurface): void {
  const state = load();
  if (state.pending[surface] === undefined) return;
  delete state.pending[surface];
  save(state);
}

// --- Classic rotation --------------------------------------------------------------------------------

export function peekClassicRotationSlot(pattern: readonly InkRotationSlot[]): InkRotationSlot {
  const state = load();
  return scheduledSlot(pattern, state.classicPointer, state.rotationKey);
}

/** One Classic Rewarded offer RENDERED (coin, ink, or ink -> coin fallback): the rotation moves one slot. */
export function advanceClassicRotation(pattern: readonly InkRotationSlot[]): void {
  const state = load();
  const next = advancedPointer(pattern, state.classicPointer, state.rotationKey);
  state.classicPointer = next.pointer;
  state.rotationKey = next.key;
  save(state);
}

// --- Offer numbering (analytics only) ------------------------------------------------------------------

export function nextInkOfferNumber(ink: InkTrialInk): number {
  return Math.min((load().offersRendered[ink] ?? 0) + 1, MAX_OFFER_NUMBER);
}

export function recordInkOfferRendered(ink: InkTrialInk): void {
  const state = load();
  state.offersRendered[ink] = Math.min((state.offersRendered[ink] ?? 0) + 1, MAX_OFFER_NUMBER);
  save(state);
}

// --- Tests ----------------------------------------------------------------------------------------------

export function _resetInkTrialStoreForTests(options: {
  storage?: InkTrialStorage;
  isOwned?: (ink: InkTrialInk) => boolean;
  track?: Tracker;
  now?: () => number;
} = {}): void {
  let value: string | null = null;
  storage = options.storage ?? { get: () => value, set: (v) => (value = v) };
  memoryState = null;
  isOwned = options.isOwned ?? (() => false);
  track = options.track ?? (() => undefined);
  now = options.now ?? (() => Date.now());
  listeners.clear();
  sessionsThisRun.playTogether = 0;
  sessionsThisRun.twoPlayers = 0;
}
