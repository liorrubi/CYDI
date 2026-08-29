import { AppLogo } from "cydi";

/** The app mark at its default size. */
export const Default = () => <AppLogo />;

/** The mark scales cleanly - it is pure SVG with no raster assets. */
export const Sizes = () => (
  <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-end" }}>
    <AppLogo size={24} />
    <AppLogo size={48} />
    <AppLogo size={96} />
  </div>
);

/** How it reads in a header next to the wordmark. */
export const InHeader = () => (
  <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
    <AppLogo size={40} />
    <strong style={{ fontSize: 22, color: "var(--color-text)" }}>CYDI</strong>
  </div>
);
