"""OmniBuild uygulama ikonunu (512x512 PNG) üretir. Harici bağımlılık gerektirmez."""
import math, os, struct, zlib

N = 512

def lerp(a, b, t):
    return a + (b - a) * t

def gold(t):
    stops = [(0.0, (255, 241, 184)), (0.45, (245, 215, 122)), (1.0, (154, 116, 24))]
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        if t <= t1:
            k = (t - t0) / (t1 - t0)
            return tuple(int(lerp(c0[i], c1[i], k)) for i in range(3))
    return stops[-1][1]

def pixel(x, y):
    px, py = x + 0.5, y + 0.5
    dx = max(abs(px - 256) - 224, 0)
    dy = max(abs(py - 256) - 224, 0)
    dist = math.hypot(dx, dy)
    if dist > 112:
        return (0, 0, 0, 0)
    if dist > 108:
        return (212, 175, 55, 200)
    r = min(1.0, math.hypot(px - 256, py - 256) / 360)
    bg = tuple(int(lerp(c0, c1, r)) for c0, c1 in zip((34, 26, 12), (5, 4, 6)))
    d = abs(px - 256) + abs(py - 256)
    if d <= 200:
        c = gold((px + py) / (2 * N))
        if py < 256:
            c = tuple(min(255, int(v + 18)) for v in c)
        if d <= 104:
            c = bg
        if d <= 78:
            c = gold(0.25 + (px + py) / (4 * N))
        return (*c, 255)
    return (*bg, 255)

def write_png(path, w, h, rows):
    raw = b''.join(b'\x00' + bytes(row) for row in rows)
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(data)

if __name__ == '__main__':
    rows = []
    for y in range(N):
        row = bytearray()
        for x in range(N):
            row.extend(pixel(x, y))
        rows.append(row)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    write_png(os.path.join(root, 'assets', 'icon-512.png'), N, N, rows)
    write_png(os.path.join(root, 'build', 'icon.png'), N, N, rows)
    print('İkon üretildi.')
