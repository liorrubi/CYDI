/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Remote-content boot flow. Two deliberately separate steps:
 *
 * 1. `applyCachedCatalog()` - SYNCHRONOUS, called once before React mounts.
 *    If a previously downloaded catalog sits in localStorage and still
 *    validates, it becomes the active content source. Works fully offline;
 *    zero network on the startup path.
 *
 * 2. `refreshCatalogInBackground()` - fire-and-forget after mount. Downloads
 *    the server's current catalog and, if it differs from the cache, stores
 *    it FOR THE NEXT LAUNCH. It never swaps the active source mid-session -
 *    two screens must never observe different catalogs within one run (see
 *    the setContentSource contract in contentRepository.ts).
 *
 * FALLBACK LADDER (any failure falls through, never breaks the game):
 *   fresh server catalog (next launch) -> cached catalog -> baked-in content.
 *
 * ROLLBACK: the server's catalog always wins over the cache regardless of
 * version direction, so re-publishing an older catalog rolls every client
 * back on their next refresh; DELETING the server catalog (404) clears the
 * cache and restores baked-in content everywhere.
 */
import { apiFetch } from "../services/nativeApi";
import { parseCatalogJson } from "./catalogSchema";
import { contentSourceFromCatalog } from "./remoteContentSource";
import { localContentSource, setContentSource } from "./contentRepository";

export const CATALOG_CACHE_KEY = "cydi.contentCatalog.v1";
const FETCH_TIMEOUT_MS = 8000;

export type HydrateResult = { applied: boolean; contentVersion?: number; reason?: string };

function readCache(): string | null {
  try {
    return localStorage.getItem(CATALOG_CACHE_KEY);
  } catch {
    return null;
  }
}

function writeCache(raw: string): void {
  try {
    localStorage.setItem(CATALOG_CACHE_KEY, raw);
  } catch {
    // Quota/privacy-mode failure: skip caching, the app just stays on its current content.
  }
}

function clearCache(): void {
  try {
    localStorage.removeItem(CATALOG_CACHE_KEY);
  } catch {
    // ignore
  }
}

/** Applies the cached catalog (if any, and only if it still validates) as the active content source. Synchronous - call before the first React render. */
export function applyCachedCatalog(): HydrateResult {
  const raw = readCache();
  if (raw === null) return { applied: false, reason: "no cached catalog" };

  const result = parseCatalogJson(raw);
  if (!result.ok) {
    // A cache that no longer validates (corruption, or a format this build
    // no longer accepts) is useless - drop it so the refresh can replace it.
    clearCache();
    return { applied: false, reason: `cached catalog rejected: ${result.error}` };
  }

  setContentSource(contentSourceFromCatalog(result.catalog, localContentSource));
  console.info(`[content] remote catalog v${result.catalog.contentVersion} active (${result.catalog.shapes.length} shapes)`);
  return { applied: true, contentVersion: result.catalog.contentVersion };
}

/**
 * Fetches the server's current catalog and caches it for the next launch.
 * Never throws; never touches the active source. 404 means "no remote
 * content published" and clears the cache (server-side rollback switch).
 */
export async function refreshCatalogInBackground(): Promise<HydrateResult> {
  let response;
  try {
    response = await apiFetch("/api/content/catalog", { timeoutMs: FETCH_TIMEOUT_MS });
  } catch {
    return { applied: false, reason: "network error" }; // offline etc. - cache/local stays in effect
  }

  if (response.status === 404) {
    clearCache();
    return { applied: false, reason: "no catalog published" };
  }
  if (!response.ok) return { applied: false, reason: `server error ${response.status}` };

  let raw: string;
  try {
    raw = await response.text();
  } catch {
    return { applied: false, reason: "unreadable response" };
  }

  const result = parseCatalogJson(raw);
  if (!result.ok) {
    // A catalog this build can't validate (corrupt, or a newer format) is
    // simply not adopted - the current cache/local content stays.
    return { applied: false, reason: `rejected: ${result.error}` };
  }

  if (raw !== readCache()) {
    writeCache(raw);
    console.info(`[content] catalog v${result.catalog.contentVersion} downloaded - active on next launch`);
  }
  return { applied: true, contentVersion: result.catalog.contentVersion };
}
