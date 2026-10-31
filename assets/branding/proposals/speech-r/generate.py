"""Create four speech-bubble/R vector proposals without changing app icons."""
from pathlib import Path
import importlib.util
from PIL import Image, ImageDraw, ImageChops

OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('proposal_geometry', OUT.parent / 'generate.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
BLUE = '#315BDD'
INK, MUTED = base.INK, base.MUTED

R_OUTER = 'M 192 162 L 256 162 C 302 162 326 184 326 220 C 326 245 314 263 292 271 L 334 334 L 286 334 L 248 278 L 234 278 L 234 334 L 192 334 Z'
R_COUNTER = 'M 234 196 L 234 244 L 255 244 C 275 244 284 236 284 220 C 284 204 275 196 255 196 Z'
R_SOFT = 'M 210 318 L 210 166 L 258 166 C 292 166 310 182 310 212 C 310 243 292 258 258 258 L 210 258 M 258 258 L 314 318'

CONCEPTS = [
    dict(id='01-solid-bubble', name='Solid Bubble', label='Bold R / rounded rectangle / left tail',
         bubble='M 166 108 L 346 108 Q 420 108 420 182 L 420 292 Q 420 366 346 366 L 223 366 L 142 420 L 155 366 Q 92 366 92 292 L 92 182 Q 92 108 166 108 Z',
         outline=0, soft=False,
         lines=['A bold R cut out of a solid conversation bubble.', 'The clearest starting point for a small app icon.']),
    dict(id='02-outline-bubble', name='Outline Bubble', label='Bold R / open interior / left tail',
         bubble='M 166 112 L 346 112 Q 416 112 416 182 L 416 290 Q 416 360 346 360 L 221 360 L 140 412 L 152 360 Q 96 360 96 290 L 96 182 Q 96 112 166 112 Z',
         outline=26, soft=False,
         lines=['An outlined bubble keeps the letter and frame separate.', 'Light and crisp; needs more care at toolbar sizes.']),
    dict(id='03-round-bubble', name='Round Bubble', label='Bold R / circular body / left tail',
         bubble='M 410 242 C 410 328 344 394 256 394 C 229 394 204 387 182 376 L 114 414 L 132 346 C 109 318 98 284 98 248 C 98 162 168 102 256 102 C 344 102 410 164 410 242 Z',
         outline=0, soft=False,
         lines=['A rounder silhouette suggests both an O and a conversation.', 'The R stays explicit inside a softer, friendlier shape.']),
    dict(id='04-soft-bubble', name='Soft Bubble', label='Rounded R / compact body / right tail',
         bubble='M 202 88 L 310 88 Q 408 88 408 186 L 408 276 Q 408 342 370 364 L 390 426 L 302 374 L 202 374 Q 104 374 104 276 L 104 186 Q 104 88 202 88 Z',
         outline=0, soft=True,
         lines=['A rounded, drawn R gives the mark a more casual voice.', 'A compact bubble and right tail add a different rhythm.']),
]


def path_svg(data, fill, width=0):
    return f'<path d="{data}" fill="{"none" if width else fill}"' + (f' stroke="{fill}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"' if width else '') + '/>'


def svg(c, tile):
    # The cutout is a genuine transparent aperture, including for standalone marks.
    bg = f'<rect width="512" height="512" rx="112" fill="{BLUE}"/>' if tile else ''
    color = '#FFFFFF' if tile else 'currentColor'
    if c['outline']:
        artwork = path_svg(c['bubble'], color, c['outline'])
        artwork += f'<path d="{R_OUTER} {R_COUNTER}" fill="{color}" fill-rule="evenodd"/>'
        defs = ''
    else:
        cutout = path_svg(R_SOFT, 'black', 32) if c['soft'] else path_svg(R_OUTER, 'black') + path_svg(R_COUNTER, 'white')
        defs = '<defs><mask id="r-cutout" x="0" y="0" width="512" height="512" maskUnits="userSpaceOnUse"><rect width="512" height="512" fill="white"/>'+cutout+'</mask></defs>'
        artwork = f'<g mask="url(#r-cutout)">{path_svg(c["bubble"], color)}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" color="{BLUE}" role="img"><title>OpenRelay — {c["name"]}</title>{defs}{bg}{artwork}</svg>\n'


def paint(draw, data, fill, scale, width=0):
    for points in base.path_points(data):
        pts = [(x*scale, y*scale) for x, y in points]
        if width:
            draw.line(pts, fill=fill, width=round(width*scale), joint='curve')
            r = width*scale/2
            for x, y in pts:
                draw.ellipse((x-r, y-r, x+r, y+r), fill=fill)
        else:
            draw.polygon(pts, fill=fill)


def raster(c, size, tile=True, color=None):
    n = size*4
    s = n/512
    mask = Image.new('L', (n, n))
    d = ImageDraw.Draw(mask)
    paint(d, c['bubble'], 255, s, c['outline'])
    letter = Image.new('L', (n, n))
    ld = ImageDraw.Draw(letter)
    if c['soft']:
        paint(ld, R_SOFT, 255, s, 32)
    else:
        paint(ld, R_OUTER, 255, s)
        paint(ld, R_COUNTER, 0, s)
    mask = ImageChops.lighter(mask, letter) if c['outline'] else ImageChops.subtract(mask, letter)
    im = Image.new('RGBA', (n, n))
    if tile:
        ImageDraw.Draw(im).rounded_rectangle((0, 0, n-1, n-1), radius=112*s, fill=BLUE)
    ink = Image.new('RGBA', (n, n), color or ('#FFFFFF' if tile else BLUE))
    ink.putalpha(mask)
    im = Image.alpha_composite(im, ink)
    return im.resize((size, size), Image.Resampling.LANCZOS)


def board():
    im = Image.new('RGB', (1600, 1450), '#F3F4F7')
    d = ImageDraw.Draw(im)
    d.text((64, 42), 'OPENRELAY / SPEECH BUBBLE + R', font=base.font(19, True), fill=MUTED)
    d.text((60, 77), 'One idea. Four different voices.', font=base.font(48, True), fill=INK)
    d.text((64, 147), 'A shared blue palette keeps the comparison focused on shape and lettering.', font=base.font(23), fill=MUTED)
    for i, c in enumerate(CONCEPTS):
        x, y = 64+(i % 2)*752, 220+(i//2)*572
        d.rounded_rectangle((x, y, x+720, y+540), 24, fill='white', outline='#DDE1E8')
        d.text((x+32, y+24), f'0{i+1} / {c["name"].upper()}', font=base.font(19, True), fill=BLUE)
        d.text((x+32, y+60), c['label'], font=base.font(21), fill=INK)
        icon = raster(c, 184)
        im.paste(icon, (x+36, y+118), icon)
        d.text((x+253, y+149), 'OpenRelay', font=base.font(41, True), fill=INK)
        d.text((x+255, y+207), 'for Reddit', font=base.font(20), fill=MUTED)
        d.ellipse((x+256, y+258, x+275, y+277), fill=BLUE)
        d.text((x+291, y+253), BLUE, font=base.font(17), fill=MUTED)
        for j, line in enumerate(c['lines']):
            d.text((x+32, y+328+j*27), line, font=base.font(19), fill=MUTED)
        d.line((x+32, y+404, x+688, y+404), fill='#E6E9EF')
        d.text((x+32, y+422), 'ACTUAL SIZE', font=base.font(13, True), fill=MUTED)
        for offset, size in ((32, 16), (93, 32), (170, 48)):
            icon = raster(c, size)
            im.paste(icon, (x+offset, y+460+(48-size)//2), icon)
            d.text((x+offset, y+515), str(size), font=base.font(11), fill=MUTED)
        d.text((x+371, y+422), 'ONE COLOR', font=base.font(13, True), fill=MUTED)
        icon = raster(c, 76, False, INK)
        im.paste(icon, (x+365, y+448), icon)
        d.rounded_rectangle((x+488, y+448, x+564, y+524), 12, fill=INK)
        icon = raster(c, 76, False, '#FFFFFF')
        im.paste(icon, (x+488, y+448), icon)
    d.text((64, 1392), 'RECOMMENDATION: 01 SOLID BUBBLE', font=base.font(17, True), fill=INK)
    d.text((608, 1392), 'Original vector artwork / Proposals only / October 2026', font=base.font(17), fill=MUTED)
    im.save(OUT / 'comparison.png')


def main():
    for c in CONCEPTS:
        (OUT / (c['id']+'.svg')).write_text(svg(c, True), encoding='utf-8')
        (OUT / (c['id']+'-mark.svg')).write_text(svg(c, False), encoding='utf-8')
        raster(c, 512).save(OUT / (c['id']+'.png'))
    board()
    cards = ''.join(f'<article><img src="{c["id"]}.svg" width="180" height="180" alt="{c["name"]}"><h2>{c["name"]}</h2><p>{" ".join(c["lines"])}</p><a href="{c["id"]}.svg">Icon SVG</a> · <a href="{c["id"]}-mark.svg">Transparent mark SVG</a> · <a href="{c["id"]}.png">PNG</a></article>' for c in CONCEPTS)
    (OUT / 'index.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenRelay — Speech bubble + R</title><style>body{max-width:1100px;margin:48px auto;padding:0 24px;background:#f3f4f7;color:#172238;font:18px/1.6 system-ui}h1{font-size:42px;line-height:1.15}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{background:white;border:1px solid #dde1e8;border-radius:24px;padding:32px}a{color:#315bdd}p{color:#667184}img{display:block}h2{margin-bottom:8px}</style><h1>OpenRelay / Speech bubble + R</h1><p>Four shape and lettering variants in one shared palette. Recommended starting point: Solid Bubble.</p><p><a href="comparison.png">Comparison board with small-size and monochrome previews</a></p><main>'+cards+'</main></html>', encoding='utf-8')
    print(f'Created four vector icon/mark pairs, PNGs and comparison board in {OUT}')


if __name__ == '__main__':
    main()
