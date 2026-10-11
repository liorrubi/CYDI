import { useEffect, useState } from "react";
import { playChipSound, playSelectSound } from "../engine/soundEngine";
import { resolveAdOutcome } from "../components/doubleOfferAdFlow";
import { isStreakRescueOn } from "../services/ads/coinOfferConfig";
import { isRewardedAdReadyFor, preloadRewardedAd, showRewardedAd, subscribeRewardedAdEvents } from "../services/ads";
import { trackEvent } from "../services/analytics";
import type { StreakAchievementRewards } from "../services/achievementRewards";
import { getStreakRescueOffer, grantStreakRescue, onStreakChanged } from "../services/drawingStreakStore";
import { isAndroidApp } from "../services/nativeShare";

// The streak view is the one place the Rescue is offered; report each offer day once, and never let two ads start.
const reportedOfferDays = new Set<string>();
let adInFlight = false;

export type StreakRescue = {
  /** The streak a rescue would keep, when one is on offer today (whether or not an ad is loaded). */
  from: number;
  /** A rewarded ad is loaded right now (or playing): the only time the Rescue may be shown. */
  available: boolean;
  pending: boolean;
  /** "The ad couldn't play" - shown once after a failure; the streak is unchanged. */
  note: string | null;
  /** True once a rescue was granted while this view was open. */
  granted: boolean;
  /** A streak achievement (and its Mega card) the rescued streak reached - paid with the grant, shown by the sheet. */
  rewards: StreakAchievementRewards | null;
  watch: () => Promise<void>;
};

/**
 * 0.59.0 Rewarded Streak Rescue (rules: app/drawingStreak.ts). `available` is true ONLY when the rescue can really be
 * delivered now: Android, remote flag coin.streakRescue ON, a rescue on offer today, and a coin-unit rewarded ad
 * already LOADED (so this country, consent and the interstitial lane allow it). The streak is kept only on a verified
 * grant; a failed or closed ad changes nothing and the button returns only when a fresh ad has loaded.
 */
export function useStreakRescue(enabled = true): StreakRescue {
  const [offer, setOffer] = useState(() => getStreakRescueOffer());
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);
  const [rewards, setRewards] = useState<StreakAchievementRewards | null>(null);
  const [, setAdTick] = useState(0);

  const eligible = enabled && offer !== null && isAndroidApp() && isStreakRescueOn();
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

  async function watch() {
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
      const paid = grantStreakRescue(offer.day);
      if (paid) {
        playChipSound();
        setGranted(true);
        setRewards(paid);
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

  return { from: offer?.from ?? 0, available: eligible && (ready || pending), pending, note, granted, rewards, watch };
}
