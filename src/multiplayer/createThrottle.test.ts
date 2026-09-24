// Create is debounced, backs off (bounded) after a deliberate capacity refusal, never
// retries on its own, and a retired build stays refused.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

const { CAPACITY_BACKOFF_MS, CREATE_DEBOUNCE_MS, _resetCreateThrottleForTests, checkCreateAllowed, recordCreateAttempt, recordCreateResult, recordUpdateRequired } =
  await import("./createThrottle.ts");

beforeEach(() => _resetCreateThrottleForTests());

test("a second tap inside the debounce window is ignored", () => {
  recordCreateAttempt(1000);
  assert.deepEqual(checkCreateAllowed(1000 + CREATE_DEBOUNCE_MS - 1), { ok: false, reason: "debounce" });
  assert.deepEqual(checkCreateAllowed(1000 + CREATE_DEBOUNCE_MS), { ok: true });
});

test("capacity refusals back off 15 s -> 30 s -> 60 s -> 120 s and stay capped", () => {
  let now = 0;
  const waits: number[] = [];
  for (let i = 0; i < 6; i++) {
    recordCreateAttempt(now);
    recordCreateResult(now, { ok: false, code: "multiplayer_capacity" });
    const gate = checkCreateAllowed(now);
    assert.equal(gate.ok, false);
    waits.push((gate as { waitMs: number }).waitMs);
    now += waits[waits.length - 1];
    // Allowed again once the wait is over - by the player's tap, never by a timer.
    assert.deepEqual(checkCreateAllowed(now), { ok: true });
  }
  assert.deepEqual(waits, [15_000, 30_000, 60_000, 120_000, 120_000, 120_000]);
  assert.equal(CAPACITY_BACKOFF_MS[CAPACITY_BACKOFF_MS.length - 1], 120_000);
});

test("a success resets the backoff; other failures only debounce", () => {
  recordCreateResult(0, { ok: false, code: "multiplayer_capacity" });
  recordCreateResult(20_000, { ok: true });
  recordCreateResult(20_000, { ok: false });
  assert.deepEqual(checkCreateAllowed(22_000), { ok: true });
  recordCreateResult(22_000, { ok: false, code: "multiplayer_capacity" });
  assert.equal((checkCreateAllowed(22_001) as { waitMs: number }).waitMs, 14_999, "back to the first step");
});

test("update required is sticky - learned from create or from a join lookup", () => {
  recordCreateResult(0, { ok: false, code: "multiplayer_update_required" });
  assert.deepEqual(checkCreateAllowed(10 ** 9), { ok: false, reason: "update_required" });
  _resetCreateThrottleForTests();
  recordUpdateRequired();
  assert.deepEqual(checkCreateAllowed(10 ** 9), { ok: false, reason: "update_required" });
});
