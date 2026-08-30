/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Which real catalog shapes the public site draws, and how it resolves them.
 *
 * The art direction is explicit that every shape on the site is "real geometry
 * from the CYDI shape library", not illustration - so nothing here holds path
 * data. Shapes are looked up by id through contentRepository, exactly the way
 * FeaturedShapePreviews already does it on the game's home screen, and any id a
 * content source does not carry is simply dropped rather than breaking a page.
 *
 * Web-only module: imported from src/site/ only.
 */
import {
  getAllShapes,
  getCategories,
  getCategoryById,
  getShapeById,
  type ShapeDefinition,
} from "../content/contentRepository";
import type { CatalogCounts } from "../content/siteContent";

/**
 * The eight shapes 3a rotates through in the hero. Picked by the direction for
 * silhouette contrast across categories; ids, not geometry, so a catalog that
 * renames or redraws one of them still shows the real current shape.
 */
export const HERO_SHAPE_IDS = [
  "home-house",
  "sym-heart",
  "univ-compass",
  "food-donut",
  "nat-leaf",
  "fant-crown",
  "trans-car",
  "nat-sun",
];

/** The "more shapes to draw from memory" grid on the SEO/practice page. */
export const PRACTICE_GRID_SHAPE_IDS = ["home-house", "sym-heart", "nat-leaf", "trans-car", "fant-crown", "food-donut"];

/** How long each hero shape holds before the next one draws itself in (3a: 4.2s). */
export const HERO_ROTATION_MS = 4200;

/**
 * What the ACTIVE catalog holds, right now.
 *
 * Read through contentRepository rather than from publicFacts, so a stated
 * count and the list rendered next to it always describe the same catalog. If a
 * remote release adds a category, the chip row and the "N categories" beside it
 * both move; publicFacts would still say what shipped in the bundle.
 *
 * Safe to call during render: the repository is synchronous, and the content
 * source is swapped once before React mounts (see hydrateContent.ts).
 */
export function runtimeCatalogCounts(): CatalogCounts {
  return { shapes: getAllShapes().length, categories: getCategories().length };
}

export type SiteShape = {
  shape: ShapeDefinition;
  /** Display name of the shape's category, resolved through the repository. */
  categoryName: string;
};

function withCategory(shape: ShapeDefinition): SiteShape {
  return { shape, categoryName: getCategoryById(shape.category)?.name ?? "" };
}

/** Resolves ids to shapes, dropping any the active content source does not have. */
export function resolveSiteShapes(ids: string[]): SiteShape[] {
  return ids
    .map(getShapeById)
    .filter((shape): shape is ShapeDefinition => shape !== undefined)
    .map(withCategory);
}

/**
 * Fallback for a page whose named shapes are all missing (a drastically slimmer
 * remote catalog): take the first few shapes the catalog does have, so the grid
 * is never empty and never invents anything.
 */
export function resolveSiteShapesOrFirst(ids: string[], count: number): SiteShape[] {
  const named = resolveSiteShapes(ids);
  if (named.length >= count) return named.slice(0, count);
  const seen = new Set(named.map((entry) => entry.shape.id));
  const filler = getAllShapes()
    .filter((shape) => !seen.has(shape.id))
    .slice(0, count - named.length)
    .map(withCategory);
  return [...named, ...filler];
}
