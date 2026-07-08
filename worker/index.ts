export interface Env {
  SHARE_KV: KVNamespace;
  ASSETS: Fetcher;
}

// Excludes 0/O and 1/I to avoid ids that are ambiguous when read aloud or copied by hand.
const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ID_LENGTH = 6;
const MAX_BODY_BYTES = 20_000;
const TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  let id = "";
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return id;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  if (!body || body.length > MAX_BODY_BYTES) return json({ error: "invalid payload" }, 400);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const type = (parsed as Record<string, unknown> | null)?.type;
  if (type !== "c" && type !== "r") return json({ error: "invalid shape" }, 400);

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomId();
    const existing = await env.SHARE_KV.get(id);
    if (existing === null) {
      await env.SHARE_KV.put(id, body, { expirationTtl: TTL_SECONDS });
      return json({ id }, 201);
    }
  }
  return json({ error: "could not allocate id" }, 500);
}

async function handleGet(id: string, env: Env): Promise<Response> {
  const value = await env.SHARE_KV.get(id);
  if (value === null) return json({ error: "not found" }, 404);
  return new Response(value, { headers: { "content-type": "application/json" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/share" && request.method === "POST") return handleCreate(request, env);

    const match = url.pathname.match(/^\/api\/share\/([A-Za-z0-9]{4,12})$/);
    if (match && request.method === "GET") return handleGet(match[1], env);

    return env.ASSETS.fetch(request);
  },
};
