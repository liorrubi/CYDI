// Short campaign aliases. The property that matters most here is a negative one:
// /s/<anything> must never turn <anything> into a campaign, or our own analytics
// become writable by whoever guesses a URL.
import test from "node:test";
import assert from "node:assert/strict";

import { campaignLinkForPath, campaignRedirectUrl, CAMPAIGN_SLUGS } from "./campaignLinks.ts";
import { robotsTxt } from "./seoPages.ts";
import { resolveAttribution } from "../src/services/analyticsAttribution.ts";

const ORIGIN = "https://playcydi.com";
const EXPECTED =
  "https://playcydi.com/?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=N4H7VTj59A0";

test("/s/cat redirects to the fully tagged homepage", () => {
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/cat")), EXPECTED);
});

test("the alias is case-insensitive and tolerates a trailing slash", () => {
  for (const path of ["/s/CAT", "/s/Cat", "/s/cat/", "/s/cat//"]) {
    assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath(path)), EXPECTED, path);
  }
});

test("the redirect target resolves to exactly the intended attribution", () => {
  // Closing the loop: the URL this route produces is fed through the real landing
  // resolver, so the route and the attribution logic cannot drift apart.
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/cat")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "N4H7VTj59A0");
});

test("the creative id keeps its case through the whole round trip", () => {
  // A YouTube id is case-sensitive; lowercasing it anywhere would point the row at a
  // different video.
  assert.ok(EXPECTED.includes("N4H7VTj59A0"));
  assert.equal(CAMPAIGN_SLUGS.cat.content, "N4H7VTj59A0");
});

// --- The negative half ---

test("an unknown slug produces no campaign at all", () => {
  for (const path of ["/s/unknown", "/s/dog", "/s/", "/s/cydi_shorts", "/s/N4H7VTj59A0"]) {
    assert.equal(campaignLinkForPath(path), null, path);
    const url = campaignRedirectUrl(ORIGIN, campaignLinkForPath(path));
    assert.equal(url, "https://playcydi.com/", path);
    assert.ok(!url.includes("utm_"), `${path} must not carry any tag`);
  }
});

test("an unknown slug cannot smuggle its own text into the tags", () => {
  const hostile = "/s/" + encodeURIComponent("evil&utm_campaign=hijacked");
  const url = campaignRedirectUrl(ORIGIN, campaignLinkForPath(hostile));
  assert.equal(url, "https://playcydi.com/");
  assert.ok(!url.includes("hijacked"));
});

test("inherited object keys are not campaigns", () => {
  // A plain-object map would answer /s/constructor with Object.prototype.constructor.
  for (const path of ["/s/constructor", "/s/__proto__", "/s/tostring", "/s/hasownproperty"]) {
    assert.equal(campaignLinkForPath(path), null, path);
  }
});

test("paths that merely start with s are not aliases", () => {
  for (const path of ["/", "/shapes", "/s", "/sitemap.xml", "/how-to-play", "/c/abc123"]) {
    assert.equal(campaignLinkForPath(path), null, path);
  }
});

test("campaign aliases are kept out of the index", () => {
  assert.ok(robotsTxt().includes("Disallow: /s/"));
});

test("every configured slug is a usable, typeable alias", () => {
  // The whole point is a URL someone can read off a screen and type correctly.
  for (const [slug, link] of Object.entries(CAMPAIGN_SLUGS)) {
    assert.match(slug, /^[a-z0-9-]{1,16}$/, `slug "${slug}" must be short and lowercase`);
    assert.equal(campaignLinkForPath("/s/" + slug), link);
    for (const field of ["source", "medium", "campaign", "content"] as const) {
      assert.ok(link[field].length > 0, `${slug}.${field} must be set`);
    }
  }
});
