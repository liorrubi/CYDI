import { useState } from "react";
import { PEN_COLORS, type PenColorId } from "../app/constants";
import { isColorUnlocked } from "../services/penColorStore";
import { playSelectSound, playToggleSound } from "../engine/soundEngine";

type PenColorMenuProps = {
  selected: PenColorId;
  onSelect: (id: PenColorId) => void;
  onLockedColorClick: (id: PenColorId) => void;
};

/** Button that opens a menu of every pen color, including locked ones - tapping a locked color jumps straight to its shop product. */
export default function PenColorMenu({ selected, onSelect, onLockedColorClick }: PenColorMenuProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = PEN_COLORS.find((c) => c.id === selected) ?? PEN_COLORS[0];

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
        aria-label="Change pen color"
        aria-expanded={open}
      >
        🖊️
      </button>
      {open && (
        <div className="pen-color-dropdown">
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
