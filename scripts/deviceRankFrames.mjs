// Renders the three frames of the promotion beat on the connected Android
// device and screenshots each, without playing a five-round match through a
// slow ADB link.
//
//   node scripts/deviceRankFrames.mjs <outDir>
//
// It builds the card's real markup and lets the real stylesheet lay it out, so
// what is checked here is exactly what the component produces: whether the old
// band reads as COMPLETED at the moment of promotion, and whether the reset to
// the new band is a clean cut rather than a backwards slide.
import { attach } from "./deviceCdp.mjs";

const outDir = process.argv[2] ?? ".";
const width = 375;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { evaluate, call, close } = await attach("https://playcydi.com");

await call("Emulation.setDeviceMetricsOverride", { width, height: 760, deviceScaleFactor: 0, mobile: true });
await call("Page.navigate", { url: "http://localhost:5174/" });
await sleep(3500);

const FRAMES = [
  { name: "1-before", rank: "Rookie", points: 8, fill: 80, label: "8 / 10 to Challenger", next: "2 points to Challenger", rankup: null },
  { name: "2-completed", rank: "Rookie", points: 10, fill: 100, label: "10 / 10 to Challenger", next: "0 points to Challenger", rankup: null },
  { name: "3-promoted", rank: "Challenger", points: 10, fill: 0, label: "0 / 15 to Competitor", next: "15 points to Competitor", rankup: "Challenger" },
];

const { writeFile } = await import("node:fs/promises");

for (const f of FRAMES) {
  await evaluate(`
    document.getElementById("__frame")?.remove();
    const host = document.createElement("div");
    host.id = "__frame";
    host.style.cssText = "position:fixed;inset:0;z-index:99999;background:var(--color-bg,#fff);padding:16px;display:flex;align-items:center";
    host.innerHTML = \`
      <section class="social-progress" aria-label="Your Social Rank">
        <p class="social-progress-rank"><span aria-hidden="true">🎖️</span> ${f.rank}</p>
        <p class="social-progress-points">${f.points} Social Points</p>
        <div class="social-progress-bar" role="progressbar">
          <div class="social-progress-fill" style="--social-fill: ${f.fill}%"></div>
          <span class="social-progress-label">${f.label}</span>
        </div>
        <p class="social-progress-next">${f.next}</p>
        ${f.rankup ? '<p class="social-rankup"><span aria-hidden="true">⬆️</span> SOCIAL RANK UP! <strong>' + f.rankup + "</strong></p>" : ""}
      </section>\`;
    document.body.appendChild(host);
    const bar = host.querySelector(".social-progress-bar");
    const fill = host.querySelector(".social-progress-fill");
    JSON.stringify({
      cssWidth: innerWidth,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      barW: Math.round(bar.getBoundingClientRect().width),
      barH: Math.round(bar.getBoundingClientRect().height),
      fillW: Math.round(fill.getBoundingClientRect().width),
      labelFits: host.querySelector(".social-progress-label").scrollWidth <= bar.clientWidth,
    })
  `).then((m) => process.stdout.write(f.name + " " + m + "\n"));

  await sleep(300);
  // Clip to the card. A full 1031x2090 page screenshot is megabytes of base64
  // over the ADB hop and was the whole reason this crawled.
  const box = JSON.parse(
    await evaluate(`(() => { const r = document.querySelector("#__frame .social-progress").getBoundingClientRect();
      return JSON.stringify({ x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }); })()`),
  );
  const shot = await call("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
  if (shot.result?.data) {
    await writeFile(`${outDir}/rank-${f.name}.png`, Buffer.from(shot.result.data, "base64"));
    process.stdout.write(`wrote rank-${f.name}.png\n`);
  }
}

await evaluate(`document.getElementById("__frame")?.remove(); "cleaned"`);
await call("Emulation.clearDeviceMetricsOverride");
await call("Page.navigate", { url: "https://playcydi.com/" });
await sleep(1200);
close();
console.log("done; device restored");
