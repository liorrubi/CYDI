import { useEffect, useState } from "react";
import { EMBER_CSS_GRADIENT } from "../app/constants";
import { STREAK_MILESTONES, STREAK_SAVE_MAX, STREAK_SAVE_PRICE, streakRewardFor, type StreakView } from "../app/drawingStreak";
import { playChipSound, playSelectSound } from "../engine/soundEngine";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { useStreakRescue } from "../hooks/useStreakRescue";
import { getCoins, onCoinsChanged } from "../services/coinsStore";
import { buyStreakSave, getStreakState, getStreakView, onStreakChanged } from "../services/drawingStreakStore";
import StreakFlame from "./StreakFlame";

type StreakSheetProps = {
  onClose: () => void;
  /** Offer the Rewarded Rescue here (Home, Daily chip). Off on result screens, which have their own ad offers. */
  offerRescue?: boolean;
};

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

const BADGE: Partial<Record<StreakView["status"], { text: string; tone: "ok" | "warn" | "info" }>> = {
  done: { text: "Today ✓", tone: "ok" },
  protected: { text: "🛡 Protected", tone: "info" },
  at_risk: { text: "At risk", tone: "warn" },
  rescued: { text: "Rescued ✓", tone: "ok" },
  restarted: { text: "New streak", tone: "info" },
};

function statusLine(v: StreakView): string {
  const missed = v.missed === 1 ? "yesterday" : `${v.missed} days`;
  switch (v.status) {
    case "new":
      return "Finish 5 drawings today - any mode counts - to start your streak.";
    case "active":
      return "Finish 5 drawings today to keep it going.";
    case "protected":
      return `You missed ${missed}. Your Streak Save covers it - finish 5 drawings today.`;
    case "at_risk":
      return `You missed ${missed}. Keep your streak before today counts.`;
    case "rescued":
      return `Kept by the Rescue. Finish 5 drawings today to make it Day ${v.current + 1}.`;
    case "lost":
      return "Your last streak ended. Finish 5 drawings today to start a new one.";
    case "restarted":
      return `Today started a new streak - your ${v.restartedFrom}-day streak ended.`;
    case "done":
      return v.rescuedToday ? "Kept by the Rescue and today counts ✓ Come back tomorrow." : "Today counts ✓ Come back tomorrow to keep it going.";
  }
}

/**
 * The on-demand streak view. ONE status drives every line, so it can never say "12-day streak" and "Day 1" at once:
 * the streak and its state, today's progress (5 drawings, any mode), at most one "keep your streak" box (a Save,
 * and - only when an ad is really loaded - the Rescue), the milestone track and the Saves held. No calendar, no
 * history, no nagging. Opened from Home's streak bar, the Daily chip and the result chips.
 */
export default function StreakSheet({ onClose, offerRescue = true }: StreakSheetProps) {
  const [view, setView] = useState(() => getStreakView());
  const [emberOwned, setEmberOwned] = useState(() => getStreakState().emberGranted);
  const [coins, setCoins] = useState(() => getCoins());
  const rescue = useStreakRescue(offerRescue);
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
  const badge = BADGE[view.status];
  const canBuy = view.saves < STREAK_SAVE_MAX && coins >= STREAK_SAVE_PRICE;
  // At most one place offers a Save: the keep box while at risk, the Saves row otherwise.
  const keepBox = view.status === "at_risk" || (view.status === "restarted" && rescue.available);

  function handleBuySave() {
    if (buyStreakSave() === "bought") playChipSound();
  }

  const nextLine = view.doneToday
    ? `Tomorrow: Day ${current + 1} · +${streakRewardFor(current + 1)} 🪙`
    : view.next
      ? `${view.status === "at_risk" ? "If kept, today is" : "Today:"} Day ${view.next.day} · +${view.next.coins} 🪙`
      : "";

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
          <StreakFlame lit={view.doneToday} size={52} animated />
          <h2 id="streak-sheet-title" className="streak-sheet-title">
            {current > 0 ? `${current}-day streak` : "Drawing streak"}
          </h2>
          {badge && <span className={`streak-badge streak-badge-${badge.tone}`}>{badge.text}</span>}
          <p className="streak-sheet-status">{statusLine(view)}</p>
          {view.best > current && <p className="streak-sheet-best">Best: {view.best} days</p>}
          {!view.doneToday && (
            <p className="streak-today" aria-label={`Today: ${view.drawings} of ${view.target} drawings`}>
              <span className="daily-goal-dots" aria-hidden="true">
                {Array.from({ length: view.target }, (_, i) => (
                  <span key={i} className={i < view.drawings ? "daily-goal-dot daily-goal-dot-on" : "daily-goal-dot"} />
                ))}
              </span>
              <span>
                <strong>
                  {Math.min(view.drawings, view.target)}/{view.target}
                </strong>{" "}
                drawings today · any mode
              </span>
            </p>
          )}
        </div>

        {keepBox && (
          <div className="streak-keep">
            <p className="streak-keep-title">
              {view.status === "restarted" ? `Restore your ${view.restartedFrom}-day streak?` : `Keep your ${current}-day streak`}
            </p>
            {view.status === "at_risk" && (
              <>
                <p className="streak-keep-text">
                  {view.savesShort > 1 ? `${view.savesShort} Saves cover the missed days.` : "A Save covers the missed day."}
                  {rescue.available ? " Or watch a short ad instead." : ""}
                </p>
                <button type="button" className="streak-keep-save" disabled={!canBuy} onClick={handleBuySave}>
                  🛡 Get a Save · {STREAK_SAVE_PRICE} 🪙
                </button>
                {!canBuy && coins < STREAK_SAVE_PRICE && <p className="streak-keep-note">You need {STREAK_SAVE_PRICE} 🪙 for a Save.</p>}
              </>
            )}
            {view.status === "restarted" && <p className="streak-keep-text">Watch a short ad and it carries on from Day {view.restartedFrom + 1}.</p>}
            {rescue.available && !rescue.granted && (
              <button type="button" className="streak-rescue-btn" disabled={rescue.pending} onClick={() => void rescue.watch()}>
                {rescue.pending ? "Loading ad…" : "▶ Watch a short ad"}
              </button>
            )}
            {rescue.note && <p className="streak-keep-note">{rescue.note}</p>}
          </div>
        )}

        <div className="streak-track" aria-label={`Milestones: day ${current}`}>
          <p className="streak-track-label">Milestones</p>
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
                        {emberOwned ? "Ember ✓" : "+300 · Ember"}
                      </>
                    ) : (
                      <>+{m.coins} 🪙{m.extra === "save" ? " 🛡" : ""}</>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="streak-track-legend">Other days +20 🪙 (Day 2 +30) · 🛡 = Streak Save</p>
          {nextLine && <p className="streak-next-line">{nextLine}</p>}
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
            <span className="streak-saves-text">
              Saves {view.saves}/{STREAK_SAVE_MAX} - one covers a missed day automatically.
            </span>
          </div>
          {!keepBox && (
            <button type="button" className="streak-save-buy" disabled={!canBuy} onClick={handleBuySave}>
              {view.saves >= STREAK_SAVE_MAX ? "Saves full" : `Get a Save · ${STREAK_SAVE_PRICE} 🪙`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
