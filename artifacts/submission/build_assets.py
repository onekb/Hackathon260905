#!/usr/bin/env python3
"""Build original InferPool vector submission assets; only writes beside this script."""
from pathlib import Path
from html import escape
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

OUT = Path(__file__).resolve().parent
REGULAR = Path(os.environ.get('INFERPOOL_FONT_REGULAR', '/System/Library/Fonts/Supplemental/Arial.ttf'))
BOLD = Path(os.environ.get('INFERPOOL_FONT_BOLD', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'))
FONTS = {False: TTFont(REGULAR), True: TTFont(BOLD)}
LIME = '#b6f86a'
WHITE = '#edf4ef'
MUTED = '#91a69b'
BG = '#0b1115'

# Original geometric IP monogram. The counters are transparent; no font is used.
MARK = '''<g fill="#b6f86a"><rect x="80" y="116" width="56" height="284" rx="8"/>
<path fill-rule="evenodd" d="M192 116H312C387 116 432 156 432 218C432 279 387 320 312 320H256V400H192V116ZM256 180V256H310C347 256 368 243 368 218C368 193 347 180 310 180H256Z"/></g>'''

def text(x, y, value, size, fill=WHITE, bold=False, tracking=0):
    font = FONTS[bold]
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font['head'].unitsPerEm
    kern = {}
    if 'kern' in font:
        for sub in font['kern'].kernTables:
            kern.update(getattr(sub, 'kernTable', {}))
    paths = []
    cursor = x
    previous = None
    for char in value:
        name = cmap.get(ord(char))
        if name is None:
            raise ValueError(f'Missing glyph {char!r} in font')
        if previous:
            cursor += kern.get((previous, name), 0) * scale
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        if pen.getCommands():
            paths.append(f'<path d="{pen.getCommands()}" transform="translate({cursor:.3f} {y:.3f}) scale({scale:.7f} {-scale:.7f})"/>')
        cursor += font['hmtx'][name][0] * scale + tracking
        previous = name
    return f'<g fill="{fill}" aria-label="{escape(value, quote=True)}"><title>{escape(value)}</title>{"".join(paths)}</g>'


def rect(x, y, w, h, fill, stroke='none', radius=0, sw=1):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'


def line(x1, y1, x2, y2, color, width=2, dash=None):
    extra = f' stroke-dasharray="{dash}"' if dash else ''
    return f'<path d="M{x1} {y1}H{x2}" stroke="{color}" stroke-width="{width}" fill="none"{extra}/>' if y1 == y2 else f'<path d="M{x1} {y1}L{x2} {y2}" stroke="{color}" stroke-width="{width}" fill="none"{extra}/>'


def arrow(x1, x2, y, color=LIME, width=2):
    sign = 1 if x2 > x1 else -1
    return line(x1, y, x2, y, color, width) + f'<path d="M{x2-9*sign} {y-6}L{x2} {y}L{x2-9*sign} {y+6}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>'


logo = f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-labelledby="title description"><title id="title">InferPool IP monogram</title><desc id="description">Original geometric IP mark in InferPool green on a transparent background.</desc>{MARK}</svg>'''
(OUT/'inferpool-logo.svg').write_text(logo)

p = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-labelledby="title description">', '<title id="title">InferPool project overview</title>', '<desc id="description">AI inference marketplace on Monad Testnet. Buyer requests go through a Router to independent sellers. Testnet contracts manage budgets and settlement. Mock inference, real testnet settlement. Original explanatory diagram, not a product screenshot.</desc>', rect(0, 0, 1600, 900, BG)]
# Restrained original geometry, not application chrome or a screenshot.
for x in [80, 380, 620, 980, 1160, 1520]:
    p.append(line(x, 318, x, 785, '#172126', 1))
p.append(line(80, 294, 1520, 294, '#26352e', 1))
p.append(f'<g transform="translate(58 49) scale(.23)">{MARK}</g>')
p.append(text(202, 155, 'InferPool', 83, WHITE, True))
p.append(text(84, 236, 'AI inference marketplace on Monad Testnet', 33, '#c7d8ce'))
p.append(text(1116, 85, 'HACKATHON / PROJECT OVERVIEW', 14, MUTED, False, 1.1))
p.append(rect(1351, 121, 169, 35, '#18291b', '#3f5a32', 17))
p.append(text(1373, 144, 'MONAD TESTNET', 12, LIME, True, .8))

# Main request path.
for x, w in [(80, 300), (620, 360), (1160, 360)]:
    p.append(rect(x, 354, w, 216, '#111c21', '#314238', 16))
    p.append(rect(x+28, 383, 8, 8, LIME, radius=2))
p.append(text(108, 437, 'Buyer', 34, WHITE, True))
p.append(text(108, 481, 'Set a request budget', 21, '#bdcec3'))
p.append(text(108, 518, 'Web + API', 18, MUTED))
p.append(text(648, 437, 'Router', 34, WHITE, True))
p.append(text(648, 481, 'Match quotes and route', 21, '#bdcec3'))
p.append(text(648, 518, 'Meter simulated usage', 18, MUTED))
p.append(text(1188, 437, 'Independent sellers', 27, WHITE, True))
p.append(text(1188, 481, 'Run their own nodes', 21, '#bdcec3'))
p.append(text(1188, 518, 'Stream mock responses', 18, MUTED))
p.append(text(429, 401, 'REQUEST', 12, MUTED, True, 1.5))
p.append(arrow(406, 594, 430))
p.append(arrow(594, 406, 513, '#6f9580', 1.5))
p.append(text(454, 541, 'stream', 13, MUTED))
p.append(text(1020, 401, 'DISPATCH', 12, MUTED, True, 1.2))
p.append(arrow(1006, 1134, 430))
p.append(arrow(1134, 1006, 513, '#6f9580', 1.5))
p.append(text(1041, 541, 'stream', 13, MUTED))

# Financial rail is visibly separate from the inference path.
p.append(line(800, 570, 800, 652, '#74935d', 2, '5 6'))
p.append(text(823, 619, 'lock / settle', 14, MUTED))
p.append(rect(240, 652, 1120, 135, '#152218', '#45613a', 14))
p.append('<path d="M281 691L307 681L333 691V711C333 731 320 743 307 749C294 743 281 731 281 711Z" fill="none" stroke="#b6f86a" stroke-width="2.5"/>')
p.append('<path d="M296 713L304 721L320 703" fill="none" stroke="#b6f86a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>')
p.append(text(365, 691, 'ON-CHAIN BUDGET & SETTLEMENT', 14, LIME, True, 1.25))
p.append(text(365, 731, 'Budget escrow  /  Lock  /  Settle or release', 30, WHITE, True))
p.append(text(365, 762, 'Testnet contracts record the financial outcome.', 18, '#a4bca3'))
p.append(line(80, 818, 1520, 818, '#26352e', 1))
p.append(text(80, 858, 'Mock inference · Real testnet settlement', 23, LIME))
p.append(text(1082, 856, 'Project overview · Not a product screenshot', 16, MUTED))
p.append('</svg>')
(OUT/'inferpool-project-overview.svg').write_text(''.join(p))
print('Wrote original SVG logo and project overview.')
