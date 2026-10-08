import { useEffect, useState } from "react";
import { isRewardedAdAvailable } from "../services/ads";
import {
  clearPostSessionPending,
  completedSessionsThisRun,
  getNextEligibleInk,
  getPendingCtaInk,
  hasPostSessionPending,
  nextInkOfferNumber,
  type PostSessionSurface,
} from "../services/inkTrialStore";
import { POST_SESSION_INK_PLACEMENT, canOfferInkOn, hasInkConfigAnswer } from "../services/inkTrialOffers";
import type { InkTrialInk } from "../services/analyticsSchema";
import { isMathFallbackEnabled } from "./DoubleCoinsOffer";
import InkTrialOffer from "./InkTrialOffer";
import InkTrialCta from "./InkTrialCta";

type Decision = { kind: "offer" | "cta"; ink: InkTrialInk; offerNumber: number; sessionGames: number };

/**
 * The Play Together / 2 Players Ink offer, on the SAFE post-session surface only (the Play Together menu after the
 * player has left the room; the 2 Players setup screen after the game). Never between rounds, never on a final
 * screen where a rematch can start, never while anyone waits.
 *
 * No caps: every completed session leaves one pending offer (a rematch chain keeps one); this card renders it once
 * if an ink is eligible and the surface is on. Declining records nothing, so the same ink can come back after the
 * next completed session - until its Trial is granted. Nothing eligible -> no card and no fallback (there is no coin
 * Rewarded in these modes). No rewarded ad capability -> no card, and the pending offer waits (as the coin offer's
 * pending_no_ad does).
 */
type Evaluation = { decision: Decision | null; drop: boolean };

/** Pure: what this mount does with the pending offer. `drop` = nothing will ever be offered for it. */
function evaluate(surface: PostSessionSurface): Evaluation {
  if (!hasPostSessionPending(surface)) return { decision: null, drop: false };
  // A Trial phase just ended on this surface: its Keep-it card comes first (buy / one-time +5 / Shop). It is not an
  // ad offer, so it needs neither the surface config nor an ad - only its optional +5 button does (InkTrialCta).
  const ctaInk = getPendingCtaInk();
  if (ctaInk !== null) return { decision: { kind: "cta", ink: ctaInk, offerNumber: 1, sessionGames: completedSessionsThisRun(surface) }, drop: false };
  const ink = getNextEligibleInk();
  // No eligible ink (owned / already trialled / another Trial running): nothing to offer for this session.
  if (ink === null) return { decision: null, drop: true };
  if (!canOfferInkOn(surface)) {
    // Off by config: drop it - but only once the server has actually answered. Before the first answer of a cold
    // start, "off" just means "not known yet", so the offer waits (it expires on its own after 2 h).
    return { decision: null, drop: hasInkConfigAnswer() };
  }
  if (!isRewardedAdAvailable(POST_SESSION_INK_PLACEMENT[surface]) && !isMathFallbackEnabled()) return { decision: null, drop: false };
  return { decision: { kind: "offer", ink, offerNumber: nextInkOfferNumber(ink), sessionGames: completedSessionsThisRun(surface) }, drop: false };
}

export default function PostSessionInkOffer({ surface, onViewShop }: { surface: PostSessionSurface; onViewShop: (ink: InkTrialInk) => void }) {
  const [closed, setClosed] = useState(false);
  // Decided once per mount from a pure read; the pending flag is spent only when the card really renders.
  const [{ decision, drop }] = useState<Evaluation>(() => evaluate(surface));
  useEffect(() => {
    // The Keep-it card is rendered as soon as it is decided: its pending session is spent here.
    if (drop || decision?.kind === "cta") clearPostSessionPending(surface);
  }, [drop, decision, surface]);

  if (decision === null || closed) return null;
  if (decision.kind === "cta") {
    return (
      <div className="ink-offer-slot">
        <InkTrialCta
          ink={decision.ink}
          surface={surface}
          placement={POST_SESSION_INK_PLACEMENT[surface]}
          sessionGames={decision.sessionGames}
          onViewShop={onViewShop}
          onClosed={() => setClosed(true)}
        />
      </div>
    );
  }
  return (
    <div className="ink-offer-slot">
      <InkTrialOffer
        ink={decision.ink}
        surface={surface}
        placement={POST_SESSION_INK_PLACEMENT[surface]}
        context={{ offerNumber: decision.offerNumber, sessionGames: decision.sessionGames }}
        onShown={() => clearPostSessionPending(surface)}
        onClosed={(outcome) => {
          if (outcome === "declined") setClosed(true);
        }}
      />
    </div>
  );
}
