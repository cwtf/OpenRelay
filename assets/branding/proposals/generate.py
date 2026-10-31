"""Render standalone vector logo proposals and a local comparison board.

Requires Pillow. Does not change the installed application artwork.
"""
from pathlib import Path
from html import escape
import math
import re
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
INK = '#172238'
MUTED = '#667184'
FONT = Path('C:/Windows/Fonts')

CONCEPTS = [
    dict(id='01-or-ligature', name='OR Ligature', color='#315BDD', accent='#B4C5FF',
         tag='A signature built from the name',
         lines=['An O and R share one continuous silhouette.',
                'The most direct, ownable identity for OpenRelay.'],
         shapes=[('path', 'M 278 256 C 278 318 242 369 194 369 C 146 369 108 318 108 256 C 108 194 146 143 194 143 C 242 143 278 194 278 256 Z', 38),
                 ('path', 'M 266 369 L 266 143 L 310 143 C 366 143 392 164 392 204 C 392 244 366 266 310 266 L 266 266 M 310 266 L 390 369', 38)]),
    dict(id='02-open-conversation', name='Open Conversation', color='#087D83', accent='#B4EFE6',
         tag='An open O with a conversational tail',
         lines=['A broken conversation ring invites you into the thread.',
                'Friendly, calm, and easy to recognize as a compact mark.'],
         shapes=[('path', 'M 352 190 C 330 156 292 136 250 136 C 181 136 126 189 126 256 C 126 323 181 376 248 376 C 267 376 285 372 302 364 L 366 386 L 347 331', 40),
                 ('circle', (374, 256, 21), 0)]),
    dict(id='03-relay-handoff', name='Relay Handoff', color='#C54B31', accent='#FFD6BE',
         tag='Two paths, one exchange',
         lines=['Opposing arrows express passing a conversation along.',
                'Energetic and clear, with a warmer visual personality.'],
         shapes=[('path', 'M 132 246 L 132 180 C 132 154 154 132 180 132 L 358 132 M 312 86 L 358 132 L 312 178', 40),
                 ('path', 'M 380 266 L 380 332 C 380 358 358 380 332 380 L 154 380 M 200 334 L 154 380 L 200 426', 40)]),
    dict(id='04-thread-pair', name='Thread Pair', color='#253B75', accent='#C3CFFF',
         tag='A new chapter for the current thread motif',
         lines=['Two reply bubbles and a rail make nested discussion visible.',
                'The closest connection to the existing Open Thread icon.'],
         shapes=[('path', 'M 108 160 L 108 314 C 108 332 118 342 136 342 L 178 342', 32),
                 ('solid', 'M 182 116 L 350 116 Q 378 116 378 144 L 378 196 Q 378 224 350 224 L 220 224 L 170 253 L 170 224 Q 148 224 148 196 L 148 144 Q 148 116 182 116 Z', 0),
                 ('solid-accent', 'M 242 284 L 382 284 Q 410 284 410 312 L 410 364 Q 410 392 382 392 L 298 392 L 248 421 L 248 392 L 242 392 Q 214 392 214 364 L 214 312 Q 214 284 242 284 Z', 0)]),
]


def path_points(data):
    tokens = re.findall(r'[MLCQZ]|-?\d+(?:\.\d+)?', data)
    paths, pts, i, start = [], [], 0, None
    def point():
        nonlocal i
        p = (float(tokens[i]), float(tokens[i+1]))
        i += 2
        return p
    while i < len(tokens):
        cmd = tokens[i]
        i += 1
        if cmd == 'M':
            if pts:
                paths.append(pts)
            start = point()
            pts = [start]
        elif cmd == 'L':
            pts.append(point())
        elif cmd in ('C', 'Q'):
            p0 = pts[-1]
            p1, p2 = point(), point()
            p3 = point() if cmd == 'C' else None
            for n in range(1, 49):
                t = n / 48
                u = 1-t
                if p3:
                    pts.append(tuple(u**3*p0[j]+3*u*u*t*p1[j]+3*u*t*t*p2[j]+t**3*p3[j] for j in (0, 1)))
                else:
                    pts.append(tuple(u*u*p0[j]+2*u*t*p1[j]+t*t*p2[j] for j in (0, 1)))
        elif cmd == 'Z':
            pts.append(start)
    if pts:
        paths.append(pts)
    return paths


def svg(c, tile=True, mono=False):
    shapes = []
    if tile:
        shapes.append(f'<rect width="512" height="512" rx="112" fill="{c["color"]}"/>')
    for kind, data, width in c['shapes']:
        fill = 'currentColor' if not tile else '#FFFFFF'
        if kind == 'solid-accent' and tile and not mono:
            fill = c['accent']
        if kind == 'circle':
            x, y, r = data
            shapes.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"/>')
        elif kind == 'path':
            shapes.append(f'<path d="{data}" fill="none" stroke="{fill}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>')
        else:
            shapes.append(f'<path d="{data}" fill="{fill}"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" color="{c["color"]}" role="img"><title>OpenRelay — {escape(c["name"])}</title>{"".join(shapes)}</svg>\n'


def raster(c, size, tile=True, color=None):
    scale = size*4/512
    im = Image.new('RGBA', (size*4, size*4))
    draw = ImageDraw.Draw(im)
    if tile:
        draw.rounded_rectangle((0, 0, size*4-1, size*4-1), radius=112*scale, fill=c['color'])
    for kind, data, width in c['shapes']:
        fill = color or ('#FFFFFF' if tile else c['color'])
        if kind == 'solid-accent' and tile and not color:
            fill = c['accent']
        if kind == 'circle':
            x, y, r = data
            draw.ellipse(tuple(v*scale for v in (x-r, y-r, x+r, y+r)), fill=fill)
        else:
            for pts in path_points(data):
                points = [(x*scale, y*scale) for x, y in pts]
                if kind == 'path':
                    draw.line(points, fill=fill, width=round(width*scale), joint='curve')
                    # Round caps and joins, including Bezier endpoints.
                    for x, y in points:
                        r = width*scale/2
                        draw.ellipse((x-r, y-r, x+r, y+r), fill=fill)
                else:
                    draw.polygon(points, fill=fill)
    return im.resize((size, size), Image.Resampling.LANCZOS)


def font(size, bold=False):
    return ImageFont.truetype(str(FONT / ('segoeuib.ttf' if bold else 'segoeui.ttf')), size)


def render_board():
    board = Image.new('RGB', (1600, 1450), '#F3F4F7')
    d = ImageDraw.Draw(board)
    d.text((64, 42), 'OPENRELAY / IDENTITY EXPLORATIONS', font=font(19, True), fill=MUTED)
    d.text((60, 77), 'Four ways to open the conversation.', font=font(48, True), fill=INK)
    d.text((64, 147), 'Vector concepts for the browser extension, desktop app, and Android reader.', font=font(23), fill=MUTED)
    for i, c in enumerate(CONCEPTS):
        x, y = 64+(i % 2)*752, 220+(i//2)*572
        d.rounded_rectangle((x, y, x+720, y+540), 24, fill='white', outline='#DDE1E8', width=1)
        d.text((x+32, y+24), f'0{i+1} / {c["name"].upper()}', font=font(19, True), fill=c['color'])
        d.text((x+32, y+58), c['tag'], font=font(22), fill=INK)
        board.paste(raster(c, 180), (x+36, y+118), raster(c, 180))
        d.text((x+253, y+150), 'OpenRelay', font=font(41, True), fill=INK)
        d.text((x+255, y+208), 'for Reddit', font=font(20), fill=MUTED)
        for j, color in enumerate((c['color'], c['accent'])):
            d.ellipse((x+256+j*32, y+257, x+275+j*32, y+276), fill=color)
        d.text((x+333, y+254), c['color'].upper(), font=font(17), fill=MUTED)
        for j, line in enumerate(c['lines']):
            d.text((x+32, y+328+j*27), line, font=font(19), fill=MUTED)
        d.line((x+32, y+404, x+688, y+404), fill='#E6E9EF', width=1)
        d.text((x+32, y+422), 'ACTUAL SIZE', font=font(13, True), fill=MUTED)
        for offset, size in ((32, 16), (93, 32), (170, 48)):
            icon = raster(c, size)
            board.paste(icon, (x+offset, y+460+(48-size)//2), icon)
            d.text((x+offset, y+515), str(size), font=font(11), fill=MUTED)
        d.text((x+371, y+422), 'ONE COLOR', font=font(13, True), fill=MUTED)
        icon = raster(c, 76, False, INK)
        board.paste(icon, (x+365, y+448), icon)
        d.rounded_rectangle((x+488, y+448, x+564, y+524), 12, fill=INK)
        icon = raster(c, 76, False, '#FFFFFF')
        board.paste(icon, (x+488, y+448), icon)
    d.text((64, 1392), 'RECOMMENDATION: 01 OR LIGATURE', font=font(17, True), fill=INK)
    d.text((608, 1392), 'Original vector artwork / Proposals only / October 2026', font=font(17), fill=MUTED)
    board.save(OUT / 'comparison.png')


def main():
    for c in CONCEPTS:
        (OUT / f'{c["id"]}.svg').write_text(svg(c), encoding='utf-8')
        (OUT / f'{c["id"]}-mark.svg').write_text(svg(c, False), encoding='utf-8')
        raster(c, 512).save(OUT / f'{c["id"]}.png')
    render_board()
    cards = ''.join(f'<article><img src="{c["id"]}.svg" width="180" height="180" alt="{c["name"]}"><h2>{c["name"]}</h2><p>{" ".join(c["lines"])}</p><a href="{c["id"]}.svg">App icon SVG</a> · <a href="{c["id"]}-mark.svg">Standalone mark SVG</a> · <a href="{c["id"]}.png">PNG</a></article>' for c in CONCEPTS)
    (OUT / 'index.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenRelay — Logo proposals</title><style>body{max-width:1100px;margin:48px auto;padding:0 24px;background:#f3f4f7;color:#172238;font:18px/1.6 system-ui}h1{font-size:42px;line-height:1.15}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{background:white;border:1px solid #dde1e8;border-radius:24px;padding:32px}a{color:#315bdd}p{color:#667184}img{display:block}h2{margin-bottom:8px}</style><h1>OpenRelay / Logo proposals</h1><p>Four original vector directions. Recommendation: OR Ligature.</p><p><a href="comparison.png">View comparison with monochrome and actual-size previews</a></p><main>'+cards+'</main></html>', encoding='utf-8')
    print(f'Created four SVG icon/mark pairs, PNGs, comparison.png and index.html in {OUT}')


if __name__ == '__main__':
    main()
