"""Generate OpenRelay's Rounded Tail SVG, raster and Android vector icons.

Run with Python + Pillow. All generated assets are checked in.
"""
from pathlib import Path
import re
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BLUE = "#315bdd"
BUBBLE = (
    "M256 96 C340 96 408 164 408 248 C408 332 340 400 256 400 "
    "C223 400 194 390 174 377 L119 407 Q108 414 111 400 L128 337 "
    "C112 310 104 281 104 248 C104 164 172 96 256 96 Z"
)
R_OUTER = (
    "M192 162 L256 162 C302 162 326 184 326 220 "
    "C326 245 314 263 292 271 L334 334 L286 334 L248 278 "
    "L234 278 L234 334 L192 334 Z"
)
R_COUNTER = "M234 196 L234 244 L255 244 C275 244 284 236 284 220 C284 204 275 196 255 196 Z"
R_SCALE = 0.88
R_TRANSLATE = (30.72, 29.76)


def save_text(relative, text):
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + "\n", encoding="utf-8")


def svg(background):
    tile = f'<rect width="512" height="512" rx="112" fill="{BLUE}"/>' if background else ""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        '<title>OpenRelay — Rounded Tail</title>'
        f'{tile}<path d="{BUBBLE}" fill="none" stroke="#fff" '
        'stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<g transform="translate({R_TRANSLATE[0]} {R_TRANSLATE[1]}) scale({R_SCALE})">'
        f'<path d="{R_OUTER} {R_COUNTER}" fill="#fff" fill-rule="evenodd"/></g></svg>'
    )


def path_points(data):
    """Sample the shared M/L/C/Q/Z geometry for Pillow."""
    tokens = iter(re.findall(r"[MLCQZ]|-?\d+(?:\.\d+)?", data))
    points = []

    def point():
        return float(next(tokens)), float(next(tokens))

    for command in tokens:
        if command in ("M", "L"):
            points.append(point())
        elif command in ("C", "Q"):
            start = points[-1]
            control, end = point(), point()
            last = point() if command == "C" else None
            for step in range(1, 49):
                t = step / 48
                u = 1 - t
                if last is None:
                    points.append(tuple(u*u*start[j] + 2*u*t*control[j] + t*t*end[j] for j in (0, 1)))
                else:
                    points.append(tuple(u**3*start[j] + 3*u*u*t*control[j] + 3*u*t*t*end[j] + t**3*last[j] for j in (0, 1)))
        elif command == "Z":
            points.append(points[0])
        else:
            raise ValueError(f"Unsupported path command: {command}")
    return points


def raster(size, background=True):
    # Supersample each target independently for crisp small toolbar icons.
    scale = size * 4 / 512
    image = Image.new("RGBA", (size * 4, size * 4))
    draw = ImageDraw.Draw(image)
    if background:
        draw.rounded_rectangle((0, 0, size*4-1, size*4-1), radius=112*scale, fill=BLUE)
    points = [(x*scale, y*scale) for x, y in path_points(BUBBLE)]
    draw.line(points, fill="white", width=round(26*scale), joint="curve")
    radius = 13*scale
    for x, y in points:
        draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill="white")
    letter = Image.new("L", image.size)
    letter_draw = ImageDraw.Draw(letter)
    for path, fill in ((R_OUTER, 255), (R_COUNTER, 0)):
        points = [((x*R_SCALE+R_TRANSLATE[0])*scale, (y*R_SCALE+R_TRANSLATE[1])*scale) for x, y in path_points(path)]
        letter_draw.polygon(points, fill=fill)
    image.paste("white", (0, 0), letter)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main():
    save_text("assets/branding/rounded-tail.svg", svg(True))
    save_text("assets/branding/rounded-tail-mark.svg", svg(False))
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

    save_text(f"{res}/drawable/ic_launcher_foreground.xml", f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="512" android:viewportHeight="512">
    <!-- Keep the entire mark inside the adaptive icon's circular safe zone. -->
    <group android:scaleX="0.72" android:scaleY="0.72" android:pivotX="256" android:pivotY="256">
        <path android:fillColor="@android:color/transparent" android:strokeColor="#FFFFFFFF"
            android:strokeWidth="26" android:strokeLineCap="round" android:strokeLineJoin="round"
            android:pathData="{BUBBLE}" />
        <group android:scaleX="{R_SCALE}" android:scaleY="{R_SCALE}"
            android:translateX="{R_TRANSLATE[0]}" android:translateY="{R_TRANSLATE[1]}">
            <path android:fillColor="#FFFFFFFF" android:fillType="evenOdd"
                android:pathData="{R_OUTER} {R_COUNTER}" />
        </group>
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
    print("Generated Rounded Tail SVGs, desktop icons, extension icons and Android launcher resources.")


if __name__ == "__main__":
    main()
