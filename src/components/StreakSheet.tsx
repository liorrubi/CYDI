import { useEffect, useState } from "react";
import { EMBER_CSS_GRADIENT } from "../app/constants";
import { STREAK_MILESTONES, STREAK_SAVE_MAX, STREAK_SAVE_PRICE, streakRewardFor } from "../app/drawingStreak";
import { playChipSound, playSelectSound } from "../engine/soundEngine";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { getCoins, onCoinsChanged } from "../services/coinsStore";
import { buyStreakSave, getStreakState, getStreakView, onStreakChanged } from "../services/drawingStreakStore";
import StreakFlame from "./StreakFlame";
import StreakRescueOffer from "./StreakRescueOffer";

type StreakSheetProps = { onClose: () => void };

/** The milestone dots are evenly spaced; the fill moves between them in proportion to the days in each stretch. */
function trackFillPercent(current: number): number {
  const days = STREAK_MILESTONES.map((m) => m.day);
  const last = days.length - 1;
  if (current <= days[0]) return 0;
  if (current >= days[last]) return 100;
  const i = days.findIndex((d, k) => current >= d && current < days[k + 1]);
  const within = (current - days[i]) / (days[i + 1] - days[i]);
  return Math.round(((i + within) / last) * 100);
}

/**
 * The on-demand streak view: the current streak, the road to the next milestones, Streak Saves. One compact sheet -
 * no calendar grid, no history, no nagging. Opened from the streak chip or the Daily result card, closed by the ✕,
 * the backdrop or Escape.
 */
export default function StreakSheet({ onClose }: StreakSheetProps) {
  const [view, setView] = useState(() => getStreakView());
  const [emberOwned, setEmberOwned] = useState(() => getStreakState().emberGranted);
  const [coins, setCoins] = useState(() => getCoins());
  const ref = useDialogA11y<HTMLDivElement>(true, { onClose });

  useEffect(
    () =>
      onStreakChanged(() => {
        setView(getStreakView());
        setEmberOwned(getStreakState().emberGranted);
      }),
    [],
  );
  useEffect(() => onCoinsChanged(() => setCoins(getCoins())), []);

  const current = view.current;
  const fill = trackFillPercent(current);
  const nextMilestone = STREAK_MILESTONES.find((m) => m.day > current);

  const status = view.doneToday
    ? "Done for today. Come back tomorrow to keep it going."
    : current > 0
      ? view.savesNeeded > 0
        ? `A Streak Save will cover the missed day when you play today's Daily.`
        : "Play today's Daily Challenge to keep it going."
      : view.best > 0
        ? "Play today's Daily Challenge to start a new streak."
        : "Play the Daily Challenge on consecutive days to build a streak.";

  const canBuy = view.saves < STREAK_SAVE_MAX && coins >= STREAK_SAVE_PRICE;

  function handleBuySave() {
    if (buyStreakSave() === "bought") playChipSound();
  }

  return (
    <div className="streak-sheet-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="streak-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="streak-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="streak-sheet-close"
          aria-label="Close"
          onClick={() => {
            playSelectSound();
            onClose();
          }}
        >
          ✕
        </button>
        <div className="streak-sheet-hero">
          <StreakFlame lit={view.doneToday} size={56} animated />
          <h2 id="streak-sheet-title" className="streak-sheet-title">
            {current > 0 ? `${current}-day streak` : "Daily streak"}
          </h2>
          <p className="streak-sheet-status">{status}</p>
          {view.best > current && <p className="streak-sheet-best">Best: {view.best} days</p>}
          <StreakRescueOffer />
        </div>

        <div className="streak-track" aria-label={`Streak progress: day ${current}`}>
          <div className="streak-track-line">
            <div className="streak-track-fill" style={{ width: `${fill}%` }} />
          </div>
          <ol className="streak-track-nodes">
            {STREAK_MILESTONES.map((m) => {
              const reached = current >= m.day;
              const isNext = nextMilestone?.day === m.day;
              return (
                <li key={m.day} className={`streak-node${reached ? " streak-node-reached" : ""}${isNext ? " streak-node-next" : ""}`}>
                  <span className="streak-node-dot" aria-hidden="true">
                    {reached ? "✓" : ""}
                  </span>
                  <span className="streak-node-day">Day {m.day}</span>
                  <span className="streak-node-reward">
                    {m.extra === "ember" ? (
                      <>
                        <span className="streak-ember-swatch" style={{ background: EMBER_CSS_GRADIENT }} aria-hidden="true" />
                        {emberOwned ? "Ember ✓" : "Ember Ink"}
                      </>
                    ) : (
                      <>+{m.coins} 🪙{m.extra === "save" ? " 🛡" : ""}</>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="streak-next-line">
            {view.next
              ? `Today: Day ${view.next.day} · +${view.next.coins} 🪙`
              : `Tomorrow: Day ${current + 1} · +${streakRewardFor(current + 1)} 🪙`}
          </p>
        </div>

        <div className="streak-saves">
          <div className="streak-saves-row">
            <span className="streak-saves-icons" aria-label={`${view.saves} of ${STREAK_SAVE_MAX} Streak Saves`}>
              {Array.from({ length: STREAK_SAVE_MAX }, (_, i) => (
                <span key={i} className={i < view.saves ? "streak-save-icon streak-save-icon-held" : "streak-save-icon"} aria-hidden="true">
                  🛡
                </span>
              ))}
            </span>
            <span className="streak-saves-text">A Save covers a missed day automatically.</span>
          </div>
          <button type="button" className="streak-save-buy" disabled={!canBuy} onClick={handleBuySave}>
            {view.saves >= STREAK_SAVE_MAX ? "Saves full" : `Get a Save · ${STREAK_SAVE_PRICE} 🪙`}
          </button>
        </div>
      </div>
    </div>
  );
}
