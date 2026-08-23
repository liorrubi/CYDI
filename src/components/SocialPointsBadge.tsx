/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useEffect, useState } from "react";
import { getSocialPoints, subscribeSocialPoints } from "../services/socialPointsStore";
import { SOCIAL_POINTS_ICON, SOCIAL_POINTS_LABEL } from "../social/socialRewards";
import { compactRankLabel, rankFor, rankProgress } from "../social/socialRank";
import { getSocialPointsOverride, subscribeSocialPointsOverride } from "../social/socialPointsDisplay";

/**
 * The running Social Points total, as a small pill.
 *
 * Shown only inside the social modes - never added to Home, whose status row is
 * already carrying coins, a shape counter, a daily crown and four icon buttons.
 * A player who never plays with anyone else has no reason to be shown a number
 * that can only ever be zero.
 */
export function SocialPointsBadge() {
  const [stored, setStored] = useState(() => getSocialPoints());
  const [held, setHeld] = useState(() => getSocialPointsOverride());
  useEffect(() => subscribeSocialPoints((profile) => setStored(profile.total)), []);
  // While a progress card is counting up, the badge shows the same number it
  // does - so it can never announce a promotion the card has not reached yet.
  useEffect(() => subscribeSocialPointsOverride(setHeld), []);
  const total = held?.points ?? stored;
  // While a promotion is playing out, the badge reads the rank from the same
  // band the card is drawing - so the two never disagree about who you are.
  const rank = held ? rankProgress(held.points, held.bandIndex ?? undefined).rank : rankFor(total);

  return (
    <p className="social-badge" aria-label={`${rank.name}, ${total} ${SOCIAL_POINTS_LABEL}`}>
      {compactRankLabel(total, rank.name)}
    </p>
  );
}

type SocialPointsAwardProps = {
  /** Points earned by the match that just finished. 0 means it has already been counted - a reconnect or a revisit - and nothing is shown. */
  points: number;
  total: number;
};

/** The one-off confirmation on a final results screen: what this match was worth, and what it brings the tally to. */
export function SocialPointsAward({ points, total }: SocialPointsAwardProps) {
  if (points <= 0) return null;
  return (
    <p className="social-award" role="status">
      <span className="social-award-gain">
        <span aria-hidden="true">{SOCIAL_POINTS_ICON}</span> +{points} {SOCIAL_POINTS_LABEL}
      </span>
      <span className="social-award-total">{total} total</span>
    </p>
  );
}
