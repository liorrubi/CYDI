import { PenSkinGlyph } from "cydi";

const SKINS = [
  "basicPencil",
  "improvedPencil",
  "magicPencil",
  "goldenPencil",
  "rainbowPencil",
  "royalQuill",
  "galaxyPen",
] as const;

const cell = {
  display: "grid",
  justifyItems: "center",
  gap: "var(--space-1)",
  fontSize: 11,
  color: "var(--color-text-muted)",
  width: 84,
};

/** Every pen skin the shop sells, drawn upright as it appears on a shop card. */
export const AllSkins = () => (
  <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
    {SKINS.map((skin) => (
      <span key={skin} style={cell}>
        <svg viewBox="0 0 44 44" width={56} height={56}>
          <PenSkinGlyph skin={skin} inkColor="#5b5bf7" />
        </svg>
        {skin}
      </span>
    ))}
  </div>
);

/** The nib is tinted to the ink color, so the pen reads as the pen that made the stroke. */
export const InkColors = () => (
  <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
    {["#5b5bf7", "#1d7d54", "#c02338", "#f5b400"].map((ink) => (
      <svg key={ink} viewBox="0 0 44 44" width={56} height={56}>
        <PenSkinGlyph skin="goldenPencil" inkColor={ink} />
      </svg>
    ))}
  </div>
);

/** `rotate` tilts the pen the way the drawing canvas overlays it while the player draws. */
export const Rotated = () => (
  <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center" }}>
    <svg viewBox="0 0 44 44" width={72} height={72}>
      <PenSkinGlyph skin="royalQuill" inkColor="#5b5bf7" />
    </svg>
    <svg viewBox="0 0 44 44" width={72} height={72}>
      <PenSkinGlyph skin="royalQuill" inkColor="#5b5bf7" rotate />
    </svg>
  </div>
);
