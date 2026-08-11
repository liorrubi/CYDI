// Remote ads kill switch: an operational off-switch independent of the hardcoded
// AD_FLAGS.master (adConfig.ts), so ads can be disabled instantly - no app
// redeploy - by flipping a tiny Cloudflare-KV-backed flag (PUT /api/config/ads,
// see worker/index.ts). Reuses the existing content-catalog infra (CONTENT_KV,
// CONTENT_ADMIN_TOKEN) - no new KV namespace, secret, or binding.
//
// FAIL-CLOSED by design: state starts at { enabled: false } and ANY failure -
// network error, timeout, non-2xx (including 404 = "no config published yet"),
// unreadable body, invalid JSON, or a payload that isn't exactly
// { enabled: boolean } - leaves state at that fail-closed default. The only way
// this ever becomes true is a well-formed { enabled: true } response actually
// received from the server.
//
// This is an ADDITIONAL gate alongside AD_FLAGS.master/per-format flags
// (adConfig.ts) and the UMP consent gate (consent.ts) - see registerRemoteAdsGate
// in rewardedAds.ts. ALL of them must agree before a rewarded ad is ever
// requested; this module does not replace or bypass any of the others.

import { apiFetch } from "../nativeApi";
import { isValidRemoteAdsConfig, type RemoteAdsConfig } from "./remoteAdsConfigSchema";

const FETCH_TIMEOUT_MS = 5000;
const FAIL_CLOSED: RemoteAdsConfig = { enabled: false };

let state: RemoteAdsConfig = FAIL_CLOSED;

/** Current remote-flag state - synchronous, read by the gate registered in rewardedAds.ts. */
export function isRemoteAdsEnabled(): boolean {
  return state.enabled;
}

/**
 * Fetch the remote flag once. Called at native startup alongside UMP consent
 * (see nativeAdsSetup.ts), so the flag is re-checked on every app open, the same
 * cadence as consent. Never throws - every failure path resolves to the
 * fail-closed default instead.
 */
export async function refreshRemoteAdsKillSwitch(): Promise<RemoteAdsConfig> {
  try {
    const response = await apiFetch("/api/config/ads", { timeoutMs: FETCH_TIMEOUT_MS });
    if (!response.ok) {
      state = FAIL_CLOSED;
      return state;
    }
    const parsed = await response.json();
    state = isValidRemoteAdsConfig(parsed) ? parsed : FAIL_CLOSED;
    return state;
  } catch {
    state = FAIL_CLOSED;
    return state;
  }
}

/** Test-only: reset module state between test cases. */
export function _resetRemoteAdsKillSwitchForTests(): void {
  state = FAIL_CLOSED;
}
