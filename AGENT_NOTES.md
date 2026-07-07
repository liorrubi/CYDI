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

- Normal/correct behavior: `const unlocked = index <= levelIndex;` (progressive unlock -
  a shape is only available once the previous one in its category has been passed).
- To temporarily unlock everything for browsing: replace that line with
  `const unlocked = true;` and leave a `// TEMP: ...` comment so it's easy to find and
  revert later.
- `levelIndex` comes from the per-category progress store (`getCategoryLevelIndex`) -
  don't touch that when toggling the lock bypass; only the `unlocked` line itself needs
  to change.
