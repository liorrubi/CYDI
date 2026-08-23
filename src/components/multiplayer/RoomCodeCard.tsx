import { useState } from "react";
import Button from "../Button";
import QrCode from "./QrCode";
import { copyTextToClipboard } from "../../services/clipboard";
import { shareOrCopy } from "../../services/nativeShare";
import { getPublicOrigin } from "../../services/nativeApi";

type RoomCodeCardProps = {
  roomCode: string;
};

/** The canonical invite address. `/join/<code>` is a dedicated, clean path (not the `/c/` share namespace). */
export function inviteUrlFor(roomCode: string): string {
  return `${getPublicOrigin()}/join/${roomCode}`;
}

/**
 * The invite panel: the code in large type, a QR beside it, and the two ways
 * to hand it to someone.
 *
 * The CODE is the primary affordance and the QR is secondary, not the other
 * way round - a code can be read down a phone call or typed by someone across
 * the room, and it is the only route that works when both people are looking
 * at the same screen.
 */
export default function RoomCodeCard({ roomCode }: RoomCodeCardProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const inviteUrl = inviteUrlFor(roomCode);

  function flash(message: string) {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 2200);
  }

  async function handleCopy() {
    const ok = await copyTextToClipboard(inviteUrl);
    flash(ok ? "Invite link copied" : "Couldn't copy - read out the code instead");
  }

  async function handleShare() {
    const outcome = await shareOrCopy({
      title: "Join my CYDI game",
      text: `Join my drawing game! Room code: ${roomCode}`,
      url: inviteUrl,
    });
    if (outcome === "copied") flash("Invite link copied");
    else if (outcome === "failed") flash("Couldn't share - read out the code instead");
  }

  return (
    <section className="mp-invite" aria-labelledby="mp-invite-heading">
      <h2 id="mp-invite-heading" className="mp-invite-heading">
        Invite your friends
      </h2>

      <div className="mp-invite-body">
        <div className="mp-invite-code-block">
          <span className="mp-invite-label">Room code</span>
          {/* Letter-spaced and chunked so it can be read aloud without ambiguity. */}
          <span className="mp-room-code" aria-label={`Room code ${roomCode.split("").join(" ")}`}>
            {roomCode}
          </span>
          <span className="mp-invite-hint">Enter it at playcydi.com/join</span>
        </div>

        <div className="mp-invite-qr">
          <QrCode value={inviteUrl} size={148} label={`QR code to join room ${roomCode}`} />
          <span className="mp-invite-hint">or scan</span>
        </div>
      </div>

      <div className="mp-invite-actions">
        <Button variant="secondary" onClick={handleCopy}>
          Copy link
        </Button>
        <Button variant="primary" onClick={handleShare}>
          Share invite
        </Button>
      </div>

      {/* Polite, so the confirmation never interrupts what a screen reader is saying. */}
      <p className="mp-invite-feedback" role="status" aria-live="polite">
        {feedback ?? ""}
      </p>
    </section>
  );
}
