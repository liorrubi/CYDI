/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The version identity analytics reports, per surface:
//
//   Web      appVersion = APP_VERSION (the web bundle's own constant), no versionCode.
//   Android  appVersion = the INSTALLED package's versionName, appVersionCode = its
//            versionCode - both read from the native package metadata through
//            Capacitor's App.getInfo(), never from the web bundle.
//
// Why: web and Android ship on different schedules, so APP_VERSION legitimately runs
// ahead of the APK (web was 0.52.1 while the live Android release was 0.51.0 /
// versionCode 45). Stamping Android events with APP_VERSION reported a web release
// the device had never installed.
//
// App.getInfo() is async and the envelope is built synchronously, so the value is
// read once at bootstrap (main.tsx awaits it, bounded, before the first render) and
// cached here. Until it resolves - or if it fails - Android reports "unknown", never
// APP_VERSION: an honest gap is better than a confidently wrong release.

import { Capacitor } from "@capacitor/core";

import { APP_VERSION } from "../app/constants";

/** What the envelope sends before the native value is known, and when reading it failed. The Worker already counts it under "unknown". */
export const NATIVE_VERSION_FALLBACK = "unknown";

type NativeInfo = { version: string; build: string };

let cached: NativeInfo | null = null;
let pending: Promise<void> | null = null;
let isNative: () => boolean = () => Capacitor.isNativePlatform();

type InfoReader = () => Promise<{ version?: unknown; build?: unknown }>;

async function defaultReader(): Promise<{ version?: unknown; build?: unknown }> {
  const { App } = await import("@capacitor/app");
  return App.getInfo();
}

let reader: InfoReader = defaultReader;

/**
 * Reads the native package info once per run. Resolves (never rejects) when the
 * value is cached or reading it has failed; `timeoutMs` bounds how long a caller
 * (the bootstrap) waits - the read itself may still land afterwards.
 */
export function initNativeAppInfo(timeoutMs = 1500): Promise<void> {
  if (!isNative()) return Promise.resolve();
  pending ??= reader().then(
    (info) => {
      const version = typeof info.version === "string" ? info.version : "";
      const build = typeof info.build === "string" || typeof info.build === "number" ? String(info.build) : "";
      if (version !== "") cached = { version, build };
    },
    () => {
      // No package info: stay on the fallback for this run.
    },
  );
  return Promise.race([pending, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

/** Synchronous, for the analytics envelope. */
export function getAnalyticsAppVersion(): string {
  if (!isNative()) return APP_VERSION;
  return cached?.version ?? NATIVE_VERSION_FALLBACK;
}

/** Native versionCode as a string, or undefined on web / before it is known (the field is then omitted entirely). */
export function getAnalyticsAppVersionCode(): string | undefined {
  if (!isNative()) return undefined;
  return cached?.build || undefined;
}

/**
 * The version the Settings footer shows: the web bundle's APP_VERSION on the web; on
 * Android the installed package's versionName with its versionCode, e.g. "0.53.0 (47)",
 * so a support screenshot names the exact APK.
 */
export function getDisplayAppVersion(): string {
  const version = getAnalyticsAppVersion();
  const code = getAnalyticsAppVersionCode();
  return code === undefined ? version : `${version} (${code})`;
}

export function _resetNativeAppInfoForTests(options: { native?: boolean; reader?: InfoReader } = {}): void {
  cached = null;
  pending = null;
  isNative = options.native === undefined ? () => Capacitor.isNativePlatform() : () => options.native as boolean;
  reader = options.reader ?? defaultReader;
}
