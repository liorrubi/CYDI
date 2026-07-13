import {
  buildArtistResultPayload,
  buildChallengePayload,
  buildResultPayload,
  parseArtistResultPayload,
  parseChallengePayload,
  parseResultPayload,
  type DecodedSharedArtistResult,
  type DecodedSharedChallenge,
  type DecodedSharedResult,
} from "./shareLink";
import { apiFetch, getPublicOrigin } from "./nativeApi";
import type { Challenge, DrawingPath } from "../types/Challenge";
import type { PenColorId } from "../app/constants";
import type { ScoreBreakdown } from "../types/Score";

const REQUEST_TIMEOUT_MS = 4000;

// Any failure (no server, offline, timeout, old deploy without the /api/share
// route) resolves to null rather than throwing - callers fall back to the
// self-contained hash link, which never depends on a server.
async function postShare(type: "c" | "r" | "a", payload: unknown): Promise<string | null> {
  try {
    const response = await apiFetch("/api/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, payload }),
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { id?: unknown };
    return typeof data.id === "string" ? data.id : null;
  } catch {
    return null;
  }
}

export async function createShortChallengeLink(challenge: Challenge): Promise<string | null> {
  const id = await postShare("c", buildChallengePayload(challenge));
  return id ? `${getPublicOrigin()}/c/${id}` : null;
}

export async function createShortResultLink(args: {
  challengeId: string;
  challengeName: string;
  score: ScoreBreakdown;
  target: DrawingPath;
  attempt: DrawingPath;
}): Promise<string | null> {
  const id = await postShare("r", buildResultPayload(args));
  return id ? `${getPublicOrigin()}/c/${id}` : null;
}

export async function createShortArtistResultLink(args: {
  artworkName: string;
  packName: string;
  artistName: string;
  packId: string;
  score: ScoreBreakdown;
  attempt: DrawingPath;
  attemptColor?: PenColorId;
  artworkId?: string;
}): Promise<string | null> {
  const id = await postShare("a", buildArtistResultPayload(args));
  return id ? `${getPublicOrigin()}/c/${id}` : null;
}

export type FetchedShare =
  | { kind: "challenge"; data: DecodedSharedChallenge }
  | { kind: "result"; data: DecodedSharedResult }
  | { kind: "artistResult"; data: DecodedSharedArtistResult };

export async function fetchSharedById(id: string): Promise<FetchedShare | null> {
  try {
    const response = await apiFetch(`/api/share/${id}`);
    if (!response.ok) return null;
    const data = (await response.json()) as { type?: unknown; payload?: unknown };
    if (data.type === "c") {
      const parsed = parseChallengePayload(data.payload);
      return parsed ? { kind: "challenge", data: parsed } : null;
    }
    if (data.type === "r") {
      const parsed = parseResultPayload(data.payload);
      return parsed ? { kind: "result", data: parsed } : null;
    }
    if (data.type === "a") {
      const parsed = parseArtistResultPayload(data.payload);
      return parsed ? { kind: "artistResult", data: parsed } : null;
    }
    return null;
  } catch {
    return null;
  }
}
