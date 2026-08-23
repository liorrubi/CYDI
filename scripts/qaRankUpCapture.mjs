// Plays the last round of a Pass & Play match on the device and captures the
// promotion beat as it happens: the frame where the OLD band is full, and the
// frame just after the card flips to the new one.
//
//   node scripts/qaRankUpCapture.mjs <outDir>
import { writeFile } from "node:fs/promises";
import { attach, HELPERS } from "./qaDriver.mjs";

const outDir = process.argv[2] ?? ".";
const { call, evaluate, close } = await attach();
await evaluate(HELPERS);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(name) {
  const box = await evaluate(`(() => {
    const el = document.querySelector(".social-progress");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), width: Math.ceil(r.width), height: Math.ceil(r.height) });
  })()`);
  if (!box) return false;
  const shot = await call("Page.captureScreenshot", { format: "png", clip: { ...JSON.parse(box), scale: 2 } });
  if (!shot.result?.data) return false;
  await writeFile(`${outDir}/rc2-${name}.png`, Buffer.from(shot.result.data, "base64"));
  return true;
}

// Finish the match.
await evaluate(`(async () => {
  const q = window.__qa;
  if (q.btn("Next Round")) { q.btn("Next Round").click(); await q.wait(500); }
  const turn = async () => { if (!q.has("m ready")) return false; q.has("m ready").click(); await q.wait(6600);
    q.draw(); await q.wait(220); const b = q.btn("DONE"); if (b && !b.disabled) b.click(); await q.wait(700); return true; };
  await turn(); await turn();
  return "played";
})()`);

// Watch the card through the promotion.
const frames = [];
let shotHold = false;
let shotFlip = false;
for (let i = 0; i < 90; i++) {
  const snap = await evaluate(`JSON.stringify({ card: window.__qa.card(), badge: window.__qa.badge() })`);
  const { card, badge } = JSON.parse(snap);
  if (card) {
    const key = `${card.points}|${card.fill}|${card.rank}|${card.rankup}|${badge}`;
    if (frames.at(-1)?.key !== key) frames.push({ key, card, badge });

    // The completion hold: old band full, promotion not yet announced.
    if (!shotHold && card.fill === "100%" && !card.rankup) {
      shotHold = await shoot("1-old-band-full");
    }
    // Just after the flip.
    if (!shotFlip && card.rankup) {
      shotFlip = await shoot("2-promoted");
      break;
    }
  }
  await sleep(110);
}

console.log(JSON.stringify({ shotHold, shotFlip, frames: frames.map((f) => ({ pts: f.card.points, fill: f.card.fill, rank: f.card.rank, label: f.card.label, up: f.card.rankup, badge: f.badge })) }, null, 1));
console.log("social:", await evaluate("window.__qa.social()"));
close();
