"""Six refinements of the round speech-bubble/R proposal. Requires Pillow."""
from pathlib import Path
import importlib.util
from PIL import Image, ImageDraw, ImageChops

OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('speech_proposals', OUT.parent / 'generate.py')
speech = importlib.util.module_from_spec(spec)
spec.loader.exec_module(speech)
base = speech.base
BLUE, INK, MUTED = speech.BLUE, speech.INK, speech.MUTED

CIRCLE = 'M 256 96 C 340 96 408 164 408 248 C 408 332 340 400 256 400 C 223 400 194 390 169 372 L 105 416 L 125 330 C 112 306 104 278 104 248 C 104 164 172 96 256 96 Z'
SHORT = 'M 256 96 C 340 96 408 164 408 248 C 408 332 340 400 256 400 C 223 400 194 390 169 372 L 119 397 L 135 345 C 115 319 104 285 104 248 C 104 164 172 96 256 96 Z'
RIGHT = 'M 256 96 C 340 96 408 164 408 248 C 408 278 400 306 387 330 L 407 416 L 343 372 C 318 390 289 400 256 400 C 172 400 104 332 104 248 C 104 164 172 96 256 96 Z'
FORWARD = 'M 256 96 C 340 96 408 164 408 248 C 408 278 400 306 387 330 L 427 420 L 335 377 C 312 392 285 400 256 400 C 172 400 104 332 104 248 C 104 164 172 96 256 96 Z'
OPEN = 'M 372 150 C 344 116 302 96 256 96 C 172 96 104 164 104 248 C 104 282 115 314 135 339 L 113 409 L 180 379 C 203 393 229 400 256 400 C 340 400 408 332 408 248 C 408 232 405 216 400 201'

CONCEPTS = [
    dict(id='01-balanced-round', name='Balanced Round', tag='Classic circle / left tail / bold R',
         bubble=CIRCLE, outline=0, soft=False, sx=1, sy=1, shear=0,
         lines=['A balanced refinement of your selected direction.', 'The strongest all-purpose starting point.']),
    dict(id='02-compact-tail', name='Compact Tail', tag='Short tail / larger R / solid bubble',
         bubble=SHORT, outline=0, soft=False, sx=1.10, sy=1.06, shear=0,
         lines=['A shorter tail puts more emphasis on the R.', 'Dense and bold, especially at small sizes.']),
    dict(id='03-round-outline', name='Round Outline', tag='Circular border / inset R / left tail',
         bubble=CIRCLE, outline=26, soft=False, sx=.86, sy=.86, shear=0,
         lines=['More space separates the letter from the ring.', 'A lighter, more precise visual character.']),
    dict(id='04-soft-round', name='Soft Round', tag='Rounded R / circular body / right tail',
         bubble=RIGHT, outline=0, soft=True, sx=1.10, sy=1.04, shear=0,
         lines=['Rounded letter strokes echo the circular bubble.', 'A relaxed, friendly take on the same idea.']),
    dict(id='05-forward-round', name='Forward Round', tag='Slanted R / extended right tail',
         bubble=FORWARD, outline=0, soft=False, sx=1.02, sy=1, shear=-.18,
         lines=['An angled R and extended tail suggest motion.', 'A more energetic expression of the relay name.']),
    dict(id='06-open-round', name='Open Round', tag='Open ring / rounded R / left tail',
         bubble=OPEN, outline=26, soft=True, sx=.86, sy=.92, shear=0,
         lines=['A deliberate gap makes the round frame feel open.', 'A subtle reference to the Open in OpenRelay.']),
]


def matrix(c):
    return (c['sx'], 0, c['shear'], c['sy'], 256-256*c['sx']-248*c['shear'], 248-248*c['sy'])


def transform(c, x, y):
    a, b, q, d, e, f = matrix(c)
    return a*x+q*y+e, b*x+d*y+f


def letter_svg(c, color):
    mat = ' '.join(f'{v:.4f}' for v in matrix(c))
    if c['soft']:
        paths = speech.path_svg(speech.R_SOFT, color, 32)
    else:
        paths = f'<path d="{speech.R_OUTER} {speech.R_COUNTER}" fill="{color}" fill-rule="evenodd"/>'
    return f'<g transform="matrix({mat})">{paths}</g>'


def svg(c, tile):
    color = '#FFFFFF' if tile else 'currentColor'
    bg = f'<rect width="512" height="512" rx="112" fill="{BLUE}"/>' if tile else ''
    defs = ''
    if c['outline']:
        artwork = speech.path_svg(c['bubble'], color, c['outline']) + letter_svg(c, color)
    else:
        defs = '<defs><mask id="letter-cutout" x="0" y="0" width="512" height="512" maskUnits="userSpaceOnUse"><rect width="512" height="512" fill="white"/>'+letter_svg(c, 'black')+'</mask></defs>'
        artwork = f'<g mask="url(#letter-cutout)">{speech.path_svg(c["bubble"], color)}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" color="{BLUE}" role="img"><title>OpenRelay — {c["name"]}</title>{defs}{bg}{artwork}</svg>\n'


def paint(draw, data, fill, s, c=None, width=0):
    for points in base.path_points(data):
        pts = [transform(c, x, y) if c else (x, y) for x, y in points]
        pts = [(x*s, y*s) for x, y in pts]
        if width:
            draw.line(pts, fill=fill, width=round(width*s), joint='curve')
            for x, y in pts:
                r = width*s/2
                draw.ellipse((x-r, y-r, x+r, y+r), fill=fill)
        else:
            draw.polygon(pts, fill=fill)


def raster(c, size, tile=True, color=None):
    n, s = size*4, size*4/512
    bubble, letter = Image.new('L', (n, n)), Image.new('L', (n, n))
    paint(ImageDraw.Draw(bubble), c['bubble'], 255, s, width=c['outline'])
    ld = ImageDraw.Draw(letter)
    if c['soft']:
        # Transform a supersampled mask to match SVG's affine-scaled stroke.
        original = Image.new('L', (n, n))
        paint(ImageDraw.Draw(original), speech.R_SOFT, 255, s, width=32)
        a, _, q, d, e, f = matrix(c)
        inv = (1/a, -q/(a*d), (q*f/d-e)*s/a, 0, 1/d, -f*s/d)
        letter = original.transform((n, n), Image.Transform.AFFINE, inv, Image.Resampling.BICUBIC)
    else:
        paint(ld, speech.R_OUTER, 255, s, c)
        paint(ld, speech.R_COUNTER, 0, s, c)
    mask = ImageChops.lighter(bubble, letter) if c['outline'] else ImageChops.subtract(bubble, letter)
    im = Image.new('RGBA', (n, n))
    if tile:
        ImageDraw.Draw(im).rounded_rectangle((0, 0, n-1, n-1), radius=112*s, fill=BLUE)
    artwork = Image.new('RGBA', (n, n), color or ('#FFFFFF' if tile else BLUE))
    artwork.putalpha(mask)
    return Image.alpha_composite(im, artwork).resize((size, size), Image.Resampling.LANCZOS)


def board():
    im = Image.new('RGB', (1800, 1330), '#F3F4F7')
    d = ImageDraw.Draw(im)
    d.text((60, 35), 'OPENRELAY / ROUND BUBBLE REFINEMENTS', font=base.font(19, True), fill=MUTED)
    d.text((56, 70), 'Six ways to shape the conversation.', font=base.font(48, True), fill=INK)
    d.text((60, 139), 'Same blue. Different tails, borders, and R lettering.', font=base.font(23), fill=MUTED)
    for i, c in enumerate(CONCEPTS):
        x, y = 60+(i % 3)*568, 205+(i//3)*530
        d.rounded_rectangle((x, y, x+544, y+506), 23, fill='white', outline='#DDE1E8')
        d.text((x+26, y+23), f'0{i+1} / {c["name"].upper()}', font=base.font(20, True), fill=BLUE)
        d.text((x+26, y+60), c['tag'], font=base.font(17), fill=INK)
        icon = raster(c, 170)
        im.paste(icon, (x+28, y+112), icon)
        d.text((x+223, y+147), 'OpenRelay', font=base.font(33, True), fill=INK)
        d.text((x+225, y+194), 'for Reddit', font=base.font(18), fill=MUTED)
        for j, line in enumerate(c['lines']):
            d.text((x+26, y+306+j*26), line, font=base.font(17), fill=MUTED)
        d.line((x+26, y+378, x+518, y+378), fill='#E6E9EF')
        d.text((x+26, y+397), 'ACTUAL SIZE', font=base.font(12, True), fill=MUTED)
        for dx, size in ((26, 16), (77, 32), (144, 48)):
            icon = raster(c, size)
            im.paste(icon, (x+dx, y+432+(48-size)//2), icon)
            d.text((x+dx, y+485), str(size), font=base.font(10), fill=MUTED)
        d.text((x+294, y+397), 'ONE COLOR', font=base.font(12, True), fill=MUTED)
        icon = raster(c, 72, False, INK)
        im.paste(icon, (x+284, y+424), icon)
        d.rounded_rectangle((x+407, y+424, x+479, y+496), 12, fill=INK)
        icon = raster(c, 72, False, '#FFFFFF')
        im.paste(icon, (x+407, y+424), icon)
    d.text((60, 1271), 'FAVORITES: 01 BALANCED ROUND / 02 COMPACT TAIL', font=base.font(17, True), fill=INK)
    d.text((1060, 1271), 'Original vectors / Proposals only / October 2026', font=base.font(17), fill=MUTED)
    im.save(OUT / 'comparison.png')


def main():
    for c in CONCEPTS:
        for tile, suffix in ((True, ''), (False, '-mark')):
            (OUT / f'{c["id"]}{suffix}.svg').write_text(svg(c, tile), encoding='utf-8')
        raster(c, 512).save(OUT / f'{c["id"]}.png')
    board()
    cards = ''.join(f'<article><img src="{c["id"]}.svg" width="180" height="180" alt="{c["name"]}"><h2>{c["name"]}</h2><p>{c["tag"]}</p><p>{" ".join(c["lines"])}</p><a href="{c["id"]}.svg">Icon SVG</a> · <a href="{c["id"]}-mark.svg">Transparent mark SVG</a> · <a href="{c["id"]}.png">PNG</a></article>' for c in CONCEPTS)
    (OUT / 'index.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenRelay — Round bubble variants</title><style>body{max-width:1400px;margin:48px auto;padding:0 24px;background:#f3f4f7;color:#172238;font:18px/1.6 system-ui}h1{font-size:42px;line-height:1.15}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{background:white;border:1px solid #dde1e8;border-radius:24px;padding:30px}a{color:#315bdd}p{color:#667184}img{display:block}h2{margin-bottom:8px}</style><h1>OpenRelay / Round bubble variants</h1><p>Six refinements of the round speech bubble with an R inside. Shared palette: '+BLUE+'.</p><p><a href="comparison.png">Open comparison board</a> · <a href="../index.html">Previous speech-bubble proposals</a></p><main>'+cards+'</main></html>', encoding='utf-8')
    print(f'Created six vector icon/mark pairs, PNGs and comparison board in {OUT}')


if __name__ == '__main__':
    main()
