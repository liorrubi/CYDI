import ShapePreviewIcon from "./ShapePreviewIcon";
import { getShapeById, type ShapeDefinition } from "../content/contentRepository";

/**
 * Three shapes from the regular catalog, drawn on the Shape Challenge card so the home
 * screen shows what the game is before you tap into it. Picked for silhouette contrast
 * (a drawn gesture / an everyday object / an organic form), for reading clearly at icon
 * size, and for not combining into a single scene the way e.g. a house and a cloud would.
 * Ids are looked up rather than hardcoded paths, so a content source that lacks one just
 * drops it.
 */
const FEATURED_PREVIEW_SHAPE_IDS = ["spiral-2", "home-mug", "nat-mushroom"];

/**
 * Shared by the real home card and by the onboarding spotlight's copy of it - the
 * spotlight is positioned over the live card and sized from its rect, so anything the
 * card draws has to be drawn there too or the highlighted card comes out half empty.
 */
export default function FeaturedShapePreviews() {
  const shapes = FEATURED_PREVIEW_SHAPE_IDS.map(getShapeById).filter(
    (shape): shape is ShapeDefinition => shape !== undefined,
  );
  if (shapes.length === 0) return null;

  return (
    <div className="home-card-preview">
      {shapes.map((shape) => (
        <ShapePreviewIcon key={shape.id} shape={shape} size={52} />
      ))}
    </div>
  );
}
