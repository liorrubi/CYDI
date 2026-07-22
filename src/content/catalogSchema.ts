/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Content catalog wire format + validation - shared by the client
 * (hydrateContent / remoteContentSource), the Worker (catalog GET/PUT
 * endpoints and the daily-challenge DO), and the export tool.
 *
 * THE CATALOG IS DATA ONLY: category records and shapes serialized as plain
 * point arrays. It can never carry JavaScript, functions, or any executable
 * payload - the client turns points into DrawingPath objects with its own
 * code and nothing from the network is ever evaluated.
 *
 * Like analyticsSchema.ts, this module must stay dependency-light and free of
 * import.meta.env so the Worker and plain-Node tests can import it directly.
 */

export const CATALOG_FORMAT_VERSION = 1;

// Hard caps - a catalog exceeding any of these is rejected outright, both by
// the Worker on upload and by the client before activating remote content
// (render-DoS/memory guard, same philosophy as shareLink's point caps).
export const MAX_CATALOG_BYTES = 10_000_000; // well under the 25 MB KV value limit
export const MAX_CATEGORIES = 64;
export const MAX_SHAPES = 5000;
export const MAX_POINTS_PER_SHAPE = 5000;
export const MAX_NAME_LENGTH = 100;
export const MAX_ICON_LENGTH = 16;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type CatalogCategory = { id: string; name: string; icon: string };

/** Serialized drawing: [x,y] pairs in the catalog's canvasSize coordinate space; `breaks` marks indices where a new disconnected stroke starts (same meaning as DrawingPath.breaks). */
export type CatalogShapePath = { points: [number, number][]; breaks?: number[] };

export type CatalogShape = { id: string; name: string; category: string; path: CatalogShapePath };

export type ContentCatalog = {
  /** Wire-format version. A client only ever activates a catalog whose formatVersion it knows (exactly CATALOG_FORMAT_VERSION) - anything newer or older falls back to built-in content. */
  formatVersion: number;
  /** Strictly-positive integer bumped on every published catalog - used for logging, cache bookkeeping, and rollback audits. The server's current catalog always wins regardless of direction, so re-publishing an older catalog IS the rollback mechanism. */
  contentVersion: number;
  /** Informational ISO timestamp of when the export ran. */
  generatedAt: string;
  /** The coordinate space points were serialized at; the client rescales to any requested size. */
  canvasSize: number;
  categories: CatalogCategory[];
  shapes: CatalogShape[];
};

export type CatalogValidationResult = { ok: true; catalog: ContentCatalog } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_NAME_LENGTH;
}

function fail(error: string): CatalogValidationResult {
  return { ok: false, error };
}

/**
 * Strict, all-or-nothing validation of an untrusted catalog payload. Any
 * malformed field, unknown reference, duplicate id, or exceeded cap rejects
 * the WHOLE catalog - remote content is only ever activated fully-valid, and
 * a rejected catalog simply leaves the built-in content in place.
 */
export function validateCatalog(value: unknown): CatalogValidationResult {
  if (!isRecord(value)) return fail("catalog is not an object");

  if (value.formatVersion !== CATALOG_FORMAT_VERSION) {
    return fail(`unsupported formatVersion ${String(value.formatVersion)} (expected ${CATALOG_FORMAT_VERSION})`);
  }
  const contentVersion = value.contentVersion;
  if (typeof contentVersion !== "number" || !Number.isInteger(contentVersion) || contentVersion <= 0) {
    return fail("contentVersion must be a positive integer");
  }
  if (typeof value.generatedAt !== "string" || value.generatedAt.length > 40) return fail("generatedAt must be a short string");
  const canvasSize = value.canvasSize;
  if (typeof canvasSize !== "number" || !Number.isFinite(canvasSize) || canvasSize < 64 || canvasSize > 4096) {
    return fail("canvasSize out of range");
  }

  const rawCategories = value.categories;
  if (!Array.isArray(rawCategories) || rawCategories.length === 0 || rawCategories.length > MAX_CATEGORIES) {
    return fail("categories must be a non-empty array within the cap");
  }
  const categoryIds = new Set<string>();
  for (const cat of rawCategories) {
    if (!isRecord(cat)) return fail("category is not an object");
    if (!isId(cat.id)) return fail(`invalid category id: ${JSON.stringify(cat.id)}`);
    if (categoryIds.has(cat.id)) return fail(`duplicate category id: ${cat.id}`);
    if (!isName(cat.name)) return fail(`category "${cat.id}": invalid name`);
    if (typeof cat.icon !== "string" || cat.icon.length === 0 || cat.icon.length > MAX_ICON_LENGTH) {
      return fail(`category "${cat.id}": invalid icon`);
    }
    categoryIds.add(cat.id);
  }

  const rawShapes = value.shapes;
  if (!Array.isArray(rawShapes) || rawShapes.length === 0 || rawShapes.length > MAX_SHAPES) {
    return fail("shapes must be a non-empty array within the cap");
  }
  const shapeIds = new Set<string>();
  const categoriesWithShapes = new Set<string>();
  // Points may legitimately overshoot the canvas a little (a few generators
  // draw right up to / marginally past the edge); reject only clearly-broken
  // coordinates far outside the canvas.
  const coordMin = -0.5 * canvasSize;
  const coordMax = 1.5 * canvasSize;

  for (const shape of rawShapes) {
    if (!isRecord(shape)) return fail("shape is not an object");
    if (!isId(shape.id)) return fail(`invalid shape id: ${JSON.stringify(shape.id)}`);
    if (shapeIds.has(shape.id)) return fail(`duplicate shape id: ${shape.id}`);
    if (!isName(shape.name)) return fail(`shape "${shape.id}": invalid name`);
    if (!isId(shape.category) || !categoryIds.has(shape.category)) {
      return fail(`shape "${shape.id}": unknown category ${JSON.stringify(shape.category)}`);
    }
    if (!isRecord(shape.path)) return fail(`shape "${shape.id}": missing path`);

    const points = shape.path.points;
    if (!Array.isArray(points) || points.length < 2 || points.length > MAX_POINTS_PER_SHAPE) {
      return fail(`shape "${shape.id}": points must have 2..${MAX_POINTS_PER_SHAPE} entries`);
    }
    for (const point of points) {
      if (!Array.isArray(point) || point.length !== 2) return fail(`shape "${shape.id}": malformed point`);
      const [x, y] = point;
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
        return fail(`shape "${shape.id}": non-finite point`);
      }
      if (x < coordMin || x > coordMax || y < coordMin || y > coordMax) {
        return fail(`shape "${shape.id}": point far outside canvas`);
      }
    }

    const breaks = shape.path.breaks;
    if (breaks !== undefined) {
      if (!Array.isArray(breaks) || breaks.length >= points.length) return fail(`shape "${shape.id}": invalid breaks`);
      let previous = 0;
      for (const b of breaks) {
        // A trailing break equal to points.length is legal - toPathFromParts
        // emits one as the final segment boundary and the renderer treats it
        // as a no-op, so real baked-in shapes contain it.
        if (typeof b !== "number" || !Number.isInteger(b) || b <= previous || b > points.length) {
          return fail(`shape "${shape.id}": breaks must be strictly increasing indices inside points`);
        }
        previous = b;
      }
    }

    shapeIds.add(shape.id);
    categoriesWithShapes.add(shape.category);
  }

  for (const id of categoryIds) {
    if (!categoriesWithShapes.has(id)) return fail(`category "${id}" has no shapes`);
  }

  return { ok: true, catalog: value as unknown as ContentCatalog };
}

/** Parses raw JSON text (e.g. an HTTP/KV/cache payload) and validates it, without ever throwing. */
export function parseCatalogJson(raw: string): CatalogValidationResult {
  if (raw.length > MAX_CATALOG_BYTES) return fail("catalog exceeds size cap");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("catalog is not valid JSON");
  }
  return validateCatalog(parsed);
}
