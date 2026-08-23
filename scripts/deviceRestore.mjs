// Clears any emulation override left on the device and puts the borrowed tab back.
import { attach } from "./deviceCdp.mjs";
const t = await attach("http://localhost:5174").catch(() => attach("https://playcydi.com"));
await t.call("Emulation.clearDeviceMetricsOverride");
console.log(await t.evaluate("JSON.stringify({ w: innerWidth, url: location.href, card: !!document.querySelector('.social-progress'), text: document.body.innerText.slice(0,180) })"));
await t.call("Page.navigate", { url: "https://playcydi.com/" });
await new Promise((r) => setTimeout(r, 1500));
t.close();
console.log("override cleared, tab restored");
