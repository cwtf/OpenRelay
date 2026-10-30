"""Recreate OpenRelay's Open Thread artwork. Run with Python + Pillow.

All platform assets are checked in; normal app builds need no Python tooling.
Geometry is shared by the SVG, raster icons and Android vector drawables.
"""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BLUE = "#1d63c4"
RAIL = "M104 132 V304 Q104 336 136 336 H200 M104 176 H168"
BARS = [(144, 132, 380, 220), (184, 292, 416, 380)]


def save_text(relative, text):
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + "\n", encoding="utf-8")


def rounded_path(box, radius=32):
    x1, y1, x2, y2 = box
    r = radius
    return (
        f"M{x1+r} {y1} H{x2-r} Q{x2} {y1} {x2} {y1+r} "
        f"V{y2-r} Q{x2} {y2} {x2-r} {y2} H{x1+r} "
        f"Q{x1} {y2} {x1} {y2-r} V{y1+r} Q{x1} {y1} {x1+r} {y1} Z"
    )


def svg(background):
    tile = f'<rect width="512" height="512" rx="112" fill="{BLUE}"/>' if background else ""
    bars = "".join(f'<path d="{rounded_path(box)}"/>' for box in BARS)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        '<title>OpenRelay — Open Thread</title>'
        f'{tile}<g fill="#fff"><path d="{RAIL}" fill="none" stroke="#fff" '
        f'stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>{bars}</g></svg>'
    )


def quadratic(start, control, end, steps=32):
    return [
        tuple((1-t)**2*a + 2*(1-t)*t*b + t*t*c for a, b, c in zip(start, control, end))
        for t in (i / steps for i in range(steps + 1))
    ]


def raster(size):
    # Supersample every target independently so small toolbar icons stay crisp.
    scale = size * 4 / 512
    image = Image.new("RGBA", (size * 4, size * 4))
    draw = ImageDraw.Draw(image)
    coords = lambda box: tuple(round(n * scale) for n in box)
    draw.rounded_rectangle(coords((0, 0, 512, 512)), radius=round(112*scale), fill=BLUE)
    points = [(104, 132), (104, 304)] + quadratic((104, 304), (104, 336), (136, 336)) + [(200, 336)]
    for line in (points, [(104, 176), (168, 176)]):
        draw.line([coords(p) for p in line], fill="white", width=round(40*scale), joint="curve")
        for x, y in line:
            draw.ellipse(coords((x-20, y-20, x+20, y+20)), fill="white")
    # Match the quadratic corner curves in the SVG / Android path.
    for x1, y1, x2, y2 in BARS:
        r = 32
        points = [(x1+r, y1), (x2-r, y1)]
        points += quadratic((x2-r, y1), (x2, y1), (x2, y1+r))
        points += [(x2, y2-r)] + quadratic((x2, y2-r), (x2, y2), (x2-r, y2))
        points += [(x1+r, y2)] + quadratic((x1+r, y2), (x1, y2), (x1, y2-r))
        points += [(x1, y1+r)] + quadratic((x1, y1+r), (x1, y1), (x1+r, y1))
        draw.polygon([coords(p) for p in points], fill="white")
    return image.resize((size, size), Image.Resampling.LANCZOS)


save_text("assets/branding/open-thread.svg", svg(True))
save_text("assets/branding/open-thread-mark.svg", svg(False))
desktop = ROOT / "apps/desktop/resources"
desktop.mkdir(parents=True, exist_ok=True)
master = raster(1024)
master.save(desktop / "icon.png")
master.save(desktop / "icon.ico", sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)],
            append_images=[raster(n) for n in (16, 24, 32, 48, 64, 128, 256)])
master.save(desktop / "icon.icns")
for size in (16, 32, 48, 128):
    path = ROOT / f"public/icons/icon-{size}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    raster(size).save(path)

res = "apps/android/app/src/main/res"
for density, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
    path = ROOT / res / f"mipmap-{density}/ic_launcher.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    raster(size).save(path)

bars = "\n".join(f'        <path android:fillColor="#FFFFFFFF" android:pathData="{rounded_path(box)}" />' for box in BARS)
save_text(f"{res}/drawable/ic_launcher_foreground.xml", f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="512" android:viewportHeight="512">
    <!-- Keep the entire mark inside the adaptive icon's circular safe zone. -->
    <group android:scaleX="0.72" android:scaleY="0.72" android:pivotX="256" android:pivotY="256">
        <path android:fillColor="@android:color/transparent" android:strokeColor="#FFFFFFFF"
            android:strokeWidth="40" android:strokeLineCap="round" android:strokeLineJoin="round"
            android:pathData="{RAIL}" />
{bars}
    </group>
</vector>''')
save_text(f"{res}/values/icon_colors.xml", f'''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">{BLUE}</color>
</resources>''')
for version in (26, 33):
    mono = '\n    <monochrome android:drawable="@drawable/ic_launcher_foreground" />' if version >= 33 else ""
    save_text(f"{res}/mipmap-anydpi-v{version}/ic_launcher.xml", f'''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />{mono}
</adaptive-icon>''')

print("Generated Open Thread SVGs, desktop icons, extension icons and Android launcher resources.")
