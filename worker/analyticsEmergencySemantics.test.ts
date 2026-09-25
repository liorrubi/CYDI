// Analytics EMERGENCY semantics: in whatever scope EMERGENCY applies, the effective keep
// rate for sheddable events is 0% - regardless of any configured sampling rate - while
// ALWAYS_PRESERVE events survive and the stored rate itself is never read or rewritten.
//
// Naming note: in this Worker, globalMode "NORMAL" means no shedding at all (keep 100%).
// The production 10% sampling profile is globalMode "ELEVATED" + globalKeepPercent 10.
import test from "node:test";
import assert from "node:assert/strict";
import { ALWAYS_PRESERVE, decideShedding, effectiveShedPolicy, type AnalyticsShedConfig } from "./analyticsShedding.ts";

const FUTURE = new Date(Date.now() + 6 * 3600_000).toISOString();
const sampling = (over: Partial<AnalyticsShedConfig> = {}): AnalyticsShedConfig => ({
  monitorOnly: false,
  globalMode: "ELEVATED",
  globalKeepPercent: 10,
  countries: {},
  expiresAt: FUTURE,
  ...over,
});
const keep = (config: AnalyticsShedConfig, country: string) => effectiveShedPolicy(config, country).keepPercent;
const deepCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

test("1. the production sampling profile (ELEVATED + globalKeepPercent 10) keeps 10%", () => {
  for (const cc of ["IR", "US", "DE", "ZZ"]) assert.equal(keep(sampling(), cc), 10, cc);
});

test("1b. NORMAL keeps 100% and ignores a stored globalKeepPercent, as before", () => {
  assert.equal(keep(sampling({ globalMode: "NORMAL" }), "IR"), 100);
});

test("2. ELEVATED behaviour is unchanged: explicit country rate wins, global rate otherwise, no invented rate", () => {
  const c = sampling({ countries: { DE: { mode: "ELEVATED", keepPercent: 25 } } });
  assert.equal(keep(c, "DE"), 25);
  assert.equal(keep(c, "US"), 10);
  const modelled = { monitorOnly: true, globalMode: "ELEVATED", countries: {} } as AnalyticsShedConfig;
  assert.equal(keep(modelled, "US"), 100, "monitor-only ELEVATED with no rate still invents nothing");
});

test("3. global EMERGENCY with 10% configured keeps 0% of sheddable events", () => {
  const c = sampling({ globalMode: "EMERGENCY" });
  for (const cc of ["IR", "US", "DE", "ZZ"]) {
    const p = effectiveShedPolicy(c, cc);
    assert.equal(p.mode, "EMERGENCY", cc);
    assert.equal(p.keepPercent, 0, cc);
    assert.equal(p.source, "global", cc);
  }
});

test("4. ALWAYS_PRESERVE (and preserveExtra) events survive EMERGENCY; every sheddable event is dropped", () => {
  const c = sampling({ globalMode: "EMERGENCY", preserveExtra: ["interstitial_checkpoint"] });
  const policy = effectiveShedPolicy(c, "IR");
  const events = [
    ...ALWAYS_PRESERVE.map((eventName) => ({ eventName })),
    { eventName: "interstitial_checkpoint" },
    { eventName: "game_started" },
    { eventName: "shape_completed" },
    { eventName: "rewarded_ad_unavailable" },
  ];
  // random() = 0 would keep every sampled event at any rate > 0, so any survivor proves a non-zero rate.
  const d = decideShedding(policy, "/events", JSON.stringify({ events }), c, () => 0);
  assert.equal(d.action, "forward_filtered");
  const kept = (JSON.parse(d.body!) as { events: { eventName: string }[] }).events.map((e) => e.eventName);
  assert.deepEqual(kept.sort(), [...ALWAYS_PRESERVE, "interstitial_checkpoint"].sort(), "exactly the preserved set");
  assert.equal(d.keptSampled, 0);
  assert.equal(d.dropped, 3);
  // A single sheddable event on the legacy route is dropped outright.
  assert.equal(decideShedding(policy, "/event", JSON.stringify({ eventName: "game_started" }), c, () => 0).action, "drop");
  assert.equal(decideShedding(policy, "/event", JSON.stringify({ eventName: "first_open" }), c, () => 0).action, "forward");
});

test("5. leaving EMERGENCY restores 10% - the stored rate was never read, mutated or rewritten", () => {
  const emergency = sampling({ globalMode: "EMERGENCY" });
  const snapshot = deepCopy(emergency);
  assert.equal(keep(emergency, "US"), 0);
  assert.deepEqual(emergency, snapshot, "resolving the policy does not touch the config");
  assert.equal(emergency.globalKeepPercent, 10);
  const back = { ...emergency, globalMode: "ELEVATED" as const };
  assert.equal(keep(back, "US"), 10, "back to the sampling profile: 10% again, from the same stored value");
});

test("6. country EMERGENCY is 0% in that country only - even with an explicit country rate", () => {
  const c = sampling({ countries: { IR: { mode: "EMERGENCY" } } });
  assert.equal(keep(c, "IR"), 0);
  const explicit = sampling({ countries: { IR: { mode: "EMERGENCY", keepPercent: 10 } } });
  assert.equal(keep(explicit, "IR"), 0);
  assert.equal(explicit.countries.IR.keepPercent, 10, "the country's configured rate is not erased");
});

test("7. countries outside the EMERGENCY scope keep their normal sampling", () => {
  const c = sampling({ countries: { IR: { mode: "EMERGENCY" } } });
  for (const cc of ["US", "DE", "ZZ"]) assert.equal(keep(c, cc), 10, cc);
  // Under a GLOBAL emergency, a country with its own policy is outside the global scope.
  const g = sampling({ globalMode: "EMERGENCY", countries: { DE: { mode: "ELEVATED", keepPercent: 25 }, US: { mode: "NORMAL" } } });
  assert.equal(keep(g, "DE"), 25, "own ELEVATED policy keeps its own rate");
  assert.equal(keep(g, "US"), 100, "own NORMAL policy stays exempt");
  assert.equal(keep(g, "IR"), 0);
});

test("expiry still wins: a lapsed EMERGENCY resolves to NORMAL (keep 100%)", () => {
  const lapsed = sampling({ globalMode: "EMERGENCY", expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const p = effectiveShedPolicy(lapsed, "IR");
  assert.equal(p.mode, "NORMAL");
  assert.equal(p.keepPercent, 100);
});

test("monitor-only EMERGENCY still models 0% (the dry-run measurement matches what enforcement would do)", () => {
  const p = effectiveShedPolicy(sampling({ globalMode: "EMERGENCY", monitorOnly: true }), "IR");
  assert.equal(p.monitorOnly, true);
  assert.equal(p.keepPercent, 0);
});
