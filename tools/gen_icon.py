#!/usr/bin/env python3
"""Generate Aster app icons using only Python stdlib (no Pillow/Cairo)."""
import math, zlib, struct, os

# ---------- low-level PNG writer ----------

def _chunk(tag: bytes, data: bytes) -> bytes:
    c = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", c)

def write_png(path: str, pixels: list[list[tuple[int,int,int,int]]], size: int):
    """pixels[y][x] = (r,g,b,a)"""
    raw = b""
    for row in pixels:
        raw += b"\x00"  # filter type None
        for r, g, b, a in row:
            raw += bytes([r, g, b, a])
    compressed = zlib.compress(raw, 9)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)))
        f.write(_chunk(b"IDAT", compressed))
        f.write(_chunk(b"IEND", b""))

# ---------- drawing primitives ----------

def lerp(a, b, t):
    return a + (b - a) * t

def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))

def sdf_rounded_rect(px, py, cx, cy, hw, hh, r):
    """Signed distance to rounded rect; negative = inside."""
    qx = abs(px - cx) - hw + r
    qy = abs(py - cy) - hh + r
    return math.sqrt(max(qx,0)**2 + max(qy,0)**2) - r

def sdf_circle(px, py, cx, cy, radius):
    return math.sqrt((px-cx)**2 + (py-cy)**2) - radius

def star5_sdf(px, py, cx, cy, r_outer, r_inner):
    """Approximate SDF for a 5-pointed star."""
    x, y = px - cx, py - cy
    angle = math.atan2(y, x) + math.pi / 2  # rotate so tip points up
    segment = math.pi * 2 / 5
    a = math.fmod(angle + segment / 2, segment) - segment / 2
    d = math.sqrt(x*x + y*y)
    # polar radius of star boundary at this angle
    t = abs(a) / (segment / 2)  # 0=point, 1=inner valley
    r_boundary = lerp(r_outer, r_inner, t)
    return d - r_boundary

def aa_coverage(sdf, aa=1.2):
    """Anti-aliased coverage from SDF value."""
    return clamp(0.5 - sdf / aa)

def blend(bg, fg_rgb, fg_a):
    """Alpha-composite fg over bg (all floats 0-1)."""
    a = fg_a
    return tuple(fg * a + bg[i] * (1 - a) for i, fg in enumerate(fg_rgb))

# ---------- render one icon size ----------

def render(size: int) -> list[list[tuple[int,int,int,int]]]:
    pixels = [[(0,0,0,0)] * size for _ in range(size)]
    cx = cy = size / 2

    # coordinate helpers (normalised to size)
    def s(v): return v * size  # scale factor

    # --- palette ---
    # background: dark navy-indigo gradient-ish solid
    bg_top    = (0.09, 0.09, 0.20)   # very dark navy
    bg_bot    = (0.14, 0.08, 0.28)   # deep violet
    star_col  = (1.00, 1.00, 1.00)   # white star
    glow_col  = (0.67, 0.78, 1.00)   # ice-blue glow
    ray_col   = (0.85, 0.90, 1.00)   # ray streak

    # shape params (as fraction of size)
    rect_hw   = 0.42
    rect_hh   = 0.42
    rect_r    = 0.18        # corner radius fraction
    star_ro   = 0.27        # outer radius fraction
    star_ri   = 0.11        # inner radius fraction
    glow_r    = 0.33        # glow halo radius

    for y in range(size):
        for x in range(size):
            px, py = x + 0.5, y + 0.5

            # --- background rounded rect ---
            bg_sdf = sdf_rounded_rect(px, py, cx, cy,
                                      rect_hw * size, rect_hh * size,
                                      rect_r * size)
            bg_cov = aa_coverage(bg_sdf)
            if bg_cov <= 0:
                continue

            # vertical gradient for background
            t_grad = clamp((py - (cy - rect_hh*size)) / (2 * rect_hh * size))
            bg_rgb = tuple(lerp(bg_top[i], bg_bot[i], t_grad) for i in range(3))

            # --- subtle glow halo behind star ---
            g_sdf = sdf_circle(px, py, cx, cy, glow_r * size)
            g_cov = clamp(1.0 - (g_sdf + glow_r*size*0.4) / (glow_r*size*0.9))
            g_cov *= 0.25  # soft, not overpowering
            bg_rgb = blend(bg_rgb, glow_col, g_cov)

            # --- 4 thin ray streaks (cross) ---
            dx, dy = px - cx, py - cy
            dist_from_center = math.sqrt(dx*dx + dy*dy)
            # horizontal + vertical rays
            ray_width = size * 0.018
            h_ray = clamp(1.0 - abs(dy) / ray_width) * clamp((dist_from_center - star_ri*size*0.8) / (star_ri*size))
            v_ray = clamp(1.0 - abs(dx) / ray_width) * clamp((dist_from_center - star_ri*size*0.8) / (star_ri*size))
            # fade out near edge of card
            ray_fade = clamp(1.0 - (dist_from_center - star_ro*size) / (glow_r*size*0.6))
            ray_a = max(h_ray, v_ray) * ray_fade * 0.55
            bg_rgb = blend(bg_rgb, ray_col, ray_a)

            # --- 5-pointed star ---
            st_sdf = star5_sdf(px, py, cx, cy, star_ro * size, star_ri * size)
            st_cov = aa_coverage(st_sdf, aa=1.5)

            # combine: star on top of background
            final_rgb = blend(bg_rgb, star_col, st_cov)

            # apply rounded-rect mask with anti-aliasing
            r8 = tuple(int(clamp(v) * 255 + 0.5) for v in final_rgb)
            a8 = int(bg_cov * 255 + 0.5)
            pixels[y][x] = (*r8, a8)

    return pixels

# ---------- export all required sizes ----------

SIZES = [16, 32, 64, 128, 256, 512, 1024]

out_dir = os.path.join(os.path.dirname(__file__), "icon_output")
os.makedirs(out_dir, exist_ok=True)

for sz in SIZES:
    print(f"Rendering {sz}x{sz}...", flush=True)
    pix = render(sz)
    write_png(os.path.join(out_dir, f"icon_{sz}.png"), pix, sz)

print("Done →", out_dir)
