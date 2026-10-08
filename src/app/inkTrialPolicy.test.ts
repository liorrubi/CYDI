// Rewarded Ink Trial (0.58.0) - the pure rules: eligibility order, one Trial per ink ever, no conflicting Trials,
// the CTA owed after the last play, and the Classic coin/ink rotation.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  TRIAL_EXTENSION_PLAYS,
  extensionAdStep,
  extensionAvailable,
  TRIAL_PLAYS,
  activeTrial,
  advancedPointer,
  chooseClassicContent,
  nextEligibleInk,
  pendingCtaInk,
  rotationKey,
  scheduledSlot,
  type InkTrialRecord,
  type InkTrials,
} from "./inkTrialPolicy";

const none = () => false;
const record = (over: Partial<InkTrialRecord> = {}): InkTrialRecord => ({ status: "active", usesLeft: TRIAL_PLAYS, started: false, ctaShown: false, ctaOutcome: null, extended: false, ...over });

test("a Trial is 5 plays", () => {
  assert.equal(TRIAL_PLAYS, 5);
});

test("eligibility: Rainbow first, then Diamond Blue once Rainbow's Trial was granted (any status)", () => {
  assert.equal(nextEligibleInk({}, none), "rainbow");
  assert.equal(nextEligibleInk({ rainbow: record({ status: "exhausted", usesLeft: 0 }) }, none), "diamondBlue");
  assert.equal(nextEligibleInk({ rainbow: record({ status: "closed" }) }, none), "diamondBlue");
  assert.equal(nextEligibleInk({ rainbow: record({ status: "exhausted", usesLeft: 0 }), diamondBlue: record({ status: "exhausted", usesLeft: 0 }) }, none), null);
});

test("eligibility: an owned ink is skipped; owning both means no offer at all", () => {
  assert.equal(nextEligibleInk({}, (ink) => ink === "rainbow"), "diamondBlue");
  assert.equal(nextEligibleInk({}, () => true), null);
});

test("eligibility: no offer while another Trial is still active (no conflicting Trials)", () => {
  assert.equal(nextEligibleInk({ rainbow: record({ usesLeft: 3 }) }, none), null);
  // ...unless the active one is owned now - ownership ends it on the spot.
  assert.equal(nextEligibleInk({ rainbow: record({ usesLeft: 3 }) }, (ink) => ink === "rainbow"), "diamondBlue");
});

test("an ink whose Trial was ever granted is never eligible again (declines record nothing, so they never count)", () => {
  const trials: InkTrials = { rainbow: record({ status: "exhausted", usesLeft: 0, ctaShown: true, ctaOutcome: "declined" }) };
  assert.notEqual(nextEligibleInk(trials, none), "rainbow");
});

test("activeTrial: only an active, unowned record with plays left", () => {
  assert.deepEqual(activeTrial({ rainbow: record({ usesLeft: 2 }) }, none), { ink: "rainbow", usesLeft: 2 });
  assert.equal(activeTrial({ rainbow: record({ usesLeft: 2 }) }, () => true), null);
  assert.equal(activeTrial({ rainbow: record({ status: "exhausted", usesLeft: 0 }) }, none), null);
});

test("pendingCtaInk: owed once after the last play, not when shown or owned", () => {
  assert.equal(pendingCtaInk({ rainbow: record({ status: "exhausted", usesLeft: 0 }) }, none), "rainbow");
  assert.equal(pendingCtaInk({ rainbow: record({ status: "exhausted", usesLeft: 0, ctaShown: true }) }, none), null);
  assert.equal(pendingCtaInk({ rainbow: record({ status: "exhausted", usesLeft: 0 }) }, () => true), null);
  assert.equal(pendingCtaInk({ rainbow: record({ usesLeft: 1 }) }, none), null);
});

test("rotation coin -> ink -> coin -> ink (1:1), advancing only by rendered offers", () => {
  const pattern = ["coin", "ink"] as const;
  let pointer = 0;
  let key = "";
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    seen.push(scheduledSlot(pattern, pointer, key));
    ({ pointer, key } = advancedPointer(pattern, pointer, key));
  }
  assert.deepEqual(seen, ["coin", "ink", "coin", "ink"]);
});

test("rotation coin -> coin -> ink (2:1) is only a config change", () => {
  const pattern = ["coin", "coin", "ink"] as const;
  let pointer = 0;
  let key = "";
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    seen.push(scheduledSlot(pattern, pointer, key));
    ({ pointer, key } = advancedPointer(pattern, pointer, key));
  }
  assert.deepEqual(seen, ["coin", "coin", "ink", "coin", "coin", "ink"]);
});

test("a changed pattern restarts at its first slot; the pointer stays bounded", () => {
  const a = ["coin", "ink"] as const;
  const b = ["ink", "coin", "coin"] as const;
  const after = advancedPointer(a, 0, rotationKey(a)); // a's pointer is now 1
  assert.equal(scheduledSlot(b, after.pointer, after.key), "ink", "b starts at its own slot 0");
  assert.ok(advancedPointer(a, 1, rotationKey(a)).pointer < a.length);
});

test("content: scheduled coin stays coin even with an eligible ink; scheduled ink falls back to coin when none is eligible", () => {
  assert.deepEqual(chooseClassicContent({ inkOn: true, scheduled: "coin", eligibleInk: "rainbow" }), { kind: "coin", rotationSlot: "coin" });
  assert.deepEqual(chooseClassicContent({ inkOn: true, scheduled: "ink", eligibleInk: "rainbow" }), { kind: "ink", ink: "rainbow", rotationSlot: "ink" });
  assert.deepEqual(chooseClassicContent({ inkOn: true, scheduled: "ink", eligibleInk: null }), { kind: "coin", rotationSlot: "ink" });
});

test("content: with Ink off the rotation is not consulted at all - exactly the 0.57 coin offer, no rotationSlot", () => {
  assert.deepEqual(chooseClassicContent({ inkOn: false, scheduled: "ink", eligibleInk: "rainbow" }), { kind: "coin" });
});

test("extension ad: ONLY the confirmed reward grants; early close is a dismissal; no-fill / timeout / SDK error is a failure", () => {
  assert.equal(extensionAdStep("rewarded"), "grant");
  assert.equal(extensionAdStep("dismissed"), "dismissed");
  assert.equal(extensionAdStep("unavailable"), "failed");
  assert.equal(extensionAdStep("error"), "failed");
});

test("extension availability: first card open, never extended, not owned - nothing else", () => {
  const firstCard = record({ status: "exhausted", usesLeft: 0, started: true, ctaShown: true });
  assert.equal(TRIAL_EXTENSION_PLAYS, 5);
  assert.equal(extensionAvailable(firstCard, false), true);
  assert.equal(extensionAvailable(firstCard, true), false, "owned");
  assert.equal(extensionAvailable({ ...firstCard, extended: true }, false), false, "already extended");
  assert.equal(extensionAvailable({ ...firstCard, ctaOutcome: "declined" }, false), false, "card answered");
  assert.equal(extensionAvailable(record(), false), false, "still active");
  assert.equal(extensionAvailable(undefined, false), false);
});
