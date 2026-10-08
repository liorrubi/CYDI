// The Classic Result's one Rewarded slot (0.58.0): whether a legal opportunity exists is the 0.57 decision unchanged;
// the coin/ink rotation only decides its content; a pending Try -> Buy CTA owns its Result (interstitial deferred,
// Rewarded offer left due).

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decideClassicResultLane, type ResultLaneDeps } from "./resultAdLane";

type Calls = { completed: number; claims: number; deferred: number; interstitialDeferrals: number };

function deps(over: Partial<ResultLaneDeps> & { due?: boolean; lane?: "interstitial" | "rewarded"; interstitialDueOnExit?: boolean } = {}): { deps: ResultLaneDeps; calls: Calls } {
  const calls: Calls = { completed: 0, claims: 0, deferred: 0, interstitialDeferrals: 0 };
  const due = over.due ?? true;
  const lane = over.lane ?? "rewarded";
  return {
    calls,
    deps: {
      recordGameCompleted: () => {
        calls.completed++;
        return due;
      },
      claimLane: () => {
        calls.claims++;
        return lane;
      },
      recordDeferred: () => {
        calls.deferred++;
      },
      deferInterstitial: () => {
        calls.interstitialDeferrals++;
        return over.interstitialDueOnExit ?? false;
      },
      pendingCtaInk: () => null,
      inkOn: () => true,
      scheduledSlot: () => "ink",
      eligibleInk: () => "rainbow",
      ...over,
    },
  };
}

const paying = { coinsEarned: 40, canOfferAd: true };

test("the rewarded cadence advances exactly once per round, whatever the outcome", () => {
  for (const d of [deps(), deps({ due: false }), deps({ lane: "interstitial" }), deps({ pendingCtaInk: () => "rainbow" })]) {
    decideClassicResultLane(paying, d.deps);
    assert.equal(d.calls.completed, 1);
  }
});

test("Ink never creates an opportunity: not due / no coins / no ad capability -> no offer (and no lane claim)", () => {
  const notDue = deps({ due: false });
  assert.deepEqual(decideClassicResultLane(paying, notDue.deps), { kind: "none", decision: "not_due" });
  assert.equal(notDue.calls.claims, 0);
  assert.deepEqual(decideClassicResultLane({ coinsEarned: 0, canOfferAd: true }, deps().deps), { kind: "none", decision: "pending_no_coins" });
  assert.deepEqual(decideClassicResultLane({ coinsEarned: 40, canOfferAd: false }, deps().deps), { kind: "none", decision: "pending_no_ad" });
});

test("the interstitial still wins its claimed screen: pending_interstitial, recorded as deferred, no offer", () => {
  const d = deps({ lane: "interstitial" });
  assert.deepEqual(decideClassicResultLane(paying, d.deps), { kind: "none", decision: "pending_interstitial" });
  assert.equal(d.calls.deferred, 1);
  assert.equal(d.calls.interstitialDeferrals, 0, "only the CTA defers an interstitial");
});

test("rotation content: scheduled ink + eligible ink -> Ink; scheduled coin -> coin even with an eligible ink; no eligible ink -> coin fallback", () => {
  assert.deepEqual(decideClassicResultLane(paying, deps().deps), { kind: "offer", content: { kind: "ink", ink: "rainbow", rotationSlot: "ink" } });
  assert.deepEqual(decideClassicResultLane(paying, deps({ scheduledSlot: () => "coin" }).deps), { kind: "offer", content: { kind: "coin", rotationSlot: "coin" } });
  assert.deepEqual(decideClassicResultLane(paying, deps({ eligibleInk: () => null }).deps), { kind: "offer", content: { kind: "coin", rotationSlot: "ink" } });
});

test("Ink OFF: the 0.57 coin offer exactly - the rotation and eligibility are not even read", () => {
  let read = 0;
  const d = deps({
    inkOn: () => false,
    scheduledSlot: () => {
      read++;
      return "ink";
    },
    eligibleInk: () => {
      read++;
      return "rainbow";
    },
  });
  assert.deepEqual(decideClassicResultLane(paying, d.deps), { kind: "offer", content: { kind: "coin" } });
  assert.equal(read, 0);
  assert.equal(d.calls.interstitialDeferrals, 0);
});

test("Try -> Buy priority: a pending CTA owns its Result - no lane claim, no Rewarded offer, the interstitial deferred", () => {
  for (const input of [paying, { coinsEarned: 0, canOfferAd: true }, { coinsEarned: 40, canOfferAd: false }]) {
    for (const due of [true, false]) {
      for (const lane of ["interstitial", "rewarded"] as const) {
        const d = deps({ pendingCtaInk: () => "rainbow", due, lane, interstitialDueOnExit: true });
        assert.deepEqual(decideClassicResultLane(input, d.deps), { kind: "cta", ink: "rainbow", deferredInterstitial: true });
        assert.equal(d.calls.claims, 0, "the lane is never claimed by the CTA (no reservation spent)");
        assert.equal(d.calls.interstitialDeferrals, 1);
        assert.equal(d.calls.deferred, 0, "not the Rewarded offer's interstitial deferral");
      }
    }
  }
});

test("the CTA reports whether an interstitial was actually due (deferredInterstitial false when nothing was due)", () => {
  const d = deps({ pendingCtaInk: () => "diamondBlue", interstitialDueOnExit: false });
  assert.deepEqual(decideClassicResultLane(paying, d.deps), { kind: "cta", ink: "diamondBlue", deferredInterstitial: false });
});
