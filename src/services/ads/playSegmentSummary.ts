// Foreground play-segment summary (0.57): ONE `session_summary` telemetry event per foreground play
// segment that contained at least one completed Classic game. Android only.
//
// SEMANTICS (owner-approved)
//   - A segment BEGINS when genuine foreground play starts and ENDS on a genuine background / exit. There is
//     no explicit "begin" event: the counters below are zeroed when a segment ends, so the next game after a
//     return starts counting from zero, which is exactly the start of a new segment (nothing can be played
//     while the app is in the background).
//   - An AdMob full-screen ad pauses the WebView (the Mi 8 emits appStateChange(false) the moment an ad opens,
//     see analyticsQueue.ts) but is NOT a real exit. A background is "genuine" only when NO interstitial and
//     NO rewarded ad is showing AND the last ad lifecycle moment was more than
//     FULL_SCREEN_AD_BACKGROUND_GRACE_MS ago (an ad's own dismiss can race a late background event). The
//     checks use the ad modules' existing state - no timer, no polling, no new listener on the page.
//   - At most one summary per segment: ending a segment takes and clears the counters in one step, so the
//     several lifecycle triggers of one backgrounding (visibilitychange + pagehide + appStateChange) can only
//     ever emit once - the later ones find nothing to report.
//   - Emitted ONLY with >= 1 completed Classic (shapeChallenge) game in the segment, and only while the
//     interstitial controller says this installation takes part (it supplies the arm; a non-participant has
//     none, so it reports nothing). The controller is Android-only, and web is additionally refused here.
//
// MECHANICS. The summary is produced by a pre-flush hook of the analytics queue
// (registerBeforeLifecycleFlush): the queue calls it synchronously at the top of every lifecycle flush, BEFORE
// the queue is swapped out, so the event leaves in the very request that the backgrounding sends. Telemetry is
// never persisted or retried, so an event enqueued after that flush would wait for the 120 s timer and be lost
// when the app is killed.
//
// CLASS. `session_summary` is deliberately NOT in CLIENT_EXACT_EVENTS / EXACT_LEDGER_EVENTS: it is TELEMETRY
// (sampled per analytics session like any other telemetry, Analytics Engine only, no exact-ledger write).
//
// PRIVACY / STATE. Memory only: nothing is persisted, there is no identifier, no timestamp and no sequence
// number. The only things sent are the bounded counters below and the effective interstitial rules.
//
// KNOWN LIMITATIONS (accepted, by design)
//   - If the process dies without a lifecycle callback (kill, crash, battery pull, an OS kill while the app is
//     already in the background), the final segment's summary is lost - memory state is all there is.
//   - Games before a late first summary are not double counted: counters are cleared when a summary is taken,
//     so a game finishing in the background just after a summary (the scoring step runs on a short timer) is
//     counted in the NEXT segment, not twice.
//   - A segment spans analytics-session boundaries (a long foreground idle rotates the session id): cadence
//     and cap are read when the summary is taken, i.e. the values of the session then current.
//   - The counters are the segment's own: an opportunity consumed in an earlier segment of the same analytics
//     session still counts toward the session cap, but not toward this segment's `checkpoints`.
//   - `rewardedShown` counts every rewarded ad shown in the segment, whatever its placement.
//   - Telemetry sampling (a remote keep percent below 100) keeps or drops a whole analytics session's events,
//     summaries included.

import { Capacitor } from "@capacitor/core";
import { trackEvent } from "../analytics";
import { registerBeforeLifecycleFlush } from "../analyticsQueue";
import { SESSION_SUMMARY_MAX_COUNT, type SessionSummaryParams } from "../analyticsSchema";
import { getInterstitialState, subscribeInterstitialLifecycle } from "./interstitialAds";
import type { InterstitialArm, InterstitialCellId, InterstitialOutcome } from "./interstitialConfigSchema";
import { getRewardedLifecycleState, subscribeRewardedAdEvents } from "./rewardedAds";

/**
 * After an interstitial or rewarded ad's last lifecycle moment (shown / dismissed / error), a background event
 * within this window is still attributed to the ad, not to the player leaving: the SDK's dismiss and the
 * WebView's app-state change are separate callbacks that can arrive in either order.
 */
export const FULL_SCREEN_AD_BACKGROUND_GRACE_MS = 3000;

/** What the controller knows about the installation right now (null = takes no part: no summary). */
export type SegmentContext = {
  arm: InterstitialArm;
  /** Effective cadence / session cap (the baseline's, or the participant's cell's). */
  cadence: number;
  cap: number;
  ifxCell: InterstitialCellId | null;
  ifxVersion: number | null;
};

type Counters = {
  classicGames: number;
  checkpoints: number;
  shown: number;
  notReady: number;
  secondReached: 0 | 1;
  rewardedShown: number;
  rewardedDeferred: number;
};

function emptyCounters(): Counters {
  return { classicGames: 0, checkpoints: 0, shown: 0, notReady: 0, secondReached: 0, rewardedShown: 0, rewardedDeferred: 0 };
}

let counters: Counters = emptyCounters();
let contextProvider: () => SegmentContext | null = () => null;
let now: () => number = () => Date.now();
let isNative: () => boolean = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};
let track: (eventName: "session_summary", params: SessionSummaryParams) => void = trackEvent;
/** Last interstitial / rewarded ad lifecycle moment, for the grace window. */
let lastAdActivityAt = Number.NEGATIVE_INFINITY;

function bump(key: Exclude<keyof Counters, "secondReached">): void {
  if (counters[key] < SESSION_SUMMARY_MAX_COUNT) counters[key] += 1;
}

// --- Recorders (called by interstitialController.ts) ----------------------------------

/** The controller supplies the arm / effective rules; it is the only caller. */
export function configurePlaySegmentSummary(provider: () => SegmentContext | null): void {
  contextProvider = provider;
}

/** A completed, scored Classic game of a participating installation. */
export function recordSegmentClassicGame(): void {
  bump("classicGames");
}

/** A completion made an opportunity due. Due again after one was consumed in this segment = a second opportunity. */
export function recordSegmentOpportunityDue(): void {
  if (counters.checkpoints >= 1) counters.secondReached = 1;
}

/** An opportunity was consumed (any outcome, either arm). Reaching a second consumed opportunity marks secondReached. */
export function recordSegmentCheckpoint(outcome: InterstitialOutcome): void {
  bump("checkpoints");
  if (outcome === "shown") bump("shown");
  else if (outcome === "not_ready") bump("notReady");
  if (counters.checkpoints >= 2) counters.secondReached = 1;
}

/** A rewarded offer was deferred because the interstitial won the result-screen lane (the `pending_interstitial` decision). */
export function recordSegmentRewardedDeferred(): void {
  bump("rewardedDeferred");
}

// --- Genuine background ----------------------------------------------------------------

/**
 * Is an AdMob full-screen ad (interstitial or rewarded) showing, or was one a moment ago? Reads only the ad
 * modules' own state and the timestamps their lifecycle callbacks set below.
 */
export function isFullScreenAdActive(): boolean {
  try {
    if (getInterstitialState() === "showing" || getRewardedLifecycleState() === "showing") return true;
  } catch {
    /* unreadable state: fall through to the time check */
  }
  return now() - lastAdActivityAt < FULL_SCREEN_AD_BACKGROUND_GRACE_MS;
}

/**
 * The pre-flush hook body: runs on every lifecycle trigger, ends the segment only when it is a genuine
 * background. Idempotent (see the header).
 */
export function onLifecycleFlush(): void {
  if (!isNative()) return;
  if (isFullScreenAdActive()) return; // an ad paused the app, the segment goes on
  endSegment();
}

/** Takes and clears the counters; emits one summary if the segment had a completed Classic game and the installation takes part. */
function endSegment(): void {
  const taken = counters;
  counters = emptyCounters();
  if (taken.classicGames < 1) return;
  const ctx = contextProvider();
  if (ctx === null) return;
  const params: SessionSummaryParams = {
    arm: ctx.arm,
    classicGames: taken.classicGames,
    checkpoints: taken.checkpoints,
    shown: taken.shown,
    notReady: taken.notReady,
    secondReached: taken.secondReached,
    rewardedShown: taken.rewardedShown,
    rewardedDeferred: taken.rewardedDeferred,
    cadence: ctx.cadence,
    cap: ctx.cap,
    ...(ctx.ifxCell !== null && ctx.ifxVersion !== null ? { ifxCell: ctx.ifxCell, ifxVersion: ctx.ifxVersion } : {}),
  };
  track("session_summary", params);
}

// --- Wiring ----------------------------------------------------------------------------

function connect(): void {
  registerBeforeLifecycleFlush("play-segment-summary", onLifecycleFlush);
  subscribeInterstitialLifecycle("play-segment-summary", (event) => {
    if (event.type === "showed" || event.type === "dismissed") lastAdActivityAt = now();
  });
  subscribeRewardedAdEvents("play-segment-summary", (event) => {
    if (event === "shown") bump("rewardedShown");
    if (event === "shown" || event === "rewarded" || event === "dismissed" || event === "error") lastAdActivityAt = now();
  });
}

connect();

// --- Tests -----------------------------------------------------------------------------

export function _resetPlaySegmentSummaryForTests(
  options: { track?: typeof track; now?: () => number; isNative?: () => boolean; context?: () => SegmentContext | null } = {},
): void {
  counters = emptyCounters();
  lastAdActivityAt = Number.NEGATIVE_INFINITY;
  track = options.track ?? trackEvent;
  now = options.now ?? (() => Date.now());
  isNative = options.isNative ?? (() => {
    try {
      return Capacitor.isNativePlatform();
    } catch {
      return false;
    }
  });
  if (options.context) contextProvider = options.context;
  connect();
}

export function _playSegmentCountersForTests(): Readonly<Counters> {
  return { ...counters };
}
