/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Short, human-readable campaign aliases: /s/<slug> redirects to the homepage
// carrying that campaign's UTM tags, so a link can be read off the screen in a
// YouTube Short and typed by hand. A raw video id (playcydi.com/s/N4H7VTj59A0) is no
// more typeable than the full tagged URL, which is the whole reason this exists.
//
// The mapping is explicit and server-side, never derived from the slug. /s/<anything>
// does NOT become utm_content=<anything>: an unrecognized slug redirects to a clean
// homepage with no tags at all, so nobody can mint campaign rows in our analytics by
// guessing URLs, and a typo cannot invent a creative that never ran. Attribution
// itself is untouched - this route only produces the same tagged URL a hand-written
// link would, and analyticsAttribution.ts resolves it exactly as before.

export type CampaignLink = {
  source: string;
  medium: string;
  campaign: string;
  /** The creative this alias stands for - for CYDI, the YouTube video id, case-sensitive. */
  content: string;
  /**
   * Where the alias lands, when the homepage is not the right answer. Used where a
   * Short has a page of its own that continues it - /s/dog opens the dog challenge
   * the video was about, so the viewer draws the shape they just watched instead of
   * arriving at the generic home screen and having to find it.
   *
   * A landing path only: it is one of our own SEO landing pages, and the tags are
   * appended to it exactly as they would be on the homepage, so attribution
   * resolves identically either way.
   */
  path?: string;
};

export const CAMPAIGN_PATH_PREFIX = "/s/";

/**
 * Every live alias. One entry per promoted creative; slugs are lowercase and short
 * because their entire purpose is to be legible on a phone screen and typed without
 * the viewer looking twice.
 */
export const CAMPAIGN_SLUGS: Record<string, CampaignLink> = {
  // Corrected 22 Sep 2026: this carried N4H7VTj59A0, which is a different Short
  // ("Can You Beat This Score?"), so every /s/cat click was filed under the wrong
  // creative. The Cat Short is 28ntXVUs-cs, read from the live channel. Rows already
  // recorded under the old id are left exactly as they are - they are a real record of
  // what the redirect did at the time, and rewriting analytics history would be worse
  // than a documented break in the series.
  cat: {
    source: "youtube",
    medium: "shorts",
    campaign: "cydi_shorts",
    content: "28ntXVUs-cs",
    path: "/draw-a-cat-from-memory",
  },
  dog: {
    source: "youtube",
    medium: "shorts",
    campaign: "cydi_shorts",
    content: "n8aojqnxidc",
    path: "/draw-a-dog-from-memory",
  },
  bear: {
    source: "youtube",
    medium: "shorts",
    campaign: "cydi_shorts",
    content: "OTByR2NtJk4",
    path: "/draw-a-bear-from-memory",
  },
  owl: {
    source: "youtube",
    medium: "shorts",
    campaign: "cydi_shorts",
    content: "FuEiFnzQuSY",
    path: "/draw-an-owl-from-memory",
  },
  pig: {
    source: "youtube",
    medium: "shorts",
    campaign: "cydi_shorts",
    content: "yfj8ZejJdVs",
    path: "/draw-a-pig-from-memory",
  },
  snail: {
    source: "youtube",
    medium: "shorts",
    campaign: "cydi_shorts",
    content: "w8zzhQOdSas",
    path: "/draw-a-snail-from-memory",
  },
  // The star Short is the first in the experimental format, and the first whose
  // landing page already existed: /draw-a-perfect-star predates the Shorts series,
  // so this alias adds a destination rather than creating one.
  star: {
    source: "youtube",
    medium: "shorts",
    campaign: "cydi_shorts",
    content: "vcbiASLg-Gk",
    path: "/draw-a-perfect-star",
  },
  // The lightning bolt is the second Short in the experimental format, published to
  // test whether the star's reach was the format rather than the subject.
  lightning: {
    source: "youtube",
    medium: "shorts",
    campaign: "cydi_shorts",
    content: "UWZ8uIOM3XU",
    path: "/draw-a-lightning-bolt-from-memory",
  },
  // Third Short in the experimental format. Its drawing was produced by the capture
  // tool's target tracer rather than by a person, so nothing in the Short or its copy
  // claims a human scored it - the alias just carries the attribution.
  triangle: {
    source: "youtube",
    medium: "shorts",
    campaign: "cydi_shorts",
    content: "ZbkTMF7LTTE",
    path: "/draw-a-triangle-from-memory",
  },
};

/**
 * The campaign for this path, or null when the path is not an alias or the slug is
 * not one of ours.
 *
 * Looked up with an own-property check rather than a plain index, so inherited keys
 * ("constructor", "toString", "__proto__") cannot resolve to something that is not a
 * campaign at all.
 */
export function campaignLinkForPath(pathname: string): CampaignLink | null {
  if (!pathname.startsWith(CAMPAIGN_PATH_PREFIX)) return null;
  const slug = pathname.slice(CAMPAIGN_PATH_PREFIX.length).replace(/\/+$/, "").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CAMPAIGN_SLUGS, slug)) return null;
  return CAMPAIGN_SLUGS[slug];
}

/**
 * Where an alias sends the visitor: the homepage, tagged from the MAP's values.
 *
 * Nothing from the request reaches the query string. A null link (unknown slug) lands
 * on the bare homepage - still attributable by referrer, which is correct, but
 * carrying no campaign, which is the point.
 */
export function campaignRedirectUrl(origin: string, link: CampaignLink | null): string {
  if (link === null) return `${origin}/`;
  // The landing path comes from the MAP, never from the request, for the same reason
  // the tags do: a path taken from the URL would let anyone aim our campaign traffic
  // anywhere, including off-site.
  const target = link.path ?? "/";
  const params = new URLSearchParams({
    utm_source: link.source,
    utm_medium: link.medium,
    utm_campaign: link.campaign,
    utm_content: link.content,
  });
  return `${origin}${target}?${params.toString()}`;
}
