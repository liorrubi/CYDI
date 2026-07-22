/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Resolves the daily-challenge episode's shape, guaranteeing the screen
 * ALWAYS gets a drawable shape - even when the server picked a shape from a
 * catalog release this client doesn't hold (old cache / offline / rollback).
 *
 * Resolution ladder (first hit wins), decided ONCE per episode - the chosen
 * shape never changes after the player has seen it, and nothing here ever
 * swaps the app's active content source mid-session:
 *   1. Active content source (remote catalog or baked-in) + baked-in fallback
 *      - the ~always path, via contentRepository.getShapeById.
 *   2. The cached release envelope (a newer catalog may have been downloaded
 *      this session and be waiting for the next launch).
 *   3. One background refresh, then re-check the cache - covers "episode
 *      references a brand-new shape and this client hasn't downloaded the
 *      new catalog yet".
 *   4. A deterministic local substitute (seeded by the requested id, so a
 *      given episode substitutes the same shape on every affected device),
 *      reported to analytics with opaque content ids only.
 */
import { getShapeById, localContentSource, type ShapeDefinition } from "../content/contentRepository";
import { contentSourceFromCatalog } from "../content/remoteContentSource";
import { getCachedCatalog, refreshCatalogInBackground } from "../content/hydrateContent";
import { trackEvent } from "./analytics";

export type DailyShapeSource = "active" | "cached-release" | "refreshed-release" | "local-substitute";
export type DailyShapeResolution = { shape: ShapeDefinition; source: DailyShapeSource };

function findInCachedRelease(shapeId: string): ShapeDefinition | undefined {
  const cached = getCachedCatalog();
  if (!cached) return undefined;
  if (!cached.catalog.shapes.some((s) => s.id === shapeId)) return undefined;
  return contentSourceFromCatalog(cached.catalog, localContentSource)
    .getAllShapes()
    .find((s) => s.id === shapeId);
}

/** Stable non-crypto string hash - only used to spread substitute picks deterministically. */
function stableHash(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/** Injection points exist purely so tests can exercise the ladder without a browser/network. */
export type DailyShapeResolverDeps = {
  resolveActive: (shapeId: string) => ShapeDefinition | undefined;
  resolveCached: (shapeId: string) => ShapeDefinition | undefined;
  refresh: () => Promise<unknown>;
  substitutePool: () => ShapeDefinition[];
  hasCache: () => boolean;
  reportFallback: (requestedId: string, substituteId: string, hadCache: boolean) => void;
};

const defaultDeps: DailyShapeResolverDeps = {
  resolveActive: getShapeById,
  resolveCached: findInCachedRelease,
  refresh: refreshCatalogInBackground,
  substitutePool: () => localContentSource.getAllShapes(),
  hasCache: () => getCachedCatalog() !== null,
  reportFallback: (requestedId, substituteId, hadCache) =>
    trackEvent("daily_shape_fallback", { contentKey: requestedId, substituteKey: substituteId, hadCache }),
};

export async function resolveDailyShape(shapeId: string, deps: DailyShapeResolverDeps = defaultDeps): Promise<DailyShapeResolution> {
  const active = deps.resolveActive(shapeId);
  if (active) return { shape: active, source: "active" };

  const cached = deps.resolveCached(shapeId);
  if (cached) return { shape: cached, source: "cached-release" };

  // One refresh attempt, never a loop - offline/unreachable just falls through.
  try {
    await deps.refresh();
  } catch {
    // refreshCatalogInBackground never throws by contract; belt and braces.
  }
  const refreshed = deps.resolveCached(shapeId);
  if (refreshed) return { shape: refreshed, source: "refreshed-release" };

  const pool = deps.substitutePool();
  const substitute = pool[stableHash(shapeId) % pool.length];
  deps.reportFallback(shapeId, substitute.id, deps.hasCache());
  return { shape: substitute, source: "local-substitute" };
}