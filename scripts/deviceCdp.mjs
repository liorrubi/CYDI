// Minimal Chrome DevTools Protocol driver for CYDI's Android WebView.
// Reused by every Stage 5 device test.
export async function attach(urlPrefix = "https://") {
  const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const page = targets.find((t) => t.url.startsWith(urlPrefix) && !t.url.includes("doubleclick"));
  if (!page) throw new Error(`no target matching ${urlPrefix}. Targets: ${targets.map((t) => t.url).join(", ")}`);

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

  const evaluate = async (expression, timeout = 60000) => {
    const m = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
    if (m.result?.exceptionDetails) {
      throw new Error("page threw: " + JSON.stringify(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails));
    }
    return m.result.result.value;
  };

  return { page, call, evaluate, close: () => ws.close() };
}
