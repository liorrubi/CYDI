/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Remote-content boot flow. Two deliberately separate steps:
 *
 * 1. `applyCachedCatalog()` - SYNCHRONOUS, called once before React mounts.
 *    If a previously downloaded release envelope sits in localStorage and
 *    still validates, its catalog becomes the active content source. Works
 *    fully offline; zero network on the startup path.
 *
 * 2. `refreshCatalogInBackground()` - fire-and-forget after mount. Downloads
 *    the server's ACTIVE release and, if its releaseId differs from the
 *    cached one, verifies the catalog hash and stores it FOR THE NEXT
 *    LAUNCH. It never swaps the active source mid-session - two screens
 *    must never observe different catalogs within one run (see the
 *    setContentSource contract in contentRepository.ts).
 *
 * ADOPTION RULE: a downloaded release replaces the cache iff its releaseId
 * differs (hash-verified first). There is deliberately NO "higher
 * contentVersion wins" rule - re-activating an OLDER release on the server
 * (rollback) must reach clients exactly like an upgrade does.
 *
 * FALLBACK LADDER (any failure falls through, never breaks the game):
 *   fresh server release (next launch) -> cached release -> baked-in content.
 *
 * ROLLBACK: server flips content:active to an earlier releaseId; clients see
 * a different releaseId and adopt it. Deleting the pointer (404) clears the
 * cache and restores baked-in content everywhere.
 */
import { apiFetch } from "../services/nativeApi";
import { parseReleaseJson, sha256Hex, type ContentCatalog } from "./catalogSchema";
import { contentSourceFromCatalog } from "./remoteContentSource";
import { localContentSource, setContentSource } from "./contentRepository";

export const RELEASE_CACHE_KEY = "cydi.contentRelease.v1";
/** Pre-release cache key from the phase-1 implementation (raw catalog, no envelope). Never shipped in any store build - just dropped. */
const LEGACY_CACHE_KEY = "cydi.contentCatalog.v1";
const FETCH_TIMEOUT_MS = 8000;

export type HydrateResult = { applied: boolean; releaseId?: string; contentVersion?: number; reason?: string };

function readCache(): string | null {
  try {
    return localStorage.getItem(RELEASE_CACHE_KEY);
  } catch {
    return null;
  }
}

function writeCache(raw: string): void {
  try {
    localStorage.setItem(RELEASE_CACHE_KEY, raw);
  } catch {
    // Quota/privacy-mode failure: skip caching, the app just stays on its current content.
  }
}

function clearCache(): void {
  try {
    localStorage.removeItem(RELEASE_CACHE_KEY);
  } catch {
    // ignore
  }
}

/** The releaseId of the cached envelope, or null. Cheap-parses just the envelope, not the embedded catalog. */
export function getCachedReleaseId(): string | null {
  const raw = readCache();
  if (raw === null) return null;
  try {
    const releaseId = (JSON.parse(raw) as Record<string, unknown>).releaseId;
    return typeof releaseId === "string" ? releaseId : null;
  } catch {
    return null;
  }
}

/** Full parse+validation of the cached envelope for callers that need the catalog data itself (e.g. the daily-challenge shape resolver). Returns null when there is no valid cache. */
export function getCachedCatalog(): { releaseId: string; catalog: ContentCatalog } | null {
  const raw = readCache();
  if (raw === null) return null;
  const result = parseReleaseJson(raw);
  if (!result.ok) return null;
  return { releaseId: result.release.releaseId, catalog: result.catalog };
}

/** Applies the cached release's catalog (if any, and only if it still validates) as the active content source. Synchronous - call before the first React render. */
export function applyCachedCatalog(): HydrateResult {
  try {
    localStorage.removeItem(LEGACY_CACHE_KEY);
  } catch {
    // ignore
  }

  const raw = readCache();
  if (raw === null) return { applied: false, reason: "no cached release" };

  const result = parseReleaseJson(raw);
  if (!result.ok) {
    // A cache that no longer validates (corruption, or a format this build
    // no longer accepts) is useless - drop it so the refresh can replace it.
    clearCache();
    return { applied: false, reason: `cached release rejected: ${result.error}` };
  }

  setContentSource(contentSourceFromCatalog(result.catalog, localContentSource));
  console.info(
    `[content] release ${result.release.releaseId} active (catalog v${result.catalog.contentVersion}, ${result.catalog.shapes.length} shapes)`,
  );
  return { applied: true, releaseId: result.release.releaseId, contentVersion: result.catalog.contentVersion };
}

/**
 * Fetches the server's active release and caches it for the next launch.
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

  const result = parseReleaseJson(raw);
  if (!result.ok) {
    // A release this build can't validate (corrupt, or a newer format) is
    // simply not adopted - the current cache/local content stays.
    return { applied: false, reason: `rejected: ${result.error}` };
  }

  // Integrity: the embedded catalog must hash to what the envelope claims.
  if ((await sha256Hex(result.release.catalogJson)) !== result.release.catalogHash) {
    return { applied: false, reason: "hash mismatch" };
  }

  // Adoption by releaseId difference - upgrades AND rollbacks alike.
  if (result.release.releaseId !== getCachedReleaseId()) {
    writeCache(raw);
    console.info(`[content] release ${result.release.releaseId} downloaded (catalog v${result.catalog.contentVersion}) - active on next launch`);
  }
  return { applied: true, releaseId: result.release.releaseId, contentVersion: result.catalog.contentVersion };
}