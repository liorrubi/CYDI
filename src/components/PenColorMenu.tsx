import { useState } from "react";
import { PEN_COLORS, type PenColorId } from "../app/constants";
import { isColorUnlocked } from "../services/penColorStore";
import { playSelectSound, playToggleSound } from "../engine/soundEngine";
import { useDialogA11y } from "../hooks/useDialogA11y";

type PenColorMenuProps = {
  selected: PenColorId;
  onSelect: (id: PenColorId) => void;
  onLockedColorClick: (id: PenColorId) => void;
};

/** Solid paint-drop glyph — sits on top of the trigger's ink-tinted swatch so the button unambiguously reads as "this changes the ink color", distinct from PenSkinMenu's pen-shaped trigger. Kept white with a soft dark outline so it stays visible against every ink color, including the light-colored ones. */
function ColorDropIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.5 C12 2.5 5 11 5 15.5 C5 19.64 8.36 23 12 23 C15.64 23 19 19.64 19 15.5 C19 11 12 2.5 12 2.5 Z"
        fill="#ffffff"
        stroke="rgba(30,32,46,0.35)"
        strokeWidth="1.2"
      />
    </svg>
  );
}

/** Button that opens a menu of every pen ink color, including locked ones - tapping a locked color jumps straight to its shop product. Its trigger is tinted with the actual ink color plus a paint-drop icon, so it's clearly the "change ink color" control (as opposed to PenSkinMenu's "change pen style" control next to it). */
export default function PenColorMenu({ selected, onSelect, onLockedColorClick }: PenColorMenuProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = PEN_COLORS.find((c) => c.id === selected) ?? PEN_COLORS[0];
  // Not a full trap: the dropdown is a lightweight disclosure of plain buttons, so Tab
  // should still be free to move on through the page as usual - only Escape and the
  // initial focus placement are handled here.
  const dropdownRef = useDialogA11y<HTMLDivElement>(open, { onClose: () => setOpen(false), trapFocus: false });

  return (
    <div className="pen-color-menu">
      <button
        type="button"
        className={selectedOption.id === "rainbow" ? "pen-color-trigger pen-color-swatch-rainbow" : "pen-color-trigger"}
        style={selectedOption.hex ? { background: selectedOption.hex } : undefined}
        onClick={() => {
          playToggleSound();
          setOpen((isOpen) => !isOpen);
        }}
        aria-label="Change ink color"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <ColorDropIcon />
      </button>
      {open && (
        <div ref={dropdownRef} className="pen-color-dropdown">
          {PEN_COLORS.map((color) => {
            const unlocked = isColorUnlocked(color.id);
            const classes = ["pen-color-option"];
            if (color.id === selected) classes.push("pen-color-option-selected");
            if (!unlocked) classes.push("pen-color-option-locked");
            return (
              <button
                key={color.id}
                type="button"
                className={classes.join(" ")}
                aria-label={unlocked ? color.name : `${color.name} (locked)`}
                onClick={() => {
                  if (!unlocked) {
                    onLockedColorClick(color.id);
                    setOpen(false);
                    return;
                  }
                  playSelectSound();
                  onSelect(color.id);
                  setOpen(false);
                }}
              >
                <span
                  className={
                    color.id === "rainbow"
                      ? "pen-color-option-swatch pen-color-swatch-rainbow"
                      : "pen-color-option-swatch"
                  }
                  style={color.hex ? { background: color.hex } : undefined}
                />
                <span className="pen-color-option-name">{color.name}</span>
                {!unlocked && (
                  <span className="pen-color-option-lock" aria-hidden="true">
                    🔒
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
