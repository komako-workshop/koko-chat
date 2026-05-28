"""
Rebuild an Android adaptive-icon foreground from an artwork PNG.

Two things this fixes about the original assets/adaptive-icon.png:

  1. The artwork ships with a cream squircle baked in. That cream then
     reads as a stripe between Android's launcher background (configured
     in app.config.js as #FFFFFF) and the duck — the icon looks like
     three nested shapes on a Circle launcher.
  2. The duck fills 100% of the canvas, well past the 66dp safe zone
     Android promises to keep visible. Circle launchers on MIUI / vivo
     etc. clip its body and the corner star.

Pipeline:

  1. Flood-fill from the four corners erasing pixels close to the cream
     card colour (same recipe as .brand/site-concepts/_strip-sticker-bg.py).
     This produces a transparent-background duck preserving stars / hearts
     / props that aren't touching the cream.
  2. Trim the transparent margin to find the duck's true bounding box.
  3. Place the trimmed sprite centred on a fresh 1024x1024 transparent
     canvas, scaled so its longer side is `safe_zone_fraction` of the
     canvas. Default is 0.66 — slightly outside the 0.611 safe zone so
     the duck doesn't feel tiny under Squircle masks, but well inside
     the launcher clip on Circle masks.

Usage:
  python apps/koko-chat/scripts/compose-adaptive-icon.py \
      apps/koko-chat/assets/icon.png \
      apps/koko-chat/assets/adaptive-icon.png

  Optional flags:
    --scale 0.66          fraction of canvas the duck's longer side spans
    --vertical-bias -10   pixels to nudge the duck up (negative = up)
    --cream "#FBEDD0"     baked-in card colour to strip
    --tolerance 95        chroma-key tolerance, 0..255
"""
from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path
from PIL import Image


def colour_distance(a, b):
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return (dr * dr + dg * dg + db * db) ** 0.5


def parse_hex(s: str):
    s = s.lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def strip_card_background(img: Image.Image, cream_rgb, tolerance) -> Image.Image:
    """Flood-fill from corners erasing pixels within tolerance of cream."""
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    visited = bytearray(w * h)
    queue: deque[tuple[int, int]] = deque(
        [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    )
    while queue:
        x, y = queue.popleft()
        idx = y * w + x
        if visited[idx]:
            continue
        r, g, b, a = px[x, y]
        d = colour_distance((r, g, b), cream_rgb)
        if d > tolerance:
            continue
        px[x, y] = (r, g, b, 0)
        visited[idx] = 1
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny * w + nx]:
                queue.append((nx, ny))
    return img


def trim_alpha(img: Image.Image) -> Image.Image:
    """Crop to the bounding box of non-transparent pixels."""
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def compose(
    src: Path,
    dst: Path,
    canvas_size: int,
    scale: float,
    vertical_bias: int,
    cream: tuple[int, int, int],
    tolerance: float,
) -> None:
    raw = Image.open(src).convert("RGBA")
    stripped = strip_card_background(raw, cream, tolerance)
    duck = trim_alpha(stripped)

    # Scale so longer side = scale * canvas
    target_long = int(canvas_size * scale)
    w, h = duck.size
    if w >= h:
        new_w = target_long
        new_h = int(round(h * target_long / w))
    else:
        new_h = target_long
        new_w = int(round(w * target_long / h))
    duck = duck.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    x = (canvas_size - new_w) // 2
    y = (canvas_size - new_h) // 2 + vertical_bias
    canvas.alpha_composite(duck, (x, y))
    canvas.save(dst)
    print(f"wrote {dst} ({canvas_size}x{canvas_size}, sprite {new_w}x{new_h})")


def main(argv):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("source", type=Path, help="Source artwork PNG (1024x1024)")
    p.add_argument("output", type=Path, help="Output adaptive-icon foreground PNG")
    p.add_argument("--canvas", type=int, default=1024, help="Output canvas side (default 1024)")
    p.add_argument("--scale", type=float, default=0.66,
                   help="Sprite longer-side as fraction of canvas (default 0.66)")
    p.add_argument("--vertical-bias", type=int, default=0,
                   help="Pixels to nudge the sprite vertically (negative=up)")
    p.add_argument("--cream", type=str, default="#FBEDD0",
                   help="Baked-in card colour to strip (default #FBEDD0)")
    p.add_argument("--tolerance", type=float, default=95,
                   help="Chroma-key tolerance, 0..255 (default 95)")
    args = p.parse_args(argv[1:])

    compose(
        args.source, args.output,
        canvas_size=args.canvas,
        scale=args.scale,
        vertical_bias=args.vertical_bias,
        cream=parse_hex(args.cream),
        tolerance=args.tolerance,
    )
    return 0


if __name__ == "__main__":
    import sys
    raise SystemExit(main(sys.argv))
