/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * ContentRepository — the single access point for ALL drawable content:
 * categories, shapes (levels), Mega Challenge cards, and Artist Packs.
 *
 * Screens, components, and services must import content ONLY from this module,
 * never from the engine libraries directly. The engine libraries
 * (shapeLibrary / megaShapeLibrary / artistPackLibrary) remain the local,
 * baked-in content DEFINITION; this module owns content ACCESS.
 *
 * WHY: this is the seam for a future remote content source. When shapes /
 * categories / levels can be served from the server, only this module changes:
 * an async boot step (e.g. `hydrateContent()`) fetches + validates a remote
 * catalog, converts it into the same `ContentSource` shape, and swaps it in via
 * `setContentSource` before React mounts — every consumer keeps its synchronous
 * reads and nothing else in the app needs to know. Until then the local source
 * is both the active source and the permanent offline fallback.
 *
 * KNOWN EXCEPTION: `src/services/analyticsSchema.ts` still imports CATEGORIES
 * from the engine directly. It is shared with the Cloudflare Worker, and this
 * module (via artistPackLibrary) touches `import.meta.env`, which does not
 * exist in the workerd runtime. The Worker is the server side anyway — when
 * content moves to the server it will own the catalog, not consume this
 * client repository.
 */
import {
  CATEGORIES,
  SHAPE_LIBRARY,
  getShapeById as engineGetShapeById,
  shapesForCategory as engineShapesForCategory,
  type CategoryId,
  type ShapeDefinition,
} from "../engine/shapeLibrary";
import {
  MEGA_CARDS,
  getMegaCardById as engineGetMegaCardById,
  megaCardsByRarity as engineMegaCardsByRarity,
  megaRarityLabel,
  type MegaCardDefinition,
} from "../engine/megaShapeLibrary";
import {
  getArtistPackById as engineGetArtistPackById,
  getPlayerFacingPacks as engineGetPlayerFacingPacks,
  getPublishedArtworks,
  getVisibleArtworks,
  packHasPublishedArtwork,
  resolvePublishedArtwork as engineResolvePublishedArtwork,
  artistOutboundUrl,
  type ArtistArtworkDefinition,
  type ArtistPackDefinition,
  type ArtistProfile,
  type ArtworkStatus,
} from "../engine/artistPackLibrary";
import type { MegaRarity } from "../app/constants";

// Content model types, re-exported so consumers can type against the
// repository without reaching into the engine layer.
export type {
  CategoryId,
  ShapeDefinition,
  MegaCardDefinition,
  ArtistArtworkDefinition,
  ArtistPackDefinition,
  ArtistProfile,
  ArtworkStatus,
};

/** Category metadata record. Display order = array order (data-driven). */
export type CategoryDefinition = { id: CategoryId; name: string; icon: string };

/**
 * Everything a content source must provide. All arrays are in display/level
 * order — order is part of the data, consumers never re-sort. A future remote
 * source implements exactly this contract from fetched JSON.
 */
export interface ContentSource {
  getCategories(): CategoryDefinition[];
  getAllShapes(): ShapeDefinition[];
  getMegaCards(): MegaCardDefinition[];
  /** Raw pack list including unpublished/dev-only packs; player filtering happens in the accessors below. */
  getArtistPacks(): ArtistPackDefinition[];
}

/** The baked-in catalog that ships inside the app bundle. Always available offline. Exported so a remote source can delegate the collections a catalog doesn't carry (mega cards, artist packs) back to it. */
export const localContentSource: ContentSource = {
  getCategories: () => CATEGORIES,
  getAllShapes: () => SHAPE_LIBRARY,
  getMegaCards: () => MEGA_CARDS,
  // artistPackLibrary keeps its own list module-private; player-facing
  // filtering lives there too, so the local source exposes packs through the
  // same filtered accessors the app already trusts (see getPlayerFacingPacks).
  getArtistPacks: () => engineGetPlayerFacingPacks(),
};

let activeSource: ContentSource = localContentSource;

/**
 * Swap the active content source (future: a remote catalog merged over the
 * local fallback). Intended to be called once, at app boot, BEFORE React
 * mounts — every read below is synchronous against the active source, so
 * swapping mid-session would let two screens observe different catalogs.
 */
export function setContentSource(source: ContentSource): void {
  activeSource = source;
}

/** Restore the baked-in local catalog (also the future remote-failure fallback). */
export function resetContentSource(): void {
  activeSource = localContentSource;
}

// ---------- Categories ----------

/** All categories in display order. */
export function getCategories(): CategoryDefinition[] {
  return activeSource.getCategories();
}

export function getCategoryById(id: string): CategoryDefinition | undefined {
  return activeSource.getCategories().find((c) => c.id === id);
}

// ---------- Shapes (levels) ----------

/** Every shape across all categories, in library order. */
export function getAllShapes(): ShapeDefinition[] {
  return activeSource.getAllShapes();
}

/**
 * Shapes of one category, in level order (simplest → most intricate).
 * Accepts plain strings (progress data keys categories as `string`); an
 * unknown category simply yields no shapes.
 */
export function getShapesForCategory(category: CategoryId | string): ShapeDefinition[] {
  if (activeSource === localContentSource) return engineShapesForCategory(category as CategoryId);
  return activeSource.getAllShapes().filter((s) => s.category === category);
}

/**
 * The BAKED-IN shapes for a category, ignoring any active remote source.
 * Used only by legacy progress migration: a legacy `levelIndexByCategory`
 * counter was accumulated under the baked-in order (remote catalogs did not
 * exist in any build that wrote that format), so deriving which shape ids it
 * represents MUST use the baked order - deriving against a remote catalog that
 * inserted/reordered shapes would mislabel which shapes were completed.
 */
export function getLocalShapesForCategory(category: CategoryId | string): ShapeDefinition[] {
  return engineShapesForCategory(category as CategoryId);
}

export function getShapeById(id: string): ShapeDefinition | undefined {
  if (activeSource === localContentSource) return engineGetShapeById(id);
  // Resilience: an id the remote catalog doesn't know (e.g. the daily
  // challenge references a shape a slimmer catalog dropped) still resolves
  // against the baked-in library rather than breaking the screen.
  return activeSource.getAllShapes().find((s) => s.id === id) ?? engineGetShapeById(id);
}

// ---------- Mega Challenge cards ----------

export function getMegaCards(): MegaCardDefinition[] {
  return activeSource.getMegaCards();
}

export function getMegaCardById(id: string): MegaCardDefinition | undefined {
  if (activeSource === localContentSource) return engineGetMegaCardById(id);
  return activeSource.getMegaCards().find((card) => card.id === id);
}

export function getMegaAlbumSize(): number {
  return activeSource.getMegaCards().length;
}

export function megaCardsByRarity(rarity: MegaRarity): MegaCardDefinition[] {
  if (activeSource === localContentSource) return engineMegaCardsByRarity(rarity);
  return activeSource.getMegaCards().filter((card) => card.rarity === rarity);
}

export { megaRarityLabel };

// ---------- Artist Packs ----------

/** Packs a player may see (dev-only and unpublished filtering already applied by the source). */
export function getPlayerFacingPacks(): ArtistPackDefinition[] {
  return activeSource.getArtistPacks();
}

export function getArtistPackById(id: string): ArtistPackDefinition | undefined {
  if (activeSource === localContentSource) return engineGetArtistPackById(id);
  return activeSource.getArtistPacks().find((pack) => pack.id === id);
}

export function resolvePublishedArtwork(packId: string, artworkId: string): ArtistArtworkDefinition | undefined {
  if (activeSource === localContentSource) return engineResolvePublishedArtwork(packId, artworkId);
  const pack = getArtistPackById(packId);
  return pack ? getPublishedArtworks(pack).find((artwork) => artwork.id === artworkId) : undefined;
}

// Pure per-pack helpers — they operate on pack data, not on the catalog, so
// they are re-exported unchanged regardless of which source is active.
export { getPublishedArtworks, getVisibleArtworks, packHasPublishedArtwork, artistOutboundUrl };
