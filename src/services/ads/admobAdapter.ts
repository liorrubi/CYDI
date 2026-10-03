// Adapter factory for the Capacitor community AdMob plugin - the expected SDK
// once CYDI ships as a native app. The plugin is NOT a dependency yet, so the
// plugin object is passed in structurally typed; future wiring is exactly:
//
//   import { AdMob } from "@capacitor-community/admob";
//   import { registerAdAdapter, createAdMobAdapter } from "./services/ads";
//   registerAdAdapter(createAdMobAdapter(AdMob));
//
// ...in native startup code only. The web build never registers an adapter and
// keeps its zero-dependency no-op behavior.

import type { AdAdapter, AdReward, RewardedLoadError } from "./adTypes";
import type { InterstitialAdapter, InterstitialNativeEvent } from "./interstitialAds";

// Minimal structural slice of @capacitor-community/admob's AdMob object - just
// the members this adapter calls, so the real plugin satisfies it when installed.
export type AdMobPluginLike = {
  initialize(options?: { initializeForTesting?: boolean }): Promise<unknown>;
  prepareRewardVideoAd(options: { adId: string }): Promise<unknown>;
  showRewardVideoAd(): Promise<{ type?: string; amount?: number } | undefined>;
  /**
   * Optional: when present, the rewarded events are observed - FailedToLoad supplies the numeric
   * GMA code, and Reward / Dismissed / FailedToShow settle a show. Without it a show can only be
   * settled by the plugin's own call (which resolves on a reward alone), so an early close is
   * then caught only by the 90 s backstop in rewardedAds.ts.
   */
  addListener?(eventName: string, listener: (info: unknown) => void): Promise<unknown>;
};

/** The plugin's RewardAdPluginEvents values (that enum is not importable under plain-Node tests). */
export const REWARDED_PLUGIN_EVENTS = {
  failedToLoad: "onRewardedVideoAdFailedToLoad",
  reward: "onRewardedVideoAdReward",
  dismissed: "onRewardedVideoAdDismissed",
  failedToShow: "onRewardedVideoAdFailedToShow",
} as const;

/** Kept for existing callers/tests: the FailedToLoad event name. */
export const REWARDED_PLUGIN_FAILED_TO_LOAD = REWARDED_PLUGIN_EVENTS.failedToLoad;

/**
 * How long a rejected prepare call waits for the FailedToLoad event that carries the
 * numeric code. The plugin posts the event and then the rejection (see
 * RewardedAdCallbackAndListeners.kt), so this is normally already settled.
 */
const REWARDED_CODE_GRACE_MS = 300;

/**
 * After the ad is DISMISSED with no reward seen yet, how long to wait for a late Reward
 * event before settling the show as "dismissed" (no coins). Google's SDK normally delivers
 * the reward callback before the close callback, so this only covers the opposite order on
 * a slow bridge. NOT YET VALIDATED: it must be checked on the Mi 8 against the real callback
 * ordering (and tuned) before release. Too short risks denying a coin reward the player
 * earned; too long delays the offer coming back after an early close.
 */
export const REWARDED_POST_DISMISS_GRACE_MS = 1500;

/** Longest plugin rejection message kept for classification (it is never sent to analytics). */
const MAX_PLUGIN_MESSAGE_CHARS = 200;

function pluginErrorCode(info: unknown): number | undefined {
  const code = (info as { code?: unknown } | null)?.code;
  return typeof code === "number" && Number.isInteger(code) ? code : undefined;
}

/** The message text of a plugin rejection (Error, plain object or string), bounded; for classification only. */
function pluginErrorMessage(err: unknown): string | undefined {
  const raw = typeof err === "string" ? err : (err as { message?: unknown } | null)?.message;
  return typeof raw === "string" && raw !== "" ? raw.slice(0, MAX_PLUGIN_MESSAGE_CHARS) : undefined;
}

/** A positive reward item, or null (a missing or zero reward is not a reward). */
function toReward(item: unknown): AdReward | null {
  const r = item as { type?: unknown; amount?: unknown } | null | undefined;
  if (!r || typeof r.amount !== "number" || !(r.amount > 0)) return null;
  return { type: typeof r.type === "string" && r.type !== "" ? r.type : "reward", amount: r.amount };
}

/** One in-flight show. Events and the plugin call settle it at most once; anything after that is ignored. */
type PendingShow = {
  settled: boolean;
  sawDismiss: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
  resolve: (reward: AdReward | null) => void;
  reject: (err: RewardedLoadError) => void;
};

export function createAdMobAdapter(
  admob: AdMobPluginLike,
  options?: { testing?: boolean; /** Test hook: overrides REWARDED_POST_DISMISS_GRACE_MS. */ postDismissGraceMs?: number },
): AdAdapter {
  const postDismissGraceMs = options?.postDismissGraceMs ?? REWARDED_POST_DISMISS_GRACE_MS;
  // FailedToLoad is the only place the numeric code surfaces. The plugin also fires it
  // (code -1) when showRewardVideoAd() finds nothing prepared; with no load pending that
  // one is simply ignored here.
  let lastFailureCode: number | undefined;
  let loadPending = false;
  // The show in flight, if any. Plugin events carry no id, so "which show does this event
  // belong to" is answered by there being at most one pending show: an event with no pending
  // show (after settlement, after the grace window, before any show) is dropped, and a new
  // show supersedes - and so closes out - an older one.
  let pendingShow: PendingShow | null = null;

  // Settle `show` once. A show that is no longer the pending one is stale and changes nothing.
  const settleShow = (show: PendingShow, settle: () => void) => {
    if (show.settled || pendingShow !== show) return;
    show.settled = true;
    pendingShow = null;
    if (show.graceTimer !== null) clearTimeout(show.graceTimer);
    show.graceTimer = null;
    settle();
  };
  const rejectShow = (show: PendingShow, err: unknown) => {
    const code = pluginErrorCode(err);
    const message = pluginErrorMessage(err);
    settleShow(show, () => show.reject({ ...(code !== undefined ? { code } : {}), ...(message !== undefined ? { message } : {}) }));
  };

  const listen = (eventName: string, handler: (info: unknown) => void) => {
    try {
      void Promise.resolve(admob.addListener?.(eventName, handler)).catch(() => undefined);
    } catch {
      // no listener support: that event is simply never observed
    }
  };

  listen(REWARDED_PLUGIN_EVENTS.failedToLoad, (info) => {
    if (loadPending) lastFailureCode = pluginErrorCode(info);
  });
  // Reward: the only thing that grants. Either order against Dismissed works: before it the
  // show settles here and the later Dismissed finds no pending show; after it, inside the grace.
  listen(REWARDED_PLUGIN_EVENTS.reward, (info) => {
    const show = pendingShow;
    const reward = toReward(info);
    if (show && reward) settleShow(show, () => show.resolve(reward));
  });
  // Dismissed: the ad left the screen. With no reward by the end of the grace this is a
  // dismiss, not a failure.
  listen(REWARDED_PLUGIN_EVENTS.dismissed, () => {
    const show = pendingShow;
    if (!show || show.sawDismiss) return;
    show.sawDismiss = true;
    show.graceTimer = setTimeout(() => settleShow(show, () => show.resolve(null)), postDismissGraceMs);
    (show.graceTimer as { unref?: () => void }).unref?.();
  });
  // FailedToShow: the ad never appeared. Ignored once a Dismissed has been seen (that show already ended).
  listen(REWARDED_PLUGIN_EVENTS.failedToShow, (info) => {
    const show = pendingShow;
    if (show && !show.sawDismiss) rejectShow(show, info);
  });

  return {
    name: "admob-capacitor",

    async initialize(): Promise<void> {
      await admob.initialize(options?.testing ? { initializeForTesting: true } : undefined);
    },

    async loadRewarded(adUnitId: string): Promise<void> {
      lastFailureCode = undefined;
      loadPending = true;
      try {
        await admob.prepareRewardVideoAd({ adId: adUnitId });
      } catch (err) {
        // The plugin rejects with the SDK's message (e.g. "No fill."). Keep it, bounded, so a
        // no-fill still classifies when the FailedToLoad event never fired; it is for
        // classification only and never reaches analytics.
        const message = pluginErrorMessage(err);
        if (lastFailureCode === undefined) await new Promise((resolve) => setTimeout(resolve, REWARDED_CODE_GRACE_MS));
        throw { code: lastFailureCode, ...(message !== undefined ? { message } : {}) } satisfies RewardedLoadError;
      } finally {
        loadPending = false;
      }
    },

    // The plugin's show call resolves ONLY when a reward is earned - a close or a show failure
    // never settles it - so the outcome is assembled from its events as well, and this promise
    // settles exactly once on the first of:
    //   reward                -> resolves the reward item (a later Dismissed is ignored);
    //   dismissed, no reward  -> after a short grace for a late Reward, resolves null (dismissed);
    //   failed to show        -> rejects {code, message}.
    showRewarded(): Promise<AdReward | null> {
      return new Promise<AdReward | null>((resolve, reject) => {
        const previous = pendingShow;
        if (previous) settleShow(previous, () => previous.resolve(null));
        const show: PendingShow = { settled: false, sawDismiss: false, graceTimer: null, resolve, reject };
        pendingShow = show;
        let call: Promise<{ type?: string; amount?: number } | undefined>;
        try {
          call = admob.showRewardVideoAd();
        } catch (err) {
          call = Promise.reject(err);
        }
        call.then(
          // The plugin resolves with the reward item when earned; a missing or zero item is "dismissed".
          (item) => settleShow(show, () => show.resolve(toReward(item))),
          // e.g. nothing prepared. Not a failure once the ad was already dismissed.
          (err) => {
            if (!show.sawDismiss) rejectShow(show, err);
          },
        );
      });
    },
  };
}

// --- Interstitial --------------------------------------------------------------------
//
// A SEPARATE adapter for a separate format, deliberately not new members on the
// rewarded one above: the rewarded adapter and everything that calls it stay exactly
// as they were. Wired only by nativeAdsSetup.ts, after the SDK is initialized.

/** The plugin's InterstitialAdPluginEvents values (spelled out: that enum is not importable under plain-Node tests). */
export const INTERSTITIAL_PLUGIN_EVENTS = {
  loaded: "interstitialAdLoaded",
  failedToLoad: "interstitialAdFailedToLoad",
  showed: "interstitialAdShowed",
  failedToShow: "interstitialAdFailedToShow",
  dismissed: "interstitialAdDismissed",
} as const;

export type AdMobInterstitialPluginLike = {
  prepareInterstitial(options: { adId: string }): Promise<unknown>;
  showInterstitial(): Promise<void>;
  addListener(eventName: string, listener: (info: unknown) => void): Promise<unknown>;
};

/**
 * How long a rejected prepareInterstitial() waits for the FailedToLoad event that
 * carries the numeric code. The plugin posts the event and then the rejection (see
 * InterstitialAdCallbackAndListeners.kt), so this is normally already settled.
 */
const LOAD_CODE_GRACE_MS = 300;

function errorCode(info: unknown): number | undefined {
  const code = (info as { code?: unknown } | null)?.code;
  return typeof code === "number" && Number.isInteger(code) ? code : undefined;
}

export function createAdMobInterstitialAdapter(admob: AdMobInterstitialPluginLike): InterstitialAdapter {
  let listener: (event: InterstitialNativeEvent) => void = () => {};
  let pendingLoad: { resolve: () => void; reject: (err: { code?: number }) => void } | null = null;

  const settleLoad = (outcome: { ok: true } | { ok: false; code?: number }) => {
    const pending = pendingLoad;
    if (!pending) return;
    pendingLoad = null;
    if (outcome.ok) pending.resolve();
    else pending.reject({ code: outcome.code });
  };

  // FailedToLoad is the only place the numeric Google Mobile Ads code surfaces. The
  // plugin also fires it (code -1) when showInterstitial() finds nothing prepared;
  // with no load pending that one is simply ignored here.
  void admob.addListener(INTERSTITIAL_PLUGIN_EVENTS.failedToLoad, (info) => settleLoad({ ok: false, code: errorCode(info) }));
  void admob.addListener(INTERSTITIAL_PLUGIN_EVENTS.showed, () => listener({ type: "showed" }));
  void admob.addListener(INTERSTITIAL_PLUGIN_EVENTS.failedToShow, (info) => listener({ type: "failedToShow", code: errorCode(info) }));
  void admob.addListener(INTERSTITIAL_PLUGIN_EVENTS.dismissed, () => listener({ type: "dismissed" }));

  return {
    name: "admob-capacitor-interstitial",

    load(adUnitId) {
      return new Promise<void>((resolve, reject) => {
        pendingLoad = { resolve, reject };
        admob.prepareInterstitial({ adId: adUnitId }).then(
          () => settleLoad({ ok: true }),
          () => setTimeout(() => settleLoad({ ok: false }), LOAD_CODE_GRACE_MS),
        );
      });
    },

    show() {
      return admob.showInterstitial();
    },

    setListener(next) {
      listener = next;
    },
  };
}
