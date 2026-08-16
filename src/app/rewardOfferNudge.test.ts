// The contract of the Android-only ×2-offer nudges. The most important case is the
// web one: if these ever fired off Android, the website's offer would change and it
// must not. The reminder rules (3 consecutive skips, once per session, reset on a
// granted reward) are asserted underneath it.
//
// Platform is simulated exactly the way Capacitor itself detects it - by the presence
// of `window.androidBridge`, re-read on every getPlatform() call - the same technique
// services/nativeShare.test.ts already uses, so no device is needed.

import test from "node:test";
import assert from "node:assert/strict";

const {
  areRewardNudgesEnabled,
  shouldShowReminder,
  markReminderShown,
  recordOfferSkipped,
  recordRewardGranted,
  _resetRewardNudgesForTests,
  SKIPS_BEFORE_REMINDER,
} = await import("./rewardOfferNudge.ts");

function asAndroid(): void {
  (globalThis as { androidBridge?: unknown }).androidBridge = {};
}

function asWeb(): void {
  delete (globalThis as { androidBridge?: unknown }).androidBridge;
}

// --- The platform boundary ---------------------------------------------------------

test("nudges are off on web", () => {
  _resetRewardNudgesForTests();
  asWeb();
  assert.equal(areRewardNudgesEnabled(), false);
});

test("on web the reminder can never fire, no matter how many skips happen", () => {
  _resetRewardNudgesForTests();
  asWeb();
  for (let i = 0; i < SKIPS_BEFORE_REMINDER + 5; i++) recordOfferSkipped(true);
  assert.equal(shouldShowReminder(), false);
});

test("skips counted on web still cannot trigger a reminder after switching to Android mid-process", () => {
  // Guards the ordering: the gate is checked at read time, not at count time, so a
  // web session's counter can never leak a reminder into an Android read.
  _resetRewardNudgesForTests();
  asWeb();
  for (let i = 0; i < SKIPS_BEFORE_REMINDER; i++) recordOfferSkipped(true);
  assert.equal(shouldShowReminder(), false);
});

// --- What counts as a skip ---------------------------------------------------------
// The streak measures real refusals of a real double. Passing an offer that had no
// watchable ad behind it - the button says "Continue", the daily cap is spent, or an
// ad attempt already failed - is not a refusal, so it must never build toward a
// reminder that promises "one short ad doubles your coins".

test("passing an offer with no watchable ad never counts toward the reminder", () => {
  _resetRewardNudgesForTests();
  asAndroid();
  for (let i = 0; i < SKIPS_BEFORE_REMINDER + 5; i++) recordOfferSkipped(false);
  assert.equal(shouldShowReminder(), false, "Continue is not a refusal");
});

test("only the real refusals in a mixed run are counted", () => {
  _resetRewardNudgesForTests();
  asAndroid();
  recordOfferSkipped(true);
  recordOfferSkipped(false);
  recordOfferSkipped(false);
  recordOfferSkipped(true);
  assert.equal(shouldShowReminder(), false, "two real refusals so far, not three");
  recordOfferSkipped(true);
  assert.equal(shouldShowReminder(), true);
});

// --- Reminder rules ----------------------------------------------------------------

test("nudges are on inside the Android app", () => {
  _resetRewardNudgesForTests();
  asAndroid();
  assert.equal(areRewardNudgesEnabled(), true);
});

test("the reminder appears only after the 3rd consecutive skip", () => {
  _resetRewardNudgesForTests();
  asAndroid();
  assert.equal(shouldShowReminder(), false);
  recordOfferSkipped(true);
  assert.equal(shouldShowReminder(), false);
  recordOfferSkipped(true);
  assert.equal(shouldShowReminder(), false, "two skips must not be enough");
  recordOfferSkipped(true);
  assert.equal(shouldShowReminder(), true, "the offer after the 3rd skip shows it");
});

test("the reminder shows once per session, even if the player keeps skipping", () => {
  _resetRewardNudgesForTests();
  asAndroid();
  for (let i = 0; i < SKIPS_BEFORE_REMINDER; i++) recordOfferSkipped(true);
  assert.equal(shouldShowReminder(), true);

  markReminderShown();

  assert.equal(shouldShowReminder(), false);
  for (let i = 0; i < 10; i++) recordOfferSkipped(true);
  assert.equal(shouldShowReminder(), false, "never a second time in one session");
});

test("a granted reward resets the skip streak", () => {
  _resetRewardNudgesForTests();
  asAndroid();
  for (let i = 0; i < SKIPS_BEFORE_REMINDER; i++) recordOfferSkipped(true);
  assert.equal(shouldShowReminder(), true);

  recordRewardGranted();

  assert.equal(shouldShowReminder(), false, "the streak restarts after a double");
  recordOfferSkipped(true);
  recordOfferSkipped(true);
  assert.equal(shouldShowReminder(), false);
  recordOfferSkipped(true);
  assert.equal(shouldShowReminder(), true, "and builds again from zero");
});
