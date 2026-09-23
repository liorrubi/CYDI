/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Android install attribution: ask Google Play once per installation where this install
// came from, and decide whether this looks like the first launch of a new one.
//
// INSTALL_REFERRER_NOTES.md is the specification; this file is its implementation and
// the comments here do not repeat it. The two things worth knowing before reading:
//
// 1. `first_open` is NOT an exact install counter and must never be described as one.
//    It is gated on Play's installVersion matching the running version plus a local
//    marker, and clearing app data drops the marker while Play's metadata is unchanged,
//    so it can repeat. Accepted, documented, measured through `installAge`.
// 2. `installAge` never decides anything. It is reported so the inexactness above is
//    visible in the numbers instead of invisible.
//
// Everything is fire-and-forget: no path here may throw into app startup, and a failed
// lookup is silence, never an error the game has to handle.

import { Capacitor, registerPlugin } from "@capacitor/core";

import { APP_VERSION } from "../app/constants";
import { setInstallAttribution, trackEvent } from "./analytics";
import { resolveAttribution, type Attribution } from "./analyticsAttribution";
import { isQaBuild } from "./analyticsIdentity";
import type { InstallAgeParam } from "./analyticsSchema";

const STATE_KEY = "cydi.installReferrer.v1";

/** Transient failures get this many launches to succeed before we stop asking forever. */
const MAX_ATTEMPTS = 3;

/**
 * Verified against the decompiled 2.2 artifact, not the public docs page - which lists
 * three of these six. `javap -constants` on InstallReferrerClient$InstallReferrerResponse.
 */
export const INSTALL_REFERRER_RESPONSE = {
  SERVICE_DISCONNECTED: -1,
  OK: 0,
  SERVICE_UNAVAILABLE: 1,
  FEATURE_NOT_SUPPORTED: 2,
  DEVELOPER_ERROR: 3,
  PERMISSION_ERROR: 4,
} as const;

/**
 * What the native plugin hands back. `referrer` and `installVersion` are nullable
 * because both are plain Bundle.getString on the Java side with no default, and
 * `installBeginTimestampSeconds` is 0 when absent because that one is Bundle.getLong.
 */
export type ReferrerDetailsResult = {
  responseCode: number;
  referrer?: string | null;
  installVersion?: string | null;
  installBeginTimestampSeconds?: number | null;
};

type InstallReferrerBridge = { getReferrerDetails(): Promise<ReferrerDetailsResult> };

const InstallReferrer = registerPlugin<InstallReferrerBridge>("InstallReferrer");

type StoredState = {
  /** "done" means never ask again, whatever the outcome was. */
  status: "pending" | "done";
  attempts: number;
  firstOpenEmitted: boolean;
};

const EMPTY_STATE: StoredState = { status: "pending", attempts: 0, firstOpenEmitted: false };

function readState(): StoredState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { ...EMPTY_STATE };
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      status: parsed.status === "done" ? "done" : "pending",
      attempts: typeof parsed.attempts === "number" && parsed.attempts >= 0 ? parsed.attempts : 0,
      firstOpenEmitted: parsed.firstOpenEmitted === true,
    };
  } catch {
    // Corrupt or unavailable - treated as never asked, which at worst costs one extra
    // lookup. Storage being blocked is why this can never be a hard precondition.
    return { ...EMPTY_STATE };
  }
}

function writeState(state: StoredState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked. The lookup already happened and its events were already sent;
    // losing the marker only risks asking again next launch.
  }
}

/**
 * Diagnostic only - see the header. 0 means the Play response carried no install-begin
 * timestamp at all (Bundle.getLong's default), and a negative age means the device
 * clock moved backwards, the same case getSessionId already guards for. Neither is
 * guessed into a real bucket.
 */
export function installAgeBucket(installBeginSeconds: number | null | undefined, now: number): InstallAgeParam {
  if (typeof installBeginSeconds !== "number" || !Number.isFinite(installBeginSeconds) || installBeginSeconds <= 0) {
    return "unknown";
  }
  const ageMs = now - installBeginSeconds * 1000;
  if (ageMs < 0) return "unknown";
  const hours = ageMs / (60 * 60 * 1000);
  if (hours < 24) return "h0_24";
  if (hours < 24 * 7) return "d1_7";
  if (hours < 24 * 30) return "d7_30";
  return "d30_plus";
}

/**
 * The whole `first_open` rule. `installAge` is deliberately not a parameter.
 *
 * A null installVersion - every Play Store build too old to send `install_version` -
 * counts as NOT matching, so it never produces a first_open. That is the conservative
 * direction on purpose: under-reporting a new install is recoverable, inventing one is
 * not.
 */
export function shouldEmitFirstOpen(
  installVersion: string | null | undefined,
  appVersion: string,
  alreadyEmitted: boolean,
): boolean {
  if (alreadyEmitted) return false;
  if (typeof installVersion !== "string" || installVersion.length === 0) return false;
  return installVersion === appVersion;
}

/**
 * The Play referrer is a query string, so the website's own normalizer does all of the
 * work: closed alphabet, length clipping, canonical source labels. Nothing
 * Android-specific is invented, and the raw string never leaves this function.
 *
 * Returns null when Play sent no referrer to parse; an organic install is NOT that case
 * - it sends real values (utm_source=google-play&utm_medium=organic).
 */
export function referrerAttribution(referrer: string | null | undefined): Attribution | null {
  if (typeof referrer !== "string" || referrer.trim().length === 0) return null;
  return resolveAttribution({ search: referrer, referrer: "", origin: "" });
}

/** Whether a response code is worth another launch's attempt, or is final either way. */
export function isRetryableResponse(responseCode: number): boolean {
  return (
    responseCode === INSTALL_REFERRER_RESPONSE.SERVICE_UNAVAILABLE ||
    responseCode === INSTALL_REFERRER_RESPONSE.SERVICE_DISCONNECTED
  );
}

type Deps = {
  bridge: InstallReferrerBridge;
  isNative: () => boolean;
  isQa: () => boolean;
  now: () => number;
  appVersion: string;
};

let deps: Deps = {
  bridge: InstallReferrer,
  isNative: () => Capacitor.getPlatform() === "android",
  isQa: isQaBuild,
  now: () => Date.now(),
  appVersion: APP_VERSION,
};

/** Test-only: swap the native bridge and the environment predicates. */
export function _setInstallReferrerDepsForTests(overrides: Partial<Deps>): void {
  deps = { ...deps, ...overrides };
}

/** Test-only: forget the persisted one-shot state. */
export function _resetInstallReferrerForTests(): void {
  try {
    localStorage.removeItem(STATE_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/**
 * Run the lookup at most once per installation, emit at most the two events, and never
 * throw. Safe to call on every startup - the stored state is what makes it a one-shot.
 */
export async function runInstallReferrerOnce(): Promise<void> {
  try {
    // Android only. The web has no installation to attribute, and iOS has no Play.
    if (!deps.isNative()) return;
    // A debug build never contacts the service at all. This is the ONLY QA protection
    // that holds: a sideloaded APK does not reliably report FEATURE_NOT_SUPPORTED, and
    // a device that once carried a Play build can still be handed stale Play metadata
    // for the package - so absence of data cannot be relied on to mean anything.
    if (deps.isQa()) return;

    const state = readState();
    if (state.status === "done") return;
    if (state.attempts >= MAX_ATTEMPTS) return;

    const attempted: StoredState = { ...state, attempts: state.attempts + 1 };
    writeState(attempted);

    const result = await deps.bridge.getReferrerDetails();
    const responseCode = typeof result?.responseCode === "number" ? result.responseCode : INSTALL_REFERRER_RESPONSE.SERVICE_UNAVAILABLE;

    if (responseCode !== INSTALL_REFERRER_RESPONSE.OK) {
      // Retryable codes keep status "pending" so a later launch tries again, bounded by
      // MAX_ATTEMPTS. Everything else - FEATURE_NOT_SUPPORTED, DEVELOPER_ERROR,
      // PERMISSION_ERROR - is final: asking again would get the same answer.
      if (!isRetryableResponse(responseCode)) writeState({ ...attempted, status: "done" });
      return;
    }

    // Two independent decisions reading two different fields of one response. Neither
    // may stand in for the other, and neither invents metadata Play did not send.
    const attribution = referrerAttribution(result.referrer);
    const emitFirstOpen = shouldEmitFirstOpen(result.installVersion, deps.appVersion, attempted.firstOpenEmitted);

    if (attribution !== null || emitFirstOpen) {
      // Set before either event so both carry the same labels; cleared afterwards so no
      // later event can ever pick them up.
      setInstallAttribution(attribution);
      if (attribution !== null) trackEvent("install_attributed", {});
      if (emitFirstOpen) {
        trackEvent("first_open", { installAge: installAgeBucket(result.installBeginTimestampSeconds, deps.now()) });
      }
      setInstallAttribution(null);
    }

    writeState({ status: "done", attempts: attempted.attempts, firstOpenEmitted: attempted.firstOpenEmitted || emitFirstOpen });
  } catch {
    // Startup must not care. The attempt counter was already persisted, so a bridge that
    // throws every time still stops asking after MAX_ATTEMPTS.
  }
}
