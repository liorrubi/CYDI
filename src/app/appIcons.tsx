/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The three literal icons the Android refresh needs, as local inline SVG.
 *
 * WHY THESE EXIST. Version A used abstract glyphs (a half-filled circle for 2
 * Players, a diamond for Multiplayer). Version B replaced them with drawings of
 * the actual thing - two people, a group, a crown - which is read instantly and
 * needs no learning. These are those, traced to the same 24x24 grid and stroke
 * weight as the design.
 *
 * NO ICON LIBRARY. Three shapes do not justify a dependency, a font or a
 * sprite; each is a handful of circles and paths.
 *
 * THEY TAKE THEIR COLOUR FROM CSS. `stroke="currentColor"` and no `fill`, so
 * the surrounding token decides - which is what keeps them working in both
 * themes without a second copy. They are sized by the caller and are always
 * secondary to the title beside them, never the loudest thing in a row.
 *
 * `aria-hidden` on every one: the row's own text already names the mode, so
 * announcing the picture as well would just be noise to a screen reader.
 */

type IconProps = {
  /** Rendered width and height in px. */
  size?: number;
};

const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
  style: { display: "block" as const },
};

/** Two people side by side - 2 Players, on one device. */
export function TwoPlayersIcon({ size = 26 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <circle cx="8.2" cy="8" r="3" />
      <circle cx="15.8" cy="8" r="3" />
      <path d="M3.2 18.5c0-2.7 2.2-4.4 5-4.4s5 1.7 5 4.4" />
      <path d="M13.6 18.5c.3-2.4 2.4-4 5-4 2.4 0 4.2 1.4 4.2 3.4" />
    </svg>
  );
}

/** A group - Multiplayer, everyone on their own device. */
export function GroupIcon({ size = 26 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <circle cx="12" cy="7.4" r="3" />
      <circle cx="5.6" cy="10.4" r="2.3" />
      <circle cx="18.4" cy="10.4" r="2.3" />
      <path d="M7 19c0-2.9 2.2-4.9 5-4.9s5 2 5 4.9" />
      <path d="M1.6 18.6c0-2.1 1.5-3.5 3.6-3.5" />
      <path d="M22.4 18.6c0-2.1-1.5-3.5-3.6-3.5" />
    </svg>
  );
}

/** A crown - the winner, wherever one is being named. */
export function CrownIcon({ size = 19 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <path d="M4 17l-1.4-8L8 12.5 12 5.5l4 7 5.4-3.5L20 17z" />
      <path d="M4 19.5h16" />
    </svg>
  );
}

/** A clock face - the Daily Challenge tile in More. */
export function DailyIcon({ size = 17 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.6V12l3 1.8" />
    </svg>
  );
}

/** A pencil - Create Challenge. */
export function CreateIcon({ size = 17 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <path d="M4 20l3.6-.9 10.2-10.2a2 2 0 0 0 0-2.8l-.9-.9a2 2 0 0 0-2.8 0L3.9 15.4z" />
      <path d="M14 6.2l3.8 3.8" />
    </svg>
  );
}

/** A bookmark - My Challenges, the ones you saved. */
export function SavedIcon({ size = 17 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <path d="M5 4.6h14v15.2l-7-3.6-7 3.6z" />
    </svg>
  );
}

/** A coin - the Shop. */
export function ShopIcon({ size = 17 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.6 9.9h4.1M9.6 14.1h4.1M11.4 7.6v8.8M12.9 7.6v8.8" />
    </svg>
  );
}

/** A curved arrow doubling back - Undo. */
export function UndoIcon({ size = 22 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <path d="M4 9h10.5a4.5 4.5 0 0 1 0 9H8" />
      <path d="M7.5 5.5L4 9l3.5 3.5" />
    </svg>
  );
}

/**
 * A dashed star - the reference guide. Dashed rather than solid because that is
 * exactly how the guide is drawn on the canvas, so the control looks like the
 * thing it toggles.
 */
export function GuideIcon({ size = 22 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <path d="M12 4.5l2.6 6.4 6.9.3-5.4 4.3 1.9 6.6L12 18.3 6 22.1l1.9-6.6L2.5 11.2l6.9-.3z" strokeDasharray="3.2 3" />
    </svg>
  );
}
