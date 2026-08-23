import { useEffect, useState } from "react";
import Confetti from "./Confetti";
import { playChampionFanfare, playRoundWinSound } from "../../engine/soundEngine";
import { hapticChampion, hapticRoundWin } from "../../services/haptics";

type WinnerRevealProps = {
  nickname: string | null;
  score: number | null;
  isYou: boolean;
  /** "round" is the per-round winner beat; "champion" is the end-of-game one. */
  variant: "round" | "champion";
  /** Fires once the reveal has finished playing, so the parent can show the standings. */
  onDone?: () => void;
};

// Long enough to register, short enough that nobody is waiting on it. The
// champion beat earns the extra second because it happens once per game.
const ROUND_HOLD_MS = 1700;
const CHAMPION_HOLD_MS = 2800;

/**
 * The celebratory beat before the leaderboard.
 *
 * Sequenced entirely on the client, not as a server phase: the server keeps
 * ROUND_RESULTS as one state and sends the winner and the standings together,
 * so this animation can never desync the room or race the host's Next.
 *
 * Sound goes through the existing soundEngine, which already honours the
 * player's sound setting - there is no separate multiplayer mute.
 */
export default function WinnerReveal({ nickname, score, isYou, variant, onDone }: WinnerRevealProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Sound goes through the existing soundEngine, which already honours the
    // player's sound setting - there is no separate multiplayer mute. Haptics
    // are a native no-op on web.
    if (variant === "champion") {
      playChampionFanfare();
      hapticChampion();
    } else {
      playRoundWinSound();
      hapticRoundWin();
    }

    const hold = variant === "champion" ? CHAMPION_HOLD_MS : ROUND_HOLD_MS;
    const timer = window.setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, hold);
    return () => window.clearTimeout(timer);
    // Intentionally mount-only: re-running on prop identity changes would
    // restart the celebration mid-beat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  if (!nickname) {
    return (
      <div className="mp-reveal mp-reveal-empty" role="status">
        <span className="mp-reveal-emoji" aria-hidden="true">
          🫥
        </span>
        <p className="mp-reveal-title">Nobody finished in time!</p>
      </div>
    );
  }

  const isChampion = variant === "champion";

  return (
    <div className={`mp-reveal ${isChampion ? "mp-reveal-champion" : "mp-reveal-round"}`} role="status">
      <Confetti variant={variant} />
      <span className="mp-reveal-emoji" aria-hidden="true">
        {isChampion ? "👑" : "🎉"}
      </span>
      <p className="mp-reveal-kicker">{isChampion ? "CYDI Champion" : "Round winner"}</p>
      <p className="mp-reveal-title">{isYou ? `${nickname} — that's you!` : nickname}</p>
      {score !== null && <p className="mp-reveal-score">{isChampion ? `${score} points` : `+${score} this round`}</p>}
    </div>
  );
}
