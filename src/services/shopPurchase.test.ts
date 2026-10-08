// 0.58.0: a Trial ink's Shop purchase states that ink's Trial history (`inkTrialBefore`: none | active | ended) on the
// existing shop_purchase_with_coins row, read before the purchase closes the Trial. Runs the REAL coin, save, pen
// colour and Ink Trial stores against an in-memory localStorage and captures what trackEvent would send.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
(globalThis as Record<string, unknown>).window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true, setTimeout, clearTimeout };
store.set("cydi.analyticsDebug.v1", "1"); // analytics is dev-gated; the flag turns it on under node

const { registerAnalyticsProvider } = await import("./analytics.ts");
const { validateEventParams } = await import("./analyticsSchema.ts");
const { updateSaveData, replaceSaveData } = await import("./saveStore.ts");
const { createDefaultSaveData } = await import("./saveData.ts");
const { purchasePenColor } = await import("./shopPurchase.ts");
const { _resetInkTrialStoreForTests, consumeInkTrialUse, getActiveInkTrial, grantInkTrial, getInkTrialHistory } = await import("./inkTrialStore.ts");
const { isColorUnlocked } = await import("./penColorStore.ts");

type Sent = { name: string; params: Record<string, unknown> };
const sent: Sent[] = [];
const everySent: Sent[] = []; // never cleared: the last test validates every row this file produced
registerAnalyticsProvider({
  name: "test-capture",
  trackEvent: (name: string, params: unknown) => {
    sent.push({ name, params: params as Record<string, unknown> });
    everySent.push({ name, params: params as Record<string, unknown> });
  },
} as never);
const purchases = () => sent.filter((s) => s.name === "shop_purchase_with_coins").map((s) => s.params);

function freshPlayer(coins = 50_000) {
  for (const k of [...store.keys()]) if (k !== "cydi.analyticsDebug.v1") store.delete(k);
  replaceSaveData(createDefaultSaveData()); // saveStore caches the save in memory
  updateSaveData((d) => {
    d.progress.coins = coins;
  });
  _resetInkTrialStoreForTests({ isOwned: (ink) => isColorUnlocked(ink), track: () => {} });
  sent.length = 0;
}

test("inkTrialBefore = none: a Trial ink bought with no Trial history", () => {
  freshPlayer();
  assert.equal(purchasePenColor("rainbow"), "purchased");
  assert.deepEqual(purchases(), [{ productType: "penColor", tier: "rainbow", price: 10000, inkTrialBefore: "none" }]);
});

test("inkTrialBefore = active: bought while its Trial is running - and the purchase then closes that Trial", () => {
  freshPlayer();
  assert.equal(grantInkTrial("rainbow", "classic"), true);
  consumeInkTrialUse("rainbow", "g1", "classic");
  assert.equal(purchasePenColor("rainbow"), "purchased");
  assert.equal(purchases()[0].inkTrialBefore, "active");
  assert.equal(getActiveInkTrial(), null, "ownership closed the Trial");
});

test("inkTrialBefore = ended: bought after its Trial was used up (the Keep-it CTA path and a later Shop purchase alike)", () => {
  freshPlayer();
  grantInkTrial("rainbow", "playTogether");
  for (let i = 1; i <= 5; i++) consumeInkTrialUse("rainbow", `g${i}`, "playTogether");
  assert.equal(getInkTrialHistory("rainbow"), "ended");
  assert.equal(purchasePenColor("rainbow"), "purchased");
  assert.equal(purchases()[0].inkTrialBefore, "ended");
});

test("Diamond Blue carries its own canonical id; a non-Trial ink carries no inkTrialBefore", () => {
  freshPlayer();
  purchasePenColor("diamondBlue");
  purchasePenColor("purple");
  assert.deepEqual(purchases(), [
    { productType: "penColor", tier: "diamondBlue", price: 15000, inkTrialBefore: "none" },
    { productType: "penColor", tier: "purple", price: 1000 },
  ]);
});

test("no purchase, no row: an owned ink or a short balance sends nothing", () => {
  freshPlayer(500);
  assert.equal(purchasePenColor("rainbow"), "insufficient_coins");
  assert.deepEqual(purchases(), []);
});

test("every purchase row above passes the shared validator (the Worker's ingest rule)", () => {
  const rows = everySent.filter((s) => s.name === "shop_purchase_with_coins").map((s) => s.params);
  assert.deepEqual(rows.map((p) => `${p.tier}:${p.inkTrialBefore ?? "-"}`), ["rainbow:none", "rainbow:active", "rainbow:ended", "diamondBlue:none", "purple:-"]);
  for (const p of rows) assert.equal(validateEventParams("shop_purchase_with_coins", p).valid, true, JSON.stringify(p));
});
