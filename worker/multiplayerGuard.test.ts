// Multiplayer cost guard, Phase 1 (monitor-only).
//
// Two properties dominate this file. First, fail-open: every way the guard can go
// wrong - no config, bad config, unknown country, dead KV - must end at
// "unrestricted", because guard infrastructure breaking must not be able to break
// multiplayer. Second, monitor-only: `allowed` is true on every path, including the
// ones whose decision is would_reject, and the tests assert that explicitly so
// enforcement cannot arrive by accident.
import test from "node:test";
import assert from "node:assert/strict";

const {
  evaluateRoomCreation,
  effectiveMode,
  isValidGuardConfig,
  parseGuardConfig,
  readGuardConfig,
  guardConfigAgeMs,
  guardLogLine,
  enforcementConfigError,
  isEnforcementActive,
  GUARD_FAIL_OPEN,
  _resetGuardCacheForTests,
} = await import("./multiplayerGuard.ts");

type Config = Parameters<typeof evaluateRoomCreation>[0];

const NOW = Date.parse("2026-09-24T12:00:00Z");
const FUTURE = "2026-09-25T00:00:00Z";
const PAST = "2026-09-24T00:00:00Z";

const base = (over: Partial<Config> = {}): Config => ({
  monitorOnly: true,
  globalMode: "NORMAL",
  countries: {},
  ...over,
});

class FakeKv {
  reads = 0;
  value: string | null;
  throws: boolean;
  constructor(value: string | null, throws = false) {
    this.value = value;
    this.throws = throws;
  }
  async get(_key: string, _o?: { cacheTtl?: number }): Promise<string | null> {
    this.reads++;
    if (this.throws) throw new Error("kv down");
    return this.value;
  }
}

test.beforeEach(() => _resetGuardCacheForTests());

// ------------------------------------------------------------------ validation ----

test("a well-formed config validates", () => {
  assert.equal(isValidGuardConfig(base()), true);
  assert.equal(isValidGuardConfig(base({ countries: { IR: { mode: "ELEVATED", createAllowPercent: 50 } } })), true);
  assert.equal(isValidGuardConfig(base({ globalMode: "EMERGENCY", expiresAt: FUTURE, reason: "spike" })), true);
  assert.equal(isValidGuardConfig(base({ override: { scope: "GLOBAL", mode: "EMERGENCY", expiresAt: FUTURE } })), true);
});

test("malformed configs are rejected whole", () => {
  const bad: unknown[] = [
    null,
    [],
    "NORMAL",
    { globalMode: "NORMAL", countries: {} },                                  // monitorOnly missing
    { monitorOnly: true, globalMode: "PANIC", countries: {} },                // not a mode
    { monitorOnly: "yes", globalMode: "NORMAL", countries: {} },              // wrong type
    { monitorOnly: true, globalMode: "NORMAL", countries: [] },               // array, not map
    { monitorOnly: true, globalMode: "NORMAL", countries: {}, rogue: 1 },     // unknown key
    { monitorOnly: true, globalMode: "NORMAL", countries: { ir: { mode: "ELEVATED" } } },       // unnormalized key
    { monitorOnly: true, globalMode: "NORMAL", countries: { ZZ: { mode: "ELEVATED" } } },       // unknown-country key
    { monitorOnly: true, globalMode: "NORMAL", countries: { IR: { mode: "ELEVATED", createAllowPercent: 150 } } },
    { monitorOnly: true, globalMode: "NORMAL", countries: { IR: { mode: "ELEVATED", extra: 1 } } },
    // An override with no expiry is a permanent policy in temporary clothing.
    { monitorOnly: true, globalMode: "NORMAL", countries: {}, override: { scope: "IR", mode: "EMERGENCY" } },
    { monitorOnly: true, globalMode: "NORMAL", countries: {}, override: { scope: "NOPE!", mode: "EMERGENCY", expiresAt: FUTURE } },
  ];
  for (const value of bad) {
    assert.equal(isValidGuardConfig(value), false, `should reject ${JSON.stringify(value)}`);
  }
});

test("parsing never throws and yields null on anything unusable", () => {
  assert.equal(parseGuardConfig(null), null);
  assert.equal(parseGuardConfig("{"), null);
  assert.equal(parseGuardConfig('{"monitorOnly":true}'), null);
  assert.deepEqual(parseGuardConfig(JSON.stringify(base()))?.globalMode, "NORMAL");
});

// ---------------------------------------------------------------- fail-open ----

test("a missing config leaves everyone unrestricted", async () => {
  const kv = new FakeKv(null);
  const config = await readGuardConfig(kv, NOW);
  assert.deepEqual(config, GUARD_FAIL_OPEN);
  assert.equal(evaluateRoomCreation(config, "IR", NOW).decision, "would_allow");
});

test("a malformed stored config leaves everyone unrestricted", async () => {
  const kv = new FakeKv('{"globalMode":"EMERGENCY"}');
  const config = await readGuardConfig(kv, NOW);
  assert.deepEqual(config, GUARD_FAIL_OPEN, "a broken policy must not restrict anybody");
});

test("a KV outage leaves everyone unrestricted and is not cached", async () => {
  const kv = new FakeKv(null, true);
  assert.deepEqual(await readGuardConfig(kv, NOW), GUARD_FAIL_OPEN);
  assert.deepEqual(await readGuardConfig(kv, NOW + 1), GUARD_FAIL_OPEN);
  assert.equal(kv.reads, 2, "a thrown read must be retried, not frozen for the window");
});

test("a missing KV binding leaves everyone unrestricted", async () => {
  assert.deepEqual(await readGuardConfig(undefined, NOW), GUARD_FAIL_OPEN);
});

test("an undeterminable country is never restricted", () => {
  const config = base({ globalMode: "EMERGENCY", countries: { IR: { mode: "EMERGENCY" } } });
  for (const raw of [undefined, null, "", "XX", "T1", "nonsense", 42]) {
    const e = evaluateRoomCreation(config, raw, NOW);
    assert.equal(e.country, "ZZ");
    assert.equal(e.decision, "would_allow", `ZZ from ${String(raw)} must stay unrestricted`);
  }
});

test("an unconfigured country is unrestricted while another is under policy", () => {
  const config = base({ countries: { IR: { mode: "EMERGENCY" } } });
  assert.equal(evaluateRoomCreation(config, "DE", NOW).decision, "would_allow");
  assert.equal(evaluateRoomCreation(config, "IR", NOW).decision, "would_reject");
});

// ------------------------------------------------------------- mode resolution ----

test("a country policy resolves for that country only", () => {
  const config = base({ countries: { IR: { mode: "ELEVATED", createAllowPercent: 0 } } });
  const ir = effectiveMode(config, "IR", NOW);
  assert.equal(ir.mode, "ELEVATED");
  assert.equal(ir.source, "country");
  assert.equal(ir.createAllowPercent, 0);
  assert.equal(effectiveMode(config, "US", NOW).mode, "NORMAL");
});

test("globalMode applies where no country policy does", () => {
  const config = base({ globalMode: "EMERGENCY" });
  assert.equal(effectiveMode(config, "DE", NOW).mode, "EMERGENCY");
  assert.equal(effectiveMode(config, "DE", NOW).source, "global");
});

test("a live override beats both the country policy and the global mode", () => {
  const config = base({
    globalMode: "ELEVATED",
    countries: { IR: { mode: "NORMAL" } },
    override: { scope: "IR", mode: "EMERGENCY", expiresAt: FUTURE },
  });
  const ir = effectiveMode(config, "IR", NOW);
  assert.equal(ir.mode, "EMERGENCY");
  assert.equal(ir.source, "override");
});

test("a GLOBAL-scoped override covers every country", () => {
  const config = base({ override: { scope: "GLOBAL", mode: "EMERGENCY", expiresAt: FUTURE } });
  assert.equal(effectiveMode(config, "DE", NOW).mode, "EMERGENCY");
  assert.equal(effectiveMode(config, "IR", NOW).mode, "EMERGENCY");
});

test("an expired override stops applying, with no mutation", () => {
  const config = base({ countries: { IR: { mode: "NORMAL" } }, override: { scope: "IR", mode: "EMERGENCY", expiresAt: PAST } });
  const snapshot = JSON.stringify(config);
  assert.equal(effectiveMode(config, "IR", NOW).mode, "NORMAL");
  assert.equal(JSON.stringify(config), snapshot, "evaluation must never rewrite the config");
});

test("an expired whole-policy expiresAt lapses every country back to NORMAL", () => {
  const config = base({ globalMode: "EMERGENCY", countries: { IR: { mode: "EMERGENCY" } }, expiresAt: PAST });
  const ir = effectiveMode(config, "IR", NOW);
  assert.equal(ir.mode, "NORMAL");
  assert.equal(ir.source, "expired");
  assert.equal(ir.expired, true);
  assert.equal(evaluateRoomCreation(config, "IR", NOW).decision, "would_allow");
});

test("a policy expiring at the next 00:00 UTC is live before it and lapsed after", () => {
  const midnight = Date.parse("2026-09-25T00:00:00Z");
  const config = base({ countries: { IR: { mode: "EMERGENCY" } }, expiresAt: "2026-09-25T00:00:00Z" });
  assert.equal(effectiveMode(config, "IR", midnight - 1000).mode, "EMERGENCY", "live one second before the quota reset");
  assert.equal(effectiveMode(config, "IR", midnight).mode, "NORMAL", "lapsed exactly at the reset");
  assert.equal(effectiveMode(config, "IR", midnight + 3_600_000).mode, "NORMAL");
});

// -------------------------------------------------------------------- decisions ----

test("NORMAL always reads would_allow", () => {
  const config = base({ countries: { IR: { mode: "NORMAL" } } });
  for (let i = 0; i < 50; i++) assert.equal(evaluateRoomCreation(config, "IR", NOW).decision, "would_allow");
});

test("EMERGENCY reads would_reject - and still allows", () => {
  const config = base({ countries: { IR: { mode: "EMERGENCY" } } });
  const e = evaluateRoomCreation(config, "IR", NOW);
  assert.equal(e.decision, "would_reject");
  assert.equal(e.allowed, true, "phase 1 must never actually deny");
});

test("ELEVATED at 0% always reads would_throttle, at 100% never does", () => {
  const none = base({ countries: { IR: { mode: "ELEVATED", createAllowPercent: 0 } } });
  const all = base({ countries: { IR: { mode: "ELEVATED", createAllowPercent: 100 } } });
  for (let i = 0; i < 50; i++) {
    assert.equal(evaluateRoomCreation(none, "IR", NOW).decision, "would_throttle");
    assert.equal(evaluateRoomCreation(all, "IR", NOW).decision, "would_allow");
  }
});

test("ELEVATED sampling is unbiased enough to model capacity from", () => {
  // The measurement this feeds is "what share would have been throttled", so the
  // rate has to track createAllowPercent rather than merely being non-constant.
  const config = base({ countries: { IR: { mode: "ELEVATED", createAllowPercent: 50 } } });
  let allowed = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) if (evaluateRoomCreation(config, "IR", NOW).decision === "would_allow") allowed++;
  const rate = allowed / n;
  assert.ok(rate > 0.45 && rate < 0.55, `expected ~50% allowed, got ${(rate * 100).toFixed(1)}%`);
});

test("monitorOnly is reported and allowed is true on every decision", () => {
  const config = base({ countries: { IR: { mode: "EMERGENCY" }, DE: { mode: "ELEVATED", createAllowPercent: 0 } } });
  for (const country of ["IR", "DE", "US"]) {
    const e = evaluateRoomCreation(config, country, NOW);
    assert.equal(e.allowed, true, `${country} must still be allowed in phase 1`);
    assert.equal(e.monitorOnly, true);
  }
});

test("the guard makes no Durable Object call - it has no DO binding at all", async () => {
  // Structural, not behavioural: the module cannot touch a DO because it never
  // receives one. Asserting on the source keeps that true as the file grows.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("./multiplayerGuard.ts", import.meta.url), "utf8");
  for (const f of ["DurableObject", "idFromName", "ROOM_DO", "ANALYTICS_DO"]) {
    assert.equal(src.includes(f), false, `guard must not reference ${f}`);
  }
});

// ------------------------------------------------------------------ cache ----

test("repeated evaluations inside the window cost one KV read", async () => {
  const kv = new FakeKv(JSON.stringify(base({ countries: { IR: { mode: "EMERGENCY" } } })));
  for (let i = 0; i < 100; i++) {
    const config = await readGuardConfig(kv, NOW + i * 100);
    evaluateRoomCreation(config, "IR", NOW);
  }
  assert.equal(kv.reads, 1, "a KV read per room creation would trade the DO quota for the KV quota");
});

test("the cache expires so an operator change lands without a deploy", async () => {
  const kv = new FakeKv(JSON.stringify(base()));
  await readGuardConfig(kv, NOW);
  await readGuardConfig(kv, NOW + 29_000);
  assert.equal(kv.reads, 1);
  await readGuardConfig(kv, NOW + 31_000);
  assert.equal(kv.reads, 2);
});

test("config age is reported for the status endpoint", async () => {
  assert.equal(guardConfigAgeMs(NOW), null);
  await readGuardConfig(new FakeKv(JSON.stringify(base())), NOW);
  assert.equal(guardConfigAgeMs(NOW + 5_000), 5_000);
});

// -------------------------------------------------------------------- logging ----

test("the log line is structured and carries nothing identifying", () => {
  const config = base({ countries: { IR: { mode: "EMERGENCY" } } });
  const line = JSON.parse(guardLogLine(evaluateRoomCreation(config, "IR", NOW)));
  assert.deepEqual(Object.keys(line).sort(), ["country", "decision", "enforced", "mode", "monitorOnly", "pct", "src", "t"]);
  assert.equal(line.t, "mp_guard");
  assert.equal(line.country, "IR");
  assert.equal(line.decision, "would_reject");
});

// ------------------------------------------------- enforcement (phase 2A) ----
//
// monitorOnly is the whole switch. These pin both halves: that it being true keeps
// phase 1 behaviour exactly, and that turning it false refuses only EMERGENCY and
// only for configured countries.

test("monitorOnly true never denies, whatever the decision says", () => {
  const config = base({ countries: { IR: { mode: "EMERGENCY" }, DE: { mode: "ELEVATED", createAllowPercent: 0 } } });
  for (const country of ["IR", "DE", "US"]) {
    const e = evaluateRoomCreation(config, country, NOW);
    assert.equal(e.allowed, true, `${country} must be allowed while monitoring`);
    assert.equal(e.enforced, false);
  }
});

test("live EMERGENCY denies the configured country and nobody else", () => {
  const config = base({ monitorOnly: false, countries: { IR: { mode: "EMERGENCY" } }, expiresAt: FUTURE });
  const ir = evaluateRoomCreation(config, "IR", NOW);
  assert.equal(ir.decision, "would_reject");
  assert.equal(ir.allowed, false, "this is the one case that actually refuses");
  assert.equal(ir.enforced, true);
  assert.equal(evaluateRoomCreation(config, "DE", NOW).allowed, true, "an unconfigured country is untouched");
  assert.equal(evaluateRoomCreation(config, undefined, NOW).allowed, true, "ZZ stays unrestricted even under enforcement");
});

test("live NORMAL allows", () => {
  const config = base({ monitorOnly: false, countries: { IR: { mode: "NORMAL" } } });
  assert.equal(evaluateRoomCreation(config, "IR", NOW).allowed, true);
});

test("an expired live EMERGENCY stops denying, with no write and no cleanup", () => {
  const config = base({ monitorOnly: false, countries: { IR: { mode: "EMERGENCY" } }, expiresAt: PAST });
  const snapshot = JSON.stringify(config);
  const e = evaluateRoomCreation(config, "IR", NOW);
  assert.equal(e.allowed, true, "expiry alone must lift enforcement");
  assert.equal(e.enforced, false);
  assert.equal(JSON.stringify(config), snapshot, "evaluation must never mutate the config");
});

test("enforcement lifts exactly at the quota-reset boundary", () => {
  const midnight = Date.parse("2026-09-25T00:00:00Z");
  const config = base({ monitorOnly: false, countries: { IR: { mode: "EMERGENCY" } }, expiresAt: "2026-09-25T00:00:00Z" });
  assert.equal(evaluateRoomCreation(config, "IR", midnight - 1000).allowed, false);
  assert.equal(evaluateRoomCreation(config, "IR", midnight).allowed, true);
});

test("a live override can enforce and expire on its own clock", () => {
  const live = base({ monitorOnly: false, countries: {}, override: { scope: "IR", mode: "EMERGENCY", expiresAt: FUTURE } });
  assert.equal(evaluateRoomCreation(live, "IR", NOW).allowed, false);
  const lapsed = base({ monitorOnly: false, countries: {}, override: { scope: "IR", mode: "EMERGENCY", expiresAt: PAST } });
  assert.equal(evaluateRoomCreation(lapsed, "IR", NOW).allowed, true);
});

// -------------------------------------------- ELEVATED is not enforceable ----

test("a live ELEVATED config is rejected by validation, with a reason", () => {
  for (const cfg of [
    base({ monitorOnly: false, countries: { IR: { mode: "ELEVATED", createAllowPercent: 50 } }, expiresAt: FUTURE }),
    base({ monitorOnly: false, globalMode: "ELEVATED", expiresAt: FUTURE }),
    base({ monitorOnly: false, countries: {}, override: { scope: "IR", mode: "ELEVATED", expiresAt: FUTURE } }),
  ]) {
    assert.equal(isValidGuardConfig(cfg), false, "percentage enforcement is not reliable and must not be accepted");
    assert.match(String(enforcementConfigError(cfg)), /ELEVATED cannot be enforced/);
  }
});

test("ELEVATED is still freely modellable while monitoring", () => {
  const cfg = base({ monitorOnly: true, countries: { IR: { mode: "ELEVATED", createAllowPercent: 50 } } });
  assert.equal(isValidGuardConfig(cfg), true);
  assert.equal(enforcementConfigError(cfg), null);
});

test("even if a live ELEVATED reached evaluation it would fall open", () => {
  // Defence in depth: validation rejects it, and would_throttle can never clear the
  // allowed bar anyway.
  const cfg = base({ monitorOnly: false, countries: { IR: { mode: "ELEVATED", createAllowPercent: 0 } }, expiresAt: FUTURE });
  const e = evaluateRoomCreation(cfg, "IR", NOW);
  assert.equal(e.decision, "would_throttle");
  assert.equal(e.allowed, true, "a throttle decision must never deny");
});

// ------------------------------------------------------- time-bounded ----

test("live EMERGENCY without an expiry is rejected", () => {
  const cfg = base({ monitorOnly: false, countries: { IR: { mode: "EMERGENCY" } } });
  assert.equal(isValidGuardConfig(cfg), false);
  assert.match(String(enforcementConfigError(cfg)), /requires expiresAt/);
});

test("an override's own expiry satisfies the time-bound rule", () => {
  const cfg = base({ monitorOnly: false, countries: {}, override: { scope: "IR", mode: "EMERGENCY", expiresAt: FUTURE } });
  assert.equal(isValidGuardConfig(cfg), true);
});

test("monitor-only EMERGENCY needs no expiry - nothing is being refused", () => {
  assert.equal(isValidGuardConfig(base({ countries: { IR: { mode: "EMERGENCY" } } })), true);
});

// ------------------------------------------------- enforcement headline ----

test("isEnforcementActive answers the operator's one question", () => {
  assert.equal(isEnforcementActive(base({ countries: { IR: { mode: "EMERGENCY" } } }), NOW), false, "monitoring is not enforcing");
  assert.equal(isEnforcementActive(base({ monitorOnly: false }), NOW), false, "live but NORMAL is not enforcing");
  assert.equal(isEnforcementActive(base({ monitorOnly: false, countries: { IR: { mode: "EMERGENCY" } }, expiresAt: FUTURE }), NOW), true);
  assert.equal(isEnforcementActive(base({ monitorOnly: false, countries: { IR: { mode: "EMERGENCY" } }, expiresAt: PAST }), NOW), false, "expired is not enforcing");
  assert.equal(isEnforcementActive(base({ monitorOnly: false, override: { scope: "GLOBAL", mode: "EMERGENCY", expiresAt: FUTURE } }), NOW), true);
});

test("the log line records whether the decision was acted on", () => {
  const live = base({ monitorOnly: false, countries: { IR: { mode: "EMERGENCY" } }, expiresAt: FUTURE });
  assert.equal(JSON.parse(guardLogLine(evaluateRoomCreation(live, "IR", NOW))).enforced, true);
  const monitoring = base({ countries: { IR: { mode: "EMERGENCY" } } });
  assert.equal(JSON.parse(guardLogLine(evaluateRoomCreation(monitoring, "IR", NOW))).enforced, false);
});
