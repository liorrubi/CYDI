import { useMemo } from "react";
import { encodeQr, qrToSvgPath } from "../../multiplayer/qrEncoder";

type QrCodeProps = {
  /** The text to encode - for Play Together, the full invite URL. */
  value: string;
  /** Rendered edge length in CSS pixels. */
  size?: number;
  /** Accessible description; the code itself is decorative to a screen reader, which cannot use it. */
  label?: string;
};

// The spec requires a light margin of at least 4 modules for a scanner to
// find the symbol against the surrounding page.
const QUIET_ZONE_MODULES = 4;

/**
 * A self-contained QR code, rendered as inline SVG.
 *
 * Colours are hard-coded dark-on-white rather than themed: a scanner needs
 * real contrast and, on a dark-theme phone, a "dark grey on near-black" code
 * simply will not read. The white plate is part of the code, not decoration.
 */
export default function QrCode({ value, size = 176, label }: QrCodeProps) {
  const path = useMemo(() => {
    try {
      const matrix = encodeQr(value);
      return { d: qrToSvgPath(matrix), modules: matrix.size };
    } catch {
      // Only reachable if the payload outgrows the supported versions; the
      // room code beside it is the real fallback either way.
      return null;
    }
  }, [value]);

  if (!path) return null;

  const total = path.modules + QUIET_ZONE_MODULES * 2;

  return (
    <svg
      className="mp-qr"
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      role="img"
      aria-label={label ?? "QR code for the invite link"}
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <g transform={`translate(${QUIET_ZONE_MODULES} ${QUIET_ZONE_MODULES})`}>
        <path d={path.d} fill="#101322" />
      </g>
    </svg>
  );
}
