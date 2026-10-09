import { useEffect, useRef, useState } from "react";
import { EMBER_CSS_GRADIENT } from "../app/constants";
import { earnsStreakSave, isStreakMilestone, streakRewardFor, type StreakCompletion } from "../app/drawingStreak";
import { triggerCoinFlight } from "../engine/coinFlight";
import { playSelectSound } from "../engine/soundEngine";
import StreakFlame from "./StreakFlame";
import StreakSheet from "./StreakSheet";

type StreakDayCardProps = { completion: StreakCompletion };

/**
 * The Daily result's one streak moment, shown only on the attempt that advanced the streak: the day reached, its
 * coins, and what tomorrow brings. A milestone day gets a warmer card; nothing ever blocks the result or asks for
 * anything. "View streak" opens the full view on demand.
 */
export default function StreakDayCard({ completion }: StreakDayCardProps) {
  const [open, setOpen] = useState(false);
  const coinsRef = useRef<HTMLSpanElement | null>(null);
  const { day, coins } = completion;
  const milestone = isStreakMilestone(day);
  const tomorrow = day + 1;
  const tomorrowCoins = streakRewardFor(tomorrow);
  const tomorrowSave = earnsStreakSave(tomorrow);

  // The coins were credited by the store; fly them to the counter once the card is on screen.
  useEffect(() => {
    const t = window.setTimeout(() => triggerCoinFlight(coinsRef.current), 350);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className={`streak-day-card${milestone ? " streak-day-card-milestone" : ""}`} role="status">
      <div className="streak-day-main">
        <span className="streak-day-flame">
          <StreakFlame lit size={40} animated />
        </span>
        <div className="streak-day-text">
          <p className="streak-day-title">
            {milestone ? `Day ${day} milestone!` : day === 1 ? "Day 1 – your streak has started" : `Day ${day} streak`}
          </p>
          <p className="streak-day-sub">
            {completion.emberUnlocked ? (
              <>
                <span className="streak-ember-swatch" style={{ background: EMBER_CSS_GRADIENT }} aria-hidden="true" />
                Ember Ink unlocked – find it in your ink colors.
              </>
            ) : (
              <>
                Tomorrow: +{tomorrowCoins} 🪙{tomorrowSave ? " and a Streak Save" : ""}
              </>
            )}
          </p>
          {completion.savesUsed > 0 && <p className="streak-day-note">🛡 A Streak Save kept your streak going.</p>}
          {completion.saveEarned && <p className="streak-day-note">🛡 +1 Streak Save</p>}
        </div>
        <span ref={coinsRef} className="streak-day-coins">
          +{coins} 🪙
        </span>
      </div>
      <button
        type="button"
        className="streak-day-view"
        onClick={() => {
          playSelectSound();
          setOpen(true);
        }}
      >
        View streak
      </button>
      {open && <StreakSheet onClose={() => setOpen(false)} />}
    </div>
  );
}
