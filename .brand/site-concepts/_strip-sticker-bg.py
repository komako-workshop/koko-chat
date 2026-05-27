"""
Strip the cream/beige rounded card background from a sticker PNG.

The Koko stickers are designed for chat bubbles, so they ship with a
rounded ~#FBEDD0 card and soft shadow. When we use them as floating
decorations on a warm-orange landing page that card reads as "polaroid
glued onto the canvas" which breaks the floating-duck illusion.

Strategy: flood-fill transparency from the four corners using a tolerant
colour-distance threshold. Whatever the fill can reach (the card + shadow
halo) becomes transparent; the duck and any non-touching props (hearts,
sparkles, magnifier handle) stay intact.

Tuned for the existing 9 stickers in apps/koko-chat/assets/brand/stickers.
"""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image


CREAM_RGB = (251, 237, 208)  # eyeballed average of card centre
TOLERANCE = 95               # 0..255, lower = stricter colour match. 95 covers
                             # both the centre cream and the soft outer halo,
                             # at the cost of nibbling a touch of duck edge.


def colour_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return (dr * dr + dg * dg + db * db) ** 0.5


def strip_background(src: Path, dst: Path) -> None:
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    px = img.load()

    visited = bytearray(w * h)
    queue: deque[tuple[int, int]] = deque()
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        queue.append(corner)

    while queue:
        x, y = queue.popleft()
        idx = y * w + x
        if visited[idx]:
            continue
        r, g, b, a = px[x, y]
        if a == 0:
            visited[idx] = 1
            continue
        d = colour_distance((r, g, b), CREAM_RGB)
        if d > TOLERANCE:
            # Hit the duck (or any prop): stop the flood here.
            continue
        # Anything the flood can reach within tolerance is card / shadow halo.
        # Hard-erase to fully transparent. A previous version kept these
        # pixels at 0..120 alpha to soften the edge, but that turned the
        # card outline into a visible frosted-glass rectangle on warm
        # backgrounds. Hard cut is uglier at pixel level but reads as "duck
        # floating on the page" instead of "polaroid pasted on the canvas".
        px[x, y] = (r, g, b, 0)
        visited[idx] = 1

        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny * w + nx]:
                queue.append((nx, ny))

    img.save(dst, "PNG")


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print("usage: _strip-sticker-bg.py <input.png> <output.png>", file=sys.stderr)
        return 1
    src = Path(argv[1])
    dst = Path(argv[2])
    strip_background(src, dst)
    print(f"wrote {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
