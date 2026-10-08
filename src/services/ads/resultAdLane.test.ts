// The Classic Result's one Rewarded slot (0.57.1): whether a legal opportunity exists is the 0.57 decision unchanged;
// the coin/ink rotation only decides its content; a pending Try -> Buy CTA takes the screen and the offer stays due.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decideClassicResultLane, type ResultLaneDeps } from "./resultAdLane";

type Calls = { completed: number; claims: number; deferred: number; laneRendered: number };

function deps(over: Partial<ResultLaneDeps> & { due?: boolean; lane?: "interstitial" | "rewarded"; dueInterstitial?: boolean } = {}): { deps: ResultLaneDeps; calls: Calls } {
  const calls: Calls = { completed: 0, claims: 0, deferred: 0, laneRendered: 0 };
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
      interstitialDue: () => over.dueInterstitial ?? false,
      markLaneRendered: () => {
        calls.laneRendered++;
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
});

test("CTA on a legal Rewarded opportunity: takes the slot like an offer (lane committed as rendered); the offer stays due", () => {
  const d = deps({ pendingCtaInk: () => "rainbow" });
  assert.deepEqual(decideClassicResultLane(paying, d.deps), { kind: "cta", ink: "rainbow" });
  assert.equal(d.calls.claims, 1, "the lane is asked exactly where 0.57 asked it");
  assert.equal(d.calls.laneRendered, 1, "committed like a rendered offer, so the interstitial records what 0.57 would");
  assert.equal(d.calls.deferred, 0);
});

test("CTA yields to an interstitial that claims the screen (the CTA waits; recorded as the offer's usual deferral)", () => {
  const d = deps({ pendingCtaInk: () => "rainbow", lane: "interstitial" });
  assert.deepEqual(decideClassicResultLane(paying, d.deps), { kind: "none", decision: "pending_interstitial" });
  assert.equal(d.calls.deferred, 1);
  assert.equal(d.calls.laneRendered, 0);
});

test("CTA on a Result with no Rewarded opportunity: shown only when no treatment interstitial is due - and the lane is never asked", () => {
  for (const input of [{ coinsEarned: 0, canOfferAd: true }, { coinsEarned: 40, canOfferAd: false }]) {
    const free = deps({ pendingCtaInk: () => "diamondBlue" });
    assert.deepEqual(decideClassicResultLane(input, free.deps), { kind: "cta", ink: "diamondBlue" });
    assert.deepEqual([free.calls.claims, free.calls.laneRendered], [0, 0]);
    const busy = deps({ pendingCtaInk: () => "diamondBlue", dueInterstitial: true });
    assert.equal(decideClassicResultLane(input, busy.deps).kind, "none", "an interstitial due on this exit: the CTA waits");
    assert.deepEqual([busy.calls.claims, busy.calls.laneRendered], [0, 0]);
  }
  const notDue = deps({ due: false, pendingCtaInk: () => "rainbow" });
  assert.equal(decideClassicResultLane(paying, notDue.deps).kind, "cta");
  assert.equal(notDue.calls.claims, 0);
});

test("without a pending CTA the lane calls are exactly the 0.57 ones (claim only on 'show', no extra commit)", () => {
  for (const d of [deps(), deps({ due: false }), deps({ inkOn: () => false })]) {
    decideClassicResultLane(paying, d.deps);
    assert.equal(d.calls.laneRendered, 0, "the offer's own render commits the lane, not the decision");
  }
  const zero = deps();
  decideClassicResultLane({ coinsEarned: 0, canOfferAd: true }, zero.deps);
  assert.equal(zero.calls.claims, 0, "a zero-coin Result never claims (0.57 rule)");
});
