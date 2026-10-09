import { useId } from "react";

type StreakFlameProps = {
  size?: number;
  /** Lit = today's Daily is done (warm gradient, gentle flicker). Unlit = a muted outline waiting for today. */
  lit: boolean;
  /** Adds the slow flicker (only where the flame is the focus: the sheet and the day card). */
  animated?: boolean;
};

/** The Daily Drawing Streak's mark: a small two-tone flame drawn in SVG, so it reads the same on every device. */
export default function StreakFlame({ size = 20, lit, animated = false }: StreakFlameProps) {
  const gradientId = `streak-flame-${useId().replace(/:/g, "")}`;
  return (
    <svg
      className={`streak-flame${lit ? " streak-flame-lit" : ""}${lit && animated ? " streak-flame-animated" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#dc2626" />
          <stop offset="55%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <path
        className="streak-flame-outer"
        d="M12 2.5c.6 3.2-1.2 4.9-2.9 6.7C7.4 11 6 12.8 6 15.4 6 18.9 8.7 21.5 12 21.5s6-2.6 6-6.1c0-2.4-1.1-4.1-2.2-5.4-.3 1.3-1 2.3-2 2.8.4-3.6-.6-7.4-1.8-10.3z"
        fill={lit ? `url(#${gradientId})` : "none"}
        stroke={lit ? "none" : "currentColor"}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {lit && <path d="M12 13.2c1.6 1.4 2.6 2.7 2.6 4.1 0 1.6-1.2 2.7-2.6 2.7s-2.6-1.1-2.6-2.7c0-1.3.9-2.6 2.6-4.1z" fill="#fde68a" />}
    </svg>
  );
}
