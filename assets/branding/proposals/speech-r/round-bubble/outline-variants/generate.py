"""Explore closed round-outline speech bubbles with an R. Requires Pillow."""
from pathlib import Path
import importlib.util
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('round_proposals', OUT.parent / 'generate.py')
rounds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rounds)
base = rounds.base
BLUE, INK, MUTED = rounds.BLUE, rounds.INK, rounds.MUTED

ROUNDED_TAIL = 'M 256 96 C 340 96 408 164 408 248 C 408 332 340 400 256 400 C 223 400 194 390 174 377 L 119 407 Q 108 414 111 400 L 128 337 C 112 310 104 281 104 248 C 104 164 172 96 256 96 Z'

CONCEPTS = [
    dict(id='01-fine-line', name='Fine Line', tag='Thin circle / bold R / compact tail',
         bubble=rounds.SHORT, outline=18, soft=False, sx=.90, sy=.90, shear=0,
         lines=['A finer border lets the bold R lead.', 'Clean and light, with more open space.']),
    dict(id='02-bold-ring', name='Bold Ring', tag='Heavy circle / inset R / compact tail',
         bubble=rounds.SHORT, outline=36, soft=False, sx=.82, sy=.86, shear=0,
         lines=['A heavier outline gives the bubble more presence.', 'The strongest border at small app-icon sizes.']),
    dict(id='03-monoline', name='Monoline', tag='Matched strokes / rounded R / left tail',
         bubble=rounds.CIRCLE, outline=28, soft=True, sx=.88, sy=.94, shear=0,
         lines=['Rounded R strokes match the outline weight.', 'A quieter, more unified symbol.']),
    dict(id='04-right-tail', name='Right Tail', tag='Balanced circle / bold R / right tail',
         bubble=rounds.RIGHT, outline=26, soft=False, sx=.88, sy=.88, shear=0,
         lines=['The tail moves right while the letter stays upright.', 'A small change with a different visual rhythm.']),
    dict(id='05-joined-tail', name='Joined Tail', tag='R leg joins the tail / rounded lettering',
         bubble=rounds.RIGHT, outline=28, soft=True, sx=.90, sy=.98, shear=0,
         join='M 300 308 L 401 408',
         lines=['The R diagonal continues into the bubble tail.', 'A more distinctive connection between letter and frame.']),
    dict(id='06-rounded-tail', name='Rounded Tail', tag='Soft tail tip / bold R / medium outline',
         bubble=ROUNDED_TAIL, outline=26, soft=False, sx=.88, sy=.88, shear=0,
         lines=['A curved tail tip softens the classic outline.', 'A friendly refinement with familiar proportions.']),
]


def svg(c, tile):
    result = rounds.svg(c, tile)
    if c.get('join'):
        color = '#FFFFFF' if tile else 'currentColor'
        extra = rounds.speech.path_svg(c['join'], color, 28)
        result = result.replace('</svg>', extra+'</svg>')
    return result


def raster(c, size, tile=True, color=None):
    if not c.get('join'):
        return rounds.raster(c, size, tile, color)
    # Compose the join before downsampling so SVG and PNG share geometry.
    im = rounds.raster(c, size*4, tile, color)
    rounds.paint(ImageDraw.Draw(im), c['join'], color or ('#FFFFFF' if tile else BLUE), size*4/512, width=28)
    return im.resize((size, size), Image.Resampling.LANCZOS)


def board():
    im = Image.new('RGB', (1800, 1330), '#F3F4F7')
    d = ImageDraw.Draw(im)
    d.text((60, 35), 'OPENRELAY / ROUND OUTLINE VARIANTS', font=base.font(19, True), fill=MUTED)
    d.text((56, 70), 'Refining the round outline.', font=base.font(48, True), fill=INK)
    d.text((60, 139), 'Six closed-outline variants. Same palette; different weights, lettering, and tails.', font=base.font(23), fill=MUTED)
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
    d.text((60, 1271), 'FAVORITES: 02 BOLD RING / 03 MONOLINE', font=base.font(17, True), fill=INK)
    d.text((1060, 1271), 'Original vectors / Proposals only / October 2026', font=base.font(17), fill=MUTED)
    im.save(OUT / 'comparison.png')


def main():
    for c in CONCEPTS:
        for tile, suffix in ((True, ''), (False, '-mark')):
            (OUT / f'{c["id"]}{suffix}.svg').write_text(svg(c, tile), encoding='utf-8')
        raster(c, 512).save(OUT / f'{c["id"]}.png')
    board()
    cards = ''.join(f'<article><img src="{c["id"]}.svg" width="180" height="180" alt="{c["name"]}"><h2>{c["name"]}</h2><p>{c["tag"]}</p><p>{" ".join(c["lines"])}</p><a href="{c["id"]}.svg">Icon SVG</a> · <a href="{c["id"]}-mark.svg">Transparent mark SVG</a> · <a href="{c["id"]}.png">PNG</a></article>' for c in CONCEPTS)
    (OUT / 'index.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenRelay — Round Outline variants</title><style>body{max-width:1400px;margin:48px auto;padding:0 24px;background:#f3f4f7;color:#172238;font:18px/1.6 system-ui}h1{font-size:42px;line-height:1.15}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{background:white;border:1px solid #dde1e8;border-radius:24px;padding:30px}a{color:#315bdd}p{color:#667184}img{display:block}h2{margin-bottom:8px}</style><h1>OpenRelay / Round Outline variants</h1><p>Six refinements of the closed round-outline speech bubble with an R inside. Shared palette: '+BLUE+'.</p><p><a href="comparison.png">Open comparison board</a> · <a href="../index.html">Previous round-bubble proposals</a></p><main>'+cards+'</main></html>', encoding='utf-8')
    print(f'Created six vector icon/mark pairs, PNGs and comparison board in {OUT}')


if __name__ == '__main__':
    main()
