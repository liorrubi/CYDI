# Changelog

## 0.7.1 - 2026-07-05

- Fixed "Next Shape": clicking it from the result screen previously reused
  the same component instance with stale phase/result state (only the ghost
  target visually updated). Added `key={selectedIndex}` so each shape gets a
  fresh mount, correctly landing on a new "Study the shape" preview.
- Added encouragement on a missed attempt (score below 70): a gentle,
  synthesized two-note dip sound (`playEncourageSound`, still no external
  audio) plus a random supportive message ("Not bad!", "Try again!", "So
  close!", etc.), shown the same way the celebration banner is for a pass.

## 0.7.0 - 2026-07-05

Added sound and celebration on passing a Shape Challenge level.

- `src/engine/soundEngine.ts`: a short success chime synthesized entirely
  in-browser via the Web Audio API (oscillator tones) - no audio files,
  samples, or third-party sound effects, so there's no copyright risk.
- Passing a level (score 70+) now plays that chime and shows a random
  encouraging banner ("Great job!", "Well done!", etc.).
- Added a 🔊/🔇 `SoundToggleButton`, persisted in `localStorage`, shown in
  the shared `AppHeader` (covering every screen that uses it) plus the two
  result screens that render without a header.

## 0.6.1 - 2026-07-05

Replaying an already-passed shape and succeeding now shows "Next Shape"
straight away (jumping to the shape right after it, already unlocked),
instead of forcing a trip back to the map first.

## 0.6.0 - 2026-07-05

Added two ways to see the target shape more clearly in Shape Challenge.

- Result screen now shows `ShapeOverlayCanvas`: the target shape (gray,
  semi-transparent) overlaid with the player's own attempt (blue), with a
  legend, so it's visually clear what to improve.
- Added a "Show Guide" toggle during the drawing phase itself, letting the
  player keep the target visible (same semi-transparent ghost style) while
  actively drawing, to trace and build skill — the canvas stays fully
  interactive while the guide is shown.

## 0.5.1 - 2026-07-05

Clicking "Try Again" after a failed (or passed) Shape Challenge attempt now
returns to the "Study the shape" preview phase first, instead of jumping
straight back to a blank drawing canvas — giving the player another look
at the target shape before their next try.

## 0.5.0 - 2026-07-05

Made the scoring engine noticeably stricter about actual shape correctness.

- `comparePointArrays` (`src/engine/comparePaths.ts`) now uses root-mean-square
  point-to-point distance instead of a plain mean, which punishes localized
  mismatches (e.g. a star's concave points not matching a circle's constant
  radius) far more than an averaged distance did.
- Rebalanced `SCORE_WEIGHTS` so `shapeMatch` — the only sub-score that
  actually measures shape correctness — dominates the total (0.65 → 0.85),
  since `coverage`/`smoothness`/`scale` were propping up scores for clearly
  wrong shapes that happened to be a similar size.
- Verified: a circle drawn against a star target dropped from 85 to 53; a
  random scribble dropped further to 5; identical and reverse/rotated
  redraws are unaffected (still 100).

## 0.4.1 - 2026-07-05

Locked shapes on the Shape Challenge map no longer reveal any preview of
the shape itself — only the 🔒 icon and name are shown, removing the
dimmed outline that previously hinted at what was coming.

## 0.4.0 - 2026-07-05

Added a Shape Challenge level map.

- Entering Shape Challenge now opens a map screen showing all 52 shapes at
  once (`ShapeChallengeScreen`'s new `ShapeMap` view), each rendered with a
  small SVG outline preview (`src/components/ShapePreviewIcon.tsx`).
- Shapes are strictly sequential and never repeat: a shape is locked (dimmed
  preview, 🔒 icon, not clickable) until every shape before it has been
  passed (score 70+); completed shapes stay unlocked, show their best score
  as a badge, and can be replayed any time to improve it.
- Removed the old auto-advancing/looping progression — progress is now
  driven entirely by `progress.levelIndex` as a strict unlock frontier, with
  no wraparound back to the first shape.

## 0.3.0 - 2026-07-05

Expanded Shape Challenge with more levels and a progression gate.

- Grew the shape library from 8 to 52 shapes (`src/engine/shapeLibrary.ts`),
  ordered by increasing difficulty: circle, regular polygons (3-12 sides),
  point-stars (4-10 points), heart/arrow/crescent moon, multi-petal flowers
  (3-10 petals), zigzags, waves, growing spirals, many-toothed gears, and
  finally self-intersecting Lissajous curves.
- Added a pass threshold (`SHAPE_CHALLENGE_PASS_SCORE = 70`): scoring below
  70 disables "Next Shape" and shows an inline message; the required score
  is now also shown up front, next to the current level's best score.

## 0.2.0 - 2026-07-05

Added Shape Challenge mode: a system-generated progression loop.

- Added `src/engine/shapeLibrary.ts`: eight original, parametrically generated
  target shapes (circle, square, triangle, star, heart, spiral, infinity,
  arrow) ordered by increasing difficulty, reused by the existing scoring
  engine with no changes to it.
- Added `src/services/shapeChallengeProgress.ts` for `localStorage`-backed
  progression state (current level, per-shape best score) under the
  `cydi.shapeChallenge.progress.v1` key, with the same defensive-parsing
  approach as challenge storage.
- Added `ShapeChallengeScreen`: study/draw/analyze/result loop against the
  current level's generated shape, with Try Again (retry) and Next Shape
  (advance, looping back to the start after the last shape) actions.
- Added a fourth Home screen card, "Shape Challenge", alongside the existing
  three (the "Daily Challenge — Coming Soon" placeholder is unchanged).

## 0.1.0 - 2026-07-05

Initial CYDI MVP: local-only Create Challenge loop.

- Scaffolded fresh with Vite + React + TypeScript.
- Added a shape-agnostic vector-based scoring engine (`src/engine/`): path
  normalization (dedupe, arc-length resample, center, scale), point-array
  comparison with reverse-direction handling, and closed-shape rotational
  start-point search.
- Added `localStorage`-backed challenge persistence (`src/services/challengeStorage.ts`)
  under the `cydi.challenges.v1` key, with defensive parsing so corrupt data
  never crashes the app.
- Added Home, Create Challenge, My Challenges, and Play Challenge (with an
  embedded Result state) screens, wired together with simple state-based
  routing (no router dependency).
- Added a shared `DrawingCanvas` component supporting mouse/touch/pen input,
  a fixed single continuous stroke, and an optional ghost-preview overlay
  reused for the pre-attempt "study the shape" phase.
- Added `LEGAL_NOTES.md` documenting IP/trademark guardrails.
