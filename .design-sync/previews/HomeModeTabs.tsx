import { HomeModeTabs } from "cydi";

const noop = () => {};

/** The three modes, each shown as the selected one. */
export const EachMode = () => (
  <div style={{ display: "grid", gap: "var(--space-3)", maxWidth: 420 }}>
    <HomeModeTabs active="classic" onSelect={noop} />
    <HomeModeTabs active="passPlay" onSelect={noop} />
    <HomeModeTabs active="multiplayer" onSelect={noop} />
  </div>
);

/** Default state on Home. */
export const Default = () => (
  <div style={{ maxWidth: 420 }}>
    <HomeModeTabs active="classic" onSelect={noop} />
  </div>
);
