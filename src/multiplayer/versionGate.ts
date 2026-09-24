// Play Together's minimum-version gate: the wire format shared by the client
// (roomApi.ts / roomSocket.ts) and the Worker (worker/index.ts, which enforces it
// BEFORE any RoomDO is addressed). Dependency-free for the same reason as
// protocol.ts - the Worker bundles it.
//
// OFF by default and fail-open: no config, a malformed config, or a KV failure all
// mean "allow". It is an operational lever for retiring Android builds that cannot
// handle a newer server (or that amplify load, like the pre-0.53.0 clients with no
// capacity backoff), switched on deliberately via KV - never a side effect.
//
// Android only, keyed on versionCode. The website always serves its latest bundle,
// and its APP_VERSION follows a different numbering (web 0.52.x while Android is
// 0.53.0), so a version-string gate would lock web players out for no reason.

export const MP_VERSION_GATE_KV_KEY = "config:multiplayer-version-gate";

/** HTTP status and body code for a gated create or /info. */
export const MP_UPDATE_REQUIRED_STATUS = 426;
export const MP_UPDATE_REQUIRED_CODE = "multiplayer_update_required";
/**
 * WebSocket close code for a gated /ws. A browser WebSocket cannot read the HTTP status
 * of a refused upgrade, so the Worker accepts the socket and closes it at once with
 * this code (4000-4999 is the application range). A client that sees it stops
 * reconnecting for good.
 */
export const MP_UPDATE_REQUIRED_CLOSE_CODE = 4426;

/** Query parameters every 0.53.0+ client adds to create, /info and /ws. */
export const MP_CLIENT_PARAMS = { platform: "pf", appVersion: "av", appVersionCode: "avc" } as const;

export type MultiplayerVersionGateConfig = {
  enabled: boolean;
  /** Android builds below this versionCode are refused. Builds that send no code (pre-0.53.0) count as 0. */
  minAndroidVersionCode: number;
};

export const MP_VERSION_GATE_OFF: MultiplayerVersionGateConfig = { enabled: false, minAndroidVersionCode: 0 };

export function isValidVersionGateConfig(value: unknown): value is MultiplayerVersionGateConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 2 &&
    typeof v.enabled === "boolean" &&
    typeof v.minAndroidVersionCode === "number" &&
    Number.isInteger(v.minAndroidVersionCode) &&
    v.minAndroidVersionCode >= 0 &&
    v.minAndroidVersionCode < 1_000_000_000
  );
}

export function parseVersionGateConfig(raw: string | null): MultiplayerVersionGateConfig | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidVersionGateConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export type MultiplayerClient = { platform: "android" | "web" | "ios"; appVersionCode: number };

/**
 * Who is calling. A 0.53.0+ client says so explicitly (`pf`). An older one sends
 * nothing, so it is told apart by transport:
 *   - Origin https://localhost      the Capacitor WebView (the Android app's /ws)
 *   - a Sec-Fetch-Site header       a real browser (the website)
 *   - neither                       the Android app's native HTTP (CapacitorHttp)
 * Erring towards "android" only matters while the gate is ON, and then only for a
 * client that sends no version - which is exactly an old Android build.
 */
export function classifyMultiplayerClient(url: URL, headers: { get(name: string): string | null }): MultiplayerClient {
  const code = Number(url.searchParams.get(MP_CLIENT_PARAMS.appVersionCode));
  const appVersionCode = Number.isInteger(code) && code > 0 ? code : 0;
  const declared = url.searchParams.get(MP_CLIENT_PARAMS.platform);
  if (declared === "android" || declared === "web" || declared === "ios") return { platform: declared, appVersionCode };
  if (headers.get("origin") === "https://localhost") return { platform: "android", appVersionCode };
  if (headers.get("sec-fetch-site") !== null) return { platform: "web", appVersionCode };
  return { platform: "android", appVersionCode };
}

export function isUpdateRequired(config: MultiplayerVersionGateConfig, client: MultiplayerClient): boolean {
  if (!config.enabled) return false;
  if (client.platform !== "android") return false;
  return client.appVersionCode < config.minAndroidVersionCode;
}

export function updateRequiredBody(): { error: string; code: string } {
  return { error: "This version of CYDI is too old for Play Together. Please update the app.", code: MP_UPDATE_REQUIRED_CODE };
}
