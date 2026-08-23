type RoundCoachMarkProps = {
  text: string;
};

/**
 * A single inline hint during the first round.
 *
 * Deliberately NOT a modal or a spotlight overlay: these appear while the
 * player is watching a 3-second shape or racing the 20-second drawing clock,
 * and anything that has to be dismissed - or that dims the canvas - would cost
 * them the round. It sits in the layout, says one thing, and gets out of the
 * way on its own when the phase moves on.
 */
export default function RoundCoachMark({ text }: RoundCoachMarkProps) {
  return (
    <p className="mp-coach" role="status" aria-live="polite">
      <span className="mp-coach-pointer" aria-hidden="true">
        💡
      </span>
      {text}
    </p>
  );
}
