import { useState } from "react";
import { useDialogA11y } from "../../hooks/useDialogA11y";
import { playChipSound } from "../../engine/soundEngine";

type MultiplayerTutorialOverlayProps = {
  /** "passPlay" is the local two-player mode; the other two are the roles inside a live room. */
  role: "host" | "guest" | "passPlay";
  onDismiss: () => void;
};

type Step = { icon: string; title: string; body: string };

/**
 * Host and guest are told different things because they can do different
 * things - only the host has controls, and a guest reading "start when
 * everyone is ready" next to a button they do not have is worse than no
 * tutorial at all.
 *
 * Written for someone who has never played CYDI: nothing here assumes the
 * single-player game, the scoring page, or any CYDI vocabulary.
 */
const HOST_STEPS: Step[] = [
  { icon: "📨", title: "Invite your players", body: "Share the link or read out the 6-character room code. Friends join in a browser - no app and no account needed." },
  { icon: "▶️", title: "Start when everyone's in", body: "You're the host. Nobody can begin until you tap Start Game, so there's no rush." },
  { icon: "👀", title: "Everyone sees one shape", body: "The same shape appears for 3 seconds, then disappears. Everyone draws it from memory at the same time." },
  { icon: "🎯", title: "Accuracy and speed both count", body: "Your score is 75% how closely you matched the shape, and 25% how quickly you finished." },
  { icon: "⏭️", title: "You control the pace", body: "After each round everyone sees the scores, and the next round starts when you tap Next Round." },
];

const GUEST_STEPS: Step[] = [
  { icon: "👀", title: "Remember the shape", body: "A shape appears for 3 seconds, then vanishes. Look carefully - you won't see it again." },
  { icon: "✏️", title: "Draw it from memory", body: "You have 20 seconds. Draw it as accurately as you can with your finger or mouse." },
  { icon: "⚡", title: "Finish early for a speed bonus", body: "Tap DONE as soon as you're happy. 75% of your score is accuracy, 25% is how fast you finished." },
  { icon: "🏆", title: "Highest total wins", body: "Scores add up across every round. Whoever has the most at the end is the CYDI Champion." },
];

/**
 * One device, taken in turns. The two things a first-timer gets wrong are
 * watching over the other player's shoulder, and not realising the phone has to
 * change hands - so both are said outright.
 */
const PASS_PLAY_STEPS: Step[] = [
  { icon: "📱", title: "One device, two players", body: "You take it in turns on this phone. When it is not your turn, look away - no peeking at what the other player drew." },
  { icon: "👀", title: "Remember the shape", body: "On your turn a shape appears for 3 seconds, then vanishes. You both get the same shape in a round." },
  { icon: "✏️", title: "Draw it from memory", body: "You have 20 seconds. Tap DONE as soon as you are happy - finishing early earns a speed bonus." },
  { icon: "🤝", title: "Scores stay hidden until you are both done", body: "Nobody sees a score or a drawing until both players have taken their turn, so the second player has nothing to aim at." },
  { icon: "🏆", title: "Highest total wins", body: "Scores add up across every round, and whoever goes first swaps each round. The best total is the CYDI Champion." },
];

const STEPS_BY_ROLE = { host: HOST_STEPS, guest: GUEST_STEPS, passPlay: PASS_PLAY_STEPS };

const LABEL_BY_ROLE = {
  host: "How to host Play Together",
  guest: "How to play together",
  passPlay: "How to play 2 Players",
};

export default function MultiplayerTutorialOverlay({ role, onDismiss }: MultiplayerTutorialOverlayProps) {
  const steps = STEPS_BY_ROLE[role];
  const [index, setIndex] = useState(0);
  const dialogRef = useDialogA11y<HTMLDivElement>(true, { onClose: onDismiss });

  const step = steps[index];
  const isLast = index === steps.length - 1;

  function next() {
    playChipSound();
    if (isLast) onDismiss();
    else setIndex((i) => i + 1);
  }

  return (
    <div className="onboarding-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="onboarding-card onboarding-accent-purple mp-tutorial-card"
        role="dialog"
        aria-modal="true"
        aria-label={LABEL_BY_ROLE[role]}
      >
        <button type="button" className="onboarding-skip" onClick={onDismiss}>
          Skip
        </button>

        <div className="onboarding-step">
          <div className="onboarding-icon" aria-hidden="true">
            {step.icon}
          </div>
          <h2 className="onboarding-title">{step.title}</h2>
          <p className="mp-tutorial-body">{step.body}</p>
        </div>

        <div className="mp-tutorial-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={i === index ? "mp-dot mp-dot-active" : "mp-dot"} />
          ))}
        </div>

        <p className="sr-only" aria-live="polite">
          Step {index + 1} of {steps.length}
        </p>

        <button type="button" className="btn btn-primary onboarding-next" onClick={next}>
          {isLast ? "Got it!" : "Next"}
        </button>
      </div>
    </div>
  );
}
