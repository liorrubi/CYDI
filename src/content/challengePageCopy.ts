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
// Precomputed by the real scorer at build time (scripts/generateScoredExamples.ts).
// Every number in a deepDive below is read from here, never typed.
import { scoredExampleForPath, type ScoredExampleData } from "./scoredExamplesData";

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
  /**
   * The deeper treatment a few pages get: how the scorer weighs this shape, a
   * scored example with its overlay, and practice drills taken from the shape's
   * geometry. The tables come from scoredExamplesData.ts, keyed by `path`.
   */
  deepDive?: ChallengeDeepDive;
};

export type ChallengeDeepDive = {
  scorerHeading: string;
  scorerParagraphs: string[];
  exampleHeading: string;
  exampleParagraphs: string[];
  /** Alt text and caption for the scored overlay. */
  exampleImageAlt: string;
  exampleImageCaption: string;
  drillsHeading: string;
  drills: { title: string; body: string }[];
};

/** The scored example for a page, or a build error - a deepDive must never quote numbers that do not exist. */
function scored(path: string): ScoredExampleData {
  const example = scoredExampleForPath(path);
  if (!example) throw new Error(`no scored example for ${path} - run scripts/generateScoredExamples.ts`);
  return example;
}

const circleExample = scored("/draw-a-perfect-circle");
const owlExample = scored("/draw-an-owl-from-memory");
const pigExample = scored("/draw-a-pig-from-memory");
const snailExample = scored("/draw-a-snail-from-memory");
const bearExample = scored("/draw-a-bear-from-memory");

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
  deepDive: {
    scorerHeading: "How the scorer reads a circle",
    scorerParagraphs: [
      `A circle is one closed line, so all ${RESAMPLE_POINTS} comparison points land on it - there is no small detail to hide behind and none to rescue you. Because it is closed, the scorer also tries every possible starting point, in both directions, before it compares: where you begin and which way you go round never cost anything.`,
      "What does cost you is the stretch of line that strays furthest. After finding the best alignment, the scorer checks the worst-matching tenth of the outline, and shape match can be no better than that tenth allows. One flat side or one unfinished end therefore counts for more than an even wobble spread all the way round.",
    ],
    exampleHeading: "What two common circle mistakes cost",
    exampleParagraphs: [
      `The same freehand circle, drawn with one slight, even wobble, scores ${circleExample.rows[0].total}. Stop 12% short of the join and it scores ${circleExample.rows[1].total}: on paper the gap only costs coverage, but the unfinished end is exactly the worst tenth the contour check looks at, so shape match falls from ${circleExample.rows[0].shapeMatch} to ${circleExample.rows[1].shapeMatch}.`,
      `Draw the same good circle at 58% of the size and shape match does not move - it is still ${circleExample.rows[2].shapeMatch} - yet the total falls to ${circleExample.rows[2].total}. Size beyond the ${SIZE_TOLERANCE_PERCENT}% tolerance lowers the ceiling the whole score is held under, however round the circle is.`,
    ],
    exampleImageAlt: "The circle target in grey with a freehand circle drawn over it in blue that stops short of closing, leaving a gap just before the top where it started",
    exampleImageCaption: `A circle that stops 12% short of the join, over the target. Scored by the game's own scorer: ${circleExample.rows[1].total} / 100.`,
    drillsHeading: "Three drills for a rounder circle",
    drills: [
      {
        title: "Four compass points",
        body: "Before you draw, pick a centre and picture four marks - top, bottom, left and right - all the same distance out. Draw through them in one pass. Every point of a circle is that one distance from the centre, so four checkpoints catch an oval before it forms.",
      },
      {
        title: "Finish on the start",
        body: "Draw ten circles and watch only the join: slow down over the last quarter and land exactly on your starting point, without stopping short or overshooting. As the example shows, an unclosed end costs more than any wobble.",
      },
      {
        title: "Fill two-thirds of the canvas",
        body: "The target's diameter is 64% of the canvas width - nearly two-thirds. Practise at that size: the same circle drawn half as wide cannot score what it would full size.",
      },
    ],
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
  deepDive: {
    scorerHeading: "How the scorer reads a bear",
    scorerParagraphs: [
      `The bear is eight separate parts, and the scorer gives each a share of the ${RESAMPLE_POINTS} comparison points in proportion to how much line it has. The head outline carries ${bearExample.partShares[0].percent}%. The two ears are ${bearExample.partShares[1].percent}% between them - more than the muzzle, nose and mouth together (${bearExample.partShares[2].percent}%) - and the eyes only ${bearExample.partShares[3].percent}%.`,
      "Ears that are a quarter of the drawing decide a lot. When they drift, they become the worst-matching tenth of the outline, and the scorer holds the whole shape-match score to that tenth - however good the face below them is.",
    ],
    exampleHeading: "What drifting ears cost",
    exampleParagraphs: [
      `Drawn with a slight, even wobble and nothing else wrong, the bear scores ${bearExample.rows[0].total}. Draw the ears 30% smaller and let them slide outwards and down the sides of the head - the way memory tends to move them - and the same bear scores ${bearExample.rows[1].total}. Shape match falls from ${bearExample.rows[0].shapeMatch} to ${bearExample.rows[1].shapeMatch}, while coverage stays at ${bearExample.rows[1].coverage}: all the line is there, just not where the ears belong.`,
    ],
    exampleImageAlt: "The bear target in grey with a freehand bear drawn over it in blue, its two ears smaller and lower on the sides of the head than the target's",
    exampleImageCaption: `Ears smaller and slid down the sides, over the target. Scored by the game's own scorer: ${bearExample.rows[1].total} / 100.`,
    drillsHeading: "Three drills for the bear",
    drills: [
      {
        title: "Ears on the rim",
        body: "Draw the head, then centre each ear right on its outline, about a fifth of the head's width in from each side. Each ear is nearly a third as wide as the head - bigger than it feels.",
      },
      {
        title: "Muzzle low",
        body: "Draw the muzzle as an oval about 40% of the head's width, centred roughly 70% of the way down. Check it against the chin, not against the eyes.",
      },
      {
        title: "Leave the gap",
        body: "Between the eye line and the top of the muzzle, the target leaves about a sixth of the head's height. Draw the eyes, then deliberately leave that gap before starting the muzzle.",
      },
    ],
  },
};

const OWL_FROM_MEMORY: ChallengePageCopy = {
  path: "/draw-an-owl-from-memory",
  heading: "Draw an Owl From Memory",
  detailHeading: "Ear tufts and eyes",
  paragraphs: [
    "The owl is on screen for a couple of seconds, then it is gone and the canvas is empty. You draw it back from memory - the body, the two ear tufts, the big round eyes, the beak between them, and the feet. Your line is scored against the target and laid over it afterwards, so you can see which parts you kept and which ones drifted.",
    "An owl is two problems. The ear tufts are not shapes added to the head - they are corners of the outline itself, so the whole silhouette has to remember them while you draw it. Then the eyes: they are much bigger than they feel, and nearly everyone draws them too small and too far apart, which is the single change that makes a drawing stop reading as an owl.",
  ],
  deepDive: {
    scorerHeading: "How the scorer reads an owl",
    scorerParagraphs: [
      `The owl is ten separate parts, and the scorer gives each a share of the ${RESAMPLE_POINTS} comparison points in proportion to how much line it has. The body outline, which includes the two ear tufts, is the largest single part at ${owlExample.partShares[0].percent}%. But the eyes - two rings and two pupils - take ${owlExample.partShares[1].percent}% between them, about ${owlExample.partShares[1].points} of the ${RESAMPLE_POINTS} points: almost as much as the body. The beak is ${owlExample.partShares[3].percent}% and the two feet ${owlExample.partShares[4].percent}%.`,
      "So an owl is scored on two things above all: the silhouette and the eyes. A careful beak cannot make up for eyes of the wrong size, and because the scorer also holds shape match to the worst-matching tenth of the drawing, one badly placed pair of eyes limits the whole result.",
    ],
    exampleHeading: "What small eyes cost",
    exampleParagraphs: [
      `Drawn with a slight, even wobble and nothing else wrong, the owl scores ${owlExample.rows[0].total}. Draw the same owl with the eyes 40% smaller and pushed apart - the most common owl mistake - and it scores ${owlExample.rows[1].total}. Shape match drops from ${owlExample.rows[0].shapeMatch} to ${owlExample.rows[1].shapeMatch}; coverage barely moves (${owlExample.rows[0].coverage} to ${owlExample.rows[1].coverage}), because smaller eyes remove only a little line. One mistake, ${owlExample.rows[0].total - owlExample.rows[1].total} points.`,
    ],
    exampleImageAlt: "The owl target in grey with a freehand owl drawn over it in blue, its eyes clearly smaller and further apart than the target's",
    exampleImageCaption: `Eyes 40% smaller and set wider apart, over the target. Scored by the game's own scorer: ${owlExample.rows[1].total} / 100.`,
    drillsHeading: "Three drills for the owl",
    drills: [
      {
        title: "Eyes a third of the body",
        body: "Draw the two eye rings first, each a third as wide as the whole body. Then check the gap between them: on the target it is narrower than a pupil - the eyes almost touch.",
      },
      {
        title: "The M at the top",
        body: "Draw only the top of the outline, as a wide M: two tuft points, with the dip between them about 15% of the owl's height lower. The tufts are corners of the silhouette, not ears stuck on afterwards.",
      },
      {
        title: "The eye line",
        body: "Put the eye centres a little under halfway down from the tuft tips - about 42% of the owl's height - and the beak directly below the gap between them.",
      },
    ],
  },
};

const PIG_FROM_MEMORY: ChallengePageCopy = {
  path: "/draw-a-pig-from-memory",
  heading: "Draw a Pig From Memory",
  detailHeading: "It all hangs on the snout",
  paragraphs: [
    "The pig is on screen for a couple of seconds, then it is gone and the canvas is empty. You draw it back from memory - the round head, the two ears folding forward at the top, the small eyes, and the big oval snout with its two nostrils. Your line is scored against the target and laid over it afterwards, so you can see which parts you kept and which ones drifted.",
    "Everything about a pig hangs on the snout. It is bigger than it feels and it sits lower on the face than memory puts it, so the most common miss is a neat small oval floating in the middle of the head. The ears are the other one: they fold forward as triangles rather than standing up as points, and people who remember them as points draw a cat instead.",
  ],
  deepDive: {
    scorerHeading: "How the scorer reads a pig",
    scorerParagraphs: [
      `The pig is eight separate parts, each given a share of the ${RESAMPLE_POINTS} comparison points in proportion to how much line it has. The head outline carries ${pigExample.partShares[0].percent}%, the two ears ${pigExample.partShares[1].percent}% and the snout with its nostrils ${pigExample.partShares[2].percent}% - while the eyes, the part people usually take most care over, are only ${pigExample.partShares[3].percent}%.`,
      "The snout is a quarter of the drawing on its own. When it is the wrong size or in the wrong place it becomes the worst-matching tenth of the attempt - and the scorer's contour check holds the whole shape-match score to that tenth.",
    ],
    exampleHeading: "What a small, high snout costs",
    exampleParagraphs: [
      `Drawn with a slight, even wobble and nothing else wrong, the pig scores ${pigExample.rows[0].total}. Shrink the snout by 40% and lift it towards the eyes - the way memory tends to redraw it - and the same pig scores ${pigExample.rows[1].total}. Shape match falls from ${pigExample.rows[0].shapeMatch} to ${pigExample.rows[1].shapeMatch}, and coverage from ${pigExample.rows[0].coverage} to ${pigExample.rows[1].coverage}.`,
    ],
    exampleImageAlt: "The pig target in grey with a freehand pig drawn over it in blue, its snout visibly smaller and higher on the face than the target's",
    exampleImageCaption: `Snout 40% smaller and higher on the face, over the target. Scored by the game's own scorer: ${pigExample.rows[1].total} / 100.`,
    drillsHeading: "Three drills for the pig",
    drills: [
      {
        title: "Half the head",
        body: "Draw the head, then the snout as an oval exactly half the head's width and about a third of its height. It will feel too big; it is not.",
      },
      {
        title: "Low on the face",
        body: "Put the snout's centre about two-thirds of the way down the head, so its lower edge ends close to the chin rather than in the middle of the face.",
      },
      {
        title: "Ears to the edges",
        body: "The ear tips lean outwards until they line up with the widest points of the head, and rise above it by about a quarter of the head's height. Draw them leaning, not straight up.",
      },
    ],
  },
};

const SNAIL_FROM_MEMORY: ChallengePageCopy = {
  path: "/draw-a-snail-from-memory",
  heading: "Draw a Snail From Memory",
  detailHeading: "The spiral and the shell",
  paragraphs: [
    "The snail is on screen for a couple of seconds, then it is gone and the canvas is empty. You draw it back from memory - the long foot along the ground, the round shell sitting on it, the spiral wound inside that shell, and the two eye stalks rising from the head. Your line is scored against the target and laid over it afterwards, so you can see which parts you kept and which ones drifted.",
    "The spiral is what makes this one hard. It has a real number of turns, it starts at the outer edge and finishes at the centre, and it is the first thing a memory smooths into a vague swirl. The other common miss is the shell's position: it sits on top of the foot, roughly above the middle of it, not trailing behind like a shell being dragged.",
  ],
  deepDive: {
    scorerHeading: "How the scorer reads a snail",
    scorerParagraphs: [
      `The snail's spiral is ${snailExample.partShares[1].percent}% of the ${RESAMPLE_POINTS} comparison points on its own - almost as much as the foot (${snailExample.partShares[0].percent}%) and more than the shell outline around it (${snailExample.partShares[2].percent}%). The eye stalks and eyes, the part that makes it read as a snail at a glance, are only ${snailExample.partShares[3].percent}%.`,
      "Because the spiral is long, every turn you leave out removes a lot of line: coverage drops, and the comparison points that belong on the inner turns have nothing of yours to match.",
    ],
    exampleHeading: "What a missing turn costs",
    exampleParagraphs: [
      `Drawn with a slight, even wobble and nothing else wrong, the snail scores ${snailExample.rows[0].total}. Give the same snail a spiral of 1.2 turns instead of the target's 2.2 - the vague swirl a memory tends to produce - and it scores ${snailExample.rows[1].total}. Shape match falls from ${snailExample.rows[0].shapeMatch} to ${snailExample.rows[1].shapeMatch}, and coverage from ${snailExample.rows[0].coverage} to ${snailExample.rows[1].coverage}.`,
    ],
    exampleImageAlt: "The snail target in grey with a freehand snail drawn over it in blue whose spiral makes about one turn instead of two",
    exampleImageCaption: `A spiral of 1.2 turns instead of 2.2, over the target. Scored by the game's own scorer: ${snailExample.rows[1].total} / 100.`,
    drillsHeading: "Three drills for the snail",
    drills: [
      {
        title: "Two turns and a bit",
        body: "Draw the spiral on its own: start at the top of the shell on its outer edge and wind inwards for just over two full turns, ending close to the centre.",
      },
      {
        title: "Shell size",
        body: "The shell's diameter is a little more than half the foot's length. Draw the foot first, then a shell that spans just over half of it.",
      },
      {
        title: "Shell position",
        body: "The shell's centre sits about 40% of the way along the foot from the tail - slightly behind the middle, resting on the foot rather than trailing off its end.",
      },
    ],
  },
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
