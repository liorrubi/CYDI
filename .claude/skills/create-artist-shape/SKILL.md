---
name: create-artist-shape
description: Convert a newly added artist image (photograph OR clean line art) from cydi/artist-source-files/<pack>/originals/ into a draft CYDI drawing challenge in an Artist Pack — image-derived trace, alignment overlay, draft-only integration, real draw+score verification, then stop for the owner's Approve/Improve/Reject. Use when asked to "convert the new artist image", "turn this artist photo into a drawing challenge", "add the new artwork to the artist pack", "המר את התמונה החדשה של האמן לאתגר ציור", "צור צורה מהתמונה של האמן".
---

# Create Artist Shape (image → draft Artist Pack artwork)

Turn ONE artist-supplied image into a drawable artwork in `cydi/src/engine/artistPackLibrary.ts`. The result is always image-derived (traced/extracted from the actual pixels, never a generic hand-built template — that has been rejected before) and always lands as `status: "draft"`.

## Hard guardrails (owner-controlled lifecycle)

- Process ONLY the image the owner named; "the newest" = latest mtime in `cydi/artist-source-files/<pack>/originals/` (`stat -c '%Y %n' * | sort -n`).
- Integrate as `status: "draft"` ONLY — dev-only preview, never visible in production. NEVER set `approved`/`published`, never move files to `approved-line-art/`, never commit/push/deploy without the owner's explicit word.
- Always END by presenting results and STOPPING for **Approve / Improve / Reject**:
  - **Approve** → copy the data as `approved-line-art/<base>.ts` AND `approved-line-art/<base>-preview.png` (same base name, both mandatory), set status `"approved"` only (still not published, still no push).
  - **Improve** → apply the notes (see "Owner-directed edits"), re-verify, re-present.
  - **Reject** → remove the draft code, its registration, and the work-in-progress files.

## Environment

- Python: `C:\Python314\python.exe` (Node may not be on PATH). Libs (isolated):
  `python -m pip install --target SCRATCHPAD/pylibs pillow numpy scikit-image scipy` → pass via `sys.path` / `--libs`.
- Dev server `cydi-dev` on :5173 (HMR). Work files go in the session scratchpad; only the two WIP deliverables go in the repo.

## Step 1 — Classify the image

`Read` the image once.
- **Clean line art** (thin dark strokes, light ground) → use the root-level skill `trace-shape-from-image` and its `scripts/trace_shape.py` as-is; skip to Step 3.
- **Photograph / colored artwork** → two-pass extraction below. Do NOT hand-estimate keypoints and do NOT substitute a generic geometric construction.

## Step 2 — Photograph extraction (two targeted passes)

Build per-image masks (this part is always image-specific), then trace with the bundled generic script.

**Thin dark structures** (nets, wires, branches, outlines): `canny(gray, sigma≈3)` → `closing(disk 5–9)` merges each stroke's double edge and bridges small gaps → save as a black-on-white strokes PNG.

**Colored solid objects** (e.g. an orange rim against blue sky): a color mask (`(r-b) > 0.045` for warm; adapt per image) → `closing(disk 10–15)` → largest component → `fill_holes` → take the **outer silhouette contour** plus meaningful **hole contours** (an object's inner opening; a dark gap that separates two structural elements). Export these as extra parts in px coords.

Then:

```bash
python cydi/.claude/skills/create-artist-shape/scripts/trace_photo.py \
  --strokes strokes.png --extra-parts extra.json --out OUTDIR --name MYART_PARTS \
  --libs SCRATCHPAD/pylibs
```

The script does the validated graph trace: skeletonize → skeleton-graph walk → **keep every junction-to-junction connector** (they form the mesh; a blanket min-length filter fragments it — learned the hard way), prune only short dangling spurs and floating components, stitch straight continuations, RDP, drop specks, joint-normalize preserving aspect, and emit the TS array + `recon.png` + `parts_px.json`.

**Mask/ROI rules learned on real artwork:**
- Never let an ROI edge cut through the object — cuts read as broken prongs. If the photo itself crops the object at the frame edge, run the mask to the frame edge; the silhouette closes there honestly.
- Exclude background structures (poles, walls) by masking regions the object doesn't occupy, not by slicing the object.
- Traced centerlines only — skeleton gives what a finger traces; never switch to double-outline contours for strands.

## Step 3 — Alignment overlay (required gate)

Draw the traced parts (from `parts_px.json`) over the source photo in distinct colors and `Read` it. Every stroke must sit on real structure; composition, proportions and signature details must match. Iterate masks/params until it does — do not integrate an unrecognizable or misaligned trace. Keep this overlay for the report.

## Step 4 — Integrate as draft

In `cydi/src/engine/artistPackLibrary.ts`:
- Paste the const array + a provenance comment (source file, method, part/point counts).
- Generator: `const map = (n) => (0.06 + n * 0.88) * size;` over the parts → `toPathFromParts(parts, size)` (parts stay disconnected — no connector lines, ever).
- Register with `artwork("<pack>-<id>", "<Name>", "<pack>", "draft", <fn>)`.

WIP deliverables in `cydi/artist-source-files/<pack>/work-in-progress/` (same base name):
- `<base>.ts.txt` — the data + provenance header (status/lifecycle note included).
- `<base>-preview.png` — render with `scripts/render_preview.py` from a segs JSON (`{"size":600,"segs":[...]}`, canvas px via the same `map`). Dark strokes on white, correct aspect, no UI, no source image.

## Step 5 — Verify in the real game

1. Structural eval (browser `javascript_tool` on :5173): import `artistPackLibrary.ts`, `generate(600)`, assert breaks strictly ascending, points in-bounds, no NaN, expected part/point counts, status `"draft"`.
2. Full draw+score, desktop (1280×800) AND mobile (375×812): navigate Shape Challenge → pack → artwork, dispatch pointer events tracing `generate(canvas.width)` segment-by-segment (pen-lift per break), press Done. Self-trace should score ≈98% with Shape/Coverage/Scale 100.
3. **HMR gotcha:** after editing the library, a screen that is already open still holds the OLD target in state — a self-trace then scores ~70% falsely. Always reload the page fresh before the scoring run.
4. Screenshots may time out in this environment; verify via canvas pixel counts / page text, and present the preview PNG instead.

## Step 6 — Present and stop

Show side-by-side: source photo | alignment overlay | clean line art | in-CYDI rendering (an HTML artifact works well), plus part/point counts, simplification notes, and a short resemblance/drawability assessment. Then STOP for Approve/Improve/Reject.

## Owner-directed edits (Improve rounds)

Artistic changes beyond the photo (extending elements, handmade-wobble character) are legitimate when the owner asks:
- Post-process in normalized space with a FIXED random seed; never touch parts the owner approved (splice via fitted uniform transforms if renormalizing — see `extract5.py` pattern: fit `k, tx, ty` from stored correspondences).
- Wobble: subdivide long edges (~0.028 spacing), tapered perpendicular sine (amp ≈0.004, endpoints pinned so junctions never move).
- New net rows/openings: hang them from real traced tips, share anchors so rows stay connected, jitter drops/midpoints for asymmetry — no grids, no repeated zigzags.
- Document every edit in the provenance header and re-run Step 5.
