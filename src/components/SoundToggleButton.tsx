import { useState } from "react";
import { isSoundEnabled, setSoundEnabled } from "../services/soundSettings";
import { playToggleSound } from "../engine/soundEngine";

export default function SoundToggleButton() {
  const [enabled, setEnabled] = useState(() => isSoundEnabled());

  function toggle() {
    const next = !enabled;
    setSoundEnabled(next);
    setEnabled(next);
    playToggleSound();
  }

  return (
    <button
      type="button"
      className={enabled ? "settings-sound-toggle is-on" : "settings-sound-toggle"}
      onClick={toggle}
      aria-label={enabled ? "Mute sound" : "Unmute sound"}
      aria-pressed={!enabled}
    >
      <span className="settings-sound-toggle-knob">{enabled ? "🔊" : "🔇"}</span>
    </button>
  );
}
