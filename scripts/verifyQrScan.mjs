/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Proves that the invite QR codes CYDI generates are actually READABLE, using a
// real phone rather than a unit test.
//
// Why this exists: a hand-written encoder once passed a thorough structural
// suite (valid Reed-Solomon, valid BCH format bits, correct finder/timing
// patterns, correct capacity table) and still produced codes that decoded 0 of
// 12 times. Structure is not readability. This script is the only check that
// actually answers the question.
//
// It renders each code to a canvas inside CYDI's Android WebView and decodes it
// with the BarcodeDetector API, which on Android is backed by Google Play
// Services' own barcode engine - an implementation that knows nothing about the
// generator, so agreement is real evidence.
//
// Usage:
//   1. Connect the test device and launch CYDI (the debug build exposes a
//      DevTools socket - see CLAUDE.md).
//   2. adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
//   3. node scripts/verifyQrScan.mjs
import qrcode from "qrcode-generator";
import { attach } from "./deviceCdp.mjs";

const PAYLOADS = [
  "https://playcydi.com/join/TEST77",
  "https://playcydi.com/join/ABC234",
  "https://playcydi.com/join/9ZKQWX",
  "https://playcydi.com/join/MNPRST",
];

// 8 px/module is roughly how the lobby renders it; 2 px/module stands in for a
// camera reading it small or from a distance.
const SCALES = [8, 4, 2];

function matrixFor(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const modules = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push(qr.isDark(r, c) ? 1 : 0);
    modules.push(row);
  }
  return { text, size, version: (size - 17) / 4, modules };
}

const cases = PAYLOADS.map(matrixFor);
const device = await attach("https://localhost");

const script = `(async () => {
  if (typeof BarcodeDetector === "undefined") return JSON.stringify({ unsupported: true });
  const cases = ${JSON.stringify(cases)};
  const scales = ${JSON.stringify(SCALES)};
  const QUIET = 4;
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  const results = [];
  for (const c of cases) {
    for (const scale of scales) {
      const total = (c.size + QUIET * 2) * scale;
      const canvas = document.createElement("canvas");
      canvas.width = total; canvas.height = total;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, total, total);
      ctx.fillStyle = "#101322";
      for (let r = 0; r < c.size; r++)
        for (let col = 0; col < c.size; col++)
          if (c.modules[r][col]) ctx.fillRect((col + QUIET) * scale, (r + QUIET) * scale, scale, scale);
      let decoded = null, error = null;
      try {
        const found = await detector.detect(canvas);
        decoded = found.length ? found[0].rawValue : null;
      } catch (e) { error = e.message; }
      results.push({ expected: c.text, version: c.version, pxPerModule: scale, sizePx: total, decoded, ok: decoded === c.text, error });
    }
  }
  return JSON.stringify({ results });
})()`;

const payload = JSON.parse(await device.evaluate(script));
device.close();

if (payload.unsupported) {
  console.error("This device's WebView has no BarcodeDetector - cannot verify here.");
  process.exit(2);
}

let pass = 0;
for (const r of payload.results) {
  if (r.ok) pass++;
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  v${r.version} @${r.pxPerModule}px/module (${r.sizePx}px)  ${r.expected}` +
      (r.ok ? "" : `  -> decoded=${JSON.stringify(r.decoded)}${r.error ? " " + r.error : ""}`),
  );
}
console.log(`\n${pass}/${payload.results.length} decoded correctly by the device`);
process.exit(pass === payload.results.length ? 0 : 1);
