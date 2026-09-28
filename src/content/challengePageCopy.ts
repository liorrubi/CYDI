/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The page-specific copy of every challenge page - the part of each page that is
 * about THIS shape and could not be moved to any other page.
 *
 * WHY IT LIVES HERE. It used to exist only in worker/seoPages.ts, so it only ever
 * reached the crawlable block the Worker appends after #root - and that block is
 * removed once the app renders (site/crawlableBlock.ts). A visitor, or a crawler
 * that runs JavaScript, got the 4a practice template instead, which says the same
 * thing on every challenge page with only the shape's name swapped in. Measured on
 * the live site on 28 Sep 2026, the rendered text of any two challenge pages
 * overlapped by 90-94%, and /drawing-accuracy-test rendered character for character
 * the same as /draw-a-perfect-circle.
 *
 * Now both renderers read this module: the Worker builds the crawlable block from
 * it, and SeoPracticePage.tsx renders the same sentences on screen. One source, so
 * the indexed text and the text a visitor reads cannot drift apart.
 *
 * STATIC ON PURPOSE. Plain data bundled into the practice page's own lazy chunk:
 * no fetch, no API, no analytics, nothing computed per request. Numbers come from
 * publicFacts, never from memory, for the same reason seoPages.ts gives.
 *
 * What is NOT here: the practice-round note ("changes nothing in your game"),
 * which is the same on every page and stays in the Worker's block, and the FAQ,
 * which is shared by design (siteContent.ts).
 */
import { RESAMPLE_POINTS, SCORE_WEIGHT_PERCENTS, SIZE_TOLERANCE_PERCENT } from "./publicFacts";

export type ChallengePageImage = {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
};

export type ChallengePageCopy = {
  /** The landing path this copy belongs to (src/seo/landingPages.ts). */
  path: string;
  /** The page's one <h1> - the same words in the crawlable block and on screen. */
  heading: string;
  /** Heading of the on-screen section that carries `paragraphs` after the first. */
  detailHeading: string;
  /**
   * The first paragraph is the page's lede (under the h1); the rest are the body
   * of the "detail" section. Every one is specific to this shape.
   */
  paragraphs: string[];
  /** A diagram generated from the shape's own geometry (scripts/generateSeoShapeImages.ts). */
  image?: ChallengePageImage;
};

const ACCURACY_TEST: ChallengePageCopy = {
  path: "/drawing-accuracy-test",
  heading: "Drawing Accuracy Test",
  detailHeading: "How the test is measured",
  paragraphs: [
    "How precise is your freehand, really? This is a short drawing accuracy test: a target shape appears for a few seconds, you redraw it on the empty canvas, and CYDI measures how close you got.",
    `The score is measured, not guessed. Both your stroke and the target are resampled to ${RESAMPLE_POINTS} evenly spaced points and compared point for point on four things - shape match (does your outline follow the same form?), size (the right size, not much smaller or larger), coverage (did you draw the whole shape?) and smoothness (a steady line or a shaky one?). They are weighted ${SCORE_WEIGHT_PERCENTS.shapeMatch}%, ${SCORE_WEIGHT_PERCENTS.scale}%, ${SCORE_WEIGHT_PERCENTS.coverage}% and ${SCORE_WEIGHT_PERCENTS.smoothness}% into one percentage plus a star rating. Your attempt is drawn over the target afterwards, so the score always comes with visible evidence.`,
    `Where you start the line and which way round you go are not part of the test: every possible starting point is tried, in both directions, and the best alignment is the one that gets scored. What is not forgiven is size - draw much smaller than the target and a ceiling comes down on the total no matter how good the outline is.`,
    "The test starts with a circle, which is the fairest way to benchmark a steady hand: no corners to aim at and nowhere to hide a wobble. Retake it as many times as you want - only your best score is kept - and when you want harder targets, the full shape library is one click away.",
  ],
};

const PERFECT_CIRCLE: ChallengePageCopy = {
  path: "/draw-a-perfect-circle",
  heading: "Draw a Perfect Circle",
  detailHeading: "What decides a circle's score",
  paragraphs: [
    "Drawing a perfect circle freehand is famously hard. There are no straight edges to anchor against and no corners to aim for - just one continuous curve that has to come back and meet exactly where it started.",
    "Try it here. The target circle is shown for a few seconds, then you draw yours on the blank canvas and get an instant score out of 100, with your attempt overlaid on the target so you can see precisely where the curve went wide, flat or lumpy. A wobbly line costs you smoothness, an oval costs you shape match, and stopping short of the join costs you coverage.",
    `Two things decide it. Every point of a circle sits the same distance from its centre, so any stretch into an oval shows up immediately in shape match - which is ${SCORE_WEIGHT_PERCENTS.shapeMatch}% of the score, far more than the smoothness a shaky line costs you. And the line has to come back to where it started: the join is the one place a circle can visibly fail to close.`,
    `Draw it big. Size is the other ${SCORE_WEIGHT_PERCENTS.scale}%, and it works as a ceiling as well as a component - up to about ${SIZE_TOLERANCE_PERCENT}% off costs nothing, but past that every further 1% of size error takes a point off the highest total the round can reach. A neat little circle in the corner of the canvas cannot score what the same circle drawn full size would.`,
    "The last few percent are the hard part: the gap between a good circle and a great one is almost entirely hand steadiness and pace. Retry as often as you like, since only your best score is kept, and move on to tougher targets whenever you are ready.",
  ],
  image: {
    src: "/images/seo/draw-a-perfect-circle-radius-and-closing-guide.svg",
    alt: "Circle target with four dashed radii from its centre and a marked point where the drawn line has to close back onto its own start",
    caption:
      "The circle target and the two things it is judged on: one distance from the centre, held all the way round, and a line that closes back onto its own start.",
    width: 400,
    height: 400,
  },
};

const PERFECT_STAR: ChallengePageCopy = {
  path: "/draw-a-perfect-star",
  heading: "Draw a Perfect Star",
  detailHeading: "Where freehand stars go wrong",
  paragraphs: [
    "A star punishes a different weakness than a circle does. Nothing here is curved: a five-point star is ten straight edges and ten corners, and the whole shape only reads as a star if all five arms come out the same length, the five tips land the same distance from the centre, and each arm sits 72 degrees around from the last.",
    "Draw yours here and the score tells you where the symmetry broke. Your stroke is measured on shape match (are the arms actually where a star's arms belong?), coverage (all five points closed, not four and a gap), smoothness (straight edges rather than bowed ones) and scale, then laid over the target so a short arm or a drifting tip is impossible to miss.",
    "Freehand stars fail in predictable ways: the first arms come out well and the last one has to stretch or shrink to close the loop, the bottom two legs droop inwards, and the inner corners creep outwards until the star starts to look like a flower. Aiming at the tips before you start - and keeping the inner corners on their own smaller circle - is what turns a five-point scribble into a symmetrical star.",
  ],
  image: {
    src: "/images/seo/draw-a-perfect-star-five-point-star-symmetry-guide.svg",
    alt: "Five-point star target showing the vertical mirror axis, the outer circle its five tips sit on and the inner circle its five corners sit on",
    caption:
      "The star target, with the two rings and the mirror line every point has to respect: tips on the outer ring, inner corners on the smaller one, 72 degrees between arms.",
    width: 400,
    height: 400,
  },
};

const PERFECT_HEART: ChallengePageCopy = {
  path: "/draw-a-perfect-heart",
  heading: "Draw a Perfect Heart",
  detailHeading: "The three things a heart has to line up",
  paragraphs: [
    "A heart is the symmetry test. It is one closed line made of two mirrored halves, and the eye reads any mismatch between them instantly - a lobe that sits higher than the other, a curve that is fuller on one side, a bottom point that has wandered off centre.",
    "Three things have to line up. The dip between the lobes and the bottom point both belong on the same vertical centre line; the two lobes have to reach their widest at the same height and by the same amount; and each curve has to flow into the next without a flat spot or a corner where the lobe turns down into the point.",
    "Draw the target here and the score breaks it down: shape match catches lopsided lobes and an off-centre point, smoothness catches the flattened outer curves that come from drawing a heart in short nervous strokes, coverage catches a gap where the line failed to close at the dip or the tip, and scale catches a heart drawn far too small to control. Your attempt is drawn over the target afterwards, which is the fastest way to see which half of your heart is the honest one.",
  ],
  image: {
    src: "/images/seo/draw-a-perfect-heart-symmetry-and-curve-guide.svg",
    alt: "Heart target showing the vertical mirror axis with the centre dip and the bottom point marked on it, and a horizontal line where both lobes reach equal width",
    caption:
      "The heart target and the three alignments it depends on: dip and point on the centre line, and both lobes reaching their widest at the same height.",
    width: 400,
    height: 400,
  },
};

const DOG_FROM_MEMORY: ChallengePageCopy = {
  path: "/draw-a-dog-from-memory",
  heading: "Draw a Dog From Memory",
  detailHeading: "Where the ears go",
  paragraphs: [
    "Look at the dog for a couple of seconds. It disappears, the canvas clears, and you draw it back from memory - ears, muzzle, eyes and all. The score comes straight after, with your line laid over the target so you can see exactly where your memory drifted.",
    "Drawing from memory is a different problem from tracing. The outline is gone when your hand starts moving, so what you are really redrawing is what you noticed: how far apart the ears sit, how low the muzzle hangs, how wide the head is against its height. Most people get the head about right and discover the ears moved.",
  ],
};

const CAT_FROM_MEMORY: ChallengePageCopy = {
  path: "/draw-a-cat-from-memory",
  heading: "Draw a Cat From Memory",
  detailHeading: "A face, not a list of features",
  paragraphs: [
    "The cat is on screen for a couple of seconds. Then it is gone, the canvas clears, and you draw it back from memory - the head, the two ears, the eyes and the whiskers. Your line is scored against the target and laid over it afterwards, so you can see which part of it you remembered and which part you invented.",
    "A face is harder to redraw than it looks, because the features have to land in the right place relative to each other, not just be present. Most people get a good head and then find the ears too small and the whiskers too low.",
  ],
};

const BEAR_FROM_MEMORY: ChallengePageCopy = {
  path: "/draw-a-bear-from-memory",
  heading: "Draw a Bear From Memory",
  detailHeading: "The ears and the muzzle",
  paragraphs: [
    "The bear is on screen for a couple of seconds, then it is gone and the canvas is empty. You draw it back from memory - the round head, the two ears on top of it, the eyes, and the muzzle with its nose and mouth. Your line is scored against the target and laid over it afterwards, so you can see which parts you kept and which ones drifted.",
    "A bear is mostly one round head, which sounds easy until the details have to land on it. The ears are the giveaway: they sit high on the outline rather than beside it, and in memory they tend to slide outwards and shrink. The muzzle is the other one - it belongs low on the face, and almost everyone draws it closer to the eyes than it really is.",
  ],
};

const OWL_FROM_MEMORY: ChallengePageCopy = {
  path: "/draw-an-owl-from-memory",
  heading: "Draw an Owl From Memory",
  detailHeading: "Ear tufts and eyes",
  paragraphs: [
    "The owl is on screen for a couple of seconds, then it is gone and the canvas is empty. You draw it back from memory - the body, the two ear tufts, the big round eyes, the beak between them, and the feet. Your line is scored against the target and laid over it afterwards, so you can see which parts you kept and which ones drifted.",
    "An owl is two problems. The ear tufts are not shapes added to the head - they are corners of the outline itself, so the whole silhouette has to remember them while you draw it. Then the eyes: they are much bigger than they feel, and nearly everyone draws them too small and too far apart, which is the single change that makes a drawing stop reading as an owl.",
  ],
};

const PIG_FROM_MEMORY: ChallengePageCopy = {
  path: "/draw-a-pig-from-memory",
  heading: "Draw a Pig From Memory",
  detailHeading: "It all hangs on the snout",
  paragraphs: [
    "The pig is on screen for a couple of seconds, then it is gone and the canvas is empty. You draw it back from memory - the round head, the two ears folding forward at the top, the small eyes, and the big oval snout with its two nostrils. Your line is scored against the target and laid over it afterwards, so you can see which parts you kept and which ones drifted.",
    "Everything about a pig hangs on the snout. It is bigger than it feels and it sits lower on the face than memory puts it, so the most common miss is a neat small oval floating in the middle of the head. The ears are the other one: they fold forward as triangles rather than standing up as points, and people who remember them as points draw a cat instead.",
  ],
};

const SNAIL_FROM_MEMORY: ChallengePageCopy = {
  path: "/draw-a-snail-from-memory",
  heading: "Draw a Snail From Memory",
  detailHeading: "The spiral and the shell",
  paragraphs: [
    "The snail is on screen for a couple of seconds, then it is gone and the canvas is empty. You draw it back from memory - the long foot along the ground, the round shell sitting on it, the spiral wound inside that shell, and the two eye stalks rising from the head. Your line is scored against the target and laid over it afterwards, so you can see which parts you kept and which ones drifted.",
    "The spiral is what makes this one hard. It has a real number of turns, it starts at the outer edge and finishes at the centre, and it is the first thing a memory smooths into a vague swirl. The other common miss is the shell's position: it sits on top of the foot, roughly above the middle of it, not trailing behind like a shell being dragged.",
  ],
};

const LIGHTNING_FROM_MEMORY: ChallengePageCopy = {
  path: "/draw-a-lightning-bolt-from-memory",
  heading: "Draw a Lightning Bolt From Memory",
  detailHeading: "Less symmetrical than you remember",
  paragraphs: [
    "The bolt is on screen for a couple of seconds, then it is gone and the canvas is empty. You draw it back from memory - one unbroken line, all straight edges, no curves anywhere - and your attempt is scored against the target and laid over it afterwards, so you can see exactly where the angles went.",
    "A lightning bolt is the shape everyone thinks they know. What memory drops is that it is not symmetrical: the upper arm leans one way, the lower arm leans back the other, and the step between them sits off-centre rather than in the middle. The other common miss is the corner count - people add zigzags that are not there, because a bolt feels busier than it is.",
  ],
};

const TRIANGLE_FROM_MEMORY: ChallengePageCopy = {
  path: "/draw-a-triangle-from-memory",
  heading: "Draw a Triangle From Memory",
  detailHeading: "Why the base never comes out level",
  paragraphs: [
    "Three straight lines and three corners, on screen for a couple of seconds, then gone. You draw it back from memory onto an empty canvas, and your attempt is scored against the target and laid over it afterwards, so you can see exactly where it went.",
    "It is the shape people are most confident about and least accurate at. Freehand, the base tilts - almost nobody draws it level - the apex drifts off the centre line, and the two sides come out at different lengths, so what felt like an even triangle reads as a lean. The edges bow slightly too: a hand drawing at speed curves where it means to go straight.",
  ],
};

const GEAR_FROM_MEMORY: ChallengePageCopy = {
  path: "/draw-a-gear-from-memory",
  heading: "Draw a Gear From Memory",
  detailHeading: "Nobody remembers the number",
  paragraphs: [
    "A cog with eight teeth, on screen for a couple of seconds, then gone. You draw it back from memory onto an empty canvas, and your attempt is scored against the target and laid over it afterwards, so you can see which teeth landed and which ones you invented.",
    "The trap is that nobody remembers a number. You remember “a gear”, and then you draw however many teeth feel right - which is almost never eight. Even with the count correct, the spacing goes: teeth bunch on one side and the gaps stretch on the other, because the eye keeps the shape and drops the rhythm. The teeth also have flat tops and square shoulders, and a hand drawing at speed rounds them off.",
  ],
};

export const CHALLENGE_PAGE_COPY: ChallengePageCopy[] = [
  ACCURACY_TEST,
  PERFECT_CIRCLE,
  PERFECT_STAR,
  PERFECT_HEART,
  DOG_FROM_MEMORY,
  CAT_FROM_MEMORY,
  BEAR_FROM_MEMORY,
  OWL_FROM_MEMORY,
  PIG_FROM_MEMORY,
  SNAIL_FROM_MEMORY,
  LIGHTNING_FROM_MEMORY,
  TRIANGLE_FROM_MEMORY,
  GEAR_FROM_MEMORY,
];

/** Trailing slashes are ignored, like every other path lookup on the site. */
export function challengePageCopyForPath(pathname: string): ChallengePageCopy | undefined {
  const normalized = pathname.replace(/\/+$/, "");
  return CHALLENGE_PAGE_COPY.find((copy) => copy.path === normalized);
}

/** For the Worker, which knows its paths are right: a missing entry is a build error, not a page. */
export function challengePageCopy(path: string): ChallengePageCopy {
  const copy = challengePageCopyForPath(path);
  if (!copy) throw new Error(`no challenge page copy for ${path}`);
  return copy;
}
