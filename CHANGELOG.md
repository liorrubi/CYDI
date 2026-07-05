# Changelog

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
