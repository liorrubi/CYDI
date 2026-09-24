// Worker half of Play Together's minimum-version gate (src/multiplayer/versionGate.ts
// holds the shared wire format). Enforced in worker/index.ts BEFORE any RoomDO is
// addressed, so a refused client costs a Worker request and nothing else.
//
// Read at most once per isolate per CACHE_MS, with a KV edge cacheTtl on top - room
// operations never pay a KV read each, and no DO is ever consulted. Fail-open: a
// missing key, a malformed value or a KV error all mean "gate off".

import {
  MP_UPDATE_REQUIRED_CLOSE_CODE,
  MP_UPDATE_REQUIRED_CODE,
  MP_UPDATE_REQUIRED_STATUS,
  MP_VERSION_GATE_KV_KEY,
  MP_VERSION_GATE_OFF,
  classifyMultiplayerClient,
  isUpdateRequired,
  parseVersionGateConfig,
  updateRequiredBody,
  type MultiplayerVersionGateConfig,
} from "../src/multiplayer/versionGate";

const CACHE_MS = 60_000;
const KV_CACHE_TTL_SECONDS = 60;

type GateKv = { get(key: string, options?: { cacheTtl?: number }): Promise<string | null> };

let cache: { config: MultiplayerVersionGateConfig; expiresAt: number } | null = null;

export async function readVersionGateConfig(kv: GateKv | undefined, now: number = Date.now()): Promise<MultiplayerVersionGateConfig> {
  if (cache !== null && now < cache.expiresAt) return cache.config;
  if (!kv) return MP_VERSION_GATE_OFF;
  try {
    const raw = await kv.get(MP_VERSION_GATE_KV_KEY, { cacheTtl: KV_CACHE_TTL_SECONDS });
    const config = parseVersionGateConfig(raw) ?? MP_VERSION_GATE_OFF;
    cache = { config, expiresAt: now + CACHE_MS };
    return config;
  } catch {
    return MP_VERSION_GATE_OFF;
  }
}

/** Null when the request may proceed; otherwise the response that refuses it. Never throws. */
export async function versionGateResponse(request: Request, kv: GateKv | undefined, kind: "http" | "ws"): Promise<Response | null> {
  try {
    const config = await readVersionGateConfig(kv);
    if (!config.enabled) return null;
    const client = classifyMultiplayerClient(new URL(request.url), request.headers);
    if (!isUpdateRequired(config, client)) return null;
    if (kind === "ws" && request.headers.get("upgrade")?.toLowerCase() === "websocket") return refuseSocket();
    return new Response(JSON.stringify(updateRequiredBody()), {
      status: MP_UPDATE_REQUIRED_STATUS,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return null;
  }
}

/** Accept, then close at once with the terminal code - the only signal a browser WebSocket can read. */
function refuseSocket(): Response {
  const Pair = (globalThis as unknown as { WebSocketPair: new () => { 0: WebSocket; 1: WebSocket & { accept(): void } } }).WebSocketPair;
  const pair = new Pair();
  const server = pair[1];
  server.accept();
  server.close(MP_UPDATE_REQUIRED_CLOSE_CODE, MP_UPDATE_REQUIRED_CODE);
  return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
}

export function _resetVersionGateCacheForTests(): void {
  cache = null;
}
