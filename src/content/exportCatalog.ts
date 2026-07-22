/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Builds a ContentCatalog from the baked-in local content by running every
 * shape generator once and serializing the resulting DrawingPath to plain
 * point data. Pure - no filesystem access - so the CLI wrapper
 * (scripts/exportContentCatalog.ts) and the round-trip tests share it.
 */
import { CANVAS_SIZE } from "../app/constants";
import { getAllShapes, getCategories } from "./contentRepository";
import { validateCatalog, type CatalogShape, type ContentCatalog } from "./catalogSchema";

/** 2-decimal rounding: 0.01px precision in the 320px canvas space - far below anything scoring or rendering can distinguish - and it keeps the catalog roughly a third of the full-precision size. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildCatalogFromLocalContent(contentVersion: number): ContentCatalog {
  const shapes: CatalogShape[] = getAllShapes().map((shape) => {
    const path = shape.generate(CANVAS_SIZE);
    return {
      id: shape.id,
      name: shape.name,
      category: shape.category,
      path: {
        points: path.points.map((p) => [round2(p.x), round2(p.y)] as [number, number]),
        ...(path.breaks && path.breaks.length > 0 ? { breaks: [...path.breaks] } : {}),
      },
    };
  });

  const catalog: ContentCatalog = {
    formatVersion: 1,
    contentVersion,
    generatedAt: new Date().toISOString(),
    canvasSize: CANVAS_SIZE,
    categories: getCategories().map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
    shapes,
  };

  // Self-check: the exporter must never emit anything the client would reject.
  const result = validateCatalog(catalog);
  if (!result.ok) throw new Error(`exported catalog failed validation: ${result.error}`);
  return catalog;
}
