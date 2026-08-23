// QA driver for the installed CYDI APK.
//
//   adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
//   node scripts/qaDriver.mjs "<expression>"
//
// MIUI refuses adb-synthetic input, so the app is driven through its own
// DevTools socket instead: real DOM events dispatched inside the page, exactly
// as the desktop browser tools do it.
const PORT = process.env.QA_PORT ?? "9333";

async function attach() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.url.startsWith("https://localhost"));
  if (!page) throw new Error(`no CYDI target. Saw: ${targets.map((t) => t.url).join(", ")}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });

  const call = (method, params = {}) =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  const evaluate = async (expression, timeout = 120000) => {
    const m = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
    const ex = m.result?.exceptionDetails;
    if (ex) throw new Error("page threw: " + (ex.exception?.description ?? JSON.stringify(ex)));
    return m.result.result.value;
  };

  return { call, evaluate, close: () => ws.close() };
}

/** Helpers installed into the page once, then reused by every step. */
export const HELPERS = `
window.__qa = {
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  btn: (t) => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === t),
  has: (t) => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes(t)),
  tap: (t) => { const b = window.__qa.btn(t) || window.__qa.has(t); if (!b) throw new Error("no button: " + t); b.click(); return true; },
  setInput: (i, v) => {
    const el = [...document.querySelectorAll(".mp-input")][i];
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },
  draw: (variant) => {
    const c = document.querySelector("canvas");
    if (!c) return false;
    const r = c.getBoundingClientRect();
    const pt = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
    const fire = (t, p) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", isPrimary: true, ...p }));
    const path = variant === "small"
      ? [[0.45, 0.45], [0.55, 0.46], [0.52, 0.55], [0.45, 0.45]]
      : [[0.3, 0.3], [0.7, 0.33], [0.66, 0.7], [0.3, 0.3]];
    fire("pointerdown", pt(...path[0]));
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1], [bx, by] = path[i];
      for (let s = 1; s <= 8; s++) fire("pointermove", pt(ax + (bx - ax) * s / 8, ay + (by - ay) * s / 8));
    }
    fire("pointerup", pt(...path[path.length - 1]));
    return true;
  },
  coach: () => document.querySelector(".mp-coach")?.textContent?.replace("\\u{1F4A1}", "").trim() ?? null,
  text: (n = 420) => document.body.innerText.replace(/\\s*\\n\\s*/g, " | ").slice(0, n),
  rows: () => [...document.querySelectorAll(".mp-lb-row")].map((r) => r.innerText.replace(/\\s+/g, " ").trim()),
  badge: () => document.querySelector(".social-badge")?.textContent ?? null,
  card: () => {
    const c = document.querySelector(".social-progress");
    if (!c) return null;
    return {
      rank: c.querySelector(".social-progress-rank")?.textContent?.trim(),
      points: c.querySelector(".social-progress-points")?.textContent?.trim(),
      label: c.querySelector(".social-progress-label")?.textContent?.trim(),
      fill: c.querySelector(".social-progress-fill")?.style.getPropertyValue("--social-fill"),
      next: c.querySelector(".social-progress-next")?.textContent?.trim(),
      rankup: c.querySelector(".social-rankup")?.textContent?.trim() ?? null,
      intro: c.querySelector(".social-progress-intro")?.textContent?.trim() ?? null,
    };
  },
  social: () => localStorage.getItem("cydi.social.v1"),
  flags: () => Object.keys(localStorage).filter((k) => k.includes("tutorial") || k.includes("coach") || k.includes("intro")).sort(),
  metrics: () => ({ w: innerWidth, dpr: devicePixelRatio, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }),
};
"helpers ready"
`;

export { attach };

if (process.argv[1]?.includes("qaDriver")) {
  const t = await attach();
  await t.evaluate(HELPERS);
  const expr = process.argv[2] ?? "window.__qa.text()";
  console.log(await t.evaluate(expr));
  t.close();
}
