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

## Analytics: 22-23 Sep 2026 Android data is QA-contaminated

**Exclude Android totals for 22 and 23 September 2026 from every trend comparison.**
The last reliable Android baseline before the contamination is **21 Sep 2026**.

What happened: the internal-device flag lives in `localStorage` alongside
`installationId`/`sessionId` (`src/services/analyticsIdentity.ts`), so reinstalling the
APK wiped all three at once. Version codes 31-40 were all built and installed on the test
device on 22 Sep while preparing the 0.48.4 release, and each cycle produced a fresh
installation id with the internal flag gone - so automated QA runs were recorded as real
players. The give-away in the stored data is a near-uniform sweep of the whole geometric
category plus ten *historical* daily challenges (`daily:13`, `daily:17`, `daily:25`...),
which no real player can replay.

The contaminated figures, for reference: 185 Android "installations" / 1,280 games on
22 Sep, and 44 / 392 on 23 Sep, against 81 lifetime Play installs and ~47 monthly active
devices.

- **Web data for those two days is unaffected and stays usable** - the contamination is
  Android-only.
- The stored day buckets are **deliberately left as they are**. They hold running totals,
  not per-event records, so the noise cannot be separated from the genuine traffic; and
  `alltime` is a separate running counter, so deleting a day bucket would leave the day
  sums disagreeing with the lifetime totals - a worse state than a documented anomaly.
- Fixed going forward: a debuggable build now marks its own events internal via
  `isQaBuild()`, which reads the APK's own `android:debuggable` rather than storage, so no
  reinstall can lose it again.
