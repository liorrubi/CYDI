// Proves the UMP consent module fails closed: canRequestAds is only ever true once
// the SDK's own response says so, showConsentForm() is only called when the SDK
// reports a form is actually available AND consent isn't already sufficient, and a
// throwing plugin leaves state at its fail-closed default rather than throwing out.

import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import {
  _resetConsentForTests,
  getConsentState,
  initializeConsent,
  refreshConsentAfterPrivacyOptions,
  subscribeConsentState,
  type ConsentInfoLike,
  type ConsentPluginLike,
} from "./consent";

function makePlugin(overrides: Partial<ConsentPluginLike & { requestInfo: ConsentInfoLike }>): ConsentPluginLike {
  const requestInfo: ConsentInfoLike = overrides.requestInfo ?? {
    status: "NOT_REQUIRED",
    isConsentFormAvailable: false,
    canRequestAds: true,
    privacyOptionsRequirementStatus: "NOT_REQUIRED",
  };
  return {
    requestConsentInfo: overrides.requestConsentInfo ?? (async () => requestInfo),
    showConsentForm: overrides.showConsentForm ?? (async () => requestInfo),
    showPrivacyOptionsForm: overrides.showPrivacyOptionsForm ?? (async () => undefined),
  };
}

beforeEach(() => {
  _resetConsentForTests();
});

test("state is fail-closed before anything runs", () => {
  assert.deepEqual(getConsentState(), { canRequestAds: false, privacyOptionsRequired: false });
});

test("consent not required: canRequestAds true, no form shown", async () => {
  let formShown = false;
  const plugin = makePlugin({
    requestInfo: { status: "NOT_REQUIRED", isConsentFormAvailable: false, canRequestAds: true, privacyOptionsRequirementStatus: "NOT_REQUIRED" },
    showConsentForm: async () => {
      formShown = true;
      throw new Error("must not be called");
    },
  });
  const state = await initializeConsent(plugin);
  assert.deepEqual(state, { canRequestAds: true, privacyOptionsRequired: false });
  assert.equal(formShown, false);
});

test("consent required and a form is available: shows the form and takes its final result", async () => {
  const initialInfo: ConsentInfoLike = {
    status: "REQUIRED",
    isConsentFormAvailable: true,
    canRequestAds: false,
    privacyOptionsRequirementStatus: "REQUIRED",
  };
  const afterFormInfo: ConsentInfoLike = {
    status: "OBTAINED",
    isConsentFormAvailable: true,
    canRequestAds: true,
    privacyOptionsRequirementStatus: "REQUIRED",
  };
  const plugin = makePlugin({
    requestInfo: initialInfo,
    requestConsentInfo: async () => initialInfo,
    showConsentForm: async () => afterFormInfo,
  });
  const state = await initializeConsent(plugin);
  assert.deepEqual(state, { canRequestAds: true, privacyOptionsRequired: true });
});

test("consent required but no form available: stays blocked (fail-closed), never guesses canRequestAds", async () => {
  const info: ConsentInfoLike = {
    status: "REQUIRED",
    isConsentFormAvailable: false,
    canRequestAds: false,
    privacyOptionsRequirementStatus: "REQUIRED",
  };
  const plugin = makePlugin({ requestInfo: info, showConsentForm: async () => { throw new Error("no form to show"); } });
  const state = await initializeConsent(plugin);
  assert.deepEqual(state, { canRequestAds: false, privacyOptionsRequired: true });
});

test("a throwing plugin leaves state at its fail-closed default, never throws out", async () => {
  const plugin = makePlugin({ requestConsentInfo: async () => { throw new Error("native bridge error"); } });
  const state = await initializeConsent(plugin);
  assert.deepEqual(state, { canRequestAds: false, privacyOptionsRequired: false });
});

test("subscribers are notified of the resolved state, including late subscribers reading the getter", async () => {
  const seen: boolean[] = [];
  subscribeConsentState("test", (state) => seen.push(state.canRequestAds));
  const plugin = makePlugin({
    requestInfo: { status: "NOT_REQUIRED", isConsentFormAvailable: false, canRequestAds: true, privacyOptionsRequirementStatus: "NOT_REQUIRED" },
  });
  await initializeConsent(plugin);
  assert.deepEqual(seen, [true]);
  assert.equal(getConsentState().canRequestAds, true);
});

test("refreshConsentAfterPrivacyOptions re-queries consent after the form closes, so a revoke takes effect", async () => {
  let queried = 0;
  const plugin: ConsentPluginLike = {
    requestConsentInfo: async () => {
      queried++;
      // First query (initializeConsent) grants; second query (post-privacy-options) revokes.
      return queried === 1
        ? { status: "OBTAINED", isConsentFormAvailable: true, canRequestAds: true, privacyOptionsRequirementStatus: "REQUIRED" }
        : { status: "REQUIRED", isConsentFormAvailable: true, canRequestAds: false, privacyOptionsRequirementStatus: "REQUIRED" };
    },
    showConsentForm: async () => { throw new Error("must not be called here"); },
    showPrivacyOptionsForm: async () => undefined,
  };

  const initial = await initializeConsent(plugin);
  assert.equal(initial.canRequestAds, true);

  const afterPrivacyOptions = await refreshConsentAfterPrivacyOptions(plugin);
  assert.equal(afterPrivacyOptions.canRequestAds, false, "revoking via privacy options must block future ad requests");
  assert.equal(getConsentState().canRequestAds, false);
});
