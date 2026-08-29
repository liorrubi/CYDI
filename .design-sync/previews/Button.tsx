import { Button } from "cydi";

/** The three variants, which is the whole visual API. */
export const Variants = () => (
  <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
    <Button variant="primary">Start drawing</Button>
    <Button variant="secondary">Maybe later</Button>
    <Button variant="danger">Delete challenge</Button>
  </div>
);

/** Disabled state - used while a round is scoring or a reward is in flight. */
export const Disabled = () => (
  <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
    <Button variant="primary" disabled>Scoring...</Button>
    <Button variant="secondary" disabled>Unavailable</Button>
  </div>
);

/** `btn-compact` shrinks a button to sit inline next to other controls. */
export const Compact = () => (
  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
    <Button variant="primary" className="btn-compact">Play</Button>
    <Button variant="secondary" className="btn-compact">Share</Button>
  </div>
);
