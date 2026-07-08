import { resampleAllSegments, splitIntoSegments } from "../engine/normalizePath";
import type { Challenge, DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

type SharePoint = [x: number, y: number];

type SharePath = { p: SharePoint[]; w: number; h: number; b?: number[] };

// Raw drawn strokes routinely carry hundreds of points (one per pointermove
// event, unthrottled) - a share link has no use for that much density, since
// both rendering and scoring already resample internally. Capping the point
// budget here is what keeps links short; it never resamples past the
// original point count, so already-short paths are left untouched.
const SHARE_POINT_BUDGET = 48;

function compactForSharing(path: DrawingPath): DrawingPath {
  if (path.points.length <= SHARE_POINT_BUDGET) return path;

  const segments = splitIntoSegments(path.points, path.breaks).filter((segment) => segment.length > 0);
  if (segments.length === 0) return path;

  const { points, segmentStarts } = resampleAllSegments(segments, SHARE_POINT_BUDGET);
  return { points, canvasWidth: path.canvasWidth, canvasHeight: path.canvasHeight, breaks: segmentStarts };
}

function toSharePoints(points: DrawingPath["points"]): SharePoint[] {
  return points.map((point) => [Math.round(point.x), Math.round(point.y)]);
}

function fromSharePoints(points: SharePoint[]): DrawingPath["points"] {
  return points.map(([x, y]) => ({ x, y, t: 0 }));
}

function toSharePath(path: DrawingPath): SharePath {
  const compact = compactForSharing(path);
  return { p: toSharePoints(compact.points), w: compact.canvasWidth, h: compact.canvasHeight, b: compact.breaks };
}

function fromSharePath(shared: SharePath): DrawingPath {
  return { points: fromSharePoints(shared.p), canvasWidth: shared.w, canvasHeight: shared.h, breaks: shared.b };
}

function isSharePath(value: unknown): value is SharePath {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.p) &&
    v.p.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((n) => typeof n === "number")) &&
    typeof v.w === "number" &&
    typeof v.h === "number"
  );
}

// btoa/atob only handle Latin1, so UTF-8 bytes (needed for Hebrew challenge names)
// are routed through a binary string first - this is the standard workaround.
function encode(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(encoded: string): unknown {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "===".slice((base64.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function shareBaseUrl(): string {
  return `${location.origin}${location.pathname}`;
}

export type SharedChallengePayload = { i: string; n: string; t: SharePath };

export type DecodedSharedChallenge = { id: string; name: string; target: DrawingPath };

export function buildChallengePayload(challenge: Challenge): SharedChallengePayload {
  return { i: challenge.id, n: challenge.name, t: toSharePath(challenge.target) };
}

export function parseChallengePayload(raw: unknown): DecodedSharedChallenge | null {
  const value = raw as Partial<SharedChallengePayload> | null;
  if (!value || typeof value.i !== "string" || typeof value.n !== "string" || !isSharePath(value.t)) return null;
  return { id: value.i, name: value.n, target: fromSharePath(value.t) };
}

export function encodeChallengeLink(challenge: Challenge): string {
  return `${shareBaseUrl()}#c.${encode(buildChallengePayload(challenge))}`;
}

export function decodeChallengeHash(hash: string): DecodedSharedChallenge | null {
  if (!hash.startsWith("c.")) return null;
  try {
    return parseChallengePayload(decode(hash.slice(2)));
  } catch {
    return null;
  }
}

export type SharedResultPayload = { i: string; n: string; s: ScoreBreakdown; t: SharePath; a: SharePath };

export type DecodedSharedResult = {
  challengeId: string;
  challengeName: string;
  score: ScoreBreakdown;
  target: DrawingPath;
  attempt: DrawingPath;
};

function isScoreBreakdown(value: unknown): value is ScoreBreakdown {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.total === "number" &&
    typeof v.shapeMatch === "number" &&
    typeof v.coverage === "number" &&
    typeof v.smoothness === "number" &&
    typeof v.scale === "number" &&
    typeof v.message === "string"
  );
}

export function buildResultPayload(args: {
  challengeId: string;
  challengeName: string;
  score: ScoreBreakdown;
  target: DrawingPath;
  attempt: DrawingPath;
}): SharedResultPayload {
  return {
    i: args.challengeId,
    n: args.challengeName,
    s: args.score,
    t: toSharePath(args.target),
    a: toSharePath(args.attempt),
  };
}

export function parseResultPayload(raw: unknown): DecodedSharedResult | null {
  const value = raw as Partial<SharedResultPayload> | null;
  if (
    !value ||
    typeof value.i !== "string" ||
    typeof value.n !== "string" ||
    !isScoreBreakdown(value.s) ||
    !isSharePath(value.t) ||
    !isSharePath(value.a)
  ) {
    return null;
  }
  return {
    challengeId: value.i,
    challengeName: value.n,
    score: value.s,
    target: fromSharePath(value.t),
    attempt: fromSharePath(value.a),
  };
}

export function encodeResultLink(args: {
  challengeId: string;
  challengeName: string;
  score: ScoreBreakdown;
  target: DrawingPath;
  attempt: DrawingPath;
}): string {
  return `${shareBaseUrl()}#r.${encode(buildResultPayload(args))}`;
}

export function decodeResultHash(hash: string): DecodedSharedResult | null {
  if (!hash.startsWith("r.")) return null;
  try {
    return parseResultPayload(decode(hash.slice(2)));
  } catch {
    return null;
  }
}
