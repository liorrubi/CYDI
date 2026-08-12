import { useState } from "react";
import { playSelectSound } from "../engine/soundEngine";
import { genericShareUrl, isAndroidApp, shareOrCopy } from "../services/nativeShare";

const GAME_SHARE_URL = "https://playcydi.com";
const GAME_SHARE_TEXT = "Try CYDI — a drawing challenge game with coins, rewards, daily chests and special challenges!";

// Android-only invite text - short enough to read well in a WhatsApp/Messages
// preview next to the Play Store link. The web wording above is unchanged.
const APP_SHARE_TEXT = "Can you draw it? 🎨 Try CYDI and beat my score!";

/** Header shortcut that shares the game itself (not a specific challenge or result). */
export default function ShareGameButton() {
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleClick() {
    playSelectSound();
    // Both resolve to the existing web values off-Android, so nothing about the
    // website's share changes.
    const url = genericShareUrl(GAME_SHARE_URL);
    const outcome = await shareOrCopy({
      title: "CYDI",
      text: isAndroidApp() ? APP_SHARE_TEXT : GAME_SHARE_TEXT,
      url,
    });
    if (outcome === "copied") {
      setFeedback("Game link copied!");
      window.setTimeout(() => setFeedback(null), 2500);
    } else if (outcome === "failed") {
      setFeedback(`Couldn't share automatically - copy this link: ${url}`);
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
