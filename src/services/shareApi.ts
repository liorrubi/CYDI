import {
  buildChallengePayload,
  buildResultPayload,
  parseChallengePayload,
  parseResultPayload,
  type DecodedSharedChallenge,
  type DecodedSharedResult,
} from "./shareLink";
import type { Challenge, DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

const REQUEST_TIMEOUT_MS = 4000;

// Any failure (no server, offline, timeout, old deploy without the /api/share
// route) resolves to null rather than throwing - callers fall back to the
// self-contained hash link, which never depends on a server.
async function postShare(type: "c" | "r", payload: unknown): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch("/api/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, payload }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const data = (await response.json()) as { id?: unknown };
    return typeof data.id === "string" ? data.id : null;
  } catch {
    return null;
  }
}

export async function createShortChallengeLink(challenge: Challenge): Promise<string | null> {
  const id = await postShare("c", buildChallengePayload(challenge));
  return id ? `${location.origin}/c/${id}` : null;
}

export async function createShortResultLink(args: {
  challengeId: string;
  challengeName: string;
  score: ScoreBreakdown;
  target: DrawingPath;
  attempt: DrawingPath;
}): Promise<string | null> {
  const id = await postShare("r", buildResultPayload(args));
  return id ? `${location.origin}/c/${id}` : null;
}

export type FetchedShare =
  | { kind: "challenge"; data: DecodedSharedChallenge }
  | { kind: "result"; data: DecodedSharedResult };

export async function fetchSharedById(id: string): Promise<FetchedShare | null> {
  try {
    const response = await fetch(`/api/share/${id}`);
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
    return null;
  } catch {
    return null;
  }
}
