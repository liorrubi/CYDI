import assert from "node:assert/strict";
import test from "node:test";
import { encodeQr, qrToSvgPath } from "./qrEncoder.ts";

// These tests cover the ADAPTER: that a payload becomes a plausible matrix and
// that the matrix becomes the SVG the component draws. They deliberately do
// NOT try to prove the codes are readable.
//
// The previous hand-written encoder passed a far more thorough structural
// suite than this one and still produced codes no scanner could read. Only a
// real decoder settles that question, so it is settled out-of-band instead:
// scripts/verifyQrScan.md records the procedure, which drives CYDI's Android
// WebView and decodes generated codes with Play Services' own barcode engine.
// Current result: 12/12 at 2, 4 and 8 px per module.

const INVITE = "https://playcydi.com/join/TEST77";

test("an invite URL encodes to a compact version 3 symbol", () => {
  const qr = encodeQr(INVITE);
  assert.equal(qr.version, 3);
  assert.equal(qr.size, 29, "version 3 is 29x29");
  assert.equal(qr.modules.length, 29);
  assert.ok(qr.modules.every((row) => row.length === 29));
});

test("the matrix is square and matches its declared size for every room code", () => {
  for (const code of ["TEST77", "ABC234", "9ZKQWX", "MNPRST", "22222 2".replace(" ", "")]) {
    const qr = encodeQr(`https://playcydi.com/join/${code}`);
    assert.equal(qr.size, qr.version * 4 + 17);
    assert.equal(qr.modules.length, qr.size, code);
  }
});

test("finder patterns sit in the three expected corners", () => {
  // A weak check on its own - the old encoder passed this too - but it still
  // catches a matrix that came back transposed or offset.
  const { modules, size } = encodeQr(INVITE);
  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    assert.equal(modules[top][left], true);
    assert.equal(modules[top + 3][left + 3], true, "centre of the finder");
    assert.equal(modules[top + 1][left + 1], false, "inner light ring");
  }
});

test("different room codes produce different matrices", () => {
  const a = encodeQr("https://playcydi.com/join/AAAAAA");
  const b = encodeQr("https://playcydi.com/join/BBBBBB");
  assert.notDeepEqual(a.modules, b.modules);
});

test("encoding is deterministic", () => {
  assert.deepEqual(encodeQr(INVITE).modules, encodeQr(INVITE).modules);
});

test("the dark/light mix is balanced", () => {
  const { modules, size } = encodeQr(INVITE);
  const dark = modules.flat().filter(Boolean).length;
  const ratio = dark / (size * size);
  assert.ok(ratio > 0.3 && ratio < 0.7, `dark ratio ${ratio.toFixed(2)} is implausible`);
});

test("qrToSvgPath emits exactly one square per dark module", () => {
  const qr = encodeQr(INVITE);
  const squares = qrToSvgPath(qr).match(/M\d+ \d+h1v1h-1z/g) ?? [];
  assert.equal(squares.length, qr.modules.flat().filter(Boolean).length);
});

test("qrToSvgPath keeps every square inside the matrix bounds", () => {
  const qr = encodeQr(INVITE);
  for (const match of qrToSvgPath(qr).matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    assert.ok(Number(match[1]) < qr.size);
    assert.ok(Number(match[2]) < qr.size);
  }
});

test("a longer payload grows the symbol rather than failing", () => {
  const long = encodeQr("https://some-much-longer-staging-host.example.com/join/ABC234?ref=test");
  assert.ok(long.version > 3, `expected a larger version, got ${long.version}`);
});
