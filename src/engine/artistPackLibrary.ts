import type { DrawingPath } from "../types/Challenge";
import { toPathFromParts, type CategoryId, type ShapeDefinition } from "./shapeLibrary";

/**
 * Artist Packs — themed drawing-challenge packs built around a real artist's
 * work. Like megaShapeLibrary, this is a SEPARATE curated collection: the
 * artworks satisfy the same `ShapeDefinition` contract (so ShapePreviewIcon /
 * DrawingCanvas / scoreAttempt work unchanged) but are deliberately NOT part of
 * SHAPE_LIBRARY, so they never inflate journey progress or the "unlock every
 * shape" achievement.
 *
 * CONTENT IS ADMIN-AUTHORED AND BAKED IN. There is intentionally no runtime
 * upload path anywhere in the app: artwork line-art is produced offline by the
 * admin (the `trace-shape-from-image` skill for traced art, or `improve-shape`
 * for hand-built) and committed like any other shape. External artists submit
 * work out-of-band; they never touch the repo, a form, or an endpoint.
 */

/** A short public profile for an artist, shown on their pack card and detail page. */
export type ArtistProfile = {
  id: string;
  name: string;
  /** Styled emoji/icon (the game ships no raster images); admin-set. */
  avatarIcon: string;
  bio: string;
  /** Canonical site/store link, opened via the leave-game confirmation. */
  externalUrl: string;
  // ---- Reserved for a future affiliate program. Present now so enabling it
  // later needs no data-shape or UI change (see the Artist Packs plan). ----
  /** When set, used verbatim as the outbound target (a complete, ready-to-use URL). */
  affiliateUrl?: string;
  /** OPTIONAL analytics-only correlation id. Deliberately NOT used to build the
   * outbound URL — the owner supplies a complete `affiliateUrl` when needed. */
  affiliateLinkId?: string;
};

/**
 * Owner-controlled publishing lifecycle for a single artwork. Converted artwork
 * begins as `"draft"`; the owner promotes it to `"approved"` after review, and
 * finally to `"published"`. ONLY `"published"` artwork is ever shown to players
 * (enforced by `getPublishedArtworks` / `getPlayerFacingPacks` below). There is
 * no automatic promotion and no admin panel — status is set by the owner in
 * source and shipped through the normal review + deploy flow.
 */
export type ArtworkStatus = "draft" | "approved" | "published";

/**
 * One drawable artwork inside a pack. `sourceImageUrl` is an OPTIONAL admin-set
 * URL to the artist's hosted original, shown for credit/context only — it is
 * never an upload target and is never traced at runtime.
 */
export type ArtistArtworkDefinition = ShapeDefinition & {
  packId: string;
  /** Publishing status — players only ever see `"published"` artwork. */
  status: ArtworkStatus;
  sourceImageUrl?: string;
};

export type ArtistPackDefinition = {
  id: string;
  artist: ArtistProfile;
  /** Pack display name. */
  name: string;
  /** Optional development-only flag: such a pack never appears in a production
   * build regardless of artwork status (filtered when `import.meta.env.PROD`). */
  devOnly?: boolean;
  artworks: ArtistArtworkDefinition[];
};

// Artist Packs are always free to access — there is deliberately no unlock cost,
// coin charge, or purchase step. Publishing gating alone (below) controls what
// players can see.

const ARTWORK_CATEGORY: CategoryId = "nature";

// Pixel-traced portrait (from a reference line-art image via the
// trace-shape-from-image pipeline): Otsu threshold -> skeletonize ->
// skeleton-graph walk -> junction stitching -> RDP, normalized with the source
// ~0.539 w:h aspect preserved and centered. 48 disconnected strokes / 355 pts;
// each row is one continuous stroke as normalized [x, y] pairs.
const PORTRAIT_PARTS: [number, number][][] = [
  [[0.2831, 1.0], [0.2382, 0.8828], [0.2307, 0.847], [0.2307, 0.818], [0.2365, 0.7847], [0.2581, 0.7224], [0.2706, 0.6758], [0.2714, 0.6409], [0.2806, 0.6027], [0.2856, 0.5636], [0.2856, 0.532], [0.2789, 0.4879], [0.3014, 0.3882], [0.3022, 0.325], [0.3055, 0.2993], [0.3438, 0.1887], [0.3595, 0.1297], [0.372, 0.1014], [0.3903, 0.0723], [0.4219, 0.0391], [0.4668, 0.0116], [0.5025, 0.0017], [0.52, 0.0025], [0.5241, 0.0067]],
  [[0.51, 0.0424], [0.5233, 0.0075], [0.5374, 0.0], [0.5557, 0.0], [0.5699, 0.0042], [0.5906, 0.0133], [0.6164, 0.0308], [0.658, 0.0665], [0.6837, 0.1006], [0.6945, 0.1214], [0.7053, 0.1571], [0.7195, 0.182], [0.727, 0.2028], [0.7311, 0.2269], [0.7353, 0.2934], [0.7361, 0.3541], [0.7577, 0.4572], [0.7561, 0.5603], [0.7669, 0.6101], [0.7694, 0.6359], [0.766, 0.6683], [0.7502, 0.7332], [0.7519, 0.8113], [0.7452, 0.8845]],
  [[0.6663, 0.9368], [0.6837, 0.8903], [0.6995, 0.8304], [0.7103, 0.7756], [0.7128, 0.7456], [0.7103, 0.6858], [0.6962, 0.5835], [0.697, 0.5428], [0.7087, 0.4688], [0.712, 0.419], [0.6979, 0.3267], [0.6954, 0.2303], [0.6887, 0.1953], [0.6829, 0.1837]],
  [[0.3512, 0.2851], [0.3487, 0.2876], [0.3496, 0.3134], [0.3363, 0.3807], [0.3371, 0.4539], [0.3271, 0.522], [0.3313, 0.6093], [0.3055, 0.7066], [0.2964, 0.7639], [0.298, 0.8254], [0.3196, 0.9485], [0.3196, 1.0]],
  [[0.5989, 0.4863], [0.6264, 0.458], [0.643, 0.4306], [0.6571, 0.3691], [0.658, 0.3408], [0.6555, 0.3383], [0.653, 0.2702], [0.6355, 0.1987], [0.6364, 0.1762], [0.6339, 0.1671], [0.6264, 0.1596], [0.5965, 0.1471], [0.5632, 0.1122], [0.5541, 0.1064], [0.5358, 0.1031], [0.5167, 0.1072], [0.5108, 0.1031], [0.5142, 0.0599], [0.5125, 0.0441], [0.51, 0.0416]],
  [[0.4269, 0.9958], [0.4252, 0.9651], [0.4069, 0.8795], [0.4053, 0.8279], [0.4136, 0.7864], [0.4352, 0.724], [0.4518, 0.665], [0.4568, 0.6259], [0.4568, 0.6043], [0.4518, 0.5744], [0.4568, 0.552], [0.4635, 0.5436], [0.4826, 0.5295]],
  [[0.5366, 0.8986], [0.5258, 0.852], [0.5216, 0.8204], [0.5241, 0.7573], [0.5358, 0.7099], [0.564, 0.6401], [0.5748, 0.5586], [0.5856, 0.5187], [0.5989, 0.4855]],
  [[0.4028, 0.3292], [0.4011, 0.3142], [0.3886, 0.2785], [0.3861, 0.2627], [0.392, 0.2228], [0.3903, 0.182], [0.3945, 0.1621], [0.4011, 0.1538], [0.4227, 0.1388], [0.4502, 0.1131], [0.4618, 0.1072], [0.4859, 0.1081], [0.4934, 0.1039], [0.5042, 0.0698], [0.5058, 0.0449], [0.51, 0.0416]],
  [[0.6272, 0.2303], [0.6264, 0.2186], [0.6181, 0.2086], [0.5948, 0.2028], [0.5699, 0.2012], [0.5516, 0.2053], [0.5333, 0.2053], [0.5316, 0.217], [0.5358, 0.2203], [0.5507, 0.2203], [0.5732, 0.2161], [0.6014, 0.2161], [0.6147, 0.2211], [0.628, 0.2319]],
  [[0.5433, 0.4339], [0.5748, 0.4248], [0.5906, 0.409], [0.5898, 0.3982], [0.5815, 0.3832], [0.5541, 0.3716], [0.5216, 0.3674], [0.4925, 0.3741], [0.4801, 0.3807], [0.4701, 0.3907], [0.461, 0.409]],
  [[0.5998, 0.4855], [0.5782, 0.4921], [0.5424, 0.5096], [0.5233, 0.5121], [0.5, 0.5079], [0.4659, 0.4855], [0.4443, 0.4572], [0.4269, 0.4256], [0.4227, 0.4231]],
  [[0.5965, 0.384], [0.5848, 0.3666], [0.5732, 0.3574], [0.5399, 0.3466], [0.5258, 0.3491], [0.505, 0.3475], [0.4693, 0.3666], [0.4585, 0.3766], [0.451, 0.399], [0.4551, 0.4081], [0.461, 0.4081]],
  [[0.4094, 0.2336], [0.4111, 0.2269], [0.4194, 0.217], [0.4369, 0.2078], [0.4801, 0.2062], [0.4909, 0.2103], [0.4967, 0.2178], [0.495, 0.2244], [0.4776, 0.2203], [0.456, 0.2203], [0.4352, 0.2236], [0.4094, 0.2328]],
  [[0.3895, 0.3525], [0.3787, 0.3367], [0.3554, 0.2893], [0.3504, 0.2843], [0.3529, 0.2635], [0.3512, 0.2411], [0.3587, 0.2336], [0.3654, 0.2344], [0.3695, 0.2394], [0.3712, 0.2693], [0.3778, 0.2768], [0.3886, 0.2785]],
  [[0.4227, 0.4239], [0.4036, 0.3666], [0.4011, 0.3425], [0.4028, 0.3283], [0.4069, 0.3283], [0.4136, 0.3416], [0.4335, 0.3633], [0.446, 0.3932], [0.451, 0.3982]],
  [[0.4227, 0.4231], [0.4186, 0.4347], [0.4186, 0.4713], [0.4219, 0.4963], [0.436, 0.5445], [0.4477, 0.5719], [0.4518, 0.5752]],
  [[0.569, 0.6068], [0.5433, 0.6068], [0.5142, 0.5919], [0.4942, 0.5711], [0.4867, 0.5536], [0.4876, 0.5428], [0.4826, 0.5295]],
  [[0.5965, 0.4007], [0.5965, 0.3832], [0.6048, 0.3558], [0.6314, 0.3275], [0.6422, 0.3109], [0.6488, 0.2934], [0.653, 0.2901]],
  [[0.4269, 0.251], [0.451, 0.2377], [0.4576, 0.2386], [0.461, 0.2361], [0.4776, 0.2402], [0.4851, 0.2444], [0.4867, 0.2485], [0.4718, 0.2577], [0.4526, 0.2602], [0.4352, 0.2544]],
  [[0.5748, 0.3799], [0.569, 0.3849], [0.5482, 0.3849], [0.5366, 0.3882], [0.5083, 0.3865], [0.4942, 0.3907], [0.4792, 0.3907], [0.4743, 0.3874]],
  [[0.6829, 0.2569], [0.6837, 0.271], [0.6754, 0.2976], [0.6738, 0.3283], [0.6671, 0.3342]],
  [[0.5383, 0.2319], [0.5507, 0.2253], [0.584, 0.2244], [0.594, 0.2269], [0.6114, 0.2377]],
  [[0.5457, 0.4323], [0.5449, 0.4256], [0.5358, 0.409], [0.5108, 0.4106], [0.5017, 0.4364]],
  [[0.6364, 0.1787], [0.6696, 0.2128], [0.6796, 0.2186], [0.6937, 0.2211]],
  [[0.4851, 0.2328], [0.4718, 0.2278], [0.4518, 0.2286], [0.4377, 0.2336], [0.4236, 0.2461]],
  [[0.5042, 0.3001], [0.5034, 0.2502], [0.4992, 0.2328]],
  [[0.6023, 0.2419], [0.5965, 0.2494], [0.5848, 0.2535], [0.5657, 0.2519], [0.5466, 0.2436]],
  [[0.5408, 0.2477], [0.5524, 0.2369], [0.5715, 0.2303], [0.5873, 0.2319], [0.5931, 0.2369]],
  [[0.4601, 0.4081], [0.4693, 0.4131], [0.4909, 0.4364], [0.5, 0.4381], [0.5025, 0.4356]],
  [[0.5557, 0.3275], [0.5541, 0.3184], [0.5366, 0.2951], [0.5333, 0.2801]],
  [[0.367, 0.1978], [0.3845, 0.1687], [0.3945, 0.1621]],
  [[0.6887, 0.2594], [0.6796, 0.256], [0.6663, 0.2693], [0.653, 0.2702]],
  [[0.5665, 0.2328], [0.5682, 0.2411], [0.574, 0.2461], [0.5848, 0.2461], [0.5931, 0.2369]],
  [[0.3911, 0.325], [0.3903, 0.3159], [0.3828, 0.3017], [0.3837, 0.2943], [0.387, 0.2918]],
  [[0.4626, 0.5445], [0.4635, 0.5362], [0.4743, 0.5104]],
  [[0.4044, 0.3699], [0.3928, 0.3716], [0.387, 0.3666], [0.3853, 0.3549], [0.3886, 0.3516]],
  [[0.6671, 0.3333], [0.6688, 0.3483], [0.6638, 0.3533], [0.6571, 0.3533]],
  [[0.663, 0.3042], [0.6663, 0.2926], [0.6638, 0.2785]],
  [[0.4676, 0.4871], [0.4743, 0.5112]],
  [[0.4826, 0.5303], [0.4776, 0.5129], [0.4743, 0.5104]],
  [[0.4684, 0.2386], [0.4676, 0.2485], [0.4576, 0.2552]],
  [[0.4585, 0.2544], [0.4518, 0.2535], [0.4477, 0.2494], [0.446, 0.2419]],
  [[0.6098, 0.2461], [0.5998, 0.2386], [0.5923, 0.2369]],
  [[0.4867, 0.552], [0.4817, 0.547], [0.4784, 0.5345]],
  [[0.4028, 0.3608], [0.3953, 0.3608], [0.392, 0.3533]],
  [[0.4019, 0.3525], [0.3878, 0.3525]],
  [[0.5058, 0.3392], [0.5009, 0.335], [0.4942, 0.3342]],
  [[0.5349, 0.3392], [0.5457, 0.3333]],
];

function tracedPortrait(size: number): DrawingPath {
  const map = (n: number) => (0.06 + n * 0.88) * size;
  const parts = PORTRAIT_PARTS.map((part) => part.map(([x, y]) => ({ x: map(x), y: map(y) })));
  return toPathFromParts(parts, size);
}

function artwork(
  id: string,
  name: string,
  packId: string,
  status: ArtworkStatus,
  generate: (size: number) => DrawingPath,
  sourceImageUrl?: string,
): ArtistArtworkDefinition {
  return { id, name, category: ARTWORK_CATEGORY, packId, status, generate, sourceImageUrl };
}

/**
 * Nimco Design — a real artist pack awaiting reviewed content. It currently has
 * NO published artwork, so it is hidden from players (see `getPlayerFacingPacks`).
 * The traced portrait sits as `"draft"`: reviewable in development, never shown
 * to players until the owner explicitly promotes it to `"published"`.
 */
const nimcoPack: ArtistPackDefinition = {
  id: "nimco",
  name: "Nimco Design",
  artist: {
    id: "nimrod-cohen",
    name: "Nimrod Cohen",
    avatarIcon: "🎨",
    bio: "Impact Through Design",
    externalUrl: "https://nimco.co.il/",
    // affiliateUrl / affiliateLinkId intentionally omitted until configured.
  },
  artworks: [
    // Draft pending the owner's explicit approval. Wrapped in a DEV-only guard so
    // its data (and the traced likeness) is tree-shaken OUT of the production
    // bundle entirely — it exists only in development for review, never ships.
    ...(import.meta.env.DEV
      ? [artwork("nimco-portrait", "TEMP POC Portrait", "nimco", "draft", tracedPortrait)]
      : []),
  ],
};

const ALL_ARTIST_PACKS: ArtistPackDefinition[] = [nimcoPack];

export function getArtistPackById(id: string): ArtistPackDefinition | undefined {
  return ALL_ARTIST_PACKS.find((pack) => pack.id === id);
}

/** The published (player-facing) artworks of a pack — the single choke-point
 * every player-facing surface must go through. Never returns draft/approved. */
export function getPublishedArtworks(pack: ArtistPackDefinition): ArtistArtworkDefinition[] {
  return pack.artworks.filter((art) => art.status === "published");
}

/**
 * Artworks to render in the pack UI: PUBLISHED only for players. In a
 * development build, all artworks (draft/approved included) are also shown so
 * the owner can review unpublished work — this is a read-only dev preview, not
 * an admin panel, and it never affects production.
 */
export function getVisibleArtworks(pack: ArtistPackDefinition): ArtistArtworkDefinition[] {
  return import.meta.env.DEV ? pack.artworks : getPublishedArtworks(pack);
}

/**
 * Packs shown as cards in the Artist Packs section. Every pack appears (dev-only
 * packs are dropped in production), INCLUDING packs with no published artwork —
 * those render as a disabled "Coming Soon" card. Appearing here does not expose
 * any artwork: the card and pack screen only ever surface `"published"` artwork
 * to players, and unpublished artwork isn't even in the production bundle.
 */
export function getPlayerFacingPacks(): ArtistPackDefinition[] {
  return ALL_ARTIST_PACKS.filter((pack) => !(pack.devOnly && import.meta.env.PROD));
}

/** Whether a pack has any published artwork. A pack with none is "Coming Soon":
 * shown but non-openable by players. */
export function packHasPublishedArtwork(pack: ArtistPackDefinition): boolean {
  return getPublishedArtworks(pack).length > 0;
}

/** The outbound link for an artist: the complete configured affiliate URL used
 * verbatim, otherwise the external URL. No query parameters are appended. */
export function artistOutboundUrl(artist: ArtistProfile): string {
  return artist.affiliateUrl ?? artist.externalUrl;
}
