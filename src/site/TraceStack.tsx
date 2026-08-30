/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * A target shape, optionally with ONE drawing over it.
 *
 * That pairing is exactly what CYDI itself shows on a result: the dashed target
 * with your attempt laid on top. It is honest for Classic (one player, one
 * drawing) and for a single 2 Players thumbnail.
 *
 * It deliberately cannot stack several attempts on one canvas. Multiplayer is
 * not presented that way - players draw on their own devices and see ranked
 * room results, never a shared canvas of everyone's strokes - so the site must
 * not imply otherwise. Several players are shown as a leaderboard, or as
 * separate thumbnails, never overlaid here.
 */
import SiteShape from "./SiteShape";
import type { ShapeDefinition } from "../content/contentRepository";

type TraceStackProps = {
  /** The target, drawn dashed underneath. */
  shape: ShapeDefinition;
  /**
   * One attempt to lay over it. Omit to show the target alone - which is how
   * the shared shape is presented in the Multiplayer visuals.
   */
  attempt?: ShapeDefinition;
  /** Extra class on the wrapper, so a caller can tint the attempt. */
  className?: string;
};

export default function TraceStack({ shape, attempt, className }: TraceStackProps) {
  return (
    <span className={className ? `site-tracestack ${className}` : "site-tracestack"} aria-hidden="true">
      {/* The dashed target underneath, exactly as the result overlay draws it. */}
      <span className="site-trace site-trace-target">
        <SiteShape shape={shape} size={140} strokeWidth={2.5} />
      </span>
      {attempt && (
        <span className="site-trace site-trace-1">
          <SiteShape shape={attempt} size={140} strokeWidth={3.5} />
        </span>
      )}
    </span>
  );
}
