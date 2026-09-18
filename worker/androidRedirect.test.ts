// The branded install link. /android exists so a shared link reads playcydi.com
// instead of a store URL; the property worth protecting is that the destination is
// ours and only ours - the request may add campaign tags, never a different app.
import test from "node:test";
import assert from "node:assert/strict";

import { ANDROID_PATH, PLAY_STORE_URL, androidRedirectUrl, robotsTxt } from "./seoPages.ts";

test("/android with no query lands on exactly the Play listing", () => {
  assert.equal(androidRedirectUrl(""), PLAY_STORE_URL);
});

test("utm tags ride along, so a campaign link keeps its labels", () => {
  const target = new URL(androidRedirectUrl("?utm_source=facebook&utm_medium=page&utm_campaign=google_play"));
  assert.equal(target.origin + target.pathname, "https://play.google.com/store/apps/details");
  assert.equal(target.searchParams.get("id"), "com.playcydi.cydi");
  assert.equal(target.searchParams.get("utm_source"), "facebook");
  assert.equal(target.searchParams.get("utm_medium"), "page");
  assert.equal(target.searchParams.get("utm_campaign"), "google_play");
});

test("nothing but utm_* is forwarded, and the app id cannot be overridden", () => {
  // The whole point of the allowlist: `id` is what Play installs from, so an incoming
  // one must not reach the store, and no other parameter has any business there.
  const target = new URL(androidRedirectUrl("?id=com.someone.else&hl=de&utm_source=facebook"));
  assert.deepEqual([...target.searchParams.keys()].sort(), ["id", "utm_source"]);
  assert.equal(target.searchParams.get("id"), "com.playcydi.cydi");
});

test("the redirect cannot loop back into the site", () => {
  for (const search of ["", "?utm_source=x", "?id=com.someone.else"]) {
    assert.ok(androidRedirectUrl(search).startsWith("https://play.google.com/"), search);
  }
});

test("robots.txt keeps the install route out of the index", () => {
  assert.ok(robotsTxt().includes(`Disallow: ${ANDROID_PATH}`));
});
