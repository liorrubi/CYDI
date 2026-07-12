import { resampleAllSegments, splitIntoSegments } from "../engine/normalizePath";
import type { Challenge, DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";
import type { PenColorId } from "../app/constants";

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
    typeof v.h === "number" &&
    (v.b === undefined || (Array.isArray(v.b) && v.b.every((n) => typeof n === "number")))
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

// ---------- Artist Pack result share ----------
//
// A DELIBERATELY DISTINCT payload from the generic result share (`r`) above.
// The reference artwork (the draw-along guide / target ghost) is NEVER included
// - only the player's own attempt (`a`). This makes "the share never leaks the
// guide" a structural guarantee, not a rendering choice: there is no target
// field to render, even if the player had Show Guide on while drawing. The
// artwork/pack/artist names are carried so the landing page can credit the
// artist without exposing any of the pack's line-art.
export type SharedArtistResultPayload = {
  n: string; // artwork name
  pk: string; // pack name
  ar: string; // artist name
  pid: string; // pack id (lets the landing page deep-link to the pack)
  s: ScoreBreakdown;
  a: SharePath; // the player's attempt ONLY - no target/guide
  c?: PenColorId; // pen color used, so the landing page matches what the player saw
  aid?: string; // artwork id - lets "Draw It Back" re-resolve the exact same catalog artwork locally
};

export type DecodedSharedArtistResult = {
  artworkName: string;
  packName: string;
  artistName: string;
  packId: string;
  score: ScoreBreakdown;
  attempt: DrawingPath;
  attemptColor?: PenColorId;
  artworkId?: string;
};

// Real artwork ids look like "nimco-basketball-hoop" - lowercase alnum + dashes, a
// conservative bound well above any real id. A value failing this is dropped (treated
// as absent) rather than rejecting the whole payload - the rest of it is independently
// valid and still useful as a read-only shared result even without "Draw It Back".
const ARTWORK_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

function isValidArtworkId(value: unknown): value is string {
  return typeof value === "string" && ARTWORK_ID_PATTERN.test(value);
}

export function buildArtistResultPayload(args: {
  artworkName: string;
  packName: string;
  artistName: string;
  packId: string;
  score: ScoreBreakdown;
  attempt: DrawingPath;
  attemptColor?: PenColorId;
  artworkId?: string;
}): SharedArtistResultPayload {
  return {
    n: args.artworkName,
    pk: args.packName,
    ar: args.artistName,
    pid: args.packId,
    s: args.score,
    a: toSharePath(args.attempt),
    c: args.attemptColor,
    aid: args.artworkId,
  };
}

export function parseArtistResultPayload(raw: unknown): DecodedSharedArtistResult | null {
  const value = raw as Partial<SharedArtistResultPayload> | null;
  if (
    !value ||
    typeof value.n !== "string" ||
    typeof value.pk !== "string" ||
    typeof value.ar !== "string" ||
    typeof value.pid !== "string" ||
    !isScoreBreakdown(value.s) ||
    !isSharePath(value.a)
  ) {
    return null;
  }
  return {
    artworkName: value.n,
    packName: value.pk,
    artistName: value.ar,
    packId: value.pid,
    score: value.s,
    attempt: fromSharePath(value.a),
    attemptColor: typeof value.c === "string" ? (value.c as PenColorId) : undefined,
    artworkId: isValidArtworkId(value.aid) ? value.aid : undefined,
  };
}

export function encodeArtistResultLink(args: {
  artworkName: string;
  packName: string;
  artistName: string;
  packId: string;
  score: ScoreBreakdown;
  attempt: DrawingPath;
  attemptColor?: PenColorId;
  artworkId?: string;
}): string {
  return `${shareBaseUrl()}#a.${encode(buildArtistResultPayload(args))}`;
}

export function decodeArtistResultHash(hash: string): DecodedSharedArtistResult | null {
  if (!hash.startsWith("a.")) return null;
  try {
    return parseArtistResultPayload(decode(hash.slice(2)));
  } catch {
    return null;
  }
}
