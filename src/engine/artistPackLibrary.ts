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
  /** Styled emoji/icon fallback, shown when no `avatarImageUrl` is set; admin-set. */
  avatarIcon: string;
  /** Optional admin-set photo (a static asset under `public/`), shown instead of
   * `avatarIcon`. Displayed square/circular via CSS `object-fit: cover` — never
   * distorted. Requires `avatarImageAlt`. */
  avatarImageUrl?: string;
  /** Accessible alt text for `avatarImageUrl`. */
  avatarImageAlt?: string;
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

// Image-derived trace of Basket.jpeg (Nimco Design), NOT a generic hoop
// template. Built by a two-pass extraction over the actual photograph:
//   NET - Canny edges (sigma 3) -> close (disk 9) to merge each chain link's
//         double edge AND bridge link gaps -> skeletonize -> skeleton-GRAPH
//         walk that keeps every junction-to-junction connector (they form the
//         polygonal network), prunes only short dangling spurs, then drops
//         floating fragments -> RDP. Keeps the real irregular strand paths,
//         the large uneven polygonal openings, and the long hanging lower
//         net as one CONNECTED mesh; deliberately NOT symmetric zigzags
//         (that is what distinguishes this artist's net from a plain hoop).
//   RIM - a warm-colour mask isolates the orange tube (the net is black, the
//         sky is blue) -> outer + inner silhouette contours. Preserves the
//         near-circular from-below view, its asymmetric perspective, and the
//         right-side attachment bracket.
// v4 owner-directed edits on top of the trace: (a) long straight net runs get
// a small tapered perpendicular sine wobble (junction endpoints fixed) to
// suggest handmade twisted wire without tracing individual links; (b) one
// additional lower row of two large irregular connected openings hung from
// the bottom tips of the traced loops, midpoints pulled toward the center so
// the silhouette keeps narrowing, extending the hang beyond the photo crop.
// v5 right-side correction: the rim is re-extracted with no ROI cuts through
// the mounting bracket, so the outer silhouette is ONE closed contour flowing
// rim -> bracket plate -> photo frame edge (no broken circle); a third small
// contour traces the photo's dark gap between the rim tube and the plate,
// visually separating rim from bracket. Net parts are untouched from v4.
// 42 disconnected parts (3 rim + 39 net) / 465 pts. Each row is one continuous
// stroke as normalized [x, y] pairs; toPathFromParts keeps them disconnected
// so no connector line is drawn between strokes.
const HOOP_PARTS: [number, number][][] = [
  [[0.8472, 0.4732], [0.8408, 0.4738], [0.8293, 0.4636], [0.7853, 0.4668], [0.7722, 0.478], [0.746, 0.5182], [0.7214, 0.5447], [0.6984, 0.5626], [0.6863, 0.5619], [0.67, 0.5725], [0.6687, 0.5852], [0.6742, 0.5964], [0.6429, 0.5977], [0.6387, 0.6114], [0.6301, 0.6207], [0.6253, 0.6082], [0.6173, 0.6041], [0.5516, 0.6207], [0.5458, 0.6258], [0.5324, 0.62], [0.5043, 0.6258], [0.4366, 0.6258], [0.4041, 0.62], [0.3817, 0.6117], [0.3769, 0.5993], [0.3587, 0.5817], [0.3507, 0.5801], [0.3507, 0.5674], [0.3338, 0.5619], [0.3246, 0.5686], [0.3309, 0.5865], [0.3214, 0.5974], [0.3303, 0.6076], [0.3252, 0.6159], [0.3303, 0.6242], [0.321, 0.6258], [0.3115, 0.6194], [0.3025, 0.6258], [0.2936, 0.6258], [0.2875, 0.5776], [0.2652, 0.5182], [0.2339, 0.4901], [0.2058, 0.4569], [0.1739, 0.4013], [0.1624, 0.3694], [0.1528, 0.3011], [0.1585, 0.2443], [0.1764, 0.1887], [0.2128, 0.1274], [0.2412, 0.0951], [0.2923, 0.0543], [0.3498, 0.0243], [0.4041, 0.0083], [0.466, 0.0], [0.5337, 0.0019], [0.5867, 0.0128], [0.6403, 0.0332], [0.6889, 0.0619], [0.7269, 0.0948], [0.7339, 0.1159], [0.732, 0.1306], [0.7425, 0.1379], [0.7524, 0.137], [0.7505, 0.1517], [0.7578, 0.1584], [0.7696, 0.1574], [0.7971, 0.1989], [0.8067, 0.2462], [0.8166, 0.2522], [0.8472, 0.2548], [0.8472, 0.4732]],
  [[0.4769, 0.5664], [0.4207, 0.5607], [0.3817, 0.5517], [0.367, 0.546], [0.3638, 0.5338], [0.3568, 0.5409], [0.3485, 0.5409], [0.2987, 0.514], [0.2888, 0.5054], [0.2872, 0.4962], [0.2751, 0.4968], [0.2447, 0.4722], [0.239, 0.455], [0.2243, 0.4467], [0.2039, 0.4135], [0.1943, 0.4064], [0.1956, 0.3924], [0.1866, 0.3707], [0.179, 0.3305], [0.1777, 0.2858], [0.1834, 0.2589], [0.1796, 0.2423], [0.2058, 0.1887], [0.2352, 0.1421], [0.2751, 0.099], [0.3115, 0.0741], [0.4034, 0.0402], [0.4124, 0.0294], [0.4545, 0.0319], [0.5356, 0.0255], [0.5477, 0.0345], [0.5809, 0.0396], [0.6122, 0.0517], [0.6774, 0.0817], [0.6946, 0.0913], [0.6981, 0.1031], [0.7269, 0.1312], [0.7594, 0.1849], [0.7773, 0.2334], [0.785, 0.3119], [0.7811, 0.3305], [0.7856, 0.3413], [0.7779, 0.3522], [0.7645, 0.393], [0.7511, 0.4084], [0.7511, 0.4192], [0.7396, 0.4403], [0.6723, 0.5038], [0.632, 0.5281], [0.586, 0.5473], [0.5254, 0.5619], [0.4769, 0.5664]],
  [[0.7866, 0.4323], [0.7706, 0.4234], [0.7664, 0.4154], [0.7716, 0.4001], [0.7779, 0.3937], [0.7894, 0.3503], [0.7875, 0.3426], [0.7913, 0.3285], [0.7869, 0.3113], [0.7965, 0.2941], [0.8051, 0.2893], [0.8194, 0.296], [0.8239, 0.3094], [0.8124, 0.3368], [0.7996, 0.4135], [0.7945, 0.4282], [0.7866, 0.4323]],
  [[0.6729, 0.6721], [0.6734, 0.6263], [0.6811, 0.617], [0.6863, 0.5955]],
  [[0.3299, 0.635], [0.3413, 0.6459], [0.3532, 0.6811], [0.3771, 0.6857], [0.3862, 0.6909], [0.3933, 0.6924], [0.4093, 0.6905], [0.4299, 0.6632], [0.4347, 0.6534], [0.4271, 0.6409], [0.4231, 0.6325]],
  [[0.3938, 0.6945], [0.3966, 0.7137], [0.4053, 0.7187], [0.417, 0.7328], [0.4168, 0.7409], [0.4232, 0.752], [0.4316, 0.7674], [0.4428, 0.7762], [0.4449, 0.789]],
  [[0.4941, 0.2685], [0.4874, 0.2632], [0.4744, 0.2523], [0.4638, 0.2401], [0.4405, 0.2201], [0.4326, 0.2144], [0.4264, 0.1956], [0.4144, 0.1944], [0.405, 0.1853], [0.3651, 0.19]],
  [[0.2552, 0.4779], [0.2539, 0.4683], [0.2473, 0.4616], [0.2381, 0.4503], [0.2268, 0.4391], [0.2257, 0.41], [0.2202, 0.4033]],
  [[0.4455, 0.7883], [0.4303, 0.8325], [0.4169, 0.8465], [0.4078, 0.8488], [0.3781, 0.8488], [0.3638, 0.8375], [0.3477, 0.8029], [0.3394, 0.7835], [0.3354, 0.7721], [0.3395, 0.7546], [0.3279, 0.7246], [0.3299, 0.7117]],
  [[0.3293, 0.3566], [0.3319, 0.3467], [0.3275, 0.3365], [0.326, 0.3313], [0.3373, 0.295], [0.3436, 0.2887], [0.3383, 0.2631], [0.3463, 0.2525], [0.3557, 0.2339], [0.3574, 0.2198], [0.3668, 0.19], [0.3626, 0.1794], [0.3569, 0.1691], [0.3436, 0.1617], [0.3432, 0.1471], [0.3411, 0.1384], [0.3242, 0.113], [0.3153, 0.084]],
  [[0.5477, 0.2826], [0.5677, 0.2596], [0.5931, 0.2427], [0.6033, 0.239], [0.6093, 0.2288], [0.6145, 0.2242], [0.6365, 0.2006], [0.6389, 0.1706], [0.6335, 0.1405], [0.6391, 0.1103], [0.6358, 0.0802]],
  [[0.5484, 0.282], [0.5526, 0.3005], [0.5566, 0.3249], [0.572, 0.3449], [0.5752, 0.3698], [0.5844, 0.3845], [0.5907, 0.3985], [0.592, 0.4145], [0.5988, 0.4218]],
  [[0.5982, 0.4218], [0.6165, 0.4254], [0.627, 0.442], [0.6372, 0.4409], [0.6442, 0.432], [0.6559, 0.422], [0.6645, 0.4186]],
  [[0.6486, 0.7289], [0.6601, 0.7465], [0.668, 0.7593], [0.6824, 0.7507], [0.6832, 0.7075], [0.6857, 0.6932], [0.6792, 0.6804], [0.6722, 0.6721]],
  [[0.2278, 0.3707], [0.2173, 0.3477], [0.2134, 0.3336], [0.2094, 0.318], [0.2021, 0.3126], [0.1993, 0.2801], [0.1888, 0.2692]],
  [[0.4973, 0.4939], [0.4919, 0.4886], [0.4803, 0.4755], [0.4729, 0.4641], [0.4696, 0.4463], [0.4577, 0.4396], [0.4502, 0.4309], [0.4443, 0.4192], [0.4404, 0.4026]],
  [[0.7744, 0.3496], [0.7694, 0.3545], [0.7711, 0.3668], [0.7668, 0.376], [0.7604, 0.3882], [0.747, 0.4065]],
  [[0.5867, 0.4454], [0.5806, 0.4599], [0.5698, 0.4782], [0.5511, 0.4923], [0.5397, 0.4934], [0.5226, 0.4956], [0.4966, 0.4933]],
  [[0.7016, 0.4672], [0.7089, 0.4424], [0.704, 0.4173], [0.6998, 0.3971], [0.6997, 0.3846], [0.6901, 0.3752]],
  [[0.4034, 0.1817], [0.4031, 0.1522], [0.4117, 0.1211], [0.408, 0.0883], [0.4188, 0.0573], [0.4162, 0.0431]],
  [[0.3638, 0.5348], [0.3645, 0.5208], [0.3746, 0.5083], [0.3725, 0.4912], [0.3767, 0.4779], [0.3823, 0.4613], [0.3909, 0.4513], [0.3932, 0.4161]],
  [[0.3932, 0.4167], [0.3857, 0.4071], [0.3785, 0.4051], [0.3699, 0.3972], [0.3576, 0.3934], [0.3558, 0.3824], [0.3464, 0.3698], [0.3412, 0.3608], [0.3289, 0.358], [0.3171, 0.3593], [0.3132, 0.3583], [0.3065, 0.3612], [0.2924, 0.3758], [0.2991, 0.4079], [0.2945, 0.4129], [0.2922, 0.43], [0.293, 0.4473], [0.296, 0.4715], [0.2934, 0.4962], [0.3012, 0.5131]],
  [[0.5356, 0.8617], [0.5223, 0.8504], [0.5134, 0.8418], [0.5145, 0.8275], [0.5048, 0.8166], [0.4928, 0.7915]],
  [[0.5356, 0.8611], [0.5674, 0.8676], [0.5922, 0.8377], [0.6088, 0.7975], [0.617, 0.7812], [0.62, 0.7603], [0.6143, 0.7479], [0.6068, 0.7269], [0.6033, 0.7188], [0.5885, 0.7139], [0.5828, 0.7033], [0.5407, 0.7123]],
  [[0.4883, 0.6542], [0.4914, 0.6648], [0.5147, 0.6936], [0.5186, 0.6997], [0.529, 0.7004], [0.5413, 0.7129]],
  [[0.7476, 0.4065], [0.7278, 0.409], [0.7169, 0.4167], [0.708, 0.4167]],
  [[0.4449, 0.7883], [0.4813, 0.7902], [0.4989, 0.7923], [0.5075, 0.7771], [0.5142, 0.7672], [0.5149, 0.752], [0.5242, 0.7462], [0.5323, 0.7353], [0.541, 0.7267], [0.5413, 0.7123]],
  [[0.3555, 0.6791], [0.3472, 0.6874], [0.3453, 0.6964], [0.3395, 0.7009], [0.3363, 0.7085], [0.3299, 0.7123]],
  [[0.6544, 0.6108], [0.6463, 0.6173], [0.6229, 0.6193], [0.622, 0.6411], [0.603, 0.6711], [0.5822, 0.6996]],
  [[0.6371, 0.2008], [0.6526, 0.2085], [0.6628, 0.2222], [0.6776, 0.2196], [0.6863, 0.1987], [0.7082, 0.1738], [0.7127, 0.164], [0.7179, 0.1565], [0.7208, 0.1421]],
  [[0.3306, 0.7117], [0.3236, 0.706], [0.3179, 0.6817], [0.3134, 0.6759]],
  [[0.3932, 0.4167], [0.4105, 0.4084], [0.4411, 0.4026]],
  [[0.3274, 0.6], [0.328, 0.5936], [0.3396, 0.5867], [0.3503, 0.5915], [0.363, 0.6007], [0.3772, 0.605], [0.3792, 0.6163], [0.3876, 0.6216], [0.4023, 0.6292], [0.4231, 0.6325]],
  [[0.6186, 0.7456], [0.6294, 0.7424], [0.6474, 0.7302], [0.6512, 0.7238]],
  [[0.6371, 0.4403], [0.6385, 0.4625], [0.6459, 0.4735], [0.6474, 0.508]],
  [[0.6901, 0.3758], [0.6899, 0.3494], [0.6829, 0.3238], [0.6813, 0.2976], [0.6804, 0.2713], [0.6729, 0.2458], [0.6729, 0.2194]],
  [[0.2955, 0.3765], [0.2688, 0.3747], [0.2426, 0.3685], [0.2278, 0.3701]],
  [[0.4404, 0.4026], [0.4556, 0.3778], [0.4622, 0.3491], [0.4694, 0.3376], [0.4826, 0.3287], [0.4788, 0.3118], [0.5002, 0.2903], [0.5141, 0.2727], [0.5484, 0.2826]],
  [[0.5445, 0.6267], [0.505, 0.6357]],
  [[0.4883, 0.6549], [0.4366, 0.653]],
  [[0.3781, 0.8488], [0.3814, 0.8696], [0.3771, 0.8913], [0.392, 0.9077], [0.4017, 0.9271], [0.4174, 0.945], [0.4398, 0.9586], [0.4638, 0.9748], [0.4801, 0.9817], [0.4902, 0.9961], [0.5049, 1.0], [0.5194, 0.9944], [0.5328, 0.9951], [0.5502, 0.996], [0.5558, 0.9769], [0.5615, 0.9606], [0.5745, 0.9461], [0.5711, 0.927], [0.5708, 0.9084], [0.5754, 0.8879], [0.5674, 0.8676]],
  [[0.5674, 0.8676], [0.5632, 0.8806], [0.5644, 0.8931], [0.5613, 0.9045], [0.5607, 0.9166], [0.5679, 0.9264], [0.578, 0.9337], [0.5853, 0.9446], [0.5896, 0.9577], [0.599, 0.964], [0.608, 0.9658], [0.6146, 0.9667], [0.6213, 0.9676], [0.6308, 0.9662], [0.6406, 0.9392], [0.6577, 0.9157], [0.6603, 0.8862], [0.6696, 0.8577], [0.6729, 0.8265], [0.6677, 0.7939], [0.668, 0.7593]],
];

function tracedHoop(size: number): DrawingPath {
  const map = (n: number) => (0.06 + n * 0.88) * size;
  const parts = HOOP_PARTS.map((part) => part.map(([x, y]) => ({ x: map(x), y: map(y) })));
  return toPathFromParts(parts, size);
}

// Image-derived trace of man.jpeg (Nimco Design) — a high-contrast B&W
// photograph of a saxophonist in a conical straw hat (nón lá), shot as a
// silhouette against a bright sky. Built by a single Canny-edge pass over the
// whole frame (the strong light/dark boundaries ARE the line art here): Canny
// (sigma 2) -> closing (disk 3) -> skeleton-graph walk keeping junction-to-
// junction connectors, pruning short spurs and floating fragments -> stitch
// straight continuations -> RDP -> joint-normalize preserving the source
// ~0.79 w:h aspect, centered. The "NIMCO DESIGN ©" watermark and the blurry
// background horizon were masked out; every stroke sits on the subject: the
// conical hat (cone edges + wavy brim + radial straw ribs), the face/beard
// profile, the curved saxophone (neck, body, keys), and the shoulder silhouette.
//
// Minimal outer-contour closure pass (owner-directed): four gaps that were cut
// despite being clearly continuous in the source were bridged along the real
// silhouette boundary (never with invented connector lines) — the hat cone apex,
// two gaps in the hat's cone/brim edge, and the neck where the beard/throat
// meets the torso front. Nothing else was touched: the saxophone, the interior
// hat ribs, proportions, and positions are unchanged (the pass only merged the
// four broken outer contours; +5 points total).
// 26 disconnected parts / 216 pts. Each row is one continuous stroke as
// normalized [x, y] pairs; toPathFromParts keeps them disconnected so no
// connector line is drawn between strokes.
const MAN_PARTS: [number, number][][] = [
  [[0.5519, 0.2403], [0.5885, 0.1907], [0.6144, 0.1696]],
  [[0.8377, 0.0755], [0.8304, 0.0503], [0.8182, 0.0284]],
  [[0.8377, 0.0747], [0.8417, 0.0787], [0.8498, 0.1088], [0.875, 0.1567]],
  [[0.487, 0.5528], [0.4765, 0.5406], [0.47, 0.5398], [0.4221, 0.5731], [0.3774, 0.5877], [0.3352, 0.5852], [0.3312, 0.5804], [0.3377, 0.5722], [0.3141, 0.5649], [0.3068, 0.5568], [0.2305, 0.5617], [0.1981, 0.5698], [0.1761, 0.5795], [0.1558, 0.5982], [0.1307, 0.6494], [0.125, 0.6705], [0.1258, 0.6956], [0.1356, 0.7151], [0.1412, 0.7727]],
  [[0.8612, 0.2987], [0.8628, 0.2654], [0.8612, 0.2346], [0.858, 0.2297]],
  [[0.6997, 0.0933], [0.7167, 0.0755], [0.7735, 0.0365]],
  [[0.2825, 1], [0.2703, 0.9554], [0.2638, 0.9521], [0.2589, 0.9545], [0.2597, 0.9708]],
  [[0.4131, 0.2216], [0.401, 0.2256], [0.3571, 0.2622]],
  [[0.8182, 0.1826], [0.8141, 0.1469], [0.8141, 0.0925]],
  [[0.8872, 0.3231], [0.8807, 0.3247], [0.7719, 0.3019], [0.7143, 0.2955], [0.6997, 0.2898], [0.6469, 0.2881], [0.5877, 0.2784], [0.4253, 0.2776], [0.3612, 0.2881], [0.3539, 0.2881], [0.3474, 0.2817]],
  [[0.1615, 1], [0.1485, 0.9359], [0.1437, 0.9294], [0.1453, 0.9196], [0.1396, 0.9115], [0.1453, 0.9018], [0.1542, 0.9042], [0.1648, 0.8985], [0.1599, 0.8782], [0.1485, 0.8539], [0.1485, 0.8393], [0.1445, 0.8304], [0.1453, 0.8255], [0.1542, 0.8198], [0.1542, 0.8141], [0.1469, 0.7946], [0.1315, 0.7955], [0.1234, 0.7849], [0.1128, 0.7857], [0.1063, 0.7695], [0.1096, 0.7597], [0.1299, 0.7695], [0.1404, 0.7654]],
  [[0.858, 0.2305], [0.8604, 0.2119], [0.858, 0.1786]],
  [[0.5731, 0.6307], [0.5666, 0.6218], [0.5641, 0.6088], [0.5674, 0.5771]],
  [[0.5674, 0.5779], [0.5779, 0.5479], [0.5706, 0.5357], [0.5641, 0.5381], [0.5706, 0.5503], [0.5576, 0.5641]],
  [[0.8369, 0.2914], [0.8401, 0.2784], [0.8393, 0.2192], [0.8425, 0.2094], [0.8409, 0.1193]],
  [[0.1867, 1], [0.1802, 0.9675], [0.1672, 0.9481], [0.1672, 0.9286]],
  [[0.168, 0.9286], [0.1623, 0.9261], [0.155, 0.9326], [0.1705, 1]],
  [[0.5211, 0.2443], [0.5398, 0.2248], [0.5617, 0.1916]],
  [[0.2776, 0.5609], [0.2906, 0.5682], [0.2881, 0.5763], [0.2362, 0.5795], [0.1997, 0.5942], [0.1964, 0.5917], [0.1981, 0.5804]],
  [[0.7865, 0.2183], [0.789, 0.1794], [0.7841, 0.1534], [0.7873, 0.1445], [0.7849, 0.1226]],
  [[0.5365, 0.5771], [0.5219, 0.5804], [0.5122, 0.5739], [0.4984, 0.5844], [0.4838, 0.5795], [0.4464, 0.6006], [0.3782, 0.6242], [0.3352, 0.6266], [0.2808, 0.6234], [0.2606, 0.6266], [0.237, 0.6372], [0.2183, 0.6534], [0.2029, 0.6769], [0.1989, 0.7062], [0.2062, 0.7143], [0.224, 0.72], [0.2208, 0.7248], [0.2094, 0.7265], [0.2216, 0.7711], [0.2143, 0.7776], [0.2143, 0.7825], [0.2232, 0.8271], [0.2346, 0.8328], [0.233, 0.8409], [0.2419, 0.8758], [0.2492, 0.8856], [0.2468, 0.8945], [0.2557, 0.9245]],
  [[0.2557, 0.9237], [0.2662, 0.9213], [0.2735, 0.9253], [0.2727, 0.9343], [0.28, 0.9497], [0.2792, 0.9578], [0.2914, 1]],
  [[0.4911, 0.5463], [0.4773, 0.5308], [0.4789, 0.526], [0.526, 0.4976], [0.5487, 0.4903], [0.5398, 0.4716], [0.539, 0.4578], [0.5349, 0.4537], [0.4797, 0.4383], [0.4075, 0.4115], [0.3336, 0.3718], [0.3101, 0.3498], [0.2987, 0.3255], [0.3101, 0.3011], [0.3336, 0.289], [0.3132, 0.2963], [0.3076, 0.3068], [0.3433, 0.293], [0.3474, 0.2817]],
  [[0.8774, 0.0885], [0.8482, 0.0479], [0.8506, 0.0341], [0.836, 0.0211], [0.8368, 0.0146], [0.8295, 0.0138], [0.819, 0.0162], [0.8044, 0.0032], [0.7946, 0], [0.7808, 0.0032], [0.6907, 0.0544], [0.625, 0.0998]],
  [[0.4123, 0.2224], [0.4318, 0.211], [0.4416, 0.1981], [0.461, 0.1859], [0.5154, 0.1623], [0.513, 0.1599], [0.5065, 0.1623], [0.4391, 0.2183]],
  [[0.5722, 0.6299], [0.5885, 0.6291], [0.6031, 0.6339], [0.6128, 0.6315], [0.6193, 0.6364], [0.6688, 0.6372], [0.6818, 0.6372], [0.6851, 0.642], [0.6583, 0.6567], [0.6396, 0.6729], [0.6242, 0.6948], [0.6226, 0.7175], [0.6055, 0.7224], [0.6104, 0.7427], [0.6063, 0.7638], [0.6388, 0.7938], [0.6242, 0.8166], [0.6169, 0.8401], [0.6104, 0.9237], [0.5901, 1]],
];

function tracedMan(size: number): DrawingPath {
  const map = (n: number) => (0.06 + n * 0.88) * size;
  const parts = MAN_PARTS.map((part) => part.map(([x, y]) => ({ x: map(x), y: map(y) })));
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
 * Nimco Design — a real artist pack. "Portrait Study" is the owner-approved and
 * now explicitly published artwork, so this pack is player-facing (see
 * `getPlayerFacingPacks` / `packHasPublishedArtwork`).
 */
const nimcoPack: ArtistPackDefinition = {
  id: "nimco",
  name: "Nimco Design",
  artist: {
    id: "nimrod-cohen",
    name: "Nimrod Cohen",
    avatarIcon: "🎨",
    avatarImageUrl: "/images/artists/nimco-design-avatar.png",
    avatarImageAlt: "Nimco Design",
    bio: "Impact Through Design",
    externalUrl: "https://nimco.co.il/",
    // affiliateUrl / affiliateLinkId intentionally omitted until configured.
  },
  artworks: [
    // Published with the owner's explicit approval — player-facing.
    artwork("nimco-portrait", "Portrait Study", "nimco", "published", tracedPortrait),
    // Published by the owner (2026-07-12, v5) — image-derived trace of
    // Basket.jpeg (see HOOP_PARTS above); data + preview archived in
    // artist-source-files/nimco-design/approved-line-art/. Player-facing.
    artwork("nimco-basketball-hoop", "Basketball Hoop", "nimco", "published", tracedHoop),
    // PUBLISHED (2026-07-12) by the owner — image-derived trace of man.jpeg (see
    // MAN_PARTS above), a saxophonist in a conical straw hat, after the
    // owner-directed minimal outer-contour closure pass. Player-facing. Reference
    // copy archived in approved-line-art/man.ts.
    artwork("nimco-saxophonist", "Saxophonist", "nimco", "published", tracedMan),
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
 * Resolves a specific published artwork by pack+artwork id, used by the "Draw It
 * Back" reciprocal-share flow (and its own defensive re-check) so both call sites
 * share one published-only gate rather than duplicating the lookup. Returns
 * `undefined` for an unknown pack, an unknown artwork, or a real but
 * draft/approved (unpublished) artwork — never falls back to any other artwork.
 */
export function resolvePublishedArtwork(packId: string, artworkId: string): ArtistArtworkDefinition | undefined {
  const pack = getArtistPackById(packId);
  if (!pack) return undefined;
  return getPublishedArtworks(pack).find((art) => art.id === artworkId);
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
