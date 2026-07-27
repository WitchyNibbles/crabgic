"""Turn the owner's mascot PNG into the published icon set.

The source artwork sits on an opaque grey studio background with a soft glow.
Publishing surfaces (npm, GitHub avatars, favicons) need transparency, so the
grey is matted out, the crab is separated from the wordmark below it, and the
result is resampled into each size the package needs.
"""

import os
import sys

from png import read_rgba, write_rgba, resize

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'crabgic-mascot-1024.png')
# Dark-ground files land at the top of assets/brand/, the cutouts in transparent/.
OUT = os.path.dirname(HERE)

# The artwork was drawn to sit on a dark ground, so the dark-ground variant keeps
# the glow exactly as authored. Brand ink, from the mascot's own outlines.
DARK_GROUND = (27, 27, 69)
# The crab/wordmark split must fall inside this band.
SPLIT_BAND = (500, 620)
# The glow around the artwork mattes out fully opaque, so alpha alone cannot tell
# artwork from halo. Both the crab and the wordmark are drawn with a dark outline
# that the glow never has, so ink is what gets measured instead.
INK_LUMA = 90
INK_ALPHA = 200


def is_ink(px, i):
    return (px[i + 3] > INK_ALPHA
            and 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < INK_LUMA)


def background_colour(w, h, px, patch=28):
    """Average the four corners — all four are pure background."""
    total = [0, 0, 0]
    n = 0
    for ox, oy in ((0, 0), (w - patch, 0), (0, h - patch), (w - patch, h - patch)):
        for y in range(oy, oy + patch):
            row = y * w * 4
            for x in range(ox, ox + patch):
                i = row + x * 4
                total[0] += px[i]
                total[1] += px[i + 1]
                total[2] += px[i + 2]
                n += 1
    return [c / n for c in total]


# The artwork's dark outline sits about as far from the grey background as the
# glow does, so one threshold cannot separate them. What does separate them:
# the glow is always lighter than the background and close to neutral, while the
# artwork is either darker (outlines) or strongly coloured.
HAZE_SATURATION = 0.45
HAZE_LO, HAZE_HI = 45, 100
ART_LO, ART_HI = 8, 26


def matte(w, h, px, bg):
    """Replace the background with alpha, and un-mix the background colour out of
    the partially transparent edge pixels so no grey fringe survives onto a light page."""
    br, bgc, bb = bg
    bg_luma = 0.299 * br + 0.587 * bgc + 0.114 * bb
    for i in range(0, len(px), 4):
        r, g, b = px[i], px[i + 1], px[i + 2]
        d = max(abs(r - br), abs(g - bgc), abs(b - bb))
        mx = max(r, g, b)
        sat = (mx - min(r, g, b)) / mx if mx else 0.0
        if 0.299 * r + 0.587 * g + 0.114 * b > bg_luma and sat < HAZE_SATURATION:
            lo, hi = HAZE_LO, HAZE_HI     # glow and vignette
        else:
            lo, hi = ART_LO, ART_HI       # outlines and saturated artwork
        a = (d - lo) / float(hi - lo)
        if a <= 0:
            px[i + 3] = 0
            continue
        if a >= 1:
            px[i + 3] = 255
            continue
        inv = 1.0 - a
        px[i] = min(255, max(0, int((r - inv * br) / a)))
        px[i + 1] = min(255, max(0, int((g - inv * bgc) / a)))
        px[i + 2] = min(255, max(0, int((b - inv * bb) / a)))
        px[i + 3] = int(a * 255)


def split_row(w, h, px):
    """The row carrying the least ink between the crab above and the wordmark below."""
    best_y, best = SPLIT_BAND[0], None
    for y in range(*SPLIT_BAND):
        row = y * w * 4
        count = 0
        for x in range(w):
            if is_ink(px, row + x * 4):
                count += 1
        if best is None or count < best:
            best, best_y = count, y
    return best_y


def bbox(w, h, px, y_max):
    x0, y0, x1, y1 = w, y_max, 0, 0
    for y in range(y_max):
        row = y * w * 4
        for x in range(w):
            if is_ink(px, row + x * 4):
                if x < x0:
                    x0 = x
                if x > x1:
                    x1 = x
                if y < y0:
                    y0 = y
                if y > y1:
                    y1 = y
    return x0, y0, x1, y1


def crop(w, h, px, x0, y0, cw, ch):
    out = bytearray(cw * ch * 4)
    for y in range(ch):
        sy = y0 + y
        if sy < 0 or sy >= h:
            continue
        src = (sy * w + x0) * 4
        dst = y * cw * 4
        if x0 >= 0 and x0 + cw <= w:
            out[dst:dst + cw * 4] = px[src:src + cw * 4]
    return out


def fit_square(cw, ch, cpx, size):
    """Contain the artwork inside a transparent square: the crab is much wider
    than it is tall, so cropping to square would drag the wordmark back in."""
    scale = min(size / cw, size / ch)
    dw, dh = max(1, int(cw * scale)), max(1, int(ch * scale))
    small = resize(cw, ch, cpx, dw, dh)
    canvas = bytearray(size * size * 4)
    ox, oy = (size - dw) // 2, (size - dh) // 2
    for y in range(dh):
        src = y * dw * 4
        dst = ((oy + y) * size + ox) * 4
        canvas[dst:dst + dw * 4] = small[src:src + dw * 4]
    return canvas


def compose_over(size_w, size_h, px, ground):
    """Flatten onto a solid colour — the glow reads as designed on a dark ground."""
    gr, gg, gb = ground
    out = bytearray(size_w * size_h * 4)
    for i in range(0, len(px), 4):
        a = px[i + 3] / 255.0
        inv = 1.0 - a
        out[i] = int(px[i] * a + gr * inv)
        out[i + 1] = int(px[i + 1] * a + gg * inv)
        out[i + 2] = int(px[i + 2] * a + gb * inv)
        out[i + 3] = 255
    return out


def main():
    w, h, px = read_rgba(SRC)
    bg = background_colour(w, h, px)
    print('background colour: rgb(%.0f, %.0f, %.0f)' % tuple(bg))

    matte(w, h, px, bg)
    split = split_row(w, h, px)
    print('crab/wordmark split at row %d' % split)

    os.makedirs(OUT, exist_ok=True)

    # ---- icon: the crab alone, squared off
    x0, y0, x1, y1 = bbox(w, h, px, split)
    cw, ch = x1 - x0 + 1, y1 - y0 + 1
    pad = int(max(cw, ch) * 0.03)
    ix, iy = x0 - pad, y0 - pad
    iw, ih = cw + pad * 2, min(ch + pad * 2, split - iy)
    print('crab bounds: %dx%d at (%d, %d), padded to %dx%d' % (cw, ch, x0, y0, iw, ih))
    icon_px = crop(w, h, px, ix, iy, iw, ih)

    os.makedirs(os.path.join(OUT, 'transparent'), exist_ok=True)

    for size in (512, 256, 180, 128, 64, 48, 32, 16):
        square = fit_square(iw, ih, icon_px, size)
        write_rgba(os.path.join(OUT, 'transparent', 'crabgic-icon-%d.png' % size),
                   size, size, square)
        write_rgba(os.path.join(OUT, 'crabgic-icon-%d.png' % size),
                   size, size, compose_over(size, size, square, DARK_GROUND))
        print('  wrote crabgic-icon-%d.png (both variants)' % size)

    # ---- lockup: crab plus wordmark, natural proportions
    lx0, ly0, lx1, ly1 = bbox(w, h, px, h)
    lpad = int(max(lx1 - lx0, ly1 - ly0) * 0.03)
    lx, ly = lx0 - lpad, ly0 - lpad
    lw = min(lx1 - lx0 + 1 + lpad * 2, w - lx)
    lh = min(ly1 - ly0 + 1 + lpad * 2, h - ly)
    lock_px = crop(w, h, px, lx, ly, lw, lh)
    half_w, half_h = 512, max(1, int(512 * lh / lw))
    half_px = resize(lw, lh, lock_px, half_w, half_h)

    for folder, pixels, size in (('transparent', lock_px, (lw, lh)),
                                 ('transparent', half_px, (half_w, half_h))):
        name = 'crabgic-logo.png' if size == (lw, lh) else 'crabgic-logo-512.png'
        write_rgba(os.path.join(OUT, folder, name), size[0], size[1], pixels)

    write_rgba(os.path.join(OUT, 'crabgic-logo.png'), lw, lh,
               compose_over(lw, lh, lock_px, DARK_GROUND))
    write_rgba(os.path.join(OUT, 'crabgic-logo-512.png'), half_w, half_h,
               compose_over(half_w, half_h, half_px, DARK_GROUND))
    print('  wrote crabgic-logo.png (%dx%d) and -512 (%dx%d), both variants'
          % (lw, lh, half_w, half_h))


if __name__ == '__main__':
    sys.exit(main())
