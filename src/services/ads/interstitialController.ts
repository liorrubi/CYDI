// The interstitial experiment as gameplay sees it. ShapeChallengeScreen calls four
// functions and nothing else:
//
//   beginInterstitialResultCycle()        a result phase begins (resets the rewarded marker)
//   recordInterstitialGameCompleted(gt)   a round was completed and scored
//   runInterstitialCheckpoint()           the player tapped Next Shape / Try Again
//   recordInterstitialGameStarted(gt)     a round's game_started fired
//
// V1 scope is normal Shape Challenge only - `gameType === "shapeChallenge"`. Practice
// (seoPractice), Pass & Play, Play Together, Daily, Mega, Artist Pack and Special
// never call this module, and the gameType check below rejects anything else that
// might. Back to Map is not a placement: it never calls runInterstitialCheckpoint.
//
// Order of one opportunity:
//   completion -> sinceLast += 1 -> due? (sinceLast >= cadence and the session cap is open)
//   Next/Try Again -> consume (sinceLast = 0, session count + 1)
//     -> outcome known -> marker written SYNCHRONOUSLY -> checkpoint event
//     -> (shown only) wait for release -> navigate -> next game_started -> continuation

import { trackEvent } from "../analytics";
import type {
  AnalyticsEventName,
  EventParamsMap,
  GameType,
  InterstitialCheckpointDiag,
  InterstitialCheckpointParams,
  InterstitialIfxContext,
  NextGameContext,
  NextGameOutcome,
} from "../analyticsSchema";
import { getPersistedInstallationId, getSessionId } from "../analyticsIdentity";
import { subscribeRewardedAdEvents } from "./rewardedAds";
import { getFrozenInterstitialConfig, getInterstitialExperimentSpec, getQaForcedArm, isInterstitialLiveEnabled } from "./interstitialConfig";
import type { InterstitialArm, InterstitialCellId, InterstitialFailureReason, InterstitialOutcome } from "./interstitialConfigSchema";
import { isSecondOpportunityAllowed, localIfxStorage, resolveSessionSnapshot, type SessionSnapshot } from "./interstitialCells";
import type { AdNotReadyCause } from "./adDiagnostics";
import {
  _resetPlaySegmentSummaryForTests,
  configurePlaySegmentSummary,
  recordSegmentCheckpoint,
  recordSegmentClassicGame,
  recordSegmentOpportunityDue,
  recordSegmentRewardedDeferred,
} from "./playSegmentSummary";
import { adLatencyBucket } from "./adDiagnostics";
import {
  assignArm,
  consumeOpportunity,
  loadState,
  localInterstitialStorage,
  recordEligibleCompletion,
  saveState,
  type InterstitialStorage,
} from "./interstitialExperiment";
import {
  getInterstitialReadiness,
  getInterstitialState,
  invalidateInterstitial,
  preloadInterstitial,
  presentInterstitial,
  subscribeInterstitialLifecycle,
  type PresentOutcome,
} from "./interstitialAds";

const ELIGIBLE_GAME_TYPE: GameType = "shapeChallenge";

type TrackFn = <E extends AnalyticsEventName>(eventName: E, params: EventParamsMap[E]) => void;

let track: TrackFn = trackEvent;
let storage: InterstitialStorage = localInterstitialStorage;
/** The experiment's own persisted record (assignment + session snapshot); cydi.interstitial.v1 is never touched by it. */
let ifxStorage: InterstitialStorage = localIfxStorage;
/**
 * This analytics session's snapshot of an experiment PARTICIPANT, cached in memory as well as persisted, so
 * a failing storage write can never let a remote change reshape a session in progress. Non-participants are
 * resolved from storage on every call: their numbers are the frozen base config's (see resolveSessionSnapshot).
 */
let snapshotCache: SessionSnapshot | null = null;
let sessionIdSource: () => string = () => getSessionId();
let installationIdSource: () => string | null = getPersistedInstallationId;

// --- Per result cycle (memory only) --------------------------------------------------

/** A rewarded ad reached "shown" during the current result cycle. */
let rewardedShownThisCycle = false;
/** The completion that opened this result cycle made an opportunity due. */
let dueThisCycle = false;
/** The arm of this cycle's opportunity - only a treatment opportunity can actually show an ad. */
let dueArmThisCycle: InterstitialArm | null = null;
/** A rewarded OFFER was rendered on this result: nothing may present an interstitial from it. */
let rewardedRenderedThisCycle = false;
/** 0.58.0: a non-ad card owns this Result (deferInterstitialThisCycle) - its exit runs no checkpoint at all. */
let deferredThisCycle = false;
/**
 * The current (not yet consumed) opportunity has already reserved one Result screen and
 * deferred the rewarded offer there. It may do so only once: if the player left that
 * screen without presenting it (Back to Map), later results do not starve the offer.
 * Cleared when the opportunity is consumed at a checkpoint.
 */
let laneReservedForOpportunity = false;
/**
 * Load attempts made for the upcoming opportunity (0-2); reset when an opportunity is consumed
 * or its session changes. Attempt 1 at cadence-2, a retry at a LATER completion (cadence-1)
 * only if that attempt has definitively failed - never an immediate loop, never overlapping.
 */
let attemptsForUpcoming = 0;
/** The cadence progress (`eligibleGamesSinceLastOpportunity`) when the last attempt started. */
let lastAttemptSince = -1;
/** The analytics session the upcoming opportunity's attempts belong to. */
let attemptSessionId: string | null = null;
/** A checkpoint is running; a second tap cannot start another. */
let checkpointInFlight = false;
/**
 * One-shot, MEMORY-ONLY context for the next Classic game's completion: set when the game_started that
 * consumes a checkpoint marker fires, taken (and cleared) by that game's game_completed. Never persisted - a
 * kill or an abandoned game simply loses it, which is the intended "continued but did not complete" signal.
 * No id, no nonce: only the analytics session it belongs to, the outcome and (participants) the cell.
 */
let nextGameContext: { sessionId: string; outcome: NextGameOutcome; ifxCell: InterstitialIfxContext["ifxCell"] | null } | null = null;

// --- Participation ------------------------------------------------------------------

type Participation = {
  arm: InterstitialArm;
  /** The EFFECTIVE cadence of this analytics session (a cell's, or the frozen base config's). */
  cadence: number;
  /** The EFFECTIVE session cap of this analytics session. */
  sessionCap: number;
  /** Multi-cell experiment context of this session; null/null for everyone outside it. No ids or buckets. */
  experimentVersion: number | null;
  cellId: InterstitialCellId | null;
  /** This installation may have a 2nd+ opportunity in a session (always true unless the remote second-opportunity rollout is below 100). */
  secondOpportunityEligible: boolean;
};

/**
 * Null means "this installation takes no part right now": no config answer yet, the
 * emergency switch is off, the network country is ineligible, or the installation is
 * unassigned (including: no stable persisted id). Nothing is counted or recorded then.
 */
function participation(): Participation | null {
  const config = getFrozenInterstitialConfig();
  if (config === null || !isInterstitialLiveEnabled() || !config.countryEligible) return null;
  const installationId = installationIdSource();
  const assigned = getQaForcedArm() ?? assignArm(installationId, config.rolloutPercent);
  if (assigned === "unassigned") return null;
  // Cadence and cap come from the session snapshot, never straight from the config: a participant gets
  // its cell's values, everyone else exactly the frozen base values (0.56 behaviour).
  const sessionId = sessionIdSource();
  let snapshot = snapshotCache !== null && snapshotCache.sessionId === sessionId ? snapshotCache : null;
  if (snapshot === null) {
    snapshot = resolveSessionSnapshot(ifxStorage, {
      sessionId,
      installationId,
      arm: assigned,
      base: { cadence: config.gamesBetweenAds, cap: config.maxOpportunitiesPerSession },
      spec: getInterstitialExperimentSpec(),
    });
    snapshotCache = snapshot.cellId !== null ? snapshot : null;
  }
  return {
    arm: assigned,
    cadence: snapshot.cadence,
    sessionCap: snapshot.cap,
    experimentVersion: snapshot.experimentVersion,
    cellId: snapshot.cellId,
    // Experiment participants bypass the legacy second-opportunity gate (see isSecondOpportunityAllowed).
    secondOpportunityEligible: isSecondOpportunityAllowed(snapshot, installationId, config.secondOpportunityRolloutPercent),
  };
}

/**
 * The effective interstitial context right now - the hook for session-depth / next-game telemetry.
 * Synchronous, local, no ids or buckets: the experiment version and cell (null/null outside the
 * multi-cell experiment) and the cadence and cap actually in force. `cadence` and `cap` are the
 * snapshot's when this installation takes part, otherwise the frozen base config's; null only before
 * any config answer at all. Reading it may take (and persist) this session's snapshot - idempotent.
 */
export type EffectiveInterstitialContext = {
  experimentVersion: number | null;
  cellId: InterstitialCellId | null;
  cadence: number;
  cap: number;
};

export function getEffectiveInterstitialContext(): EffectiveInterstitialContext | null {
  const who = participation();
  if (who !== null) return { experimentVersion: who.experimentVersion, cellId: who.cellId, cadence: who.cadence, cap: who.sessionCap };
  const config = getFrozenInterstitialConfig();
  if (config === null) return null;
  return { experimentVersion: null, cellId: null, cadence: config.gamesBetweenAds, cap: config.maxOpportunitiesPerSession };
}

/** The multi-cell experiment context of a participant (all three keys), or {} for everyone else. Never an id or bucket. */
function ifxContextOf(who: Participation): InterstitialIfxContext {
  return who.cellId !== null && who.experimentVersion !== null
    ? { ifxCell: who.cellId, ifxVersion: who.experimentVersion, ifxCap: who.sessionCap }
    : {};
}

/** The summary's view of this installation (see playSegmentSummary.ts); null = takes no part, no summary. */
configurePlaySegmentSummary(() => {
  const who = participation();
  if (who === null) return null;
  return { arm: who.arm, cadence: who.cadence, cap: who.sessionCap, ifxCell: who.cellId, ifxVersion: who.experimentVersion };
});

/**
 * This installation's interstitial arm right now, for stratifying the Rewarded experiment:
 * "none" when it takes no part (see participation()). Purely local - the frozen config was
 * fetched once at startup and the arm is a hash - so reading it makes no network call.
 */
export function getInterstitialArmForAnalytics(): InterstitialArm | "none" {
  return participation()?.arm ?? "none";
}

/** The multi-cell experiment cell of this installation's current session, or null for a non-participant (no id, no bucket). */
export function getInterstitialCellForAnalytics(): InterstitialCellId | null {
  return participation()?.cellId ?? null;
}

// --- Gameplay hooks -----------------------------------------------------------------

/** A result phase begins. Resets the per-cycle rewarded marker and the due flag. */
export function beginInterstitialResultCycle(): void {
  rewardedShownThisCycle = false;
  rewardedRenderedThisCycle = false;
  deferredThisCycle = false;
  dueThisCycle = false;
  dueArmThisCycle = null;
}

/** A completed, scored round. Only an eligible game type advances anything. */
export function recordInterstitialGameCompleted(gameType: GameType): void {
  if (gameType !== ELIGIBLE_GAME_TYPE) return;
  const who = participation();
  if (who === null) return;
  const decision = recordEligibleCompletion(loadState(storage), who.cadence, who.sessionCap, sessionIdSource(), who.arm, who.secondOpportunityEligible);
  saveState(storage, decision.state);
  recordSegmentClassicGame();
  if (decision.due) recordSegmentOpportunityDue();
  dueThisCycle = decision.due;
  dueArmThisCycle = decision.due ? who.arm : null;
  if (decision.preload) scheduleLoadAttempt(decision.state.eligibleGamesSinceLastOpportunity, who.cadence);
}

/**
 * The 0.56 preload schedule for the upcoming opportunity, called once per completed treatment
 * game from cadence-2 on (cadence 7: games 5, 6, then the checkpoint at 7):
 *   - attempt 1 as soon as the window opens;
 *   - attempt 2 at a later completion, only while the checkpoint is still ahead (`since` < cadence),
 *     and only if attempt 1 has definitively failed (or its ad expired) - a load still in flight
 *     is never joined by a second one;
 *   - never more than two attempts per opportunity; a session change throws the stale ones away.
 * preloadInterstitial() additionally refuses while any native load is active.
 */
function scheduleLoadAttempt(since: number, cadence: number): void {
  const sessionId = sessionIdSource();
  if (attemptSessionId !== null && attemptSessionId !== sessionId) {
    invalidateInterstitial();
    attemptsForUpcoming = 0;
    lastAttemptSince = -1;
  }
  attemptSessionId = sessionId;
  if (attemptsForUpcoming >= 2) return;
  const ready = getInterstitialReadiness();
  if (ready.state === "ready" || ready.state === "loading" || ready.state === "showing") return;
  if (attemptsForUpcoming === 1 && (since <= lastAttemptSince || since >= cadence)) return;
  const attempt = (attemptsForUpcoming + 1) as 1 | 2;
  if (preloadInterstitial(attempt)) {
    attemptsForUpcoming = attempt;
    lastAttemptSince = since;
  }
}

/**
 * Whether this result cycle's exit (Next Shape / Try Again) runs an interstitial opportunity
 * that can actually show an ad - the TREATMENT arm only; a control opportunity shows nothing,
 * so deferring for it would only skew rewarded exposure between the interstitial arms.
 * Diagnostic only: the Rewarded experiment decides through claimResultAdLane(), which also
 * requires the interstitial to be loaded and reserves a screen only once per opportunity.
 */
export function isInterstitialDueThisCycle(): boolean {
  return dueThisCycle && dueArmThisCycle === "treatment";
}

/**
 * Result-screen ad exclusivity: a Result screen exposes at most ONE ad lane. Called once,
 * only when a rewarded offer is otherwise ready to render on this result (due, paying, a
 * rewarded ad can be offered) - so a zero-coin result never spends the reservation.
 *
 * "interstitial": a treatment interstitial is due AND already loaded, and this opportunity
 *   has not reserved a screen before - the screen is reserved for it; the rewarded offer
 *   stays pending (its cadence is not reset).
 * "rewarded": anything else - control arm (no ad to yield to), due but not loaded, not due,
 *   or this opportunity already had its one reservation (the player left that screen without
 *   it being presented). The caller renders the offer and then calls
 *   markRewardedOfferRenderedThisCycle(), which keeps the interstitial off this screen.
 */
export function claimResultAdLane(): "interstitial" | "rewarded" {
  if (dueThisCycle && dueArmThisCycle === "treatment" && getInterstitialState() === "ready" && !laneReservedForOpportunity) {
    laneReservedForOpportunity = true;
    return "interstitial";
  }
  return "rewarded";
}

/**
 * The Result screen's rewarded offer was deferred because the interstitial won the ad lane (the
 * `pending_interstitial` decision). Counted per play segment only (session_summary.rewardedDeferred); emits nothing itself.
 */
export function recordRewardedOfferDeferred(): void {
  recordSegmentRewardedDeferred();
}

/**
 * The rewarded offer is on this Result screen. From this moment no interstitial may be
 * presented when leaving it - even one that finishes loading afterwards. (The older guard,
 * rewardedShownThisCycle, only covered a WATCHED rewarded ad.)
 */
export function markRewardedOfferRenderedThisCycle(): void {
  rewardedRenderedThisCycle = true;
}

/**
 * 0.58.0: a NON-AD card (the purchase CTA after a trial's last play) owns this Result. Leaving it runs no checkpoint:
 * an opportunity due on this exit is NOT shown, NOT consumed, NOT recorded and NOT counted against the session cap.
 * The persisted counter is untouched (eligible games keep counting, `since >= cadence`), so it comes due again at
 * the next legal Result. Same for every arm and cell. Reads and changes no cadence, cap, rollout or cell value.
 * Returns whether an opportunity was due (= was deferred), for the caller's analytics only.
 */
export function deferInterstitialThisCycle(): boolean {
  deferredThisCycle = true;
  return dueThisCycle;
}

/** What the readiness machinery knew when the checkpoint ran (captured before anything is presented). */
type ReadinessAtCheckpoint = ReturnType<typeof getInterstitialReadiness> & { attempts: number };

function checkpointParams(
  arm: InterstitialArm,
  result: PresentOutcome | { outcome: "control" | "suppressed" },
  cadence: number,
  readiness: ReadinessAtCheckpoint,
): InterstitialCheckpointParams {
  if (arm === "control") return { arm, outcome: result.outcome === "suppressed" ? "suppressed" : "control", gamesBetweenAds: cadence };
  // Treatment diagnostics: bounded fields only (see adDiagnostics.ts) - how many attempts this
  // opportunity made, the numeric code of the last failed load, how long the loaded ad took,
  // and (not_ready only) why nothing was ready. Nothing waits on any of it.
  const diag: InterstitialCheckpointDiag = {};
  if (readiness.attempts === 1 || readiness.attempts === 2) diag.attempt = readiness.attempts;
  if (readiness.lastFailure?.code !== undefined) diag.code = readiness.lastFailure.code;
  if (readiness.state === "ready" && readiness.loadLatencyMs !== null) diag.latency = adLatencyBucket(readiness.loadLatencyMs);
  if (result.outcome === "show_failed") {
    return { arm: "treatment", outcome: "show_failed", gamesBetweenAds: cadence, reason: (result as { reason: InterstitialFailureReason }).reason, ...diag };
  }
  if (result.outcome === "not_ready") diag.notReadyCause = (result as { cause: AdNotReadyCause }).cause;
  return { arm, outcome: result.outcome as "not_ready" | "shown" | "suppressed", gamesBetweenAds: cadence, ...diag };
}

/**
 * The player tapped Next Shape or Try Again. Returns null when gameplay may continue
 * immediately - no opportunity, control, suppressed or not_ready. Returns a promise
 * ONLY while an ad is being presented. It resolves once, never rejects, and says
 * whether to go on: true when the ad is gone or never appeared, false when the long
 * safety timeout released it - the ad may still be up, so the caller must stay on the
 * Result screen and let the player's next tap continue (that tap finds no opportunity
 * due and navigates at once).
 */
export function runInterstitialCheckpoint(): Promise<boolean> | null {
  if (!dueThisCycle || checkpointInFlight) return null;
  // Deferred (deferInterstitialThisCycle): left due for the next Result - nothing consumed, recorded or shown.
  if (deferredThisCycle) return null;
  dueThisCycle = false;
  const who = participation();
  if (who === null) return null;

  const sessionId = sessionIdSource();
  // An ad loaded under another analytics session does not belong to this opportunity.
  if (attemptSessionId !== null && attemptSessionId !== sessionId) {
    invalidateInterstitial();
    attemptsForUpcoming = 0;
  }
  // What the checkpoint knows, captured BEFORE it consumes the opportunity or presents anything.
  const readiness: ReadinessAtCheckpoint = { ...getInterstitialReadiness(), attempts: attemptsForUpcoming };
  // Consumed before anything else, so a crash or kill mid-ad still counts it once.
  saveState(storage, consumeOpportunity(loadState(storage), sessionId));
  attemptsForUpcoming = 0;
  lastAttemptSince = -1;
  attemptSessionId = null;
  laneReservedForOpportunity = false;

  const record = (result: PresentOutcome | { outcome: "control" | "suppressed" }) => {
    const params = { ...checkpointParams(who.arm, result, who.cadence, readiness), ...ifxContextOf(who) } as InterstitialCheckpointParams;
    recordSegmentCheckpoint(params.outcome);
    // The marker is written synchronously the moment the outcome is known, BEFORE
    // any navigation - and never before the outcome is known.
    const state = loadState(storage);
    saveState(storage, { ...state, marker: { sessionId, arm: who.arm, outcome: params.outcome, gamesBetweenAds: who.cadence } });
    track("interstitial_checkpoint", params);
  };

  // Symmetric across arms: a rewarded ad - or a rewarded OFFER rendered - this result cycle
  // suppresses the opportunity in control too, so the two arms consume opportunities at the
  // same moments. Rewarded rendered -> never an interstitial from the same Result screen.
  if (rewardedShownThisCycle || rewardedRenderedThisCycle) {
    record({ outcome: "suppressed" });
    invalidateInterstitial(); // the opportunity is consumed; a loaded ad does not carry over
    return null;
  }
  if (who.arm === "control") {
    record({ outcome: "control" });
    invalidateInterstitial();
    return null;
  }

  checkpointInFlight = true;
  const release = presentInterstitial({ onOutcome: record });
  // The opportunity is consumed whether or not anything was presented: a loaded ad does not
  // carry over, and a load still in flight can no longer make anything ready. (A showing ad is
  // untouched - invalidation only resets states that hold an unused load.)
  invalidateInterstitial();
  if (release === null) {
    // not_ready: decided synchronously - nothing to wait for, no spinner, no retry.
    checkpointInFlight = false;
    return null;
  }
  return release.then((how) => {
    checkpointInFlight = false;
    return how === "continue";
  });
}

/**
 * A round's game_started. The first eligible one after a checkpoint, in the same
 * analytics session, emits the continuation and consumes the marker. A marker from
 * a previous session is stale and dropped without an event.
 */
export function recordInterstitialGameStarted(gameType: GameType): void {
  if (gameType !== ELIGIBLE_GAME_TYPE) return;
  // Any Classic game_started drops the previous next-game context: only a fresh marker below can set a new one.
  nextGameContext = null;
  const state = loadState(storage);
  const marker = state.marker;
  if (marker === null) return;
  saveState(storage, { ...state, marker: null });
  const sessionId = sessionIdSource();
  if (marker.sessionId !== sessionId) return;
  const who = participation();
  const ifx = who !== null ? ifxContextOf(who) : {};
  track("interstitial_continuation", { arm: marker.arm, outcome: marker.outcome, gamesBetweenAds: marker.gamesBetweenAds, ...ifx });
  nextGameContext = { sessionId, outcome: nextGameOutcomeOf(marker.arm, marker.outcome), ifxCell: ifx.ifxCell ?? null };
}

function nextGameOutcomeOf(arm: InterstitialArm, outcome: InterstitialOutcome): NextGameOutcome {
  if (arm === "control") return outcome === "suppressed" ? "control_suppressed" : "control";
  return outcome === "control" ? "control" : outcome;
}

/**
 * A Classic game_completed asks for the context of the checkpoint that preceded this game. Take-and-clear:
 * it returns the context once, then nothing. Null for any other game type (which leaves it untouched), when
 * there is no context (no checkpoint before this game, or a newer game_started cleared it), or when it
 * belongs to another analytics session. The result is spread into game_completed's params.
 */
export function takeNextGameContext(gameType: GameType): NextGameContext | null {
  if (gameType !== ELIGIBLE_GAME_TYPE) return null;
  const ctx = nextGameContext;
  nextGameContext = null;
  if (ctx === null || ctx.sessionId !== sessionIdSource()) return null;
  return { nextOutcome: ctx.outcome, ...(ctx.ifxCell !== null ? { ifxCell: ctx.ifxCell } : {}) };
}

// --- Observers ----------------------------------------------------------------------

/**
 * Rewarded is observed ONLY through its existing lifecycle subscription - nothing in
 * rewardedAds.ts changes. "shown" there is the moment the rewarded ad is handed to the
 * SDK, which is exactly "a rewarded ad was presented in this result cycle".
 */
function connectObservers(): void {
  subscribeRewardedAdEvents("interstitial-collision", (event) => {
    if (event === "shown") rewardedShownThisCycle = true;
  });
  subscribeInterstitialLifecycle("interstitial-analytics", (event) => {
    if (event.type === "load_failed") {
      track("interstitial_load_failed", {
        reason: event.reason,
        attempt: event.attempt,
        ...(event.code !== undefined ? { code: event.code } : {}),
        latency: adLatencyBucket(event.latencyMs),
      });
    } else if (event.type === "dismissed") track("interstitial_dismissed", {});
  });
}

connectObservers();

// --- QA / tests ---------------------------------------------------------------------

export function getInterstitialControllerDebugInfo(): {
  participation: Participation | null;
  state: ReturnType<typeof loadState>;
  dueThisCycle: boolean;
  rewardedShownThisCycle: boolean;
  attemptsForUpcoming: number;
} {
  return {
    participation: participation(),
    state: loadState(storage),
    dueThisCycle,
    rewardedShownThisCycle,
    attemptsForUpcoming,
  };
}

export function _resetInterstitialControllerForTests(options: {
  track?: TrackFn;
  storage?: InterstitialStorage;
  ifxStorage?: InterstitialStorage;
  sessionId?: () => string;
  installationId?: () => string | null;
} = {}): void {
  track = options.track ?? trackEvent;
  storage = options.storage ?? localInterstitialStorage;
  ifxStorage = options.ifxStorage ?? localIfxStorage;
  snapshotCache = null;
  sessionIdSource = options.sessionId ?? (() => getSessionId());
  installationIdSource = options.installationId ?? getPersistedInstallationId;
  rewardedShownThisCycle = false;
  rewardedRenderedThisCycle = false;
  deferredThisCycle = false;
  laneReservedForOpportunity = false;
  dueThisCycle = false;
  dueArmThisCycle = null;
  attemptsForUpcoming = 0;
  lastAttemptSince = -1;
  attemptSessionId = null;
  checkpointInFlight = false;
  nextGameContext = null;
  _resetPlaySegmentSummaryForTests({ track: options.track });
  connectObservers();
}
