import { useId } from "react";
import type { PenSkinId } from "../app/constants";

// Cosmetic pen artwork, shared by the drawing-canvas overlay and the shop cards
// so a skin looks identical wherever it appears. Purely visual - the glyph
// never touches stroke points or scoring.
//
// Every skin is drawn upright in a 0..44 viewBox with its writing tip fixed at
// (22, 40). The canvas overlay rotates the whole group -40deg around (22, 22);
// the fixed tip keeps DrawingCanvas's PEN_TIP_X / PEN_TIP_Y alignment valid for
// every skin, so no matter which pen is equipped the nib sits on the exact spot
// the player is drawing.

type PenSkinGlyphProps = {
  skin: PenSkinId;
  /** Ink color of the drawn line; the nib is tinted to match so the pen reads as the pen that made the stroke. */
  inkColor: string;
  /** Canvas overlay tilts the pen; the upright form is used for shop/menu icons. */
  rotate?: boolean;
};

/** The ink-colored writing tip, shared by every skin so the drawn line always appears to flow from the nib. */
function Nib({ inkColor }: { inkColor: string }) {
  return <path d="M17.5 31 H26.5 L22 40 Z" fill={inkColor} />;
}

const METAL_COLLAR = <rect x="16.5" y="27" width="11" height="4" rx="1.5" fill="#c7ccd8" />;

export default function PenSkinGlyph({ skin, inkColor, rotate = false }: PenSkinGlyphProps) {
  // Namespace gradient ids per instance so multiple pens on one page (shop grid)
  // never collide on a shared url(#id) reference.
  const uid = useId().replace(/:/g, "");
  const g = (name: string) => `${skin}-${name}-${uid}`;

  let body: React.ReactNode;

  switch (skin) {
    case "improvedPencil":
      body = (
        <>
          <defs>
            <linearGradient id={g("barrel")} x1="16" y1="0" x2="28" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#5ea0f2" />
              <stop offset="1" stopColor="#2f6fd6" />
            </linearGradient>
          </defs>
          <rect x="16" y="3" width="12" height="5" rx="2" fill="#1f2a44" />
          <rect x="26.4" y="4" width="1.9" height="9" rx="0.9" fill="#cfd6e6" />
          <rect x="16" y="8" width="12" height="19" fill={`url(#${g("barrel")})`} />
          <rect x="18" y="9" width="2.1" height="17" rx="1" fill="rgba(255,255,255,0.4)" />
          {METAL_COLLAR}
          <circle cx="19" cy="24.2" r="0.9" fill="rgba(255,255,255,0.5)" />
          <circle cx="22" cy="24.2" r="0.9" fill="rgba(255,255,255,0.5)" />
          <circle cx="25" cy="24.2" r="0.9" fill="rgba(255,255,255,0.5)" />
          <Nib inkColor={inkColor} />
        </>
      );
      break;

    case "magicPencil":
      body = (
        <>
          <defs>
            <linearGradient id={g("barrel")} x1="16" y1="4" x2="28" y2="27" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#c07cf2" />
              <stop offset="1" stopColor="#7b3fd0" />
            </linearGradient>
          </defs>
          <rect x="16" y="6" width="12" height="21" rx="3" fill={`url(#${g("barrel")})`} />
          <rect x="18.3" y="8" width="2.2" height="18" rx="1.1" fill="rgba(255,255,255,0.4)" />
          {METAL_COLLAR}
          {/* sparkle on the barrel top */}
          <path d="M22 2.5 L23 5.5 L26 6.5 L23 7.5 L22 10.5 L21 7.5 L18 6.5 L21 5.5 Z" fill="#fff2b0" />
          <Nib inkColor={inkColor} />
        </>
      );
      break;

    case "goldenPencil":
      body = (
        <>
          <defs>
            <linearGradient id={g("barrel")} x1="16" y1="0" x2="28" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff0be" />
              <stop offset="0.5" stopColor="#f2c14a" />
              <stop offset="1" stopColor="#cf982a" />
            </linearGradient>
          </defs>
          <rect x="16" y="3.5" width="12" height="4.5" rx="2" fill="#b8801f" />
          <rect x="16" y="8" width="12" height="19" fill={`url(#${g("barrel")})`} />
          <rect x="18.2" y="9" width="1.8" height="17" rx="0.9" fill="rgba(255,255,255,0.6)" />
          <rect x="16.5" y="27" width="11" height="4" rx="1.5" fill="#e0a52a" />
          <Nib inkColor={inkColor} />
        </>
      );
      break;

    case "rainbowPencil":
      body = (
        <>
          <defs>
            <linearGradient id={g("barrel")} x1="0" y1="6" x2="0" y2="27" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#f43f5e" />
              <stop offset="0.25" stopColor="#f59e0b" />
              <stop offset="0.5" stopColor="#22c55e" />
              <stop offset="0.75" stopColor="#3b82f6" />
              <stop offset="1" stopColor="#a855f7" />
            </linearGradient>
          </defs>
          <rect x="16" y="3.5" width="12" height="4" rx="2" fill="#f5f6fa" />
          <rect x="16" y="7.5" width="12" height="19.5" rx="1.5" fill={`url(#${g("barrel")})`} />
          <rect x="18.2" y="9" width="1.8" height="16.5" rx="0.9" fill="rgba(255,255,255,0.35)" />
          {METAL_COLLAR}
          <Nib inkColor={inkColor} />
        </>
      );
      break;

    case "royalQuill":
      body = (
        <>
          <defs>
            <linearGradient id={g("feather")} x1="16" y1="4" x2="28" y2="26" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#e7d6f7" />
            </linearGradient>
          </defs>
          {/* feather plume */}
          <path d="M22 2 C30 9 30 21 25 26 L19 26 C14 21 14 9 22 2 Z" fill={`url(#${g("feather")})`} stroke="#c9a9e8" strokeWidth="0.6" />
          {/* rachis + barbs */}
          <path d="M22 3.5 L22 26" stroke="#b892dd" strokeWidth="0.7" fill="none" />
          <path d="M22 8 L18 11 M22 8 L26 11 M22 13 L17.5 16 M22 13 L26.5 16 M22 18 L18 21 M22 18 L26 21" stroke="#cbb4e6" strokeWidth="0.5" fill="none" />
          {/* gold band */}
          <rect x="17" y="26" width="10" height="4" rx="1.2" fill="#e6b422" />
          <rect x="17" y="27" width="10" height="1" fill="rgba(255,255,255,0.5)" />
          <Nib inkColor={inkColor} />
        </>
      );
      break;

    case "galaxyPen":
      body = (
        <>
          <defs>
            <linearGradient id={g("barrel")} x1="16" y1="4" x2="28" y2="27" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#4a2f8f" />
              <stop offset="0.5" stopColor="#241a52" />
              <stop offset="1" stopColor="#120d2e" />
            </linearGradient>
            <radialGradient id={g("glow")} cx="0.35" cy="0.3" r="0.75">
              <stop offset="0" stopColor="#6d5cff" stopOpacity="0.65" />
              <stop offset="1" stopColor="#6d5cff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x="16" y="3.5" width="12" height="4" rx="2" fill="#cdd3e6" />
          <rect x="16" y="7.5" width="12" height="19.5" rx="2.5" fill={`url(#${g("barrel")})`} />
          <rect x="16" y="7.5" width="12" height="19.5" rx="2.5" fill={`url(#${g("glow")})`} />
          {/* tiny stars */}
          <circle cx="19" cy="11" r="0.7" fill="#fff" />
          <circle cx="24.5" cy="14" r="0.5" fill="#fff" />
          <circle cx="20.5" cy="18" r="0.6" fill="#cfe3ff" />
          <circle cx="25" cy="22" r="0.5" fill="#fff" />
          <circle cx="18.5" cy="23.5" r="0.45" fill="#fff" />
          <rect x="16.5" y="27" width="11" height="4" rx="1.5" fill="#cdd3e6" />
          <Nib inkColor={inkColor} />
        </>
      );
      break;

    // basicPencil (and any unknown id) → classic yellow pencil
    default:
      body = (
        <>
          <rect x="16.5" y="1" width="11" height="3.4" rx="1.4" fill="#f2939b" />
          <rect x="16" y="4.2" width="12" height="3.4" fill="#cfd3dd" />
          <rect x="16" y="5" width="12" height="0.7" fill="#a9aebd" />
          <rect x="16" y="7.6" width="12" height="19.4" fill="#f6c945" />
          <rect x="18" y="8.6" width="2.2" height="18" rx="1.1" fill="rgba(255,255,255,0.4)" />
          <rect x="16.5" y="27" width="11" height="4" rx="1" fill="#e2b877" />
          <Nib inkColor={inkColor} />
        </>
      );
  }

  return <g transform={rotate ? "rotate(-40 22 22)" : undefined}>{body}</g>;
}
