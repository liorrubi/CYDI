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
};

export const CAMPAIGN_PATH_PREFIX = "/s/";

/**
 * Every live alias. One entry per promoted creative; slugs are lowercase and short
 * because their entire purpose is to be legible on a phone screen and typed without
 * the viewer looking twice.
 */
export const CAMPAIGN_SLUGS: Record<string, CampaignLink> = {
  cat: { source: "youtube", medium: "shorts", campaign: "cydi_shorts", content: "N4H7VTj59A0" },
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
  const params = new URLSearchParams({
    utm_source: link.source,
    utm_medium: link.medium,
    utm_campaign: link.campaign,
    utm_content: link.content,
  });
  return `${origin}/?${params.toString()}`;
}
