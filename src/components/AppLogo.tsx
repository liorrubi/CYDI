import { useId } from "react";

type AppLogoProps = {
  size?: number;
};

const VIEW_SIZE = 40;
const CENTER = VIEW_SIZE / 2;
const RADIUS = 15;
// The trace stops shy of a full circle and ends in a pen-tip dot, echoing the
// dashed target vs. solid attempt drawing shown on every result screen -
// this logo is a tiny version of the exact thing the app is about.
const TRACE_SWEEP_DEGREES = 300;
const TRACE_STEPS = 24;

function polarPoint(radius: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

const TRACE_POINTS = Array.from({ length: TRACE_STEPS + 1 }, (_, i) =>
  polarPoint(RADIUS, -90 + (i / TRACE_STEPS) * TRACE_SWEEP_DEGREES),
);
const PEN_TIP = TRACE_POINTS[TRACE_POINTS.length - 1];

/** The app's mark: a dashed target circle with a solid, almost-complete traced arc and a pen-tip dot - the same visual language as the game's own target-vs-attempt overlay. */
export default function AppLogo({ size = 48 }: AppLogoProps) {
  const gradientId = useId();

  return (
    <svg width={size} height={size} viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2={VIEW_SIZE} y2={VIEW_SIZE} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#5b5bf7" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="#c7cbe0" strokeWidth="2.5" strokeDasharray="3 4" />
      <polyline
        points={TRACE_POINTS.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={PEN_TIP.x} cy={PEN_TIP.y} r="2.8" fill="#f5b400" />
    </svg>
  );
}
