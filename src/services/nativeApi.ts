import { Capacitor, CapacitorHttp } from "@capacitor/core";

// Capacitor serves the bundled app from a virtual "https://localhost" origin on
// native platforms (Android/iOS) - never the real production domain. Any code that
// builds a public URL from `location.origin`, or calls `fetch()` with a root-relative
// "/api/..." path expecting it to reach the Cloudflare Worker, silently breaks inside
// the native app even though it works fine on the real website. This is the one place
// that knows the real origin and how to reach it from each platform; every service
// that builds a shareable URL or calls the Worker (shareLink, shareApi,
// dailyChallengeApi, analytics) goes through here instead of touching
// `location`/`fetch` directly.
export const PRODUCTION_ORIGIN = "https://playcydi.com";

/**
 * The origin to build a public, shareable URL against - the production domain on
 * native, whatever the page is actually served from on web (playcydi.com, a preview
 * deploy, or localhost during `npm run dev`). Web behavior is unchanged: this only
 * ever substitutes a fixed origin on native.
 */
export function getPublicOrigin(): string {
  return Capacitor.isNativePlatform() ? PRODUCTION_ORIGIN : location.origin;
}

type ApiFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Web-only (passed straight to `fetch`) - lets a request outlive page unload, e.g. an analytics beacon fired right before navigating away. No native equivalent needed: CapacitorHttp requests aren't tied to page lifecycle. */
  keepalive?: boolean;
};

/** The subset of `Response` every caller here actually uses - satisfied by a real `fetch()` Response on web, and by the wrapper below on native. */
export type ApiResponse = { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> };

/** Shape of the options CapacitorHttp.request expects - split out from `apiFetch` purely so the URL-resolution logic can be tested directly, without going through the real native bridge (which doesn't exist in a unit-test environment). */
export type NativeHttpOptions = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  data?: string;
  connectTimeout?: number;
  readTimeout?: number;
};

/** Pure: resolves what a native request for `path` would look like, against the real production origin - never `location`, never the WebView's virtual origin. */
export function buildNativeHttpOptions(path: string, init: ApiFetchInit = {}): NativeHttpOptions {
  return {
    url: `${PRODUCTION_ORIGIN}${path}`,
    method: init.method ?? "GET",
    headers: init.headers,
    data: init.body,
    connectTimeout: init.timeoutMs,
    readTimeout: init.timeoutMs,
  };
}

/**
 * Calls a Worker API route (`path` like "/api/daily/current?..."). On web this is a
 * plain, unchanged `fetch` against the relative path (same origin as the page).
 *
 * On native, a relative path would resolve against the wrong virtual origin, and an
 * absolute URL alone doesn't fix it either - verified live against a real device that
 * the WebView's own `fetch` still gets CORS-blocked (the Worker sends no
 * Access-Control-Allow-Origin, and https://localhost -> https://playcydi.com is a
 * cross-origin request). So native requests are routed through Capacitor's native HTTP
 * bridge (CapacitorHttp.request) against the real production origin instead - real
 * native networking isn't subject to the browser's same-origin policy at all. This is
 * called explicitly only by the handful of API call sites below; it does NOT patch the
 * global `fetch`/`XMLHttpRequest`, so nothing else in the app is affected.
 */
export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<ApiResponse> {
  if (!Capacitor.isNativePlatform()) {
    const { method = "GET", headers, body, timeoutMs, keepalive } = init;
    const controller = timeoutMs !== undefined ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      return await fetch(path, { method, headers, body, keepalive, signal: controller?.signal });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  const response = await CapacitorHttp.request(buildNativeHttpOptions(path, init));
  const ok = response.status >= 200 && response.status < 300;
  return {
    ok,
    status: response.status,
    json: async () => (typeof response.data === "string" ? JSON.parse(response.data) : response.data),
    text: async () => (typeof response.data === "string" ? response.data : JSON.stringify(response.data)),
  };
}
