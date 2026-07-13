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
// NOT ACTIVE YET: nothing in the game calls this module, and every flag in
// adConfig.ts is false, so no ad request is ever issued. A reward is reported
// ONLY when the SDK itself resolves with a verified reward item - an early
// dismiss always yields "dismissed" with no reward.

import { isAdFormatEnabled, getAdUnitId } from "./adConfig";
import { isRewardedAdPlacement, type RewardedAdPlacement } from "./adPlacements";
import type {
  AdAdapter,
  AdFailureReason,
  AdPlatform,
  RewardedAdEventDetail,
  RewardedAdLifecycleEvent,
  RewardedAdListener,
  RewardedAdResult,
} from "./adTypes";

// Hard ceilings so a wedged SDK can never stall gameplay: a show request gives a
// non-ready ad this long to finish loading before resolving "unavailable", and an
// on-screen ad this long before we report an error (the ad may still be visible -
// the OS owns that surface - but game code regains control).
const LOAD_TIMEOUT_MS = 8000;
const SHOW_TIMEOUT_MS = 90_000;
let loadTimeoutMs = LOAD_TIMEOUT_MS;
let showTimeoutMs = SHOW_TIMEOUT_MS;

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

function emit(
  event: RewardedAdLifecycleEvent,
  placement: RewardedAdPlacement,
  reason: AdFailureReason | undefined,
  onEvent: RewardedAdListener | undefined,
): void {
  const detail: RewardedAdEventDetail = reason ? { placement, reason } : { placement };
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

// --- Rewarded flow state ---------------------------------------------------------

type RewardedState = "idle" | "loading" | "ready" | "showing";
let state: RewardedState = "idle";
let initialized = false;
// The in-flight load, shared so preload + a concurrent show await the same request.
let loadPromise: Promise<void> | null = null;
// Why the last load attempt failed - reported if a show then finds nothing loaded.
let lastLoadFailure: AdFailureReason = "load_failed";

/** The blocking reason right now, or null when a rewarded ad could actually be served. */
function rewardedBlockReason(): AdFailureReason | null {
  if (!isAdFormatEnabled("rewarded")) return "ads_disabled";
  if (activeAdapter() === undefined) return "no_adapter";
  if (getAdUnitId("rewarded", detectPlatform()) === "") return "not_configured";
  return null;
}

/** True only when everything needed to actually serve a rewarded ad is in place. */
export function isRewardedAdAvailable(): boolean {
  return rewardedBlockReason() === null;
}

/** A rewarded ad is loaded and can be shown immediately (use to decide whether to render a "watch ad" button). */
export function isRewardedAdReady(): boolean {
  return state === "ready";
}

async function ensureInitialized(adapter: AdAdapter): Promise<void> {
  if (initialized) return;
  await adapter.initialize();
  initialized = true;
}

function startLoad(adapter: AdAdapter, placement: RewardedAdPlacement, onEvent?: RewardedAdListener): Promise<void> {
  state = "loading";
  emit("loading", placement, undefined, onEvent);
  loadPromise = (async () => {
    try {
      await ensureInitialized(adapter);
      await withTimeout(adapter.loadRewarded(getAdUnitId("rewarded", detectPlatform())), loadTimeoutMs, "rewarded load");
      state = "ready";
      emit("loaded", placement, undefined, onEvent);
    } catch (err) {
      state = "idle";
      lastLoadFailure = err instanceof Error && err.message.includes("timed out") ? "timeout" : "sdk_error";
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

/**
 * Pre-cache a rewarded ad so a later showRewardedAd() is instant. Fire-and-forget
 * safe: resolves quietly (no throw, no game impact) whether it loads or not.
 * `placement` names the trigger point this preload is for (lifecycle/analytics
 * attribution) and must be one of the closed REWARDED_AD_PLACEMENTS values.
 */
export async function preloadRewardedAd(placement: RewardedAdPlacement, onEvent?: RewardedAdListener): Promise<void> {
  if (!isRewardedAdPlacement(placement)) return;
  if (rewardedBlockReason() !== null || state !== "idle") return loadPromise ?? Promise.resolve();
  return startLoad(activeAdapter()!, placement, onEvent);
}

/**
 * Show a rewarded ad and resolve with the outcome. Never rejects - see
 * RewardedAdResult for the contract. If no ad is preloaded, one load attempt is
 * made first (bounded by the load timeout), so callers may skip preloading at
 * the cost of a short wait.
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

  emit("requested", placement, undefined, onEvent);

  const blocked = rewardedBlockReason() ?? (state === "showing" ? "already_showing" : null);
  if (blocked) {
    emit("unavailable", placement, blocked, onEvent);
    return { status: "unavailable", reason: blocked };
  }

  if (!isRewardedAdReady()) {
    await (loadPromise ?? startLoad(activeAdapter()!, placement, onEvent));
    if (!isRewardedAdReady()) {
      emit("unavailable", placement, lastLoadFailure, onEvent);
      return { status: "unavailable", reason: lastLoadFailure };
    }
  }

  const adapter = activeAdapter()!;
  state = "showing";
  // "shown" is emitted when we hand control to the SDK - the closest observable
  // moment to the ad appearing (the SDK's promise only resolves at close).
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

// --- Test hooks -------------------------------------------------------------------

/** Test-only: reset module state between test cases. */
export function _resetRewardedAdsForTests(): void {
  adapters.clear();
  listeners.clear();
  state = "idle";
  initialized = false;
  loadPromise = null;
  lastLoadFailure = "load_failed";
  loadTimeoutMs = LOAD_TIMEOUT_MS;
  showTimeoutMs = SHOW_TIMEOUT_MS;
}

/** Test-only: shrink timeouts so timeout paths run in milliseconds. */
export function _setAdTimeoutsForTests(loadMs: number, showMs: number): void {
  loadTimeoutMs = loadMs;
  showTimeoutMs = showMs;
}
