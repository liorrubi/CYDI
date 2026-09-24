import Button from "../Button";
import { openStoreForUpdate } from "../../services/appUpdate";
import { UPDATE_REQUIRED_MESSAGE } from "../../multiplayer/roomApi";

/**
 * Shown when the server refuses this build for Play Together
 * (multiplayer_update_required). Terminal on purpose: nothing retries behind it, the
 * only ways out are updating or leaving. Solo play is untouched.
 */
export default function UpdateRequiredNotice({ onExit }: { onExit?: () => void }) {
  return (
    <div className="mp-stage" role="alert">
      <p className="status-text">{UPDATE_REQUIRED_MESSAGE}</p>
      <Button onClick={() => void openStoreForUpdate()}>Update CYDI</Button>
      {onExit && (
        <Button variant="secondary" onClick={onExit}>
          Back
        </Button>
      )}
    </div>
  );
}
