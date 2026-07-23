// Google UMP (User Messaging Platform) consent gating for AdMob. FAIL-CLOSED: the
// module-level state below starts at { canRequestAds: false, privacyOptionsRequired:
// false } and only ever flips canRequestAds true once the SDK's own response says so
// - never inferred from `status` alone, and never assumed. Nothing in
// nativeAdsSetup.ts registers an ad adapter, initializes the AdMob SDK, preloads, or
// requests an ad until initializeConsent() has resolved with canRequestAds === true.
//
// Mirrors the admobAdapter.ts pattern: the real plugin is passed in structurally
// typed, so this stays testable without @capacitor-community/admob installed as a
// hard dependency of the module itself.

export type ConsentInfoLike = {
  /** "NOT_REQUIRED" | "OBTAINED" | "REQUIRED" | "UNKNOWN" - informational only, never branched on directly. */
  status: string;
  /** Whether the SDK actually has a form ready to show. */
  isConsentFormAvailable?: boolean;
  /** The only field this module trusts to decide whether an ad request may be made. */
  canRequestAds: boolean;
  /** "NOT_REQUIRED" | "REQUIRED" | "UNKNOWN" - drives the Settings privacy-options entry point. */
  privacyOptionsRequirementStatus: string;
};

export type ConsentPluginLike = {
  requestConsentInfo(options?: unknown): Promise<ConsentInfoLike>;
  showConsentForm(): Promise<ConsentInfoLike>;
  showPrivacyOptionsForm(): Promise<void>;
};

export type ConsentState = {
  canRequestAds: boolean;
  privacyOptionsRequired: boolean;
};

const FAIL_CLOSED_STATE: ConsentState = { canRequestAds: false, privacyOptionsRequired: false };

let state: ConsentState = FAIL_CLOSED_STATE;

// Same named-map listener pattern as subscribeRewardedAdEvents: HMR/StrictMode
// re-subscription replaces rather than stacks, and a late-mounting subscriber
// (e.g. SettingsScreen mounting after native init already resolved) can read
// getConsentState() synchronously instead of missing the first notification.
const listeners = new Map<string, (next: ConsentState) => void>();

export function getConsentState(): ConsentState {
  return state;
}

/** Subscribe to consent-state changes. Returns an unsubscribe function. */
export function subscribeConsentState(name: string, listener: (next: ConsentState) => void): () => void {
  listeners.set(name, listener);
  return () => {
    listeners.delete(name);
  };
}

function setState(info: ConsentInfoLike): ConsentState {
  state = {
    canRequestAds: info.canRequestAds,
    privacyOptionsRequired: info.privacyOptionsRequirementStatus === "REQUIRED",
  };
  for (const listener of listeners.values()) {
    try {
      listener(state);
    } catch {
      // A broken observer must never affect consent state or ad flow.
    }
  }
  return state;
}

/**
 * Run the UMP consent flow once at native startup. Only shows a consent form when
 * the SDK itself reports one is available AND consent isn't already sufficient -
 * never inferred from `status` alone. Any exception here leaves state at its
 * fail-closed default (never throws to the caller).
 */
export async function initializeConsent(plugin: ConsentPluginLike): Promise<ConsentState> {
  try {
    let info = await plugin.requestConsentInfo();
    if (info.isConsentFormAvailable && !info.canRequestAds) {
      info = await plugin.showConsentForm();
    }
    return setState(info);
  } catch {
    state = FAIL_CLOSED_STATE;
    return state;
  }
}

/**
 * Settings' "Privacy Options" entry point: show the privacy options form, then
 * re-query consent info (showPrivacyOptionsForm itself resolves void) so a revoke
 * or change actually takes effect for the next ad request.
 */
export async function refreshConsentAfterPrivacyOptions(plugin: ConsentPluginLike): Promise<ConsentState> {
  try {
    await plugin.showPrivacyOptionsForm();
    const info = await plugin.requestConsentInfo();
    return setState(info);
  } catch {
    return state;
  }
}

/** Test-only: reset module state between test cases. */
export function _resetConsentForTests(): void {
  state = FAIL_CLOSED_STATE;
  listeners.clear();
}
