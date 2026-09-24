// The interstitial ad service: one cached ad, its own state machine, and the only
// code that ever calls an interstitial show. Fully independent of rewardedAds.ts -
// no shared state, promise, timer, adapter or gate variable - so the two formats
// can each hold a loaded ad and neither can wedge the other.
//
//   idle -> loading -> ready -> showing -> (release) -> idle
//
// Contracts this file exists to keep:
//   - A load NEVER shows anything. A Loaded that arrives after we gave up on it is
//     ignored, and a Loaded that arrives in time only makes the state "ready". The
//     one show call site is present(), which only interstitialController.ts calls,
//     only at a valid checkpoint.
//   - present() never waits for a LOAD. Not ready -> "not_ready", immediately.
//   - "shown" means the SDK's own Showed callback, and nothing else: not the show
//     promise resolving, not the page going hidden.
//   - "dismissed" (the analytics event) means the SDK's Dismissed callback, and
//     nothing else. The page becoming visible again may RELEASE gameplay, but it
//     never fabricates a Dismissed.
//   - Showed does not release gameplay. Release is settle-once, from Dismissed, the
//     page returning to visible after having been hidden, or a long safety timeout.
//   - The safety timeout NEVER continues into the next round. It only frees the ad
//     state and returns control to the Result screen ("stay"); the player's next tap
//     continues. Stage-0 (vc46, Mi 8) showed why: that WebView never fires
//     visibilitychange under an interstitial, so after 120 s with the ad still up the
//     old timeout started the next round behind it.

import { getAdUnitId, isAdFormatEnabled } from "./adConfig";
import type { AdPlatform } from "./adTypes";
import type { InterstitialFailureReason } from "./interstitialConfigSchema";

// --- Adapter seam -------------------------------------------------------------------

/** Native lifecycle callbacks, forwarded 1:1 from the SDK. `code` is the Google Mobile Ads numeric error code. */
export type InterstitialNativeEvent =
  | { type: "showed" }
  | { type: "failedToShow"; code?: number }
  | { type: "dismissed" };

/** A rejected load carries the numeric GMA code when the plugin reported one. Never an SDK message. */
export type InterstitialLoadError = { code?: number };

export type InterstitialAdapter = {
  name: string;
  /** Resolves when an ad is loaded and ready; rejects with an InterstitialLoadError. */
  load(adUnitId: string): Promise<void>;
  /** Asks the SDK to present the loaded ad. Resolving means "handed over", NOT "visible". */
  show(): Promise<void>;
  /** Wires the one listener for Showed/FailedToShow/Dismissed. Called once at registration. */
  setListener(listener: (event: InterstitialNativeEvent) => void): void;
};

// --- Lifecycle output (analytics bridge / QA) ---------------------------------------

export type InterstitialLifecycleEvent =
  | { type: "load_started" }
  | { type: "loaded"; latencyMs: number }
  | { type: "load_failed"; reason: InterstitialFailureReason }
  | { type: "showed"; latencyMs: number }
  | { type: "dismissed" };

// --- Environment (injectable for tests) ---------------------------------------------

export type InterstitialEnv = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  isHidden(): boolean;
  /** Subscribe to page visibility changes; returns an unsubscribe. */
  onVisibilityChange(listener: () => void): () => void;
  platform(): AdPlatform;
};

const browserEnv: InterstitialEnv = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  isHidden: () => {
    try {
      return document.visibilityState === "hidden";
    } catch {
      return false;
    }
  },
  onVisibilityChange: (listener) => {
    try {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    } catch {
      return () => {};
    }
  },
  platform: () => {
    try {
      const cap = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
      if (cap?.getPlatform?.() === "ios") return "ios";
    } catch {
      // not a browser-like environment
    }
    return "android";
  },
};

// --- Timing -------------------------------------------------------------------------

/**
 * A load nobody is waiting for still needs a ceiling, or a wedged SDK would hold
 * the state at "loading" and block every later preload. No player ever waits on it.
 */
const LOAD_TIMEOUT_MS = 30_000;
/**
 * How long present() waits for ANY evidence of the ad (Showed, FailedToShow, a
 * rejection, or the page going hidden) before failing safe and continuing. Short on
 * purpose - the player is sitting on a tapped button. PROVISIONAL: Stage-0 QA measures
 * the real Showed latency (exposed as `showedLatencyMs`) before this is finalized.
 */
const DECISION_TIMEOUT_MS = 2_500;
/**
 * Last-resort release while an ad is (or may be) on screen and neither Dismissed nor
 * a return to visible has arrived. Long, because releasing too early starts a timed
 * round behind a visible ad.
 */
const RELEASE_SAFETY_TIMEOUT_MS = 120_000;

let loadTimeoutMs = LOAD_TIMEOUT_MS;
let decisionTimeoutMs = DECISION_TIMEOUT_MS;
let releaseSafetyTimeoutMs = RELEASE_SAFETY_TIMEOUT_MS;

// --- Gates --------------------------------------------------------------------------

/**
 * Each gate defaults to CLOSED - unlike rewardedAds.ts, whose defaults stay open for
 * its pre-consent test suite. nativeAdsSetup.ts registers the live ones.
 */
export type InterstitialGates = {
  /** UMP canRequestAds. */
  consent: () => boolean;
  /** The existing global remote ads switch (/api/config/ads), unchanged and shared. */
  remoteAds: () => boolean;
  /** The interstitial config's LIVE `enabled` - the interstitial-only emergency switch. */
  interstitialEnabled: () => boolean;
};

const CLOSED_GATES: InterstitialGates = { consent: () => false, remoteAds: () => false, interstitialEnabled: () => false };
let gates: InterstitialGates = CLOSED_GATES;

export function registerInterstitialGates(next: Partial<InterstitialGates>): void {
  gates = { ...gates, ...next };
}

// --- State --------------------------------------------------------------------------

export type InterstitialState = "idle" | "loading" | "ready" | "showing";

let env: InterstitialEnv = browserEnv;
let adapter: InterstitialAdapter | null = null;
let state: InterstitialState = "idle";
/** Increments per load; a completion from an older load (timed out, superseded) is ignored. */
let loadGeneration = 0;
/** The show currently in progress, if any; receives native callbacks. */
let activeShow: ShowSession | null = null;
/** An ad that reached Showed and whose Dismissed has not arrived yet - so a late Dismissed is still reported once. */
let awaitingDismissed = false;
let lastShowedLatencyMs: number | null = null;
let lastLoadLatencyMs: number | null = null;
const lifecycleListeners = new Map<string, (event: InterstitialLifecycleEvent) => void>();

export function subscribeInterstitialLifecycle(name: string, listener: (event: InterstitialLifecycleEvent) => void): () => void {
  lifecycleListeners.set(name, listener);
  return () => {
    lifecycleListeners.delete(name);
  };
}

function emit(event: InterstitialLifecycleEvent): void {
  for (const listener of lifecycleListeners.values()) {
    try {
      listener(event);
    } catch {
      // an observer can never affect the ad flow
    }
  }
}

export function registerInterstitialAdapter(next: InterstitialAdapter): void {
  adapter = next;
  next.setListener(handleNativeEvent);
}

export function getInterstitialState(): InterstitialState {
  return state;
}

export function isInterstitialReady(): boolean {
  return state === "ready";
}

/** Null when an interstitial could be requested right now. */
function blockReason(): "blocked" | "not_configured" | null {
  if (!isAdFormatEnabled("interstitial")) return "blocked";
  if (!gates.remoteAds() || !gates.interstitialEnabled() || !gates.consent()) return "blocked";
  if (adapter === null) return "blocked";
  if (getAdUnitId("interstitial", env.platform()) === "") return "not_configured";
  return null;
}

// --- Load ---------------------------------------------------------------------------

/**
 * Google Mobile Ads LoadAdError codes -> the bounded vocabulary.
 * 0 INTERNAL_ERROR, 1 INVALID_REQUEST, 2 NETWORK_ERROR, 3 NO_FILL, 8 APP_ID_MISSING,
 * 9 MEDIATION_NO_FILL, 10 REQUEST_ID_MISMATCH, 11 INVALID_AD_STRING.
 */
export function classifyInterstitialLoadError(error: unknown): InterstitialFailureReason {
  const code = (error as InterstitialLoadError | null)?.code;
  if (typeof code !== "number") return "sdk_error";
  switch (code) {
    case 3:
    case 9:
      return "no_fill";
    case 2:
      return "network_error";
    case 1:
    case 8:
    case 10:
      return "not_configured";
    default:
      return "sdk_error";
  }
}

/**
 * Start ONE load, if nothing is loading/loaded/showing and every gate is open.
 * Fire-and-forget: returns whether a load actually started, never rejects. The
 * controller decides WHEN (one attempt per upcoming opportunity); this decides
 * WHETHER it may.
 */
export function preloadInterstitial(): boolean {
  if (state !== "idle") return false;
  const blocked = blockReason();
  if (blocked === "not_configured") {
    emit({ type: "load_failed", reason: "not_configured" });
    return false;
  }
  if (blocked !== null) return false;

  const generation = ++loadGeneration;
  const startedAt = env.now();
  state = "loading";
  emit({ type: "load_started" });

  let settled = false;
  const timer = env.setTimeout(() => {
    if (settled || generation !== loadGeneration) return;
    settled = true;
    state = "idle";
    // Bumping the generation is what makes a Loaded that arrives after this a no-op.
    loadGeneration++;
    emit({ type: "load_failed", reason: "timeout" });
  }, loadTimeoutMs);

  let pending: Promise<void>;
  try {
    pending = adapter!.load(getAdUnitId("interstitial", env.platform()));
  } catch (err) {
    pending = Promise.reject(err);
  }
  pending.then(
    () => {
      if (settled || generation !== loadGeneration) return;
      settled = true;
      env.clearTimeout(timer);
      // The emergency switch may have flipped off while loading: keep nothing
      // presentable around (the SDK may hold it, but state never says "ready").
      if (!gates.interstitialEnabled()) {
        state = "idle";
        return;
      }
      state = "ready";
      lastLoadLatencyMs = env.now() - startedAt;
      emit({ type: "loaded", latencyMs: lastLoadLatencyMs });
    },
    (err) => {
      if (settled || generation !== loadGeneration) return;
      settled = true;
      env.clearTimeout(timer);
      state = "idle";
      emit({ type: "load_failed", reason: classifyInterstitialLoadError(err) });
    },
  );
  return true;
}

// --- Show ---------------------------------------------------------------------------

export type PresentOutcome =
  | { outcome: "not_ready" }
  | { outcome: "shown" }
  | { outcome: "show_failed"; reason: InterstitialFailureReason };

/**
 * How a presented ad let go of gameplay:
 * - "continue": the ad is gone (Dismissed, back in front after being covered) or never
 *   appeared (failed/no signal) - navigate as the player asked.
 * - "stay":     the long safety timeout fired. The ad may still be on screen, so the
 *   game stays on the Result screen and waits for the player's next explicit action.
 */
export type InterstitialRelease = "continue" | "stay";

export type PresentCallbacks = {
  /** Fires exactly once, as soon as the outcome is KNOWN - before release. */
  onOutcome(result: PresentOutcome): void;
};

type ShowSession = {
  decided: boolean;
  released: boolean;
  sawHidden: boolean;
  startedAt: number;
  handle(event: InterstitialNativeEvent): void;
};

function handleNativeEvent(event: InterstitialNativeEvent): void {
  if (event.type === "dismissed" && awaitingDismissed) {
    // Reported from the real callback only, and once, even if gameplay was already
    // released by the page becoming visible first.
    awaitingDismissed = false;
    emit({ type: "dismissed" });
  }
  activeShow?.handle(event);
}

/**
 * Present the loaded ad at a checkpoint. When nothing is ready (or a gate - including
 * the live emergency switch - is closed), `onOutcome` fires synchronously with
 * "not_ready" and this returns null: there is nothing to wait for. Otherwise it
 * returns a promise that resolves once, with how gameplay was released, and never
 * rejects.
 */
export function presentInterstitial(callbacks: PresentCallbacks): Promise<InterstitialRelease> | null {
  if (state !== "ready" || blockReason() !== null || adapter === null) {
    callbacks.onOutcome({ outcome: "not_ready" });
    return null;
  }

  state = "showing";
  const showAdapter = adapter;

  return new Promise<InterstitialRelease>((resolveRelease) => {
    let decisionTimer: unknown = null;
    let safetyTimer: unknown = null;
    let unsubscribeVisibility: () => void = () => {};

    const session: ShowSession = {
      decided: false,
      released: false,
      sawHidden: false,
      startedAt: env.now(),
      handle(event) {
        if (session.released) return;
        if (event.type === "showed") {
          lastShowedLatencyMs = env.now() - session.startedAt;
          emit({ type: "showed", latencyMs: lastShowedLatencyMs });
          awaitingDismissed = true;
          decide({ outcome: "shown" });
          // Showed does NOT release: the ad is on screen now.
          armSafety();
        } else if (event.type === "failedToShow") {
          decide({ outcome: "show_failed", reason: "sdk_error" });
          release();
        } else if (event.type === "dismissed") {
          if (!session.decided) decide({ outcome: "show_failed", reason: "sdk_error" });
          release();
        }
      },
    };

    function decide(result: PresentOutcome): void {
      if (session.decided) return;
      session.decided = true;
      if (decisionTimer !== null) env.clearTimeout(decisionTimer);
      decisionTimer = null;
      try {
        callbacks.onOutcome(result);
      } catch {
        // the caller's bookkeeping must never wedge the ad state
      }
    }

    function armSafety(): void {
      if (safetyTimer !== null) return;
      safetyTimer = env.setTimeout(() => {
        // Lost Dismissed and no visibility return - OR simply an ad still open after
        // this long. Never "shown" from here, and never onward into the next round:
        // free the state and stay on the Result screen. A Dismissed that arrives
        // later is still reported (handleNativeEvent) and changes nothing else.
        if (!session.decided) decide({ outcome: "show_failed", reason: "timeout" });
        release("stay");
      }, releaseSafetyTimeoutMs);
    }

    function release(how: InterstitialRelease = "continue"): void {
      if (session.released) return;
      session.released = true;
      if (decisionTimer !== null) env.clearTimeout(decisionTimer);
      if (safetyTimer !== null) env.clearTimeout(safetyTimer);
      unsubscribeVisibility();
      if (activeShow === session) activeShow = null;
      state = "idle";
      resolveRelease(how);
    }

    unsubscribeVisibility = env.onVisibilityChange(() => {
      if (session.released) return;
      if (env.isHidden()) {
        // Something covered the WebView. Evidence enough to stop the no-signal
        // timer (so the next round cannot start behind a real ad), but NOT
        // evidence that the ad showed - that stays the Showed callback's alone.
        session.sawHidden = true;
        if (decisionTimer !== null) env.clearTimeout(decisionTimer);
        decisionTimer = null;
        armSafety();
      } else if (session.sawHidden) {
        // Back in front after having been covered: gameplay may continue. If Showed
        // never arrived, the ad is not counted as shown.
        if (!session.decided) decide({ outcome: "show_failed", reason: "timeout" });
        release();
      }
    });

    decisionTimer = env.setTimeout(() => {
      decisionTimer = null;
      if (session.decided || session.sawHidden) return;
      // No Showed, no failure, no rejection, never hidden: fail safe and continue.
      decide({ outcome: "show_failed", reason: "timeout" });
      release();
    }, decisionTimeoutMs);

    activeShow = session;

    let shown: Promise<void>;
    try {
      shown = showAdapter.show();
    } catch (err) {
      shown = Promise.reject(err);
    }
    shown.then(
      () => {
        // "Handed over" only. Deliberately no state change.
      },
      () => {
        if (session.released) return;
        if (!session.decided) {
          decide({ outcome: "show_failed", reason: "sdk_error" });
          release();
        }
      },
    );
  });
}

// --- QA / tests ---------------------------------------------------------------------

export function getInterstitialDebugInfo(): {
  state: InterstitialState;
  showedLatencyMs: number | null;
  loadLatencyMs: number | null;
  adapter: string | null;
  decisionTimeoutMs: number;
  releaseSafetyTimeoutMs: number;
} {
  return {
    state,
    showedLatencyMs: lastShowedLatencyMs,
    loadLatencyMs: lastLoadLatencyMs,
    adapter: adapter?.name ?? null,
    decisionTimeoutMs,
    releaseSafetyTimeoutMs,
  };
}

export function _resetInterstitialAdsForTests(testEnv?: InterstitialEnv): void {
  env = testEnv ?? browserEnv;
  adapter = null;
  state = "idle";
  loadGeneration = 0;
  activeShow = null;
  awaitingDismissed = false;
  lastShowedLatencyMs = null;
  lastLoadLatencyMs = null;
  lifecycleListeners.clear();
  gates = CLOSED_GATES;
  loadTimeoutMs = LOAD_TIMEOUT_MS;
  decisionTimeoutMs = DECISION_TIMEOUT_MS;
  releaseSafetyTimeoutMs = RELEASE_SAFETY_TIMEOUT_MS;
}

export function _setInterstitialTimeoutsForTests(timeouts: { load?: number; decision?: number; safety?: number }): void {
  if (timeouts.load !== undefined) loadTimeoutMs = timeouts.load;
  if (timeouts.decision !== undefined) decisionTimeoutMs = timeouts.decision;
  if (timeouts.safety !== undefined) releaseSafetyTimeoutMs = timeouts.safety;
}
