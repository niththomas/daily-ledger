"""Generate the Daily Ledger icon set: the quantum-ladder motif, four teal
rungs under one warm-gold overflow rung, with the target line above it."""
from PIL import Image, ImageDraw

BG   = (244, 245, 241)
TEAL = (22, 112, 110)
WARM = (176, 125, 24)

SS = 4  # supersample factor


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def render(size, motif_h_frac, motif_w_frac, out, target_line=True):
    S = size * SS
    img = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(img)

    H = S * motif_h_frac
    W = S * motif_w_frac
    x0 = (S - W) / 2
    y0 = (S - H) / 2

    n, gap_ratio = 5, 0.36
    rung_h = H / (n + (n - 1) * gap_ratio)
    gap = rung_h * gap_ratio
    radius = rung_h * 0.24

    for i in range(n):                       # i = 0 is the top rung
        top = y0 + i * (rung_h + gap)
        color = WARM if i == 0 else TEAL
        rounded(d, [x0, top, x0 + W, top + rung_h], radius, color)

    if target_line:
        # The target line: sits just above the overflow rung, overhanging it.
        lh = max(rung_h * 0.17, SS * 1.5)
        ly = y0 - gap * 0.62 - lh / 2
        over = W * 0.17
        rounded(d, [x0 - over, ly, x0 + W + over, ly + lh], lh / 2, WARM)

    img.resize((size, size), Image.LANCZOS).save(out, "PNG", optimize=True)
    print("wrote", out)


render(192, 0.66, 0.38, "icons/icon-192.png")
render(512, 0.66, 0.38, "icons/icon-512.png")
render(180, 0.66, 0.38, "icons/apple-touch-icon-180.png")
# Maskable: motif kept inside the centre safe circle so no crop clips it.
render(512, 0.50, 0.29, "icons/icon-512-maskable.png")
