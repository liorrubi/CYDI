/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useEffect, useState } from "react";
import { lookupRoom } from "../multiplayer/roomApi";
import { hasRoomToken } from "../multiplayer/roomSocket";
import { clearActiveRoom, getActiveRoomHint } from "../multiplayer/resumeStore";
import { trackEvent } from "../services/analytics";

type ResumeGameBannerProps = {
  onResume: (roomCode: string) => void;
};

/**
 * "Game in progress" on Home, after the app was closed or swiped away
 * mid-match.
 *
 * The banner is only ever shown once the room has been CHECKED. A local
 * breadcrumb alone would happily advertise a game that finished twenty minutes
 * ago, and a dead "Return to Game" button is worse than none - so the room is
 * looked up first, and a room that is gone, abandoned or already over silently
 * clears the breadcrumb instead of rendering anything.
 *
 * Nothing here replays what was missed: tapping through reconnects with the
 * seat token already held and the next full snapshot puts the player wherever
 * the game actually is now.
 */
export default function ResumeGameBanner({ onResume }: ResumeGameBannerProps) {
  const [roomCode, setRoomCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const hint = getActiveRoomHint();
    // Without a seat token there is nothing to reconnect AS, so the breadcrumb
    // is meaningless - a player who explicitly left has neither.
    if (!hint || !hasRoomToken(hint.roomCode)) {
      clearActiveRoom();
      return;
    }

    void lookupRoom(hint.roomCode).then((result) => {
      if (cancelled) return;
      // A lookup that failed to REACH the server is not evidence the room is
      // gone; leave the breadcrumb alone and simply offer nothing this time.
      if (!result.ok) {
        if (/No game found/.test(result.error)) clearActiveRoom();
        return;
      }
      if (result.info.phase === "ABANDONED" || result.info.phase === "FINAL_RESULTS") {
        clearActiveRoom();
        return;
      }
      setRoomCode(hint.roomCode);
      // Reported here, not when the breadcrumb was found: this is the moment
      // the offer actually reaches the player. No room code goes with it.
      trackEvent("mp_resume_offered", {});
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!roomCode) return null;

  return (
    <section className="resume-banner" role="status">
      <span className="resume-banner-icon" aria-hidden="true">
        🎮
      </span>
      <span className="resume-banner-text">
        <strong>Game in progress</strong>
        <span className="resume-banner-sub">Your multiplayer game is still going</span>
      </span>
      <button type="button" className="btn btn-primary resume-banner-action" onClick={() => onResume(roomCode)}>
        Return to Game
      </button>
    </section>
  );
}
