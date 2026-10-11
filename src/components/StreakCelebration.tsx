import { useEffect, useRef, useState } from "react";
import { EMBER_CSS_GRADIENT } from "../app/constants";
import { registerNavigationGuard } from "../app/navigationGuard";
import { closeStreakCard, getStreakCardExtras, onStreakCardExtras, openStreakCard } from "../app/streakCardGate";
import { earnsStreakSave, isBigStreakDay, isStreakMilestone, STREAK_MILESTONES, STREAK_SAVE_MAX } from "../app/drawingStreak";
import { triggerCoinFlight } from "../engine/coinFlight";
import { playSelectSound, playSuccessSound } from "../engine/soundEngine";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { onStreakDayCompleted, onStreakProgress, type StreakDayEventDetail, type StreakProgressEventDetail } from "../services/drawingStreakStore";
import StreakFlame from "./StreakFlame";

const BANNER_MS = 3600;
const PROGRESS_MS = 2200;

/** Days that earn more than the ordinary coins - a milestone, a Streak Save or the Ember Ink - get the full card. */
function isBigDay(d: StreakDayEventDetail): boolean {
  return isBigStreakDay(d.completion);
}

let liveGamesMounted = 0;

/** Mounted by the live game screens (Multiplayer room, 2 Players match): while one is on screen, a day is a banner. */
export function useStreakLiveGame(): void {
  useEffect(() => {
    liveGamesMounted++;
    return () => {
      liveGamesMounted--;
    };
  }, []);
}

/** A live game (other players, a running round) never gets a card on top of it - the banner says it all instead. */
function isLiveGame(d: { route: string }): boolean {
  return d.route === "multiplayer" || d.route === "two_players" || liveGamesMounted > 0;
}

export default function StreakCelebration() {
  const [day, setDay] = useState<{ detail: StreakDayEventDetail; card: boolean } | null>(null);
  const [progress, setProgress] = useState<StreakProgressEventDetail | null>(null);

  useEffect(
    () =>
      onStreakProgress((p) => {
        if (p.route === "classic" || p.route === "daily") return;
        setProgress(p);
      }),
    [],
  );
  useEffect(
    () =>
      onStreakDayCompleted((d) => {
        // Decided once, at the moment the day pays: a card (a milestone / Save / Ember day, or a day that reached a streak
        // achievement - not in a live game) or a banner.
        const card = !isLiveGame(d) && (isBigDay(d) || d.achievements.length > 0);
        if (card) openStreakCard(); // offers under it wait until it closes (app/streakCardGate.ts)
        setProgress(null);
        setDay({ detail: d, card });
      }),
    [],
  );
  useEffect(() => {
    if (!progress) return;
    const t = window.setTimeout(() => setProgress(null), PROGRESS_MS);
    return () => window.clearTimeout(t);
  }, [progress]);

  if (day?.card) {
    return (
      <StreakDayCard
        detail={day.detail}
        onClose={() => {
          setDay(null);
          closeStreakCard();
        }}
      />
    );
  }
  if (day) return <StreakDayBanner detail={day.detail} onDone={() => setDay(null)} />;
  if (progress) {
    return (
      <div className="streak-toast streak-toast-progress" role="status">
        <StreakFlame lit={false} size={16} />
        <span>
          {progress.drawings}/{progress.target} today
        </span>
      </div>
    );
  }
  return null;
}

function rewardsText(d: StreakDayEventDetail): string {
  const c = d.completion;
  const achievementCoins = d.achievements.reduce((sum, a) => sum + a.coins, 0);
  return [
    `+${c.coins} 🪙`,
    c.saveEarned ? `+1 🛡` : "",
    c.emberUnlocked ? "Ember Ink" : "",
    // In a live game the day is a banner: the achievement it reached (paid now) is named there too.
    achievementCoins > 0 ? `🏆 ${d.achievements.map((a) => a.title).join(", ")} +${achievementCoins}` : "",
    d.megaCards.length > 0 ? `🃏 ${d.megaCards.map((m) => m.name).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function StreakDayBanner({ detail, onDone }: { detail: StreakDayEventDetail; onDone: () => void }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const c = detail.completion;
  useEffect(() => {
    const fly = window.setTimeout(() => triggerCoinFlight(ref.current), 200);
    const t = window.setTimeout(onDone, isBigDay(detail) ? BANNER_MS + 2000 : BANNER_MS);
    return () => {
      window.clearTimeout(fly);
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);
  const title = c.restartedFrom > 0 ? "New streak · Day 1" : isBigDay(detail) ? `Day ${c.day}!` : `Day ${c.day} · streak kept`;
  return (
    <div className={`streak-toast${isBigDay(detail) ? " streak-toast-big" : ""}`} role="status">
      <StreakFlame lit size={20} />
      <span>{title}</span>
      <span ref={ref} className="streak-toast-coins">
        {rewardsText(detail)}
      </span>
    </div>
  );
}

/** What the card is about, in one line: the streak moment first, then the achievements it came with. */
function cardSubtitle(c: StreakDayEventDetail["completion"], achievementCount: number): string {
  const moment = isStreakMilestone(c.day) ? "Streak milestone reached" : c.saveEarned || earnsStreakSave(c.day) ? "Streak Save earned" : "";
  const plural = achievementCount === 1 ? "an achievement" : `${achievementCount} achievements`;
  if (!moment) return achievementCount === 1 ? "Achievement unlocked" : `${achievementCount} achievements unlocked`;
  return achievementCount > 0 ? `${moment} + ${plural}` : moment;
}

function StreakDayCard({ detail, onClose }: { detail: StreakDayEventDetail; onClose: () => void }) {
  const c = detail.completion;
  const coinsRef = useRef<HTMLDivElement | null>(null);
  const ref = useDialogA11y<HTMLDivElement>(true, { onClose });
  const next = STREAK_MILESTONES.find((m) => m.day > c.day);
  // Achievements earned on the same drawing join this card (app/streakCardGate.ts) - one celebration, every reward.
  const [extras, setExtras] = useState(getStreakCardExtras);
  useEffect(() => {
    setExtras(getStreakCardExtras());
    return onStreakCardExtras(() => setExtras(getStreakCardExtras()));
  }, []);
  // Every achievement this drawing paid: the streak achievements the day reached, then any Classic achievement it
  // also unlocked (added by the result screen) - each once.
  const achievements = [...detail.achievements, ...extras.filter((x) => !detail.achievements.some((a) => a.id === x.id))];
  const close = () => {
    playSelectSound();
    onClose();
  };
  useEffect(() => {
    playSuccessSound();
    const t = window.setTimeout(() => triggerCoinFlight(coinsRef.current), 450);
    return () => window.clearTimeout(t);
  }, []);
  // Android Back closes the card (like Nice!) instead of leaving the screen underneath it.
  useEffect(
    () =>
      registerNavigationGuard(() => {
        close();
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return (
    <div className="streak-celebrate-backdrop" onClick={close}>
      <div ref={ref} className="streak-celebrate" role="dialog" aria-modal="true" aria-labelledby="streak-celebrate-title" onClick={(e) => e.stopPropagation()}>
        <StreakFlame lit size={64} animated />
        <h2 id="streak-celebrate-title" className="streak-celebrate-title">
          Day {c.day}!
        </h2>
        <p className="streak-celebrate-sub">{cardSubtitle(c, achievements.length)}</p>
        <ul className="streak-celebrate-rewards">
          <li>
            <div ref={coinsRef} className="streak-celebrate-reward">
              <span className="streak-celebrate-icon" aria-hidden="true">
                🪙
              </span>
              <strong>+{c.coins} coins</strong>
            </div>
            <span className="streak-celebrate-meta">Balance {detail.balance.toLocaleString("en-US")}</span>
          </li>
          {c.saveEarned && (
            <li>
              <div className="streak-celebrate-reward">
                <span className="streak-celebrate-icon" aria-hidden="true">
                  🛡
                </span>
                <strong>+1 Streak Save</strong>
              </div>
              <span className="streak-celebrate-meta">
                {detail.saves}/{STREAK_SAVE_MAX} held
              </span>
            </li>
          )}
          {!c.saveEarned && earnsStreakSave(c.day) && (
            <li>
              <div className="streak-celebrate-reward">
                <span className="streak-celebrate-icon" aria-hidden="true">
                  🛡
                </span>
                <span>Streak Saves full</span>
              </div>
              <span className="streak-celebrate-meta">
                {detail.saves}/{STREAK_SAVE_MAX} held
              </span>
            </li>
          )}
          {c.emberUnlocked && (
            <li>
              <div className="streak-celebrate-reward">
                <span className="streak-ember-swatch streak-celebrate-swatch" style={{ background: EMBER_CSS_GRADIENT }} aria-hidden="true" />
                <strong>Ember Ink</strong>
              </div>
              <span className="streak-celebrate-meta">Yours to keep - in your inks</span>
            </li>
          )}
          {achievements.map((x) => (
            <li key={x.id}>
              <div className="streak-celebrate-reward">
                <span className="streak-celebrate-icon" aria-hidden="true">
                  🏆
                </span>
                <strong>+{x.coins.toLocaleString("en-US")} coins</strong>
              </div>
              <span className="streak-celebrate-meta">Achievement: {x.title}</span>
            </li>
          ))}
          {detail.megaCards.map((m) => (
            <li key={m.id}>
              <div className="streak-celebrate-reward">
                <span className="streak-celebrate-icon" aria-hidden="true">
                  🃏
                </span>
                <strong>{m.name}</strong>
              </div>
              <span className="streak-celebrate-meta">Mega card unlocked</span>
            </li>
          ))}
        </ul>
        {next && (
          <p className="streak-celebrate-next">
            Next: Day {next.day} · +{next.coins} 🪙{next.extra === "ember" ? " + Ember Ink" : ""}
          </p>
        )}
        <button type="button" className="streak-celebrate-ok" onClick={close}>
          Nice!
        </button>
      </div>
    </div>
  );
}
