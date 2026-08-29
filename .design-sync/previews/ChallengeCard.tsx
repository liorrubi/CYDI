import { ChallengeCard } from "cydi";

const TARGET = {
  points: [
    { x: 40, y: 200 },
    { x: 120, y: 60 },
    { x: 200, y: 200 },
    { x: 40, y: 200 },
  ],
  canvasWidth: 240,
  canvasHeight: 240,
};

const PLAYED = {
  id: "ch-mountain",
  name: "Mountain peak",
  target: TARGET,
  createdAt: Date.UTC(2026, 1, 14),
  updatedAt: Date.UTC(2026, 1, 18),
  personalBest: 84,
  attempts: 7,
};

const FRESH = {
  id: "ch-teapot",
  name: "Teapot",
  target: TARGET,
  createdAt: Date.UTC(2026, 2, 2),
  updatedAt: Date.UTC(2026, 2, 2),
  attempts: 0,
};

const noop = () => {};

/** A challenge the player has already attempted - best score and attempt count. */
export const Default = () => (
  <div style={{ maxWidth: 420 }}>
    <ChallengeCard challenge={PLAYED} onPlay={noop} onShare={noop} onDelete={noop} />
  </div>
);

/** A brand-new challenge: no attempts yet, so best score reads as a dash. */
export const NeverPlayed = () => (
  <div style={{ maxWidth: 420 }}>
    <ChallengeCard challenge={FRESH} onPlay={noop} onShare={noop} onDelete={noop} />
  </div>
);

/** A list of challenges, which is how the card is actually used on the Challenges screen. */
export const InAList = () => (
  <div style={{ display: "grid", gap: "var(--space-3)", maxWidth: 420 }}>
    <ChallengeCard challenge={PLAYED} onPlay={noop} onShare={noop} onDelete={noop} />
    <ChallengeCard challenge={FRESH} onPlay={noop} onShare={noop} onDelete={noop} />
  </div>
);
