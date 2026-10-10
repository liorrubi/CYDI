import { useEffect, useState } from "react";
import { playChipSound, playSelectSound } from "../engine/soundEngine";
import { isStreakRescueOn } from "../services/ads/coinOfferConfig";
import { isRewardedAdReadyFor, preloadRewardedAd, showRewardedAd, subscribeRewardedAdEvents } from "../services/ads";
import { trackEvent } from "../services/analytics";
import { getStreakRescueOffer, grantStreakRescue, onStreakChanged } from "../services/drawingStreakStore";
import { isAndroidApp } from "../services/nativeShare";
import { resolveAdOutcome } from "./doubleOfferAdFlow";

type StreakRescueOfferProps = {
  /** Called once the rescue is granted, with the streak day the player is now on. */
  onRescued?: (day: number) => void;
  /** Show the "Streak kept!" line after a grant (off where the caller says it itself). Default on. */
  showKept?: boolean;
};

// One offer, possibly visible in two places at once (the result card and the streak view opened from it): report it
// once per offer day, and never let two ads start.
const reportedOfferDays = new Set<string>();
let adInFlight = false;

/**
 * 0.59.0 Rewarded Streak Rescue (rules: app/drawingStreak.ts). Renders NOTHING unless the rescue is genuinely
 * available right now: Android, remote flag coin.streakRescue ON, a rescue on offer today, and a coin-unit rewarded
 * ad already LOADED (which also means this country, consent and the interstitial lane allow it). The streak is
 * restored only on a verified grant; a failed or closed ad changes nothing.
 */
export default function StreakRescueOffer({ onRescued, showKept = true }: StreakRescueOfferProps) {
  const [offer, setOffer] = useState(() => getStreakRescueOffer());
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [kept, setKept] = useState<number | null>(null);
  const [, setAdTick] = useState(0);

  const eligible = offer !== null && isAndroidApp() && isStreakRescueOn();
  useEffect(() => onStreakChanged(() => setOffer(getStreakRescueOffer())), []);
  // Ad readiness changes outside React: re-render on every rewarded lifecycle event.
  useEffect(() => subscribeRewardedAdEvents("streak-rescue", () => setAdTick((t) => t + 1)), []);
  useEffect(() => {
    if (eligible) void preloadRewardedAd("streak_rescue");
  }, [eligible]);
  const ready = eligible && isRewardedAdReadyFor("streak_rescue");

  useEffect(() => {
    if (!ready || !offer || reportedOfferDays.has(offer.day)) return;
    reportedOfferDays.add(offer.day);
    trackEvent("reward_offer_shown", { placement: "streak_rescue" });
  }, [ready, offer]);

  async function handleWatch() {
    if (!offer || pending || adInFlight) return;
    adInFlight = true;
    playSelectSound();
    setPending(true);
    setNote(null);
    trackEvent("reward_ad_started", { placement: "streak_rescue" });
    const outcome = resolveAdOutcome(await showRewardedAd("streak_rescue"));
    adInFlight = false;
    setPending(false);
    if (outcome.grantSource === "ad") {
      trackEvent("reward_ad_completed", { placement: "streak_rescue" });
      if (grantStreakRescue(offer.day)) {
        playChipSound();
        setKept(offer.from + 1);
        onRescued?.(offer.from + 1);
      }
      return;
    }
    if (!outcome.dismissed) {
      trackEvent("reward_ad_failed", { placement: "streak_rescue" });
      setNote("The ad couldn’t play – your streak is unchanged.");
    }
    // Closed early or failed: the offer stays for today. Ask for a fresh ad; the button returns only once it is loaded.
    void preloadRewardedAd("streak_rescue");
  }

  if (kept !== null) {
    if (!showKept) return null;
    return (
      <p className="streak-rescue streak-rescue-kept" role="status">
        🔥 Streak kept! You’re on Day {kept}.
      </p>
    );
  }
  if (!offer || (!ready && !pending)) {
    return note ? <p className="streak-rescue-note">{note}</p> : null;
  }
  return (
    <div className="streak-rescue">
      <p className="streak-rescue-text">
        <strong>Keep your {offer.from}-day streak?</strong> You missed one day – watch a short ad to continue at Day {offer.from + 1}.
      </p>
      <button type="button" className="streak-rescue-btn" disabled={pending} onClick={() => void handleWatch()}>
        {pending ? "Loading ad…" : "▶ Keep my streak"}
      </button>
    </div>
  );
}
