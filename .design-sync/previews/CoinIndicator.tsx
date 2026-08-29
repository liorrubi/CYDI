// CoinIndicator reads the player's balance from the save store rather than a
// prop, so a preview has to seed the store to show anything but zero. Written
// at module scope, before React renders: saveStore normalizes a partial
// `progress` over its defaults, so the coin count is all that's needed.
try {
  localStorage.setItem("cydi.save.v1", JSON.stringify({ progress: { coins: 1240 } }));
} catch {
  // Private-mode browsers block storage; the indicator then renders its zero state.
}

import { CoinIndicator } from "cydi";

/** Plain display - the read-only form, used where the shop isn't reachable. */
export const Display = () => <CoinIndicator />;

/** With `onClick` it becomes a button that opens the shop. */
export const AsShopShortcut = () => <CoinIndicator onClick={() => {}} />;

/** How it sits in the header's action row, next to other controls. */
export const InHeaderRow = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)",
      padding: "var(--space-2) var(--space-3)",
      background: "var(--color-card)",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
      width: "fit-content",
    }}
  >
    <CoinIndicator onClick={() => {}} />
    <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Tap to open the shop</span>
  </div>
);
