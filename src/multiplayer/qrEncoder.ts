/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// QR generation for the Play Together invite link.
//
// HISTORY, because it matters for anyone tempted to shrink this again: Stage 4
// shipped a hand-written encoder here. It passed a thorough unit suite - the
// Reed-Solomon codewords had the right roots, the BCH format bits were valid
// with the right minimum Hamming distance, the capacity table matched the
// published one, and every finder/timing/alignment pattern was in place - and
// it still produced codes that NO scanner could read. Play Services' barcode
// engine on a real phone decoded 0 of 12 of them. Structural tests cannot tell
// you a QR code is readable; only a decoder can.
//
// So this is now a thin adapter over qrcode-generator (Kazuhiko Arase, MIT):
// zero dependencies, 128 KB on disk, bundled TypeScript types, and about two
// decades of production use. The same phone decodes 12 of 12 from it.
//
// The rendering side is unchanged - callers still get a module matrix and an
// SVG path, so QrCode.tsx did not have to change.
import qrcode from "qrcode-generator";

export type QrMatrix = {
  /** size x size booleans; true is a dark module. */
  modules: boolean[][];
  size: number;
  version: number;
};

// Level M: ~15% of the symbol can be damaged or obscured and still read. The
// step up to Q buys resilience we do not need for a code shown on a clean
// screen, at the cost of a denser symbol.
const ERROR_CORRECTION = "M" as const;
// 0 asks the library to pick the smallest version that fits the payload. An
// invite URL is ~32 characters, which lands at version 3 (29x29).
const AUTO_VERSION = 0 as const;

export function encodeQr(text: string): QrMatrix {
  const qr = qrcode(AUTO_VERSION, ERROR_CORRECTION);
  qr.addData(text);
  qr.make();

  const size = qr.getModuleCount();
  const modules: boolean[][] = [];
  for (let row = 0; row < size; row++) {
    const line: boolean[] = [];
    for (let col = 0; col < size; col++) line.push(qr.isDark(row, col));
    modules.push(line);
  }

  // Versions are 21x21 at v1 and grow by 4 modules per version.
  return { modules, size, version: (size - 17) / 4 };
}

/** Renders a matrix as a single SVG path string - one 1x1 square per dark module, in module coordinates. */
export function qrToSvgPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (matrix.modules[r][c]) parts.push(`M${c} ${r}h1v1h-1z`);
    }
  }
  return parts.join("");
}
