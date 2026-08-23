/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useEffect, useState } from "react";
import { getSocialPoints, subscribeSocialPoints } from "../services/socialPointsStore";
import { SOCIAL_POINTS_ICON, SOCIAL_POINTS_LABEL } from "../social/socialRewards";

/**
 * The running Social Points total, as a small pill.
 *
 * Shown only inside the social modes - never added to Home, whose status row is
 * already carrying coins, a shape counter, a daily crown and four icon buttons.
 * A player who never plays with anyone else has no reason to be shown a number
 * that can only ever be zero.
 */
export function SocialPointsBadge() {
  const [total, setTotal] = useState(() => getSocialPoints());
  useEffect(() => subscribeSocialPoints((profile) => setTotal(profile.total)), []);

  return (
    <p className="social-badge" aria-label={`${total} ${SOCIAL_POINTS_LABEL}`}>
      <span aria-hidden="true">{SOCIAL_POINTS_ICON}</span>
      <span className="social-badge-value">{total}</span>
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
