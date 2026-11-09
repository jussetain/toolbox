"""Génère l'écran de démarrage (splash.png) et l'icône source (icon.png) dans la DA Atelier."""
from PIL import Image, ImageDraw, ImageFont

D = "/home/ubuntu/toolbox/design/"
PAPER, INK, INK2, ACCENT = (243, 237, 225, 255), (31, 27, 22, 255), (94, 85, 71, 255), (226, 87, 43, 255)
CATS = [(226, 87, 43), (58, 154, 91), (110, 155, 234), (229, 87, 79), (233, 194, 74), (217, 203, 176), (79, 179, 169), (169, 139, 230)]
heavy = lambda s: ImageFont.truetype(D + "bricolage-heavy.ttf", s)
semi = lambda s: ImageFont.truetype(D + "bricolage-semi.ttf", s)


def mark(d, x, y, s, line):
    """Pastille Toolbox : carré orange, trait encre, ombre décalée dure, poignée de boîte à outils."""
    sh = s * 0.09
    d.rounded_rectangle([x + sh, y + sh, x + s + sh, y + s + sh], radius=s * 0.2, fill=INK)
    d.rounded_rectangle([x, y, x + s, y + s], radius=s * 0.2, fill=ACCENT, outline=INK, width=line)
    # Poignée
    hw, hh = s * 0.44, s * 0.2
    hx, hy = x + (s - hw) / 2, y + s * 0.2
    d.rounded_rectangle([hx, hy, hx + hw, hy + hh * 1.6], radius=hh * 0.5, outline=INK, width=line)
    # Corps de la boîte
    bx, by, bw, bh = x + s * 0.16, y + s * 0.4, s * 0.68, s * 0.42
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=s * 0.06, fill=PAPER, outline=INK, width=line)
    d.line([bx, by + bh * 0.38, bx + bw, by + bh * 0.38], fill=INK, width=line)
    d.rounded_rectangle([x + s * 0.44, by + bh * 0.24, x + s * 0.56, by + bh * 0.54], radius=s * 0.02, fill=INK)


def splash(scale=2):
    W, H = 560 * scale, 340 * scale
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad, sh, line = 8 * scale, 10 * scale, 3 * scale
    # Carte avec ombre orange décalée
    d.rounded_rectangle([pad + sh, pad + sh, W - pad, H - pad], radius=22 * scale, fill=ACCENT)
    d.rounded_rectangle([pad, pad, W - pad - sh, H - pad - sh], radius=22 * scale, fill=PAPER, outline=INK, width=line)
    cx = pad + 44 * scale
    mark(d, cx, 58 * scale, 92 * scale, line)
    d.text((cx + 118 * scale, 54 * scale), "Toolbox", font=heavy(76 * scale), fill=INK)
    d.text((cx + 122 * scale, 136 * scale), "96 outils. Tout reste sur ton PC.", font=semi(19 * scale), fill=INK2)
    # Pastilles des 8 catégories
    y = 196 * scale
    for i, c in enumerate(CATS):
        x = cx + i * 30 * scale
        d.rounded_rectangle([x, y, x + 20 * scale, y + 20 * scale], radius=5 * scale, fill=c + (255,), outline=INK, width=2 * scale)
    img.save(D + "splash.png")


def icon(S=1024):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    mark(d, S * 0.06, S * 0.06, S * 0.8, int(S * 0.035))
    img.save(D + "icon.png")


splash()
icon()
print("ok")
