#!/usr/bin/env python
"""Render a CYDI shape preview PNG exactly as the game draws it: dark strokes
on a white square canvas, one polyline per part (pen-lift between parts, no
connector lines), no UI, no source image.

Usage:
  python render_preview.py segs.json out.png [--libs pylibs]

segs.json: {"size": 600, "segs": [[[x, y], ...], ...]} with coords already in
canvas pixels (i.e. after the shape's map(): (0.06 + n * 0.88) * size).
"""
import sys, json

args = [a for a in sys.argv[1:] if not a.startswith("--libs")]
for i, a in enumerate(sys.argv):
    if a == "--libs" and i + 1 < len(sys.argv):
        sys.path.insert(0, sys.argv[i + 1])
    elif a.startswith("--libs="):
        sys.path.insert(0, a.split("=", 1)[1])

from PIL import Image, ImageDraw

data = json.load(open(args[0], encoding="utf-8"))
size = int(data["size"])
im = Image.new("RGB", (size, size), "#ffffff")
d = ImageDraw.Draw(im)
w = max(3, round(size * 0.011))
for seg in data["segs"]:
    pts = [(float(x), float(y)) for x, y in seg]
    if len(pts) >= 2:
        d.line(pts, fill="#1b2027", width=w, joint="curve")
    # round caps so stroke ends match the game's canvas rendering
    for p in (pts[0], pts[-1]):
        r = w / 2
        d.ellipse([p[0]-r, p[1]-r, p[0]+r, p[1]+r], fill="#1b2027")
im.save(args[1])
print(f"wrote {args[1]} ({size}, {size})")
