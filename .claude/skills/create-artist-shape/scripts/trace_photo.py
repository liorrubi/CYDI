#!/usr/bin/env python
"""Generic graph-based centerline trace for photograph-derived CYDI shapes.

Input is a preprocessed STROKES image (black strokes on white, full source
resolution) produced by per-image mask building (Canny+closing for thin dark
structures — see SKILL.md). Optionally, silhouette contours extracted
separately (e.g. from a color mask) are passed as --extra-parts and prepended
before joint normalization.

Pipeline (validated on real artist photos): threshold -> skeletonize ->
skeleton-graph walk -> KEEP every junction-to-junction connector (a blanket
min-length filter fragments meshes), prune only short dangling spurs ->
drop floating components by total arc length -> stitch straightest
continuations through junctions -> RDP -> drop tiny specks -> normalize
preserving aspect -> emit TS array + recon.png + parts_px.json.

Usage:
  python trace_photo.py --strokes strokes.png --out OUTDIR --name MYART_PARTS
      [--extra-parts extra.json] [--spur-len 55] [--min-comp-len 220]
      [--stitch-cos 0.25] [--eps 3.0] [--speck-diag 0.045] [--libs pylibs]

extra.json format: [[[x, y], ...], ...]  (px coords; each list = one closed
or open polyline part, e.g. silhouette outer contour + hole contours).
"""
import sys, os, json, math, argparse
from collections import defaultdict

ap = argparse.ArgumentParser()
ap.add_argument("--strokes", required=True, help="black-on-white strokes PNG (source px)")
ap.add_argument("--out", required=True)
ap.add_argument("--name", default="SHAPE_PARTS")
ap.add_argument("--extra-parts", default="", help="JSON of px polylines to prepend (silhouettes)")
ap.add_argument("--spur-len", type=float, default=55.0, help="prune dangling spurs shorter than this (px)")
ap.add_argument("--min-comp-len", type=float, default=220.0, help="drop components with total length below this (px)")
ap.add_argument("--stitch-cos", type=float, default=0.25, help="min straightness to merge through a junction")
ap.add_argument("--eps", type=float, default=3.0, help="RDP tolerance (px)")
ap.add_argument("--speck-diag", type=float, default=0.045, help="drop parts with normalized bbox diagonal below this")
ap.add_argument("--inset", type=float, default=0.06, help="canvas margin fraction used by the emitted generate()")
ap.add_argument("--libs", default="")
args = ap.parse_args()
if args.libs:
    sys.path.insert(0, args.libs)

import numpy as np
from PIL import Image, ImageDraw
from skimage.morphology import skeletonize

os.makedirs(args.out, exist_ok=True)
arr = np.asarray(Image.open(args.strokes).convert("L"))
skel = skeletonize(arr < 128)

ys, xs = np.where(skel)
pix = set(zip(map(int, ys), map(int, xs)))
def nbrs(y, x):
    out = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if (dy or dx) and (y + dy, x + dx) in pix:
                out.append((y + dy, x + dx))
    return out
deg = {p: len(nbrs(*p)) for p in pix}
nodes = {p for p in pix if deg[p] != 2}
visited = set()
def ek(a, b): return (a, b) if a <= b else (b, a)
def walk(start, second):
    path = [start, second]; visited.add(ek(start, second))
    prev, cur = start, second
    while cur not in nodes:
        nxt = [p for p in nbrs(*cur) if p != prev and ek(cur, p) not in visited]
        if not nxt:
            break
        n = nxt[0]; visited.add(ek(cur, n)); path.append(n); prev, cur = cur, n
    return path
raw = []
for node in nodes:
    for nb in nbrs(*node):
        if ek(node, nb) not in visited:
            raw.append(walk(node, nb))
seen = {p for pth in raw for p in pth}
for p in list(pix - seen):  # pure loops
    nb = nbrs(*p)
    if nb and ek(p, nb[0]) not in visited:
        raw.append(walk(p, nb[0]))

def arclen(pts): return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))

# ---- iterative spur pruning: keep junction connectors, drop short dangles ----
segs = [list(p) for p in raw if len(p) >= 2]
for _ in range(4):
    endpoint_count = defaultdict(int)
    for s in segs:
        endpoint_count[s[0]] += 1
        endpoint_count[s[-1]] += 1
    keep, changed = [], False
    for s in segs:
        free = endpoint_count[s[0]] == 1 or endpoint_count[s[-1]] == 1
        if free and arclen(s) < args.spur_len:
            changed = True
            continue
        keep.append(s)
    segs = keep
    if not changed:
        break

# ---- drop floating components (union-find over shared endpoints) ----
parent = list(range(len(segs)))
def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]; i = parent[i]
    return i
def union(i, j):
    ri, rj = find(i), find(j)
    if ri != rj:
        parent[ri] = rj
owner = {}
for si, s in enumerate(segs):
    for p in (s[0], s[-1]):
        if p in owner:
            union(si, owner[p])
        else:
            owner[p] = si
comp_len = defaultdict(float)
for si, s in enumerate(segs):
    comp_len[find(si)] += arclen(s)
segs = [s for si, s in enumerate(segs) if comp_len[find(si)] >= args.min_comp_len]

# ---- stitch straightest continuations through junctions ----
def tangent(seg, at_start):
    k = min(8, len(seg) - 1)
    a, b = (seg[0], seg[k]) if at_start else (seg[-1], seg[-1 - k])
    return (b[0] - a[0], b[1] - a[1])
ends = defaultdict(list)
for i, s in enumerate(segs):
    ends[s[0]].append((i, True)); ends[s[-1]].append((i, False))
link = {}
for node, lst in ends.items():
    if len(lst) < 2:
        continue
    def indir(e):
        i, st = e; t = tangent(segs[i], st); return (-t[0], -t[1])
    pairs = []
    for a in range(len(lst)):
        for b in range(a + 1, len(lst)):
            da, db = indir(lst[a]), indir(lst[b])
            na = math.hypot(*da) or 1; nb = math.hypot(*db) or 1
            pairs.append((-(da[0]*db[0] + da[1]*db[1]) / (na*nb), a, b))
    pairs.sort(reverse=True)
    used = set()
    for straight, a, b in pairs:
        if straight < args.stitch_cos:
            break
        if lst[a] in used or lst[b] in used:
            continue
        used.add(lst[a]); used.add(lst[b])
        link[lst[a]] = lst[b]; link[lst[b]] = lst[a]
def as_xy(seg): return [(x, y) for (y, x) in seg]
oriented = {i: as_xy(s) for i, s in enumerate(segs)}
used_seg = set(); merged = []
for i in range(len(segs)):
    if i in used_seg or len(segs[i]) < 2:
        continue
    used_seg.add(i); poly = list(oriented[i])
    cur, end = i, False
    while (cur, end) in link:
        nseg, nend = link[(cur, end)]
        if nseg in used_seg:
            break
        used_seg.add(nseg)
        poly = poly + (oriented[nseg] if nend else oriented[nseg][::-1])[1:]
        cur, end = nseg, not nend
    cur, end = i, True
    while (cur, end) in link:
        nseg, nend = link[(cur, end)]
        if nseg in used_seg:
            break
        used_seg.add(nseg)
        add = oriented[nseg] if nend else oriented[nseg][::-1]
        poly = add[::-1][:-1] + poly
        cur, end = nseg, not nend
    merged.append(poly)

def rdp(points, eps):
    if len(points) < 3:
        return points
    a = points[0]; b = points[-1]
    ab = (b[0]-a[0], b[1]-a[1]); nab = math.hypot(*ab)
    dmax, idx = 0.0, 0
    for i in range(1, len(points) - 1):
        p = points[i]
        d = math.hypot(p[0]-a[0], p[1]-a[1]) if nab == 0 else abs(ab[0]*(a[1]-p[1]) - (a[0]-p[0])*ab[1]) / nab
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return rdp(points[:idx+1], eps)[:-1] + rdp(points[idx:], eps)
    return [points[0], points[-1]]

def arclen_xy(pts): return sum(math.dist(pts[i], pts[i+1]) for i in range(len(pts)-1))
traced = [rdp(p, args.eps) for p in merged if len(p) >= 2 and arclen_xy(p) >= 40]

extra = []
if args.extra_parts:
    extra = [[tuple(p) for p in part] for part in json.load(open(args.extra_parts, encoding="utf-8"))]
parts = extra + traced  # silhouettes first, then strands

# ---- normalize (preserve aspect, center) ----
allpts = [p for s in parts for p in s]
minx = min(p[0] for p in allpts); maxx = max(p[0] for p in allpts)
miny = min(p[1] for p in allpts); maxy = max(p[1] for p in allpts)
bw, bh = maxx - minx, maxy - miny
scale = 1.0 / max(bw, bh)
xoff = (1.0 - bw*scale) / 2.0; yoff = (1.0 - bh*scale) / 2.0
norm = [[((p[0]-minx)*scale + xoff, (p[1]-miny)*scale + yoff) for p in s] for s in parts]

# ---- drop tiny specks (junction crumbs) ----
def diag(s):
    sx = [p[0] for p in s]; sy = [p[1] for p in s]
    return math.hypot(max(sx)-min(sx), max(sy)-min(sy))
kept_idx = [i for i, s in enumerate(norm) if i < len(extra) or diag(s) >= args.speck_diag]
norm = [norm[i] for i in kept_idx]
parts_px = [parts[i] for i in kept_idx]

lines = [f"const {args.name}: [number, number][][] = ["]
for s in norm:
    lines.append("  [" + ", ".join(f"[{round(x,4)}, {round(y,4)}]" for x, y in s) + "],")
lines.append("];")
open(os.path.join(args.out, f"{args.name}.ts.txt"), "w", encoding="utf-8").write("\n".join(lines))
json.dump([[list(map(float, p)) for p in s] for s in parts_px],
          open(os.path.join(args.out, "parts_px.json"), "w"))

SIZE = 600; ins = args.inset; span = 1 - 2*ins
im = Image.new("RGB", (SIZE, SIZE), "white"); d = ImageDraw.Draw(im)
for s in norm:
    pts = [((ins + x*span)*SIZE, (ins + y*span)*SIZE) for x, y in s]
    if len(pts) >= 2:
        d.line(pts, fill="black", width=3, joint="curve")
im.save(os.path.join(args.out, "recon.png"))

print(f"parts: {len(norm)} (extra {len(extra)}, traced {len(norm)-len(extra)})  "
      f"points: {sum(len(s) for s in norm)}  aspect w/h: {bw/bh:.3f}")
print(f"wrote: {args.name}.ts.txt, recon.png, parts_px.json  in {args.out}")
fn = args.name.lower().replace("_parts", "").replace("_", "") + "Shape"
print("--- generate() to paste after the array ---")
print(f"""function {fn}(size: number): DrawingPath {{
  const map = (n: number) => ({ins} + n * {span:.2f}) * size;
  const parts = {args.name}.map((part) => part.map(([x, y]) => ({{ x: map(x), y: map(y) }})));
  return toPathFromParts(parts, size);
}}""")
