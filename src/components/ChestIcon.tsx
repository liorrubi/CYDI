import { useId } from "react";
import type { ChestTierId } from "../app/constants";

export type ChestIconTier = "wood" | ChestTierId;

type ChestPalette = {
  base: string;
  light: string;
  dark: string;
  strap: string;
  strapDark: string;
  rivet: string;
};

const PALETTES: Record<ChestIconTier, ChestPalette> = {
  wood: { base: "#a9743e", light: "#cb9a60", dark: "#6d4418", strap: "#7c6a54", strapDark: "#4c3a28", rivet: "#d8c39a" },
  iron: { base: "#565b66", light: "#8b91a0", dark: "#2c2f37", strap: "#33363f", strapDark: "#1c1e24", rivet: "#b6bcc8" },
  copper: { base: "#c96a2f", light: "#f2a267", dark: "#82400f", strap: "#8a4614", strapDark: "#5e2e0a", rivet: "#ffd3a6" },
  silver: { base: "#c4cbd8", light: "#ffffff", dark: "#8a93a5", strap: "#aab2c1", strapDark: "#7a8394", rivet: "#ffffff" },
  gold: { base: "#f2b307", light: "#ffe680", dark: "#b07800", strap: "#d99400", strapDark: "#9c6b00", rivet: "#fff3bf" },
  platinum: { base: "#c3e8f0", light: "#ffffff", dark: "#7cc2cf", strap: "#8ccdd9", strapDark: "#4f9aa8", rivet: "#ffffff" },
};

/** Which lid outline a tier uses — the biggest cue that the tiers differ at a glance. */
type LidStyle = "flat" | "flat-square" | "arch" | "dome";

const LID_STYLE: Record<ChestIconTier, LidStyle> = {
  wood: "flat",
  iron: "flat-square",
  copper: "arch",
  silver: "arch",
  gold: "dome",
  platinum: "dome",
};

/** Rounded-corner box that sits under every lid style. */
const BODY_PATH = "M8 28 H56 V52 Q56 56 52 56 H12 Q8 56 8 52 Z";

const LID_PATHS: Record<LidStyle, string> = {
  flat: "M5 28 V17 Q5 12 10 12 H54 Q59 12 59 17 V28 Z",
  "flat-square": "M4.5 28 V15 Q4.5 12.5 7 12.5 H57 Q59.5 12.5 59.5 15 V28 Z",
  arch: "M5 28 V22 Q5 11 32 11 Q59 11 59 22 V28 Z",
  dome: "M5 28 V21 Q5 7 32 7 Q59 7 59 21 V28 Z",
};

function sparklePoints(cx: number, cy: number, r: number): string {
  const q = r * 0.26;
  return `${cx},${cy - r} ${cx + q},${cy - q} ${cx + r},${cy} ${cx + q},${cy + q} ${cx},${cy + r} ${cx - q},${cy + q} ${cx - r},${cy} ${cx - q},${cy - q}`;
}

type ChestIconProps = {
  tier: ChestIconTier;
  /** Rendered width in px; height keeps the chest's aspect ratio. */
  size?: number;
};

/**
 * Tier-specific treasure-chest artwork used everywhere a chest appears (shop list, header
 * daily-chest shortcut, reward overlay). Each tier is deliberately distinct — different lid
 * shape, hardware and emblem — so the player reads the tier from the silhouette alone before
 * the colour even registers: a plain wooden crate, a heavy riveted iron box, a warm banded
 * copper chest, a sleek silver one, an ornate gold chest with a star emblem, and a crowned
 * platinum chest with a mounted gem and animated shine.
 */
export default function ChestIcon({ tier, size = 44 }: ChestIconProps) {
  const clipId = useId();
  const p = PALETTES[tier];
  const lidPath = LID_PATHS[LID_STYLE[tier]];

  return (
    <svg
      className={`chest-icon chest-icon-${tier}`}
      width={size}
      height={size * (60 / 64)}
      viewBox="0 0 64 60"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <path d={BODY_PATH} />
          <path d={lidPath} />
        </clipPath>
      </defs>

      {/* Crowns / gems that sit ABOVE the lid must be drawn first so the lid overlaps their base. */}
      {tier === "gold" && (
        <g fill={p.light} stroke={p.strapDark} strokeWidth="1" strokeLinejoin="round">
          <polygon points="24,10 27,4 30,9 32,3 34,9 37,4 40,10" />
        </g>
      )}
      {tier === "platinum" && (
        <g className="chest-gem-mount">
          {/* Pulsing radiant halo behind the mounted gem. */}
          <circle className="chest-gem-halo" cx="32" cy="7" r="9" fill="#bff3ff" />
          {/* Prominent faceted brilliant-cut gem crowning the chest. */}
          <g className="chest-gem">
            <polygon points="24.5,4.5 39.5,4.5 32,15 " fill="#7fd8ea" />
            <polygon points="24.5,4.5 32,4.5 32,15 " fill="#b6ecf7" />
            <polygon points="24.5,4.5 28,1 36,1 39.5,4.5 " fill="#eafcff" />
            <polygon points="28,1 32,4.5 32,1 " fill="#ffffff" />
            <polygon points="32,1 32,4.5 36,1 " fill="#d4f4fb" />
            <polygon points="24.5,4.5 39.5,4.5 32,15 " fill="none" stroke="#4f9aa8" strokeWidth="0.8" strokeLinejoin="round" />
            <polygon points="24.5,4.5 28,1 36,1 39.5,4.5 " fill="none" stroke="#4f9aa8" strokeWidth="0.8" strokeLinejoin="round" />
            <line x1="28" y1="1" x2="32" y2="4.5" stroke="#8fcdd9" strokeWidth="0.6" />
            <line x1="36" y1="1" x2="32" y2="4.5" stroke="#8fcdd9" strokeWidth="0.6" />
            {/* Glint travelling across the gem's top facet. */}
            <polygon className="chest-gem-glint" points="26,4 30,4 28.5,1.5 " fill="#ffffff" />
          </g>
        </g>
      )}

      {/* ---- LID ---- */}
      <path d={lidPath} fill={p.base} />
      <g clipPath={`url(#${clipId})`}>
        <rect x="0" y="7" width="64" height="12" fill={p.light} opacity="0.4" />
        {/* Wood: vertical plank seams on the lid. */}
        {tier === "wood" && (
          <g stroke={p.dark} strokeWidth="1.3" opacity="0.5">
            <line x1="20" y1="12" x2="20" y2="28" />
            <line x1="44" y1="12" x2="44" y2="28" />
          </g>
        )}
        {/* Copper: warm highlight sweep across the domed lid. */}
        {tier === "copper" && (
          <polygon points="10,28 18,11 26,11 16,28" fill="#ffd9b0" opacity="0.45" />
        )}
        {/* Silver: cold diagonal sheen. */}
        {tier === "silver" && (
          <polygon points="12,28 22,11 30,11 20,28" fill="#ffffff" opacity="0.55" />
        )}
        {/* Gold + platinum: moving specular streak. */}
        {(tier === "gold" || tier === "platinum") && (
          <g transform="rotate(22 32 20)">
            <rect className="chest-icon-shine" x="-6" y="-6" width="8" height="46" fill="#ffffff" />
          </g>
        )}
      </g>

      {/* ---- SEAM BAND between lid and body ---- */}
      <rect x="4" y="25.5" width="56" height="5.5" rx="2.5" fill={p.strap} stroke={p.strapDark} strokeWidth="1.2" />

      {/* ---- BODY ---- */}
      <path d={BODY_PATH} fill={p.base} />
      <g clipPath={`url(#${clipId})`}>
        <rect x="0" y="48" width="64" height="10" fill={p.dark} opacity="0.32" />

        {/* Wood: plank seams + a single simple horizontal band. */}
        {tier === "wood" && (
          <g stroke={p.dark} strokeWidth="1.3" opacity="0.5">
            <line x1="20" y1="31" x2="20" y2="56" />
            <line x1="44" y1="31" x2="44" y2="56" />
            <line x1="8" y1="44" x2="56" y2="44" />
          </g>
        )}

        {/* Iron: two heavy horizontal reinforcement straps with rivets. */}
        {tier === "iron" && (
          <g>
            {[37, 49].map((y) => (
              <g key={y}>
                <rect x="8" y={y - 2.5} width="48" height="5" fill={p.strap} />
                {[14, 26, 38, 50].map((x) => (
                  <circle key={x} cx={x} cy={y} r="1.5" fill={p.rivet} />
                ))}
              </g>
            ))}
          </g>
        )}

        {/* Copper: two banded straps with warm rivets. */}
        {tier === "copper" && (
          <g>
            {[38, 49].map((y) => (
              <g key={y}>
                <rect x="8" y={y - 2} width="48" height="4" fill={p.strap} opacity="0.9" />
                {[15, 32, 49].map((x) => (
                  <circle key={x} cx={x} cy={y} r="1.4" fill={p.rivet} />
                ))}
              </g>
            ))}
          </g>
        )}

        {/* Silver: single slim strap, clean look. */}
        {tier === "silver" && <rect x="8" y="45" width="48" height="3" fill={p.strap} opacity="0.85" />}
      </g>

      {/* Iron: chunky corner brackets that make it read as heavy. */}
      {tier === "iron" && (
        <g fill={p.strapDark}>
          <path d="M8 34 V29 H14 V32 H11 V34 Z" />
          <path d="M56 34 V29 H50 V32 H53 V34 Z" />
          <path d="M8 50 V56 H14 V53 H11 V50 Z" />
          <path d="M56 50 V56 H50 V53 H53 V50 Z" />
        </g>
      )}

      {/* ---- OUTLINES ---- */}
      <path d={BODY_PATH} fill="none" stroke={p.strapDark} strokeWidth="2" />
      <path d={lidPath} fill="none" stroke={p.strapDark} strokeWidth="2" />

      {/* ---- VERTICAL CENTRE STRAP + LOCK ---- */}
      <rect x="28.5" y={LID_STYLE[tier] === "dome" ? 9 : 12} width="7" height="47" fill={p.strap} opacity="0.9" />
      <rect x="26" y="22.5" width="12" height="13" rx="2.5" fill={p.light} stroke={p.strapDark} strokeWidth="1.3" />

      {/* Gold gets an embossed star emblem on the lock; others get a plain keyhole. */}
      {tier === "gold" ? (
        <polygon
          points="32,25.5 33,28.4 36,28.5 33.6,30.3 34.4,33.2 32,31.4 29.6,33.2 30.4,30.3 28,28.5 31,28.4"
          fill={p.strap}
          stroke={p.strapDark}
          strokeWidth="0.6"
        />
      ) : tier === "platinum" ? (
        <polygon points="32,25.5 35.5,29 32,32.5 28.5,29" fill="#eafcff" stroke="#5fb3c2" strokeWidth="1" strokeLinejoin="round" />
      ) : (
        <>
          <circle cx="32" cy="27.5" r="1.9" fill={p.strapDark} />
          <rect x="31" y="28" width="2" height="4.5" rx="1" fill={p.strapDark} />
        </>
      )}

      {/* Platinum: twinkling sparkles for the premium feel. */}
      {tier === "platinum" && (
        <g fill="#ffffff">
          <polygon className="chest-icon-sparkle" points={sparklePoints(11, 22, 4.5)} />
          <polygon className="chest-icon-sparkle chest-icon-sparkle-delayed" points={sparklePoints(54, 26, 3.4)} />
          <polygon className="chest-icon-sparkle chest-icon-sparkle-delayed" points={sparklePoints(46, 14, 2.8)} />
        </g>
      )}
    </svg>
  );
}
