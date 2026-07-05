import { useState } from "react";
import { isSoundEnabled, setSoundEnabled } from "../services/soundSettings";

export default function SoundToggleButton() {
  const [enabled, setEnabled] = useState(() => isSoundEnabled());

  function toggle() {
    const next = !enabled;
    setSoundEnabled(next);
    setEnabled(next);
  }

  return (
    <button
      type="button"
      className="sound-toggle"
      onClick={toggle}
      aria-label={enabled ? "Mute sound" : "Unmute sound"}
      aria-pressed={!enabled}
    >
      {enabled ? "🔊" : "🔇"}
    </button>
  );
}
