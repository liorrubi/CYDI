import { ResultComparison } from "cydi";

const SIZE = 280;

function path(unit: [number, number][], jitter = 0) {
  return {
    points: unit.map(([x, y], i) => ({
      x: x * SIZE + Math.sin(i * 1.7) * jitter,
      y: y * SIZE + Math.cos(i * 2.3) * jitter,
      t: i,
    })),
    canvasWidth: SIZE,
    canvasHeight: SIZE,
  };
}

const STAR: [number, number][] = [
  [0.5, 0.08], [0.62, 0.38], [0.94, 0.38], [0.68, 0.57],
  [0.78, 0.89], [0.5, 0.7], [0.22, 0.89], [0.32, 0.57],
  [0.06, 0.38], [0.38, 0.38], [0.5, 0.08],
];

const TARGET = path(STAR);
const CLOSE_ATTEMPT = path(STAR, 4);
const LOOSE_ATTEMPT = path(STAR, 14);

/** Target guide and the player's attempt, with the guide shown. */
export const Default = () => (
  <div style={{ maxWidth: 320 }}>
    <ResultComparison target={TARGET} attempt={CLOSE_ATTEMPT} />
  </div>
);

/** A rougher attempt - the gap between guide and stroke is the whole point of the view. */
export const LooseAttempt = () => (
  <div style={{ maxWidth: 320 }}>
    <ResultComparison target={TARGET} attempt={LOOSE_ATTEMPT} />
  </div>
);

/** The labels are overridable for screens that frame the comparison differently. */
export const CustomLabels = () => (
  <div style={{ maxWidth: 320 }}>
    <ResultComparison
      target={TARGET}
      attempt={CLOSE_ATTEMPT}
      targetLabel="Today's shape"
      attemptLabel="Your entry"
    />
  </div>
);
