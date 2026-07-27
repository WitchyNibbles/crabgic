"""Minimal RGBA PNG read/write plus an alpha-correct box-filter resize.

No imaging library is installed in this environment, so this covers exactly the
operations the icon export needs and nothing more.
"""

import struct
import zlib


def read_rgba(path):
    """Decode an 8-bit RGBA (colour type 6) PNG into (width, height, bytearray)."""
    data = open(path, 'rb').read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG: %s' % path)

    idat = bytearray()
    pos = 8
    width = height = None
    while pos < len(data):
        length, ctype = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if ctype == b'IHDR':
            width, height, depth, colour, comp, filt, interlace = struct.unpack('>IIBBBBB', body)
            if (depth, colour, interlace) != (8, 6, 0):
                raise ValueError('expected 8-bit RGBA non-interlaced, got depth=%d colour=%d interlace=%d'
                                 % (depth, colour, interlace))
        elif ctype == b'IDAT':
            idat += body
        elif ctype == b'IEND':
            break
        pos += 12 + length

    raw = zlib.decompress(bytes(idat))
    stride = width * 4
    out = bytearray(height * stride)
    prev = bytearray(stride)
    src = 0
    for y in range(height):
        ftype = raw[src]
        src += 1
        line = bytearray(raw[src:src + stride])
        src += stride
        if ftype == 1:      # Sub
            for i in range(4, stride):
                line[i] = (line[i] + line[i - 4]) & 0xFF
        elif ftype == 2:    # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:    # Average
            for i in range(stride):
                left = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:    # Paeth
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                b = prev[i]
                c = prev[i - 4] if i >= 4 else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        elif ftype != 0:
            raise ValueError('unknown PNG filter %d' % ftype)
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, out


def _filter_row(line, prev, stride, ftype):
    enc = bytearray(stride)
    for i in range(stride):
        a = line[i - 4] if i >= 4 else 0
        b = prev[i]
        c = prev[i - 4] if i >= 4 else 0
        if ftype == 0:
            pred = 0
        elif ftype == 1:
            pred = a
        elif ftype == 2:
            pred = b
        elif ftype == 3:
            pred = (a + b) >> 1
        else:
            pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
            pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
        enc[i] = (line[i] - pred) & 0xFF
    return enc


def write_rgba(path, width, height, pixels):
    """Encode 8-bit RGBA into a PNG. Each row is filtered five ways and the one
    with the smallest absolute deviation is kept — the standard heuristic, and
    worth roughly 3x on flat illustration artwork over always using Paeth."""
    stride = width * 4
    raw = bytearray()
    prev = bytearray(stride)
    for y in range(height):
        line = pixels[y * stride:(y + 1) * stride]
        best, best_score, best_type = None, None, 0
        for ftype in range(5):
            enc = _filter_row(line, prev, stride, ftype)
            score = sum(b if b < 128 else 256 - b for b in enc)
            if best_score is None or score < best_score:
                best, best_score, best_type = enc, score, ftype
        raw += bytes([best_type]) + best
        prev = line

    def chunk(tag, body):
        return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body) & 0xFFFFFFFF)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)


def resize(width, height, pixels, out_w, out_h):
    """Box-filter downscale. Colour is averaged premultiplied by alpha, so
    transparent pixels cannot bleed their colour into the visible edge."""
    out = bytearray(out_w * out_h * 4)
    x_edges = [x * width // out_w for x in range(out_w + 1)]
    y_edges = [y * height // out_h for y in range(out_h + 1)]
    for oy in range(out_h):
        y_start, y_end = y_edges[oy], max(y_edges[oy + 1], y_edges[oy] + 1)
        for ox in range(out_w):
            x_start, x_end = x_edges[ox], max(x_edges[ox + 1], x_edges[ox] + 1)
            r = g = b = a = 0
            count = 0
            for sy in range(y_start, y_end):
                row = sy * width * 4
                for sx in range(x_start, x_end):
                    i = row + sx * 4
                    pa = pixels[i + 3]
                    r += pixels[i] * pa
                    g += pixels[i + 1] * pa
                    b += pixels[i + 2] * pa
                    a += pa
                    count += 1
            o = (oy * out_w + ox) * 4
            if a:
                out[o] = min(255, r // a)
                out[o + 1] = min(255, g // a)
                out[o + 2] = min(255, b // a)
                out[o + 3] = a // count
            else:
                out[o + 3] = 0
    return out
