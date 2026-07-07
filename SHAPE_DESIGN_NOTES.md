# Shape Design Notes

Guidelines and recurring bug patterns learned while designing and fixing shapes in
`src/engine/shapeLibrary.ts`. Read this before adding or reworking a shape.

## What kinds of shapes to add (standing rule)

When adding new shapes, prefer iconic, symbolic, or geometric shapes that read clearly
as a single continuous line / one pen lift (the diamond, anchor, question mark, target,
gem, star, etc. - see the `symbols` and `geometric` categories). Avoid complex realistic
objects (animals, vehicles, people) unless they can be represented in a clearly
recognizable, minimalist way - the animal category has repeatedly needed rework because
detailed organic silhouettes are hard to make unambiguous at this scale and stroke
style, while a simple icon (umbrella, anchor, gem) is far more reliably readable both to
a human glancing at it and to the scoring engine.

## Core architecture recap

- Every shape is one ordered `Vec2[]` array, drawn as a single continuous pen stroke.
  Visually "disconnected" parts (a handle, a second hole, an eye, a leg) are achieved by
  literally jumping to a new point in the array - the pen never actually lifts unless a
  point is listed in the shape's `breaks: number[]`.
- `breaks` marks indices where a new visual segment starts. Every consumer
  (`DrawingCanvas`, `ShapeOverlayCanvas`, `ShapePreviewIcon`, the scoring engine) slices
  the path at these indices and never draws a connecting line across a break.
- Helpers:
  - `toPath(points, size, breaks?)` - wraps a finished point array.
  - `toPathFromParts(parts: Vec2[][], size)` - concatenates independent parts and
    **automatically inserts a break at every part boundary**. This is the default,
    preferred way to combine unrelated pieces (handle, hole, spot, leg, wing, hook...).
  - `withDetourLoop(points, anchorIndex, loopCenter, loopRadius)` - splices a small
    floating circle into `points` at `anchorIndex`, with breaks on both sides so the
    loop never gets a connecting line to the rest of the shape. Used for eyes, spots,
    holes, buttons, flames, etc. Returns `{ points, breaks }` (`PathWithBreaks`), **not**
    a plain array - always destructure `.points` / `.breaks`, never pass the result
    straight into `toPath`.
  - `organicBody(keyPoints, pointsPerSegment, eyes?)` - runs `keyPoints` through
    `smoothClosedPath` (Catmull-Rom spline) for an organic silhouette, then inserts any
    `EyeSpec` floating loops. Also returns `PathWithBreaks`.
  - `polygonEdges(vertices, pointsPerEdge)` - straight edges, **closes the loop back to
    `vertices[0]`**.
  - `openPolyline(vertices, pointsPerEdge)` - straight edges, **does NOT close** the
    loop. Only use this for a genuinely open line (a stem, a straight stroke) - never
    for an outline that's supposed to look like a solid closed object.

## Bug patterns hit repeatedly this session (check for these first)

1. **Shape left open on one side.** Using `openPolyline` for what should be a closed
   outline (a mug body, a candle, a coffee cup, a picture frame) silently drops the
   final edge back to the start point. Symptom: one side of the object is missing
   entirely. Fix: switch to `polygonEdges`.

2. **A stray line cuts across the whole shape.** Happens when a second part (handle,
   stand, hole, hook, tail) is appended directly after a first part
   (`[...partA, ...partB]`) without a break. The pen doesn't lift, so it draws a
   straight line from wherever `partA` happened to end to wherever `partB` starts -
   even if that's nowhere near where the two parts should visually meet. Fix: use
   `toPathFromParts([partA, partB], size)` instead of manual spreading. This is almost
   always the right fix even if `partB`'s start point exactly matches a point already
   on `partA`'s outline (a zero-distance break is invisible and harmless).

   Gotcha: a closed loop (circle, ellipse, `smoothClosedPath`) always closes back to
   **its own first point**, not to whatever point would make visual sense for the next
   part to attach to. Don't assume "the loop just finished, so appending here will
   connect near the bottom/right/wherever" - check where the parametrization actually
   starts.

3. **Smoothing overshoot / self-crossing curves.** `smoothClosedPath` (Catmull-Rom)
   through `keyPoints` with a sharp corner (e.g. an ear tip flanked by two very
   differently-angled neighbors, or a shared pinch point visited twice non-adjacently
   like the old bowtie butterfly) can overshoot past the corner and cross into the
   opposite side of the shape, producing a visible X in the middle. Fixes, in order of
   preference:
   - If the sharp feature is naturally angular anyway (ears, snout, hammer head),
     rebuild that part with straight `polygonEdges` instead of a smoothed spline.
   - If a single loop revisits the same pinch point from two different sides (e.g. two
     wing-pairs meeting at a body centerline), split it into two independent
     `smoothClosedPath` loops that each start/end at that shared point, combined with
     `toPathFromParts`, instead of one big loop that reverses direction through the
     point twice.

4. **Attached protrusions (ears, snout, beak, trunk, head) vs. floating decorations
   (eyes, spots, holes, small legs).**
   - A protrusion that's physically part of the same continuous surface (an ear, a
     snout, a bird's beak) should be **integrated into the main `keyPoints` outline**,
     framed by "pinch" points that narrow before and after it (narrow neck - wide tip -
     narrow neck for a rounded lobe like a rabbit/elephant ear; or just tip flanked by
     nearer neighbors for a sharp point like a beak/snout). This keeps it attached
     without needing a break.
   - A decoration that's a separate small round object (an eye, a spot, a button, a
     small leg peeking out from under a shell) should be a **floating loop** via
     `withDetourLoop` / the `eyes` array on `organicBody`, even if it's not literally an
     eye - the mechanism is just "small circle, cleanly disconnected via breaks". This
     is far more reliable than trying to pinch a small bump into the main spline, which
     tends to either blur into the surrounding curve (too little contrast) or spike
     into a star point (too much contrast) rather than reading as a rounded leg/knob.
   - When several bumps of the same kind (mane tufts, wool bumps) are needed, contrast
     them against a pulled-in "plain" section (a face, a chin) rather than making every
     bump uniform - a ring of evenly-spaced equal bumps reads as a gear or a flower, not
     as fur/mane/wool.

## Practical checklist for a new or reworked shape

1. Sketch the parts on paper/mentally: exactly one continuous outline, plus any floating
   circles (eyes/spots/legs), plus any separately-appended pieces (handle/stand/tail).
2. Build the main outline. If it has a sharp angular feature, prefer `polygonEdges`; if
   it's meant to look organic/rounded, use `organicBody`/`smoothClosedPath` but frame
   any sharp bumps with pinch points.
3. Add floating decorations via `withDetourLoop` (or `organicBody`'s `eyes` array) -
   never by hand-splicing a circle into the point array.
4. Combine every independent piece with `toPathFromParts`, never `[...a, ...b]`.
5. Render it and actually look at it (see verification below) - don't trust the
   coordinates alone. Overshoot and stray connector lines are only obvious once drawn.

## How to verify a shape quickly

With the dev server running, from the browser console (or via an automated preview
tool), dynamically import the shape library and render the raw points as an SVG
polyline, slicing at `breaks` so you see exactly what the game will show - including any
connector-line bugs that a glance at the coordinates would miss:

```js
const mod = await import('/src/engine/shapeLibrary.ts?t=' + Date.now());
const shape = mod.SHAPE_LIBRARY.find(s => s.id === 'home-umbrella');
const path = shape.generate(240);
// slice path.points at path.breaks, render each segment as its own <polyline>
```

Also worth a structural sanity check across the whole library after any bulk change:
confirm every shape's `breaks` are ascending, in range, and `generate()` doesn't throw -
this caught real bugs (out-of-order breaks from `organicBody`, a mis-anchored second
hole) that were invisible from reading the code alone.
