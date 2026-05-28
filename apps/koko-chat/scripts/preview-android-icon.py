"""
Preview Android adaptive icon under common launcher masks.

Usage:
  python apps/koko-chat/scripts/preview-android-icon.py \
      <foreground.png> [<background-hex>] [-o <out.png>]

Why this exists:
  Every EAS Build / TestFlight cycle on icon changes is 20+ minutes. This
  script catches ~90% of adaptive-icon problems locally in a couple of
  seconds: safe-zone overflow, off-centre composition, unintended bleed
  between the foreground sprite and the background colour.

What it does:
  - Composes the given foreground PNG over the given background colour
    in a 108dp-sized canvas (rendered at 4x for crispness).
  - Applies four representative launcher masks side-by-side:
      Square (no clip)          — Asus / fallback
      Rounded Square (r=22%)    — Stock Android / ColorOS / OneUI default
      Squircle      (r=33%)     — Pixel / OnePlus / iOS-ish
      Circle        (r=50%)     — Mi launcher / Vivo / Realme
  - Overlays the Android adaptive-icon "safe zone" circle (centre 66dp /
    108dp ≈ 61% diameter). Anything outside this red ring is at risk of
    being clipped or hidden by a tight launcher mask.

Output:
  Default: writes preview-android-icon.png next to the input file. Pass
  -o to redirect.

Limits:
  - Squircle is approximated as a rounded-rectangle with radius 33%.
    Real Pixel squircle is a G2-continuous curve; the visual delta is
    a couple of pixels at the corners and not enough to mislead.
  - Does not simulate per-app theming / monochrome icons (Android 13+).
"""
from __future__ import annotations

import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


CANVAS = 432  # 4x of 108dp baseline; matches xxxhdpi resolution

# (label, corner-radius-as-fraction-of-canvas-side, or None for plain square)
SHAPES = [
    ("Square",         None),
    ("Rounded Square", 0.22),
    ("Squircle",       0.33),
    ("Circle",         0.50),
]

# 0.611 ≈ 66dp / 108dp. Centre of the canvas the launcher promises to keep
# visible regardless of which mask shape the user's phone applies.
SAFE_ZONE_FRACTION = 66 / 108


def shape_mask(radius_pct: float | None) -> Image.Image:
    """Build an L-mode mask for the given corner radius (fraction of canvas)."""
    img = Image.new("L", (CANVAS, CANVAS), 0)
    draw = ImageDraw.Draw(img)
    if radius_pct is None:
        draw.rectangle([0, 0, CANVAS - 1, CANVAS - 1], fill=255)
    else:
        r = int(CANVAS * radius_pct)
        draw.rounded_rectangle([0, 0, CANVAS - 1, CANVAS - 1], radius=r, fill=255)
    return img


def render_tile(
    foreground: Image.Image,
    background_color: tuple[int, int, int, int],
    radius_pct: float | None,
) -> Image.Image:
    """Compose foreground over background, then clip with the shape mask."""
    base = Image.new("RGBA", (CANVAS, CANVAS), background_color)
    fg = foreground.resize((CANVAS, CANVAS), Image.LANCZOS)
    base.alpha_composite(fg)
    mask = shape_mask(radius_pct)
    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out


def overlay_safe_zone(tile: Image.Image) -> Image.Image:
    """Draw a dashed-look ring marking the 66dp safe zone."""
    out = tile.copy()
    draw = ImageDraw.Draw(out)
    inset = int(CANVAS * (1 - SAFE_ZONE_FRACTION) / 2)
    bbox = (inset, inset, CANVAS - inset, CANVAS - inset)
    # Soft red ring; 2px stroke reads on most icons without being shouty.
    draw.ellipse(bbox, outline=(255, 80, 80, 230), width=2)
    return out


def parse_bg(arg: str | None) -> tuple[int, int, int, int]:
    if arg is None:
        return (255, 255, 255, 255)
    s = arg.lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        raise SystemExit(f"background must be #RRGGBB, got {arg!r}")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


def load_label_font() -> ImageFont.ImageFont:
    """Use PingFang on macOS (handles Chinese cleanly); fall back to default."""
    for candidate in (
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, 18)
        except OSError:
            continue
    return ImageFont.load_default()


def build_grid(
    foreground: Image.Image,
    background_color: tuple[int, int, int, int],
    show_safe_zone: bool = True,
) -> Image.Image:
    pad = 28
    label_h = 32
    cols = len(SHAPES)
    grid_w = cols * CANVAS + (cols + 1) * pad
    grid_h = CANVAS + pad * 2 + label_h
    grid = Image.new("RGBA", (grid_w, grid_h), (244, 239, 229, 255))
    draw = ImageDraw.Draw(grid)
    font = load_label_font()

    for i, (name, radius_pct) in enumerate(SHAPES):
        tile = render_tile(foreground, background_color, radius_pct)
        if show_safe_zone:
            tile = overlay_safe_zone(tile)
        x = pad + i * (CANVAS + pad)
        y = pad
        grid.paste(tile, (x, y), tile)
        try:
            tw = draw.textlength(name, font=font)
        except AttributeError:
            tw, _ = font.getsize(name)
        draw.text(
            (x + (CANVAS - int(tw)) // 2, y + CANVAS + 8),
            name,
            font=font,
            fill=(31, 20, 10, 255),
        )

    return grid


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Preview Android adaptive icon")
    parser.add_argument("foreground", type=Path, help="Foreground PNG (1024x1024 recommended)")
    parser.add_argument("background", nargs="?", default="#FFFFFF",
                        help="Background colour, e.g. #FFFFFF (default white)")
    parser.add_argument("-o", "--out", type=Path, default=None,
                        help="Output PNG path (default: preview-android-icon.png next to input)")
    parser.add_argument("--no-safe-zone", action="store_true",
                        help="Hide the red safe-zone overlay ring")
    args = parser.parse_args(argv[1:])

    if not args.foreground.exists():
        raise SystemExit(f"no such file: {args.foreground}")

    fg = Image.open(args.foreground).convert("RGBA")
    bg = parse_bg(args.background)
    grid = build_grid(fg, bg, show_safe_zone=not args.no_safe_zone)

    out_path = args.out or args.foreground.with_name("preview-android-icon.png")
    grid.save(out_path)
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    import sys
    raise SystemExit(main(sys.argv))
