import { LockedFeatureHint } from "cydi";

const noop = () => {};

/** The hint shown when a locked header icon is tapped. */
export const Default = () => (
  <div style={{ position: "relative", minHeight: 160, maxWidth: 420 }}>
    <LockedFeatureHint
      message="The daily chest unlocks once you've finished your first shape."
      onNavigateToShapeChallenge={noop}
      onDismiss={noop}
    />
  </div>
);

/** A longer message still wraps inside the hint. */
export const LongMessage = () => (
  <div style={{ position: "relative", minHeight: 200, maxWidth: 420 }}>
    <LockedFeatureHint
      message="Special challenges open up after you've unlocked the Animals category on the Shape Challenge map."
      onNavigateToShapeChallenge={noop}
      onDismiss={noop}
    />
  </div>
);
