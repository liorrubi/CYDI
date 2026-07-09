type LockedFeatureHintProps = {
  message: string;
  onNavigateToShapeChallenge: () => void;
  onDismiss: () => void;
};

/** Floating hint shown when tapping a locked header icon (daily chest / special challenge). Clicking anywhere on it - message or the "Go to Shape Challenge" label - jumps straight to the Shape Challenge map; clicking outside just dismisses it. */
export default function LockedFeatureHint({ message, onNavigateToShapeChallenge, onDismiss }: LockedFeatureHintProps) {
  return (
    <>
      <button type="button" className="locked-feature-hint-backdrop" aria-label="Dismiss" onClick={onDismiss} />
      <button type="button" className="locked-feature-hint" onClick={onNavigateToShapeChallenge}>
        <p className="locked-feature-hint-message">{message}</p>
        <span className="locked-feature-hint-cta">Go to Shape Challenge</span>
      </button>
    </>
  );
}
