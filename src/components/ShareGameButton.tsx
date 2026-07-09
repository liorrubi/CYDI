import { useState } from "react";
import { playSelectSound } from "../engine/soundEngine";
import { shareOrCopy } from "../services/nativeShare";

const GAME_SHARE_URL = "https://playcydi.com";
const GAME_SHARE_TEXT = "Try CYDI — a drawing challenge game with coins, rewards, daily chests and special challenges!";

/** Header shortcut that shares the game itself (not a specific challenge or result). */
export default function ShareGameButton() {
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleClick() {
    playSelectSound();
    const outcome = await shareOrCopy({
      title: "CYDI",
      text: GAME_SHARE_TEXT,
      url: GAME_SHARE_URL,
    });
    if (outcome === "copied") {
      setFeedback("Game link copied!");
      window.setTimeout(() => setFeedback(null), 2500);
    } else if (outcome === "failed") {
      setFeedback(`Couldn't share automatically - copy this link: ${GAME_SHARE_URL}`);
    }
  }

  return (
    <div className="header-icon-anchor">
      <button type="button" className="share-game-shortcut" onClick={handleClick} aria-label="Share CYDI">
        🔗
      </button>
      {feedback && <span className="share-game-toast">{feedback}</span>}
    </div>
  );
}
