import { useState } from "react";
import { PEN_SKINS, type PenSkinId } from "../app/constants";
import { isSkinUnlocked } from "../services/penSkinStore";
import { playSelectSound, playToggleSound } from "../engine/soundEngine";
import { useDialogA11y } from "../hooks/useDialogA11y";
import PenSkinGlyph from "./PenSkinGlyph";

type PenSkinMenuProps = {
  selected: PenSkinId;
  /** Ink color to tint each pen preview's nib with, so the picker shows what the equipped pen actually looks like drawing. */
  inkColor: string;
  onSelect: (id: PenSkinId) => void;
  onLockedSkinClick: (id: PenSkinId) => void;
};

/**
 * Button that opens a menu of every pen skin (cosmetic pen appearance), including
 * locked ones - tapping a locked skin jumps to the shop's Drawing Pens section.
 * Its trigger shows an upright illustration of the actual equipped pen on a
 * neutral surface - deliberately un-tinted, so it reads as "this changes which
 * pen you draw with" as opposed to PenColorMenu's ink-tinted "change ink color"
 * trigger sitting right next to it.
 */
export default function PenSkinMenu({ selected, inkColor, onSelect, onLockedSkinClick }: PenSkinMenuProps) {
  const [open, setOpen] = useState(false);
  // Not a full trap: the dropdown is a lightweight disclosure of plain buttons, so Tab
  // should still be free to move on through the page as usual - only Escape and the
  // initial focus placement are handled here.
  const dropdownRef = useDialogA11y<HTMLDivElement>(open, { onClose: () => setOpen(false), trapFocus: false });

  return (
    <div className="pen-skin-menu">
      <button
        type="button"
        className="pen-skin-trigger"
        onClick={() => {
          playToggleSound();
          setOpen((isOpen) => !isOpen);
        }}
        aria-label="Change pen style"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg width="26" height="26" viewBox="0 0 44 44" fill="none">
          <PenSkinGlyph skin={selected} inkColor={inkColor} />
        </svg>
      </button>
      {open && (
        <div ref={dropdownRef} className="pen-skin-dropdown">
          {PEN_SKINS.map((skin) => {
            const unlocked = isSkinUnlocked(skin.id);
            const classes = ["pen-skin-option"];
            if (skin.id === selected) classes.push("pen-skin-option-selected");
            if (!unlocked) classes.push("pen-skin-option-locked");
            return (
              <button
                key={skin.id}
                type="button"
                className={classes.join(" ")}
                aria-label={unlocked ? skin.name : `${skin.name} (locked)`}
                onClick={() => {
                  if (!unlocked) {
                    onLockedSkinClick(skin.id);
                    setOpen(false);
                    return;
                  }
                  playSelectSound();
                  onSelect(skin.id);
                  setOpen(false);
                }}
              >
                <span className="pen-skin-option-icon">
                  <svg width="22" height="22" viewBox="0 0 44 44" fill="none">
                    <PenSkinGlyph skin={skin.id} inkColor={inkColor} />
                  </svg>
                </span>
                <span className="pen-skin-option-name">{skin.name}</span>
                {!unlocked && (
                  <span className="pen-skin-option-lock" aria-hidden="true">
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
