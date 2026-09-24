/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The three envelope fields every analytics event rides with (see analytics.ts):
// a stable-per-install id, a rolling session id, and the QA "this is not a real
// player" flag. All three are generated and stored LOCALLY on the device only -
// nothing here reads or derives anything from the person using the app: no name,
// no account, no IP, no device fingerprint. The ids are random numbers whose only
// purpose is to let the server count "how many installs / sessions" instead of
// just "how many events".
//
// Identical code path on Web and on Android/Capacitor: both run this same module
// inside a WebView/browser with localStorage, so there is no native-only branch.

const INSTALLATION_KEY = "cydi.installationId.v1";
const SESSION_KEY = "cydi.analyticsSession.v1";
const INTERNAL_KEY = "cydi.analyticsInternal.v1";

/** A session ends after this much inactivity; the next event starts a new one. Matches the usual web-analytics convention, and on Android it means a resume after a long pause counts as a new session rather than extending yesterday's. */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** 12 hex chars = 48 random bits. Long enough that per-day collisions are negligible at any traffic this game will see, short enough that the server's per-day id sets stay small (see analyticsUsage.ts). */
const ID_BYTES = 6;

const ID_PATTERN = /^[0-9a-f]{12}$/;

export function isAnalyticsId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function randomAnalyticsId(): string {
  const bytes = new Uint8Array(ID_BYTES);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** True only if the value was actually persisted - callers fall back to memory when storage is blocked (private mode, storage-disabled WebView). */
function writeLocal(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // storage unavailable - nothing to clear.
  }
}

// Used only when localStorage is unavailable, so that every event from this run
// still shares one installation/session pair (the per-installation and
// per-session ratios stay meaningful within the run). Such a browser looks like
// a brand-new installation on every reload; it cannot be counted any better
// without storing something, which is exactly what it refuses.
let memoryInstallationId: string | null = null;
let memorySession: { id: string; lastActivity: number } | null = null;

/** Random, anonymous, and permanent for this browser/app install until its local data is cleared. */
export function getInstallationId(): string {
  const stored = readLocal(INSTALLATION_KEY);
  if (isAnalyticsId(stored)) return stored;
  const id = randomAnalyticsId();
  if (writeLocal(INSTALLATION_KEY, id)) return id;
  memoryInstallationId ??= id;
  return memoryInstallationId;
}

/**
 * The installation id ONLY if it is actually persisted, else null - never the
 * in-memory fallback above. For uses that must be stable across launches (the
 * interstitial experiment's arm assignment): an id that is regenerated on every
 * launch would move the same person between arms, so "no stable id" has to be
 * distinguishable from "an id".
 */
export function getPersistedInstallationId(): string | null {
  getInstallationId();
  const stored = readLocal(INSTALLATION_KEY);
  return isAnalyticsId(stored) ? stored : null;
}

/**
 * The current session's id, refreshing its activity stamp. A new id is started when
 * there is no session yet, when the last activity was more than SESSION_IDLE_TIMEOUT_MS
 * ago, or when the stored stamp is in the future (device clock moved backwards).
 */
export function getSessionId(now: number = Date.now()): string {
  let current = memorySession;
  const raw = readLocal(SESSION_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { id?: unknown; lastActivity?: unknown };
      if (isAnalyticsId(parsed.id) && typeof parsed.lastActivity === "number" && Number.isFinite(parsed.lastActivity)) {
        current = { id: parsed.id, lastActivity: parsed.lastActivity };
      }
    } catch {
      // corrupt value - treated as no session at all, a fresh one starts below.
    }
  }

  const elapsed = current ? now - current.lastActivity : Infinity;
  const stillActive = current !== null && elapsed >= 0 && elapsed <= SESSION_IDLE_TIMEOUT_MS;
  const session = { id: stillActive && current ? current.id : randomAnalyticsId(), lastActivity: now };
  memorySession = session;
  writeLocal(SESSION_KEY, JSON.stringify(session));
  return session.id;
}

/** True on a device/browser marked as ours (QA, development, demos). The server keeps those events in a separate bucket so they never land in the real-player numbers. */
export function isInternalDevice(): boolean {
  return readLocal(INTERNAL_KEY) === "1";
}

export function setInternalDevice(internal: boolean): void {
  if (internal) writeLocal(INTERNAL_KEY, "1");
  else removeLocal(INTERNAL_KEY);
}

/**
 * True on a debug/QA Android build, read from the flag Capacitor itself injects
 * into the page before any of our JS runs:
 *
 *   JSExport.getGlobalJS()  ->  window.Capacitor = { DEBUG: <isDebug>, ... }
 *   CapConfig.java          ->  isDebug = ApplicationInfo.FLAG_DEBUGGABLE is set
 *
 * FLAG_DEBUGGABLE comes from the manifest's android:debuggable, which AGP sets for
 * the debug build type and never for release - so this is a property of the APK
 * itself, not of local storage. That is the whole point: unlike the flag above, it
 * survives a reinstall, an app-data clear, a new installationId and a new session,
 * which is exactly what our own QA runs kept losing (22-23 Sep 2026).
 *
 * A Play build can never match. Google Play refuses to publish an artifact with
 * android:debuggable="true" at all, and a locally built RELEASE apk reports false
 * here too - it stays external unless someone marks it by hand. The signal only
 * ever errs towards "real player", never towards silently hiding one.
 *
 * Strict === true: a non-boolean value is not trusted. Web has no injected
 * Capacitor global at all, so this is false there and nothing about the website's
 * numbers changes.
 */
export function isQaBuild(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const capacitor = (window as unknown as { Capacitor?: { DEBUG?: unknown } }).Capacitor;
    return capacitor?.DEBUG === true;
  } catch {
    // No window, or a host that refuses the property - treat as a real build.
    return false;
  }
}

/**
 * What the envelope actually sends as `isInternal`: the build says so, OR this
 * browser/device was marked by hand. Deliberately an OR and deliberately NOT
 * folded into isInternalDevice() - that one still reports only the stored flag,
 * so the Settings toggle keeps showing and controlling what the person chose.
 * The consequence is that a debug build cannot opt OUT of being internal, which
 * is the safe direction: the failure we had was QA activity landing in the real
 * player numbers, never the reverse.
 */
export function shouldReportAsInternal(): boolean {
  return isQaBuild() || isInternalDevice();
}

/**
 * Web convenience: visiting `?internal=1` marks this browser, `?internal=0` unmarks it.
 * Native builds have no address bar, so there the flag is set from the Settings screen's
 * hidden toggle or the DevTools console hook below.
 */
export function applyInternalFlagFromUrl(search: string): void {
  const value = new URLSearchParams(search).get("internal");
  if (value === "1") setInternalDevice(true);
  else if (value === "0") setInternalDevice(false);
}

/**
 * QA hook, deliberately global: `cydiSetInternal(true)` from the browser devtools
 * console (or from the Android WebView's remote devtools - see CLAUDE.md) marks
 * that device, and `cydiAnalyticsIdentity()` shows what the next event will send.
 * Reads/writes nothing but the three local values above.
 */
function installDevtoolsHook(): void {
  const w = window as unknown as Record<string, unknown>;
  w.cydiSetInternal = (internal: boolean) => {
    setInternalDevice(internal !== false);
    return isInternalDevice();
  };
  w.cydiAnalyticsIdentity = () => ({
    installationId: getInstallationId(),
    sessionId: getSessionId(),
    isInternal: isInternalDevice(),
  });
}

try {
  if (typeof window !== "undefined") {
    applyInternalFlagFromUrl(window.location?.search ?? "");
    installDevtoolsHook();
  }
} catch {
  // No DOM (unit tests, Worker) - the exported functions still work on their own.
}
