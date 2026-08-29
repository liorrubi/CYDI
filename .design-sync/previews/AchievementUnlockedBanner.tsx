import { AchievementUnlockedBanner } from "cydi";

const noop = () => {};

const FIRST_DRAW = {
  id: "first-drawing",
  icon: "🎯",
  name: "First Steps",
  description: "Finish your first drawing.",
  coinReward: 25,
  target: 1,
};

const SHARP_EYE = {
  id: "five-star-streak",
  icon: "⭐",
  name: "Sharp Eye",
  description: "Score five stars on ten different shapes.",
  coinReward: 150,
  target: 10,
};

/*
 * The banner is `position: fixed; inset: 0` - it covers the whole viewport in
 * the app, which would escape a preview card and get cropped. A `transform` on
 * an ancestor makes that ancestor the containing block for fixed positioning,
 * so this stage bounds the overlay to a phone-sized frame and the backdrop,
 * card and glow are all captured as they really render.
 */
const Stage = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      position: "relative",
      width: 380,
      height: 620,
      transform: "translateZ(0)",
      overflow: "hidden",
      borderRadius: "var(--radius-lg)",
      background: "var(--color-bg)",
    }}
  >
    {children}
  </div>
);

/** The celebratory overlay as it covers the screen after an achievement unlocks. */
export const Default = () => (
  <Stage>
    <AchievementUnlockedBanner achievement={FIRST_DRAW} onCollect={noop} onDismissed={noop} />
  </Stage>
);

/** A bigger reward - the icon and coin figure are what change per achievement. */
export const LargeReward = () => (
  <Stage>
    <AchievementUnlockedBanner achievement={SHARP_EYE} onCollect={noop} onDismissed={noop} />
  </Stage>
);
