/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Turns a VALIDATED ContentCatalog (see catalogSchema.ts) into a live
 * ContentSource. The catalog is pure data - each shape's `generate(size)` is
 * built HERE, by this bundled code, as a closure that linearly rescales the
 * serialized points to the requested size. Nothing from the network is ever
 * executed.
 *
 * A catalog only carries shapes + categories. Mega Challenge cards and Artist
 * Packs deliberately stay baked-in (they're curated, small, and tied to
 * achievements/publishing flows), so those getters delegate to the base
 * (local) source.
 */
import type { DrawingPath } from "../types/Challenge";
import type { ContentCatalog } from "./catalogSchema";
import type { CategoryDefinition, ContentSource, ShapeDefinition } from "./contentRepository";

function toGenerate(points: [number, number][], breaks: number[] | undefined, canvasSize: number) {
  return (size: number): DrawingPath => {
    const scale = size / canvasSize;
    return {
      points: points.map(([x, y], i) => ({ x: x * scale, y: y * scale, t: i })),
      canvasWidth: size,
      canvasHeight: size,
      breaks: breaks ? [...breaks] : undefined,
    };
  };
}

export function contentSourceFromCatalog(catalog: ContentCatalog, base: ContentSource): ContentSource {
  // Materialized once - catalog data is immutable after validation, so the
  // arrays can be shared by every getter call.
  const categories: CategoryDefinition[] = catalog.categories.map((c) => ({
    // The catalog's category ids are open strings by design (a future catalog
    // may introduce a brand-new category); the CategoryId union only reflects
    // what the bundled code knows about.
    id: c.id as CategoryDefinition["id"],
    name: c.name,
    icon: c.icon,
  }));

  const shapes: ShapeDefinition[] = catalog.shapes.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category as ShapeDefinition["category"],
    generate: toGenerate(s.path.points, s.path.breaks, catalog.canvasSize),
  }));

  return {
    getCategories: () => categories,
    getAllShapes: () => shapes,
    getMegaCards: () => base.getMegaCards(),
    getArtistPacks: () => base.getArtistPacks(),
  };
}
