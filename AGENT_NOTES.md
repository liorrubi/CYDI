# Agent Workflow Notes

Efficiency rules for working in this repo (token budget matters to the user).

- Don't re-read a file with the Read tool if it was already read/checked earlier in the
  same session and hasn't changed since. Trust prior context.
- Don't explain each change in detailed prose. Report changes tersely (a short list of
  what changed, not a paragraph per change).
- Don't verify (build/browser render) after every individual change - see
  `SHAPE_DESIGN_NOTES.md` for the shape-specific version of this rule. Only verify when
  asked, or once several changes have accumulated and the user approves a check.

## Quick Fix mode - small design/UI requests

When the user asks for a small visual/design change or a point UI fix (e.g. "move this
icon to the other side," "make this text smaller," "change this color"), treat it as a
**Quick Fix**, not a feature task:

- Make only the minimal change needed. Don't refactor, don't touch logic, don't make
  general improvements, and don't change files beyond the ones that must change for this
  specific fix.
- After making the change, do only a basic check that the relevant screen loads and the
  change is visible (e.g. one screenshot or snapshot) - then stop. Don't run a full
  verification pass, don't test unrelated flows, don't check edge cases.
- Report back briefly: what changed, and in which file(s). No long explanation of
  reasoning.

## Shape lock/unlock logic - where to look

When asked to lock or unlock the shapes (e.g. "unlock all shapes so I can browse them" or
"revert the lock back to normal"), the relevant code is in
`src/screens/ShapeChallengeScreen.tsx`, inside the `ShapeMap` component, in the
`shapes.map((shape, index) => { ... })` block:

- Normal/correct behavior:
  `const unlocked = unlockAllOverride || isShapeUnlockedAt(progress, category, shapes, index);`
  (progressive unlock - a shape is playable once completed, or when it's the current
  frontier: the first not-yet-completed shape in the category).
- To temporarily unlock everything for browsing: replace that line with
  `const unlocked = true;` and leave a `// TEMP: ...` comment so it's easy to find and
  revert later.
- The unlock rule lives in `src/services/shapeChallengeProgress.ts`
  (`isShapeUnlockedAt` / `getFrontierIndex`, id-based) - don't touch that when toggling
  the lock bypass; only the `unlocked` line itself needs to change.

## Analytics: 22-23 Sep 2026 Android activity is anomalous, source unresolved

**Do not label these two days as either genuine traffic or QA-generated.** The volume is
far above anything before it and the stored aggregates cannot resolve where it came from.
Treat the Android totals as unexplained, not as proven noise.

### 23 Sep 2026

Android regular-game activity is **anomalously high and the source is unresolved**: 431
external `game_started` on Android, against a prior baseline of 0-17 per day.

A read-only investigation ruled out the two obvious explanations:

- **Not the known QA device.** `dumpsys usagestats` puts CYDI in the foreground for under
  8 minutes before the 08:52 cutover (08:44:15-08:52:31 plus three sub-second resumes).
  A round cannot complete faster than roughly 4s (2s preview + 0.8-1.2s analysing +
  drawing), so that window tops out near 120 rounds - it cannot produce 431. The device
  also carries a *debug* build installed at 08:43:49 via `packageinstaller` (sideloaded,
  not Play), and that build reports JS `APP_VERSION 0.49.1`, which accounts for exactly
  **1** external regular game. No local *release* APK of 0.48.4 was built or installed.
- **Not Google Play automation.** Play Console -> Pre-launch report shows the empty state
  ("Upload artifacts to generate pre-launch reports"). No pre-launch/Robo run has ever
  executed for this app, so there is no Play automation that could have produced traffic.

Genuine user activity is plausible but **unproven**, and the stored dimensions cannot
reconstruct an exact genuine-user count.

**08:52 is not the end of proven contamination.** It is only the moment the new
debug-build internal classification was empirically verified on the device.

### 22 Sep 2026

Android activity was **highly anomalous and the source is unresolved**: 1,280 external
regular-game starts and 185 distinct Android installationIds, against 81 lifetime Play
installs.

A QA contribution remains **possible**: `usagestats` on the device only retains back to
22 Sep 18:45, so device usage earlier that day cannot be reconstructed either way. The
recorded evening windows total 29 minutes, which is far too little on its own.

Do not classify the whole day as proven QA contamination.

### Two earlier arguments that turned out to be invalid

Both were used to call these days contaminated; neither survives:

- **Historical Daily Challenges are NOT proof of automation.** `DailyChallengeScreen.tsx`
  has a replay mode (`Challenge from ${episode.dateKey}`) and the Durable Object keeps an
  episode `history`, so real players can play past challenges. `daily:40` / `daily:42`
  prove nothing.
- **The geometry-heavy shape mix is NOT proof of a catalog scan.** Geometric is the
  default category and `circle` its first shape, so a decaying distribution led by
  `circle` is exactly what ordinary progression produces.

The score distribution argues the same way: 2.61 average with a 57-60% pass rate across
1,563 rounds on 22-23 Sep is a spread of many hands, not the repeatable output of a
script.

### Baseline

**21 Sep 2026 is the last low-volume pre-spike day**, useful as a conservative comparison
point. It is **not** evidence that 22-23 Sep are invalid.

### What is settled

- Web data for 22-23 Sep is unaffected and usable.
- The debug-build fix in commit `8042949` is correct and **must not be reverted**: the
  envelope sends `shouldReportAsInternal() = isQaBuild() || isInternalDevice()`, and
  `isQaBuild()` reads `window.Capacitor.DEBUG` from the APK's own `android:debuggable`,
  which no reinstall or data clear can lose. It closes a real hole regardless of what
  caused these two days.
- Keep `cydi.analyticsInternal.v1 = "1"` set on the QA device as well - it is the only
  protection when testing a locally built *release* APK, where `Capacitor.DEBUG` is false.
- A QA debug APK reports `APP_VERSION` from `src/app/constants.ts`, which drifts ahead of
  the APK's Gradle `versionName` whenever build.gradle is deliberately not bumped.
- The stored day buckets were deliberately left untouched: they hold running totals, not
  per-event records, and `alltime` is a separate counter that deleting a day would not
  correct.
