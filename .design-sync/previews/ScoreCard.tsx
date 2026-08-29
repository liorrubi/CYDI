import { ScoreCard } from "cydi";

const GOOD = {
  total: 72,
  shapeMatch: 78,
  coverage: 81,
  smoothness: 54,
  scale: 76,
  message: "Nice and steady!",
};

const PERFECT = {
  total: 96,
  shapeMatch: 97,
  coverage: 95,
  smoothness: 94,
  scale: 98,
  message: "Almost perfect!",
};

/** The card as it appears after a normal round - breakdown plus a "how to improve" tip. */
export const Default = () => (
  <div style={{ maxWidth: 360 }}>
    <ScoreCard score={GOOD} />
  </div>
);

/** A new personal best banners above the score. */
export const NewPersonalBest = () => (
  <div style={{ maxWidth: 360 }}>
    <ScoreCard score={PERFECT} isNewBest />
  </div>
);

/** Daily Challenge drops the tip and reads the headline number as a percentage. */
export const AsPercentage = () => (
  <div style={{ maxWidth: 360 }}>
    <ScoreCard score={GOOD} showPercentSign showTip={false} />
  </div>
);
