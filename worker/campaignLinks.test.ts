// Short campaign aliases. The property that matters most here is a negative one:
// /s/<anything> must never turn <anything> into a campaign, or our own analytics
// become writable by whoever guesses a URL.
import test from "node:test";
import assert from "node:assert/strict";

import { campaignLinkForPath, campaignRedirectUrl, CAMPAIGN_SLUGS } from "./campaignLinks.ts";
import { robotsTxt, LANDING_PATHS } from "./seoPages.ts";
import { resolveAttribution } from "../src/services/analyticsAttribution.ts";

const ORIGIN = "https://playcydi.com";
const EXPECTED =
  "https://playcydi.com/draw-a-cat-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=N4H7VTj59A0";
const EXPECTED_DOG =
  "https://playcydi.com/draw-a-dog-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=n8aojqnxidc";
const EXPECTED_BEAR =
  "https://playcydi.com/draw-a-bear-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=OTByR2NtJk4";
const EXPECTED_OWL =
  "https://playcydi.com/draw-an-owl-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=FuEiFnzQuSY";

test("/s/cat redirects to the fully tagged cat challenge", () => {
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

test("/s/dog lands on the dog challenge page, tagged, not on the homepage", () => {
  // The point of this alias: someone who just watched the Dog Short gets the dog
  // challenge itself, not a home screen they then have to navigate.
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/dog")), EXPECTED_DOG);
  assert.equal(new URL(EXPECTED_DOG).pathname, "/draw-a-dog-from-memory");
});

test("/s/dog resolves to exactly the Dog Short's attribution", () => {
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/dog")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "n8aojqnxidc");
});

test("a landing path is only ever taken from the map", () => {
  // Every alias lands on the challenge its Short was about - the cat's page was
  // added after its Short, so this one moved off the homepage deliberately. Its
  // tags did not change with it.
  assert.equal(CAMPAIGN_SLUGS.cat.path, "/draw-a-cat-from-memory");
  assert.equal(CAMPAIGN_SLUGS.cat.content, "N4H7VTj59A0");
  // And every path in the map is one of our own landing pages, never an off-site URL.
  for (const [slug, link] of Object.entries(CAMPAIGN_SLUGS)) {
    if (link.path === undefined) continue;
    assert.ok(link.path.startsWith("/"), `${slug} path is not site-relative`);
    assert.ok(!link.path.startsWith("//"), `${slug} path could leave the site`);
    assert.ok(LANDING_PATHS.includes(link.path), `${slug} points at ${link.path}, which is not a landing page`);
  }
});

// --- The negative half ---

test("an unknown slug produces no campaign at all", () => {
  for (const path of ["/s/unknown", "/s/bird", "/s/", "/s/cydi_shorts", "/s/N4H7VTj59A0"]) {
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

test("/s/bear lands on the bear challenge page, tagged, not on the homepage", () => {
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/bear")), EXPECTED_BEAR);
  assert.equal(new URL(EXPECTED_BEAR).pathname, "/draw-a-bear-from-memory");
});

test("/s/bear resolves to exactly the Bear Short's attribution", () => {
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/bear")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "OTByR2NtJk4");
});

test("the bear creative id keeps its case", () => {
  // OTByR2NtJk4 - two capitals in a row and a lone lowercase y. Lowercasing it
  // anywhere would point the analytics row at a video that does not exist.
  assert.equal(CAMPAIGN_SLUGS.bear.content, "OTByR2NtJk4");
  assert.ok(EXPECTED_BEAR.includes("utm_content=OTByR2NtJk4"));
});

test("/s/owl lands on the owl challenge page, tagged, not on the homepage", () => {
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/owl")), EXPECTED_OWL);
  assert.equal(new URL(EXPECTED_OWL).pathname, "/draw-an-owl-from-memory");
});

test("/s/owl resolves to exactly the Owl Short's attribution", () => {
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/owl")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "FuEiFnzQuSY");
});

test("the owl creative id keeps its case", () => {
  // FuEiFnzQuSY alternates case in a way no reader would reproduce from a screenshot.
  assert.equal(CAMPAIGN_SLUGS.owl.content, "FuEiFnzQuSY");
  assert.ok(EXPECTED_OWL.includes("utm_content=FuEiFnzQuSY"));
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
