// Drives a real Pass & Play match on the connected Android device and reports
// what the Social Rank card actually renders there.
//
//   adb reverse tcp:5174 tcp:5174
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
//   node scripts/deviceSocialRankCheck.mjs <seedPoints>
//
// Borrows the device's existing CYDI tab and puts it back on playcydi.com when
// it finishes, so nothing is left navigated somewhere the owner did not leave it.
import { attach } from "./deviceCdp.mjs";

const seed = Number(process.argv[2] ?? 8);
/** 0 keeps the phone's own CSS width; anything else forces a narrower viewport on the real device. */
const width = Number(process.argv[3] ?? 0);
const shotPath = process.argv[4] ?? null;
const DEV_URL = "http://localhost:5174/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HELPERS = `
  window.__d = {
    btn: (t) => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === t),
    setInput: (i, v) => {
      const el = [...document.querySelectorAll(".mp-input")][i];
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    draw: () => {
      const c = document.querySelector("canvas");
      if (!c) return false;
      const r = c.getBoundingClientRect();
      const pt = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
      const fire = (t, p) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", isPrimary: true, ...p }));
      const path = [[0.3, 0.3], [0.7, 0.33], [0.66, 0.7], [0.3, 0.3]];
      fire("pointerdown", pt(...path[0]));
      for (let i = 1; i < path.length; i++) {
        const [ax, ay] = path[i - 1], [bx, by] = path[i];
        for (let s = 1; s <= 8; s++) fire("pointermove", pt(ax + (bx - ax) * s / 8, ay + (by - ay) * s / 8));
      }
      fire("pointerup", pt(...path[path.length - 1]));
      return true;
    },
    card: () => {
      const c = document.querySelector(".social-progress");
      if (!c) return null;
      const bar = c.querySelector(".social-progress-bar");
      const br = bar.getBoundingClientRect();
      return {
        rank: c.querySelector(".social-progress-rank")?.textContent?.trim(),
        points: c.querySelector(".social-progress-points")?.textContent?.trim(),
        label: c.querySelector(".social-progress-label")?.textContent?.trim(),
        fill: c.querySelector(".social-progress-fill")?.style.getPropertyValue("--social-fill"),
        next: c.querySelector(".social-progress-next")?.textContent?.trim(),
        rankup: c.querySelector(".social-rankup")?.textContent?.trim() ?? null,
        aria: bar.getAttribute("aria-valuetext"),
        barW: Math.round(br.width), barH: Math.round(br.height),
      };
    },
    badge: () => document.querySelector(".social-badge")?.textContent ?? null,
    metrics: () => ({
      cssWidth: window.innerWidth,
      dpr: window.devicePixelRatio,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }),
  };
  "ok"
`;

const { evaluate, call, close } = await attach("https://playcydi.com");

if (width) {
  // Force a narrow CSS viewport on the real device, so the layout is checked at
  // the widths that matter rather than only at this phone's 392.
  await call("Emulation.setDeviceMetricsOverride", { width, height: 760, deviceScaleFactor: 0, mobile: true });
  console.log("emulating", width, "CSS px on the device");
}

console.log("navigating the device tab to the dev build...");
await call("Page.navigate", { url: DEV_URL });
await sleep(3500);

await evaluate(`
  localStorage.clear();
  localStorage.setItem("cydi.social.v1", JSON.stringify({ total: ${seed}, awarded: [] }));
  localStorage.setItem("cydi.mp.tutorial.passplay.v1", "1");
  localStorage.setItem("cydi.mp.coach.passplay.v1", "1");
  location.href = ${JSON.stringify(DEV_URL)};
  "seeded"
`);
await sleep(3500);
await evaluate(HELPERS);

console.log("device metrics:", await evaluate("JSON.stringify(window.__d.metrics())"));

await evaluate(`window.__d.btn("2 Players").click(); "go"`);
await sleep(700);
console.log("badge before match:", await evaluate("window.__d.badge()"));
await evaluate(`window.__d.setInput(0, "Maya"); window.__d.setInput(1, "Tom"); window.__d.btn("5").click(); "set"`);
await sleep(300);
await evaluate(`window.__d.btn("Start Game").click(); "started"`);
await sleep(600);

// Ten turns: five rounds, two players.
for (let turn = 0; turn < 10; turn++) {
  // One round trip instead of three: clear any results screen and start the
  // next turn in a single evaluate. The ADB hop, not the game, is the cost here.
  const started = await evaluate(`(() => {
    const next = window.__d.btn("Next Round");
    if (next) { next.click(); return "next"; }
    const ready = window.__d.btn("I'm ready");
    if (ready) { ready.click(); return "ready"; }
    return "wait";
  })()`);
  if (started !== "ready") {
    await sleep(started === "next" ? 500 : 1200);
    turn--;
    continue;
  }
  await sleep(6600);
  // The draw and the DONE must be separate: React enables the button from the
  // canvas onChange, so clicking in the same evaluate finds it still disabled
  // and the turn falls through to the 20-second timeout instead.
  await evaluate(`window.__d.draw(); "drew"`);
  await sleep(220);
  await evaluate(`(() => { const b = window.__d.btn("DONE"); if (b && !b.disabled) b.click(); return "done"; })()`);
  await sleep(550);
  process.stdout.write(".");
}
console.log("");

// Sample the card as it counts up, then let it settle.
await sleep(2600);
const frames = [];
for (let i = 0; i < 16; i++) {
  // One round trip per sample: two was doubling an already slow ADB hop and
  // stretching the loop past the point where the tween had long finished.
  const snap = await evaluate('JSON.stringify({ card: window.__d.card(), badge: window.__d.badge(), metrics: window.__d.metrics() })');
  const parsed = JSON.parse(snap);
  if (parsed.card) frames.push({ card: parsed.card, badge: parsed.badge, metrics: parsed.metrics });
  await sleep(90);
}

const seen = [];
let prev = "";
for (const f of frames) {
  const key = f.card.points + "|" + f.card.fill + "|" + f.card.rankup + "|" + f.badge;
  if (key !== prev) {
    seen.push(f);
    prev = key;
  }
}

console.log("\ndistinct card/badge states observed on device:");
for (const f of seen) console.log(" ", JSON.stringify(f));
console.log("\nstored:", await evaluate(`localStorage.getItem("cydi.social.v1")`));

if (shotPath) {
  const shot = await call("Page.captureScreenshot", { format: "png" });
  const data = shot.result?.data;
  if (data) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(shotPath, Buffer.from(data, "base64"));
    console.log("screenshot:", shotPath);
  }
}

if (width) await call("Emulation.clearDeviceMetricsOverride");

console.log("\nrestoring the tab to playcydi.com");
await call("Page.navigate", { url: "https://playcydi.com/" });
await sleep(1500);
close();
