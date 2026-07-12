import { encodePng } from "./pngEncoder";

// Mirrors the wire format produced by src/services/shareLink.ts (`SharePath`,
// `SharedChallengePayload`, `SharedResultPayload`) - duplicated here rather than
// imported because that module pulls in browser-only globals (`location`,
// `btoa`/`atob`) that don't type-check against the worker's DOM-less tsconfig.
type SharePoint = [number, number];
type SharePath = { p: SharePoint[]; w: number; h: number; b?: number[] };

export type ShareRecord = { type: "c" | "r" | "a"; payload: unknown };

export function parseShareRecord(raw: string): ShareRecord | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.type !== "c" && data.type !== "r" && data.type !== "a") return null;
    return { type: data.type, payload: data.payload };
  } catch {
    return null;
  }
}

// Mirrors the decode-side point cap in src/services/shareLink.ts. Stored share
// records already pass the 20 KB /api/share body cap, but bounding the point
// count here too keeps the OG-image renderer from ever being handed a
// pathologically large path to draw.
const MAX_SHARE_POINTS = 4000;

function isSharePath(value: unknown): value is SharePath {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.p) &&
    v.p.length <= MAX_SHARE_POINTS &&
    v.p.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((n) => typeof n === "number")) &&
    typeof v.w === "number" &&
    typeof v.h === "number"
  );
}

/** Picks out whichever drawing the sharing player actually made by hand: the shape they
 * drew when creating a challenge, or their own attempt when sharing a played result -
 * never the other side of the comparison. */
function extractDrawnPath(record: ShareRecord): SharePath | null {
  if (typeof record.payload !== "object" || record.payload === null) return null;
  const payload = record.payload as Record<string, unknown>;
  if (record.type === "c" && isSharePath(payload.t)) return payload.t;
  // For both played-result share types the drawn path is the player's own
  // attempt (`a`). The Artist Pack share (`a`) has no target field at all, so
  // the guide/reference artwork can never end up in the unfurl image.
  if ((record.type === "r" || record.type === "a") && isSharePath(payload.a)) return payload.a;
  return null;
}

function splitIntoSegments(points: SharePoint[], breaks: number[] | undefined): SharePoint[][] {
  if (!breaks || breaks.length === 0) return points.length > 0 ? [points] : [];
  const segments: SharePoint[][] = [];
  let start = 0;
  for (const breakIndex of breaks) {
    segments.push(points.slice(start, breakIndex));
    start = breakIndex;
  }
  segments.push(points.slice(start));
  return segments.filter((segment) => segment.length > 0);
}

const IMAGE_SIZE = 640;
const MARGIN = 64;
const STROKE_COLOR: readonly [number, number, number] = [30, 32, 46]; // matches the app's default ink color
const BASE_STROKE_WIDTH = 5; // matches DrawingCanvas's default lineWidth, in the same canvas-coordinate units as SharePath.w/h

function plotDot(rgba: Uint8Array, width: number, height: number, cx: number, cy: number, radius: number): void {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));
  const r2 = radius * radius;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      const offset = (y * width + x) * 4;
      rgba[offset] = STROKE_COLOR[0];
      rgba[offset + 1] = STROKE_COLOR[1];
      rgba[offset + 2] = STROKE_COLOR[2];
      rgba[offset + 3] = 255;
    }
  }
}

function drawThickLine(
  rgba: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  strokeWidth: number,
): void {
  const distance = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(distance / (strokeWidth / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    plotDot(rgba, width, height, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, strokeWidth / 2);
  }
}

/** Renders a single decoded drawing onto a white square PNG, scaled and stroked to
 * roughly match how it looks on the in-app canvas. */
async function renderSharePathPng(sharePath: SharePath): Promise<Uint8Array> {
  const rgba = new Uint8Array(IMAGE_SIZE * IMAGE_SIZE * 4).fill(255);

  const usable = IMAGE_SIZE - MARGIN * 2;
  const scale = Math.min(usable / Math.max(sharePath.w, 1), usable / Math.max(sharePath.h, 1));
  const offsetX = (IMAGE_SIZE - sharePath.w * scale) / 2;
  const offsetY = (IMAGE_SIZE - sharePath.h * scale) / 2;
  const strokeWidth = Math.max(3, BASE_STROKE_WIDTH * scale);
  const mapX = (x: number) => offsetX + x * scale;
  const mapY = (y: number) => offsetY + y * scale;

  for (const segment of splitIntoSegments(sharePath.p, sharePath.b)) {
    plotDot(rgba, IMAGE_SIZE, IMAGE_SIZE, mapX(segment[0][0]), mapY(segment[0][1]), strokeWidth / 2);
    for (let i = 1; i < segment.length; i++) {
      drawThickLine(
        rgba,
        IMAGE_SIZE,
        IMAGE_SIZE,
        mapX(segment[i - 1][0]),
        mapY(segment[i - 1][1]),
        mapX(segment[i][0]),
        mapY(segment[i][1]),
        strokeWidth,
      );
    }
  }

  return encodePng(IMAGE_SIZE, IMAGE_SIZE, rgba);
}

/** Renders the share's drawing as a PNG, or null if the payload has no usable path. */
export async function renderShareImage(record: ShareRecord): Promise<Uint8Array | null> {
  const sharePath = extractDrawnPath(record);
  if (!sharePath) return null;
  return renderSharePathPng(sharePath);
}

/** Link-preview copy, matching the text used in the app's own native-share sheet
 * (see MyChallengesScreen's and PlayChallengeScreen's `shareOrCopy` calls). */
export function shareTitleAndDescription(record: ShareRecord): { title: string; description: string } | null {
  if (typeof record.payload !== "object" || record.payload === null) return null;
  const payload = record.payload as Record<string, unknown>;
  if (typeof payload.n !== "string") return null;
  const name = payload.n;

  if (record.type === "c") {
    return { title: `CYDI Challenge: ${name}`, description: `Can you draw "${name}"? Try my CYDI challenge!` };
  }

  const score = payload.s as Record<string, unknown> | undefined;
  const total = score && typeof score.total === "number" ? Math.round(score.total) : null;

  // Artist Pack result: credit the artist/pack in the unfurl copy, and never
  // reference any unpublished content (the payload only carries public names).
  if (record.type === "a") {
    const packName = typeof payload.pk === "string" ? payload.pk : null;
    const artistName = typeof payload.ar === "string" ? payload.ar : null;
    const credit = artistName ? ` by ${artistName}` : "";
    const packSuffix = packName ? ` from the ${packName} Artist Pack${credit}` : "";
    return {
      title: `CYDI Result: ${name}`,
      description:
        total !== null
          ? `I scored ${total}% drawing "${name}"${packSuffix} on CYDI!`
          : `Check out my CYDI drawing of "${name}"${packSuffix}!`,
    };
  }

  return {
    title: `CYDI Result: ${name}`,
    description: total !== null ? `I scored ${total}% on "${name}"! Think you can beat it?` : `Check out my CYDI result for "${name}"!`,
  };
}
