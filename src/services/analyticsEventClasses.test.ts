/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Phase 3 client sampling: exact events are never sampled; telemetry is sampled per SESSION at
// the configured rate; diagnostics are a nested subset; the client exact list equals the
// server's exact ledger list; a client batch is exactly what the Worker accepts.
import test from "node:test";
import assert from "node:assert/strict";

const { classifyEvent, shouldKeepEvent, sessionBucket, appliedKeepPercent, CLIENT_EXACT_EVENTS, CLIENT_DIAGNOSTIC_EVENTS } = await import("./analyticsEventClasses.ts");
const { parseClientConfig, SAFE_DEFAULTS } = await import("./analyticsClientConfig.ts");
const { ANALYTICS_EVENT_NAMES } = await import("./analyticsSchema.ts");
const { EXACT_LEDGER_EVENTS } = await import("../../worker/analyticsExactLedger.ts");
const { parseIngest, checkedEnvelopes } = await import("../../worker/analyticsIngest.ts");

const sessions = Array.from({ length: 20_000 }, (_, i) => `sess-${i}-${(i * 2654435761) % 1e9}`);

test("the client exact list is identical to the server's exact ledger list", () => {
  assert.deepEqual([...CLIENT_EXACT_EVENTS].sort(), [...EXACT_LEDGER_EVENTS].sort());
  for (const e of [...CLIENT_EXACT_EVENTS, ...CLIENT_DIAGNOSTIC_EVENTS]) assert.ok(ANALYTICS_EVENT_NAMES.includes(e as never), `${e} is a real event`);
  for (const e of CLIENT_DIAGNOSTIC_EVENTS) assert.equal(CLIENT_EXACT_EVENTS.has(e), false, `${e} cannot be both`);
});

test("exact events are never sampled - at any rate, even with telemetry disabled", () => {
  for (const rates of [{ telemetryKeepPercent: 0, diagnosticKeepPercent: 0, telemetryDisabled: true }, { telemetryKeepPercent: 1, diagnosticKeepPercent: 1, telemetryDisabled: false }]) {
    for (const e of CLIENT_EXACT_EVENTS) for (const s of sessions.slice(0, 500)) assert.equal(shouldKeepEvent(e, s, rates), true);
    for (const e of CLIENT_EXACT_EVENTS) assert.equal(appliedKeepPercent(e, rates), 100);
  }
});

test("telemetry is kept for ~the configured share of sessions (per-session, deterministic)", () => {
  for (const pct of [10, 25, 50]) {
    const kept = sessions.filter((s) => shouldKeepEvent("game_started", s, { telemetryKeepPercent: pct, diagnosticKeepPercent: 100, telemetryDisabled: false })).length;
    const share = (100 * kept) / sessions.length;
    assert.ok(Math.abs(share - pct) < 1.5, `${pct}% configured -> ${share.toFixed(2)}% kept`);
  }
  assert.equal(sessionBucket("abc"), sessionBucket("abc"), "deterministic");
});

test("a session keeps or drops its whole funnel together (no stage bias)", () => {
  const rates = { telemetryKeepPercent: 30, diagnosticKeepPercent: 100, telemetryDisabled: false };
  for (const s of sessions.slice(0, 2000)) {
    const a = shouldKeepEvent("game_started", s, rates), b = shouldKeepEvent("game_completed", s, rates), c = shouldKeepEvent("shape_completed", s, rates);
    assert.ok(a === b && b === c, "started/completed/scored are never split within a session");
  }
});

test("diagnostic sessions are a nested subset of telemetry sessions; disable drops all non-exact", () => {
  const rates = { telemetryKeepPercent: 40, diagnosticKeepPercent: 10, telemetryDisabled: false };
  let diag = 0;
  for (const s of sessions) {
    const d = shouldKeepEvent("mp_disconnect", s, rates);
    if (d) {
      diag++;
      assert.equal(shouldKeepEvent("game_started", s, rates), true);
    }
  }
  assert.ok(Math.abs((100 * diag) / sessions.length - 10) < 1.5);
  const off = { telemetryKeepPercent: 100, diagnosticKeepPercent: 100, telemetryDisabled: true };
  assert.equal(shouldKeepEvent("game_started", "x", off), false);
  assert.equal(shouldKeepEvent("mp_disconnect", "x", off), false);
  assert.equal(shouldKeepEvent("app_open", "x", off), true);
  assert.equal(classifyEvent("mp_round_completed"), "telemetry", "no taxonomy change: removals are proposals only");
});

test("config parsing clamps every field into a safe range and rejects non-v1 input", () => {
  const c = parseClientConfig({ v: 1, telemetryKeepPercent: 250, maxBatchEvents: 9999, flushIntervalMs: 5, exactFlushDelayMs: 1e9, maxBatchBytes: 1e9 })!;
  assert.deepEqual([c.telemetryKeepPercent, c.maxBatchEvents, c.flushIntervalMs, c.exactFlushDelayMs, c.maxBatchBytes], [100, 50, 10_000, 120_000, 60_000]);
  assert.equal(parseClientConfig({ telemetryKeepPercent: 5 }), null);
  assert.equal(parseClientConfig("not json"), null);
  assert.equal(SAFE_DEFAULTS.telemetryKeepPercent, 100, "sampling is OFF by default until the server weights sampled events");
  assert.equal(SAFE_DEFAULTS.exactRetryOnNetworkError, false, "network-error retry is OFF until the server de-duplicates");
});

test("a full client batch (50 envelopes, with eventId, near the byte cap) is accepted whole by the Worker's ingest rules", () => {
  const env = (i: number) => ({ eventName: i % 5 === 0 ? "app_open" : "game_started", params: i % 5 === 0 ? {} : { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" }, platform: "android", appVersion: "0.54.0", appBuild: "abcdef1", appVersionCode: "49", installationId: "aaaaaaaaaaaaaaaaaaaaaaaa", sessionId: "bbbbbbbbbbbbbbbbbbbbbbbb", isInternal: false, ...(i % 5 === 0 ? { eventId: "0123456789abcdef01234567" } : {}) });
  const body = JSON.stringify({ events: Array.from({ length: 50 }, (_, i) => env(i)) });
  assert.ok(body.length <= SAFE_DEFAULTS.maxBatchBytes);
  const parsed = parseIngest("/events", body);
  assert.notEqual(parsed.envelopes, null, "within the Worker's batch size and byte limits");
  assert.equal(checkedEnvelopes(parsed).filter((c) => c.eventName !== null).length, 50, "every envelope passes server validation (eventId is ignored, not rejected)");
});
