/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Sharing one saved challenge - the single implementation of that flow.
 *
 * This is MyChallengesScreen's `handleShare` lifted out verbatim, so a second
 * surface (the web Game Hub) can perform the REAL share rather than a lookalike
 * of it. Nothing about the semantics changed in the move:
 *
 *   - the short link is preferred, with the encoded link as the fallback
 *   - the share sheet is tried first, clipboard second (shareOrCopy decides)
 *   - ONLY "shared"/"copied" credit the sharing achievements, because
 *     "cancelled" (backed out of the sheet) and "failed" never reached anyone
 *
 * The one thing deliberately NOT moved here is how the outcome is shown. Each
 * screen renders feedback in its own layout, so this returns the message and
 * lets the caller place it. `sticky` marks the failure message, which carries
 * the link itself and so must stay on screen until the player has copied it,
 * rather than disappearing on a timer like "Link copied!".
 */
import { encodeChallengeLink } from "./shareLink";
import { createShortChallengeLink } from "./shareApi";
import { shareOrCopy, type ShareOutcome } from "./nativeShare";
import { recordChallengeShared } from "./sharedChallengesStore";
import type { Challenge } from "../types/Challenge";

export type ChallengeShareResult = {
  outcome: ShareOutcome;
  /** The link that was offered, whichever route produced it. */
  url: string;
  /** What to tell the player, or null when the share sheet said it all. */
  message: string | null;
  /** True when `message` must not be auto-dismissed - it contains the link. */
  sticky: boolean;
  /** True when this counted as a real share (and was recorded as one). */
  recorded: boolean;
};

/** How long a non-sticky share message should stay up. */
export const SHARE_FEEDBACK_MS = 2500;

export async function shareChallenge(challenge: Challenge): Promise<ChallengeShareResult> {
  const url = (await createShortChallengeLink(challenge)) ?? encodeChallengeLink(challenge);
  const outcome = await shareOrCopy({
    title: `CYDI Challenge: ${challenge.name}`,
    text: `Can you draw "${challenge.name}"? Try my CYDI challenge!`,
    url,
  });

  const recorded = outcome === "shared" || outcome === "copied";
  if (recorded) recordChallengeShared(challenge.id);

  if (outcome === "copied") return { outcome, url, message: "Link copied!", sticky: false, recorded };
  if (outcome === "failed") {
    return {
      outcome,
      url,
      message: `Couldn't share automatically - copy this link: ${url}`,
      sticky: true,
      recorded,
    };
  }
  return { outcome, url, message: null, sticky: false, recorded };
}
