// The single call surface for rewarded ads - screens/services import from here
// (via ads/index.ts) and NEVER touch an ad SDK, ad unit ID, or adapter directly,
// mirroring the analytics.ts pattern. Everything here is fail-safe by design:
// no adapter, ads disabled, SDK missing, load failure, or timeout all resolve to
// a normal "unavailable"/"error" result - never a thrown error, never a hang.
//
// Lifecycle observability: every flow emits RewardedAdLifecycleEvent moments to
// (a) globally subscribed listeners (how adAnalytics.ts records events without
// this file knowing analytics exists) and (b) an optional per-call `onEvent`
// callback for UI (spinners, button states). Neither is required - calling
// showRewardedAd(placement) alone is a complete integration.
//
// A reward is reported ONLY when the adapter resolves with a verified reward item (the
// SDK's own reward event). An ad closed without one resolves the adapter with null, which
// yields "dismissed" - no reward, no error. The adapter (admobAdapter.ts) is what turns the
// plugin's Dismissed event into that null; the plugin's own show call never settles on a close.

import { isAdFormatEnabled, getRewardedAdUnitId } from "./adConfig";
import { isRewardedAdPlacement, rewardedUnitFor, type RewardedAdPlacement, type RewardedUnit } from "./adPlacements";
import { adLatencyBucket, isAdErrorCode, type AdLoadSource, type AdNotReadyCause, type RewardedTapState } from "./adDiagnostics";
import type {
  AdAdapter,
  AdFailureReason,
  AdPlatform,
  RewardedAdEventDetail,
  RewardedAdLifecycleEvent,
  RewardedAdListener,
  RewardedAdResult,
} from "./adTypes";

// Time budgets. A wedged SDK can never stall gameplay or hold a load open forever:
//  - a background LOAD is allowed to finish late (an opportunity-aware window, not the old
//    8 s JS cutoff that discarded loads the SDK was about to deliver) but is abandoned at a
//    hard safety expiry;
//  - the player's TAP waits at most TAP_WAIT_MS for a load that is still in flight;
//  - a loaded ad is used only within READY_TTL_MS (GMA ads expire after about an hour);
//  - an on-screen ad gets SHOW_TIMEOUT_MS before we report an error (the ad may still be
//    visible - the OS owns that surface - but game code regains control).
// With the lifecycle kill switch off (registerRewardedLifecycleGate -> false) the 0.55
// numbers apply instead: an 8 s load window, the tap waits for it, no expiry, no cooldown.
const HARD_LOAD_EXPIRY_MS = 75_000;
const LEGACY_LOAD_TIMEOUT_MS = 8000;
const TAP_WAIT_MS = 4000;
const READY_TTL_MS = 50 * 60_000;
/** After a failed load, an automatic preload waits this long before asking again (no churn on no_fill). */
const FAILED_COOLDOWN_MS = 15_000;
const SHOW_TIMEOUT_MS = 90_000;
let hardLoadExpiryMs = HARD_LOAD_EXPIRY_MS;
let tapWaitMs = TAP_WAIT_MS;
let readyTtlMs = READY_TTL_MS;
let failedCooldownMs = FAILED_COOLDOWN_MS;
let showTimeoutMs = SHOW_TIMEOUT_MS;
let now: () => number = () => Date.now();

// Keyed by adapter name so re-registering (HMR, StrictMode double-effects)
// replaces rather than duplicates. Only one adapter is ever used: the last
// registered wins - there is no scenario with two live ad SDKs.
const adapters = new Map<string, AdAdapter>();

/**
 * Register a concrete ad SDK integration (e.g. a Capacitor AdMob adapter created
 * by createAdMobAdapter() once the native wrapper exists). Until something is
 * registered, every ad call resolves "unavailable" and gameplay is unaffected.
 */
export function registerAdAdapter(adapter: AdAdapter): void {
  adapters.set(adapter.name, adapter);
}

function activeAdapter(): AdAdapter | undefined {
  let last: AdAdapter | undefined;
  for (const adapter of adapters.values()) last = adapter;
  return last;
}

// Defaults to "allowed" only so the pre-existing test suite (written before
// consent existed) keeps passing unmodified. The real native bootstrap
// (services/ads/nativeAdsSetup.ts) always registers a live gate reading the
// actual UMP consent state before anything ad-side can run, so the effective
// default in the shipped app is fail-closed, not this fallback.
let consentGate: () => boolean = () => true;

/** Register the live consent check every rewarded-ad request must pass first. */
export function registerAdConsentGate(gate: () => boolean): void {
  consentGate = gate;
}

// Same test-compatibility rationale as consentGate above: defaults to "allowed"
// so the pre-existing test suite keeps passing unmodified. The real native
// bootstrap (nativeAdsSetup.ts) always registers a live gate reading the actual
// remote kill switch (remoteKillSwitch.ts) before anything ad-side can run, so
// the effective default in the shipped app is fail-closed, not this fallback.
let remoteAdsGate: () => boolean = () => true;

/** Register the live remote-kill-switch check every rewarded-ad request must pass, alongside the consent gate. */
export function registerRemoteAdsGate(gate: () => boolean): void {
  remoteAdsGate = gate;
}

// The rewarded lifecycle v2 kill switch (see the state machine below). Defaults to ON - v2
// is the shipped behavior - and nativeAdsSetup.ts registers the live remote flag, so a
// native-lifecycle regression can be backed out without another APK. Off = the 0.55 timing.
let lifecycleV2Gate: () => boolean = () => true;

/** Register the live remote switch for the rewarded lifecycle v2 (true = v2, false = 0.55 timing). */
export function registerRewardedLifecycleGate(gate: () => boolean): void {
  lifecycleV2Gate = gate;
}

function lifecycleV2(): boolean {
  try {
    return lifecycleV2Gate();
  } catch {
    return true;
  }
}

// --- Lifecycle event fan-out ---------------------------------------------------

// Keyed by listener name for the same HMR/StrictMode replace-not-duplicate
// behavior as the adapter registry and analytics providers.
const listeners = new Map<string, RewardedAdListener>();

/** Subscribe to every rewarded ad lifecycle event (analytics bridge, debugging). Returns an unsubscribe. */
export function subscribeRewardedAdEvents(name: string, listener: RewardedAdListener): () => void {
  listeners.set(name, listener);
  return () => {
    listeners.delete(name);
  };
}

type DetailExtras = Omit<RewardedAdEventDetail, "placement" | "reason">;

function emit(
  event: RewardedAdLifecycleEvent,
  placement: RewardedAdPlacement,
  reason: AdFailureReason | undefined,
  onEvent: RewardedAdListener | undefined,
  extras: DetailExtras = {},
): void {
  const detail: RewardedAdEventDetail = reason ? { placement, reason, ...extras } : { placement, ...extras };
  for (const listener of listeners.values()) {
    try {
      listener(event, detail);
    } catch {
      // A broken observer must never affect the ad flow or gameplay.
    }
  }
  try {
    onEvent?.(event, detail);
  } catch {
    // Same guarantee for the per-call callback.
  }
}

// --- Environment ----------------------------------------------------------------

// The game runs on the web today; platform only matters once a native wrapper
// exists. Capacitor (the expected wrapper) exposes getPlatform() on window.
function detectPlatform(): AdPlatform {
  try {
    const cap = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    if (cap?.getPlatform?.() === "ios") return "ios";
  } catch {
    // Not in a browser-like environment; android default is harmless (no adapter there anyway).
  }
  return "android";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// --- Rewarded lifecycle state machine ---------------------------------------------
//
//   idle -> loading -> ready -> showing -> idle
//              |         '-> expired (a loaded ad outlived READY_TTL_MS)
//              '-> failed (SDK failure, or the hard load expiry)
//
// 0.57.1 - TWO UNITS, ONE LANE. Coin and Ink placements serve from different AdMob units (adPlacements.ts
// rewardedUnitFor), but the native plugin holds ONE prepared rewarded ad, and so does this lane: one load at a time,
// one ready ad, tagged with the unit it was loaded for (`loadUnit`). A request for the OTHER unit never starts a
// second concurrent load and never shows the wrong unit's ad: a ready / failed / expired ad of the other unit is
// simply set aside (state -> idle) and the requested unit is loaded; a load still in flight for the other unit is
// left to finish. Before 0.57.1 every placement was the coin unit, so for coin-only traffic nothing changes.
//
// One native load at a time: a load is never started while `nativeLoadActive`. Every load
// carries a generation (`loadSeq`); a callback from an older load (abandoned at the hard
// expiry, superseded, or from before a lifecycle reset) finds a different generation and
// changes nothing. A load that finishes late but inside the hard expiry is accepted -
// the ad is as good as one that finished early, and the next offer can use it.

type RewardedState = "idle" | "loading" | "ready" | "failed" | "expired" | "showing";
let state: RewardedState = "idle";
// Bumped whenever the current load stops being the one that counts.
let loadSeq = 0;
// True from the native prepare call until THAT call settles or is abandoned at the hard expiry.
let nativeLoadActive = false;
let loadStartedAt = 0;
let loadPlacement: RewardedAdPlacement | null = null;
/** The unit the current load / ready ad belongs to (0.57.1). */
let loadUnit: RewardedUnit = "coin";
let loadSource: AdLoadSource = "preload";
let loadReported = false;
// The per-call UI callback of the call that started the load, so its spinner hears "loaded".
let loadOnEvent: RewardedAdListener | undefined;
let hardExpiryTimer: ReturnType<typeof setTimeout> | null = null;
let readyAt = 0;
let failedAt = -Infinity;
// Why the last load attempt failed - reported if a show then finds nothing loaded.
let lastLoadFailure: AdFailureReason = "load_failed";
let lastLoadCode: number | undefined;
let lastLoadLatencyMs = 0;
// Taps waiting (bounded) on the load in flight.
const waiters = new Set<() => void>();

function settleWaiters(): void {
  for (const wake of [...waiters]) wake();
}

/** The blocking reason right now, or null when a rewarded ad could actually be served. */
function rewardedBlockReason(unit: RewardedUnit = "coin"): AdFailureReason | null {
  if (!isAdFormatEnabled("rewarded")) return "ads_disabled";
  if (!remoteAdsGate()) return "ads_disabled";
  if (!consentGate()) return "consent_blocked";
  if (activeAdapter() === undefined) return "no_adapter";
  if (getRewardedAdUnitId(unit, detectPlatform()) === "") return "not_configured";
  return null;
}

/**
 * True only when everything needed to actually serve a rewarded ad is in place - for the unit of `placement`
 * (no placement = the coin unit, the pre-0.57.1 meaning every existing caller relies on).
 */
export function isRewardedAdAvailable(placement?: RewardedAdPlacement): boolean {
  return rewardedBlockReason(placement ? rewardedUnitFor(placement) : "coin") === null;
}

/** Is this unit's production ID configured in this build? (Always true in dev / test-ads builds.) */
export function isRewardedUnitConfigured(unit: RewardedUnit): boolean {
  return getRewardedAdUnitId(unit, detectPlatform()) !== "";
}

/**
 * A request for `unit` meets a settled ad of the OTHER unit (ready, failed or expired): set it aside so the
 * requested unit can load. Never touches a load in flight or an ad on screen. (A failure of the other unit
 * therefore never holds this unit in its cooldown.)
 */
function releaseOtherUnit(unit: RewardedUnit): void {
  if (loadUnit === unit) return;
  if (state === "ready" || state === "failed" || state === "expired") state = "idle";
}

/**
 * Time-based transitions, evaluated lazily whenever the state is read - so a WebView that
 * was suspended in the background (its timers frozen) still lands in the right state the
 * moment anyone looks. A load past the hard expiry is abandoned, a loaded ad past its TTL
 * is expired.
 */
function refreshLifecycle(): void {
  if (state === "loading" && now() - loadStartedAt >= (lifecycleV2() ? hardLoadExpiryMs : LEGACY_LOAD_TIMEOUT_MS)) {
    failLoad("timeout", undefined, true);
  } else if (state === "ready" && lifecycleV2() && now() - readyAt >= readyTtlMs) {
    state = "expired";
  }
}

/** A rewarded ad is loaded and can be shown immediately (use to decide whether to render a "watch ad" button). */
export function isRewardedAdReady(): boolean {
  refreshLifecycle();
  return state === "ready";
}

/** The current lifecycle state, for the tap's diagnostics and QA. */
export function getRewardedLifecycleState(): RewardedTapState {
  refreshLifecycle();
  return state;
}

/**
 * Classify a rejected LOAD. The numeric GMA code (from the plugin's FailedToLoad event,
 * carried on the rejection) is authoritative: 3 NO_FILL and 9 MEDIATION_NO_FILL are an
 * empty auction, not a fault. Without a code the message text is the fallback - "No fill."
 * is that SDK's wording for NO_FILL, verified on a real device - so an empty auction never
 * masquerades as a broken SDK. The text is read from an Error or from a plain object with a
 * string `message` (what the adapter throws when the plugin rejects but FailedToLoad never
 * fired); a bare string or anything else is not read. The message is used for this
 * classification only - it never leaves this function. Load-only: a show can never surface a no-fill.
 */
function loadFailureMessage(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : undefined;
}

function classifyLoadFailure(err: unknown): { reason: AdFailureReason; code: number | undefined } {
  const code = (err as { code?: unknown } | null)?.code;
  const numeric = isAdErrorCode(code) ? code : undefined;
  if (numeric === 3 || numeric === 9) return { reason: "no_fill", code: numeric };
  if (numeric !== undefined) return { reason: "sdk_error", code: numeric };
  const message = loadFailureMessage(err);
  if (message === undefined) return { reason: "sdk_error", code: undefined };
  if (message.includes("timed out")) return { reason: "timeout", code: undefined };
  if (/no fill/i.test(message)) return { reason: "no_fill", code: undefined };
  return { reason: "sdk_error", code: undefined };
}

function clearHardExpiry(): void {
  if (hardExpiryTimer !== null) clearTimeout(hardExpiryTimer);
  hardExpiryTimer = null;
}

/**
 * The current load ended without an ad. `abandon` = the hard expiry: the generation is
 * bumped so a native callback that arrives later is ignored (nothing can revive state).
 * A background preload owns its failure report - nobody else will ever hear about it; a
 * load a tap is waiting on is reported by that tap (one failure, one record).
 */
function failLoad(reason: AdFailureReason, code: number | undefined, abandon: boolean): void {
  const placement = loadPlacement;
  clearHardExpiry();
  if (abandon) {
    loadSeq++;
    nativeLoadActive = false;
  }
  state = "failed";
  failedAt = now();
  lastLoadFailure = reason;
  lastLoadCode = code;
  lastLoadLatencyMs = now() - loadStartedAt;
  if (loadSource === "preload" && placement && !loadReported) {
    loadReported = true;
    emit("unavailable", placement, reason, loadOnEvent, {
      source: "preload",
      ...(code !== undefined ? { code } : {}),
      latency: adLatencyBucket(lastLoadLatencyMs),
    });
  }
  settleWaiters();
}

function startLoad(adapter: AdAdapter, placement: RewardedAdPlacement, source: AdLoadSource, onEvent?: RewardedAdListener): void {
  const seq = ++loadSeq;
  state = "loading";
  nativeLoadActive = true;
  loadStartedAt = now();
  loadPlacement = placement;
  loadUnit = rewardedUnitFor(placement);
  loadSource = source;
  loadReported = false;
  loadOnEvent = onEvent;
  emit("loading", placement, undefined, onEvent);

  clearHardExpiry();
  hardExpiryTimer = setTimeout(
    () => {
      if (seq === loadSeq && state === "loading") failLoad("timeout", undefined, true);
    },
    lifecycleV2() ? hardLoadExpiryMs : LEGACY_LOAD_TIMEOUT_MS,
  );
  // Never keep a (test) process alive for a safety timer; browsers have no unref.
  (hardExpiryTimer as { unref?: () => void }).unref?.();

  let pending: Promise<void>;
  try {
    pending = adapter.loadRewarded(getRewardedAdUnitId(loadUnit, detectPlatform()));
  } catch (err) {
    pending = Promise.reject(err);
  }
  pending.then(
    () => {
      if (seq !== loadSeq) return; // abandoned or superseded: a stale success changes nothing
      nativeLoadActive = false;
      clearHardExpiry();
      state = "ready";
      readyAt = now();
      lastLoadLatencyMs = readyAt - loadStartedAt;
      emit("loaded", placement, undefined, loadOnEvent, { source, latency: adLatencyBucket(lastLoadLatencyMs) });
      settleWaiters();
    },
    (err) => {
      if (seq !== loadSeq) return;
      nativeLoadActive = false;
      const { reason, code } = classifyLoadFailure(err);
      failLoad(reason, code, false);
    },
  );
}

/**
 * Pre-cache a rewarded ad so a later showRewardedAd() is instant. Fire-and-forget
 * safe: resolves quietly (no throw, no game impact) whether it loads or not, and never
 * waits for the load - it returns as soon as the request is on its way.
 * `placement` names the trigger point this preload is for (lifecycle/analytics
 * attribution) and must be one of the closed REWARDED_AD_PLACEMENTS values.
 *
 * Starts a load only when nothing is loaded or loading, no native load is still active,
 * and (after a failure) the cooldown has passed - so callers can invoke it freely without
 * ever creating overlapping or churning requests. A failure is REPORTED to the lifecycle
 * stream (and so to analytics) - otherwise requests that never fill leave no trace.
 */
export async function preloadRewardedAd(placement: RewardedAdPlacement, onEvent?: RewardedAdListener): Promise<void> {
  if (!isRewardedAdPlacement(placement)) return;
  const unit = rewardedUnitFor(placement);
  if (rewardedBlockReason(unit) !== null) return;
  refreshLifecycle();
  releaseOtherUnit(unit);
  if (state === "loading" || state === "ready" || state === "showing" || nativeLoadActive) return;
  if (state === "failed" && lifecycleV2() && now() - failedAt < failedCooldownMs) return;
  startLoad(activeAdapter()!, placement, "preload", onEvent);
  // Callers fire and forget (nothing in the game awaits this); the returned promise only
  // settles when the load does, bounded by the hard expiry, for callers that want to know.
  await waitForLoad((lifecycleV2() ? hardLoadExpiryMs : LEGACY_LOAD_TIMEOUT_MS) + 1000);
}

function notReadyCause(at: RewardedTapState): AdNotReadyCause {
  switch (at) {
    case "failed":
      return "failed";
    case "loading":
      return "loading";
    case "expired":
      return "expired";
    default:
      return "not_attempted";
  }
}

/** Resolves when the in-flight load settles, or after `ms` (whichever is first). Never rejects. */
function waitForLoad(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      waiters.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    waiters.add(done);
  });
}

/**
 * Show a rewarded ad and resolve with the outcome. Never rejects - see
 * RewardedAdResult for the contract. The tap never makes the player wait long:
 *  - ready: shown at once;
 *  - loading (or nothing attempted yet): a short bounded wait, then "unavailable" - the load
 *    keeps going in the background for the next offer;
 *  - failed / expired / blocked: "unavailable" immediately, with the cause.
 * With the lifecycle kill switch off the 0.55 behavior applies: wait for the (8 s) load.
 *
 * `onEvent` is optional: pass it only if the UI wants lifecycle moments
 * (loading spinner etc.). Analytics is recorded automatically either way.
 */
export async function showRewardedAd(
  placement: RewardedAdPlacement,
  onEvent?: RewardedAdListener,
): Promise<RewardedAdResult> {
  // Guard against non-typechecked callers; an unknown placement is never allowed
  // to flow into lifecycle events or analytics.
  if (!isRewardedAdPlacement(placement)) return { status: "unavailable", reason: "invalid_placement" };

  const unit = rewardedUnitFor(placement);
  refreshLifecycle();
  releaseOtherUnit(unit);
  const stateAtTap: RewardedTapState = state;
  emit("requested", placement, undefined, onEvent, { stateAtTap });

  const blocked = rewardedBlockReason(unit) ?? (state === "showing" ? "already_showing" : null);
  if (blocked) {
    emit("unavailable", placement, blocked, onEvent, { stateAtTap, cause: "blocked" });
    return { status: "unavailable", reason: blocked };
  }

  const v2 = lifecycleV2();
  if (state !== "ready") {
    if (v2 && (state === "failed" || state === "expired")) {
      // Fail fast. A failure already reported by its preload is not repeated at the tap.
      const reason: AdFailureReason = state === "failed" ? lastLoadFailure : "load_failed";
      const repeat = state === "failed" && !loadReported && lastLoadCode !== undefined;
      emit("unavailable", placement, reason, onEvent, {
        stateAtTap,
        cause: notReadyCause(stateAtTap),
        ...(repeat ? { code: lastLoadCode } : {}),
      });
      return { status: "unavailable", reason };
    }
    if (state === "idle" || state === "failed" || state === "expired") startLoad(activeAdapter()!, placement, "click", onEvent);
    // v2: a short bounded wait. Legacy: wait for the load itself, which is bounded at 8 s.
    await waitForLoad(v2 ? tapWaitMs : LEGACY_LOAD_TIMEOUT_MS + 1000);
    refreshLifecycle();
    // `state` moved while we awaited (a callback ran), which the compiler cannot see.
    // A load of the OTHER unit that was already in flight is not this tap's ad (0.57.1): it counts as still loading.
    const after: RewardedState = (state as RewardedState) === "ready" && loadUnit !== unit ? "loading" : (state as RewardedState);
    if (after !== "ready") {
      const failedNow = after === "failed";
      const reason: AdFailureReason = failedNow ? lastLoadFailure : "timeout";
      const own = failedNow && !loadReported;
      if (failedNow) loadReported = true;
      emit("unavailable", placement, reason, onEvent, {
        stateAtTap,
        cause: failedNow ? "failed" : stateAtTap === "idle" ? "not_attempted" : "loading",
        source: "click",
        ...(own && lastLoadCode !== undefined ? { code: lastLoadCode } : {}),
        ...(own ? { latency: adLatencyBucket(lastLoadLatencyMs) } : {}),
      });
      return { status: "unavailable", reason };
    }
  }

  const adapter = activeAdapter()!;
  state = "showing";
  // "shown" is emitted when we hand control to the SDK - the closest observable
  // moment to the ad appearing. The adapter's promise settles on the first terminal
  // callback (reward, dismissed-without-reward, or failed-to-show), so exactly one of
  // rewarded / dismissed / error is emitted below; the show timeout is only a last-resort
  // backstop for an adapter that never settles.
  emit("shown", placement, undefined, onEvent);
  try {
    const reward = await withTimeout(adapter.showRewarded(), showTimeoutMs, "rewarded show");
    if (reward) {
      emit("rewarded", placement, undefined, onEvent);
      return { status: "rewarded", reward };
    }
    emit("dismissed", placement, undefined, onEvent);
    return { status: "dismissed" };
  } catch (err) {
    const reason: AdFailureReason =
      err instanceof Error && err.message.includes("timed out") ? "timeout" : "sdk_error";
    emit("error", placement, reason, onEvent);
    return { status: "error", reason };
  } finally {
    state = "idle";
  }
}

/**
 * App returned to the foreground: re-evaluate time-based state (a load that outlived the
 * hard expiry while the WebView was frozen, an ad that aged out). Nothing else - no new
 * load, no request. An old callback that fires after this still hits the generation check.
 */
export function handleRewardedForeground(): void {
  refreshLifecycle();
}

let foregroundHookInstalled = false;
function installForegroundHook(): void {
  if (foregroundHookInstalled) return;
  foregroundHookInstalled = true;
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") handleRewardedForeground();
    });
  } catch {
    // no document - nothing to hook
  }
}
installForegroundHook();

// --- Test hooks -------------------------------------------------------------------

/** Test-only: reset module state between test cases. */
export function _resetRewardedAdsForTests(): void {
  adapters.clear();
  listeners.clear();
  waiters.clear();
  clearHardExpiry();
  state = "idle";
  loadSeq = 0;
  nativeLoadActive = false;
  loadStartedAt = 0;
  loadPlacement = null;
  loadUnit = "coin";
  loadSource = "preload";
  loadReported = false;
  loadOnEvent = undefined;
  readyAt = 0;
  failedAt = -Infinity;
  lastLoadFailure = "load_failed";
  lastLoadCode = undefined;
  lastLoadLatencyMs = 0;
  hardLoadExpiryMs = HARD_LOAD_EXPIRY_MS;
  tapWaitMs = TAP_WAIT_MS;
  readyTtlMs = READY_TTL_MS;
  failedCooldownMs = FAILED_COOLDOWN_MS;
  showTimeoutMs = SHOW_TIMEOUT_MS;
  now = () => Date.now();
  consentGate = () => true;
  remoteAdsGate = () => true;
  lifecycleV2Gate = () => true;
}

/** Test-only: shrink the time budgets so timeout paths run in milliseconds. */
export function _setAdTimeoutsForTests(timeouts: { hardLoad?: number; tapWait?: number; readyTtl?: number; failedCooldown?: number; show?: number }): void {
  if (timeouts.hardLoad !== undefined) hardLoadExpiryMs = timeouts.hardLoad;
  if (timeouts.tapWait !== undefined) tapWaitMs = timeouts.tapWait;
  if (timeouts.readyTtl !== undefined) readyTtlMs = timeouts.readyTtl;
  if (timeouts.failedCooldown !== undefined) failedCooldownMs = timeouts.failedCooldown;
  if (timeouts.show !== undefined) showTimeoutMs = timeouts.show;
}

/** Test-only: a controllable clock for the lazy (suspend-proof) expiry checks. */
export function _setRewardedClockForTests(clock: () => number): void {
  now = clock;
}
