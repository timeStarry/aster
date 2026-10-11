#!/usr/bin/env python3
"""Construct Aster's editable SVG identity with Inkscape boolean geometry.

No traced image, font glyph, raster image, filter, or external asset is used.
geometry.json is the geometric source of truth; all delivery SVGs derive from it.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SVG = "http://www.w3.org/2000/svg"
INK = "http://www.inkscape.org/namespaces/inkscape"
ET.register_namespace("", SVG)
ET.register_namespace("inkscape", INK)


def el(name: str, **attrs: object) -> ET.Element:
    return ET.Element(f"{{{SVG}}}{name}", {k.replace("_", "-"): str(v) for k, v in attrs.items()})


def number(x: float) -> str:
    return f"{x:.8f}".rstrip("0").rstrip(".")


def document(title: str, description: str) -> ET.Element:
    root = el("svg", width=1024, height=1024, viewBox="0 0 1024 1024", version="1.1")
    ET.SubElement(root, f"{{{SVG}}}title").text = title
    ET.SubElement(root, f"{{{SVG}}}desc").text = description
    return root


def layer(name: str, ident: str) -> ET.Element:
    group = el("g", id=ident)
    group.set(f"{{{INK}}}groupmode", "layer")
    group.set(f"{{{INK}}}label", name)
    return group


def save(root: ET.Element, path: Path) -> None:
    ET.indent(root, space="  ")
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def geometry(spec: dict) -> dict:
    radius, width, corner = (spec[k] for k in ("arm_radius", "stroke_width", "corner_radius"))
    outer = spec.get("outer_width", width)
    taper = (outer - width) / (2 * radius)
    if not (0 < width <= outer < radius and 0 <= corner < width / 2 and taper * math.sqrt(3) < 1):
        raise ValueError("Invalid tapered-arm dimensions")
    valley_radius = width / (1 - taper * math.sqrt(3))
    dot = spec["period_radius"]
    # Exact polygon union area before the twelve convex endpoint roundings.
    vertices = []
    for i in range(6):
        theta = math.radians(-90 + i * 60)
        ux, uy = math.cos(theta), math.sin(theta)
        vx, vy = -uy, ux
        vertices.extend([
            (radius * ux - outer / 2 * vx, radius * uy - outer / 2 * vy),
            (radius * ux + outer / 2 * vx, radius * uy + outer / 2 * vy),
            (valley_radius * math.cos(theta + math.pi / 6), valley_radius * math.sin(theta + math.pi / 6)),
        ])
    polygon_area = abs(sum(x * y2 - x2 * y for (x, y), (x2, y2) in zip(vertices, vertices[1:] + vertices[:1]))) / 2
    convex_turn = math.pi / 2 + math.atan(taper)
    star_area = polygon_area - 12 * corner * corner * (math.tan(convex_turn / 2) - convex_turn / 2)
    dot_area = math.pi * dot * dot
    # Dot shares the main vertical arm's lower baseline. A nominal horizontal
    # clearance is measured from the unrounded star bounding extent.
    dx = radius * math.cos(math.pi / 6) + outer / 4 + spec["horizontal_clearance"] + dot
    dy = radius - dot
    dot_weight = dot_area / (star_area + dot_area)
    cx, cy = 512 - dot_weight * dx, 512 - dot_weight * dy
    return dict(spec, outer_width=outer, valley_radius=valley_radius,
                outer_expansion_percent=(outer / width - 1) * 100,
                cx=cx, cy=cy, dot_cx=cx + dx, dot_cy=cy + dy,
                star_area=star_area, period_area=dot_area,
                filled_area_centroid=[512, 512], baseline=cy + radius)


def rounded_tip_path(g: dict) -> str:
    """One trapezoid arm; the two outer corners are exact radius-r arcs."""
    cx, cy, radius = g["cx"], g["cy"], g["arm_radius"]
    points = [(cx - g["stroke_width"] / 2, cy), (cx - g["outer_width"] / 2, cy - radius),
              (cx + g["outer_width"] / 2, cy - radius), (cx + g["stroke_width"] / 2, cy)]
    commands = [f"M {number(points[0][0])} {number(points[0][1])}"]
    for i in (1, 2):
        previous, point, following = points[i - 1], points[i], points[i + 1]
        incoming = (point[0] - previous[0], point[1] - previous[1])
        outgoing = (following[0] - point[0], following[1] - point[1])
        li, lo = math.hypot(*incoming), math.hypot(*outgoing)
        ui, uo = (incoming[0] / li, incoming[1] / li), (outgoing[0] / lo, outgoing[1] / lo)
        turn = math.acos(max(-1, min(1, ui[0] * uo[0] + ui[1] * uo[1])))
        tangent = g["corner_radius"] * math.tan(turn / 2)
        start = (point[0] - ui[0] * tangent, point[1] - ui[1] * tangent)
        end = (point[0] + uo[0] * tangent, point[1] + uo[1] * tangent)
        commands.append(f"L {number(start[0])} {number(start[1])}")
        commands.append(f"A {g['corner_radius']} {g['corner_radius']} 0 0 1 {number(end[0])} {number(end[1])}")
    commands.append(f"L {number(points[3][0])} {number(points[3][1])} Z")
    return " ".join(commands)


def construction(g: dict, color: str, rotations: list[int]) -> ET.Element:
    root = document("Aster asterisk construction", "Six linearly tapered arms, sixty-degree rotational spacing.")
    group = layer("Construction — six tapered arms", "construction")
    root.append(group)
    for i, angle in enumerate(rotations):
        arm = el("path", id=f"arm-{i}", d=rounded_tip_path(g), fill=color,
                 transform=f"rotate({angle} {number(g['cx'])} {number(g['cy'])})")
        arm.set(f"{{{INK}}}label", f"Tapered arm {i + 1} — {angle}°")
        group.append(arm)
    return root


def union_path(root: ET.Element, executable: str, tmp: Path, name: str) -> ET.Element:
    original, united = tmp / f"{name}-bars.svg", tmp / f"{name}-union.svg"
    save(root, original)
    selected = ",".join(node.get("id") for node in root.findall(f".//{{{SVG}}}path"))
    actions = (f"select-by-id:{selected};object-to-path;path-union;"
               f"export-plain-svg;export-type:svg;export-filename:{united};export-do")
    subprocess.run([executable, str(original), "--batch-process", f"--actions={actions}"], check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    paths = ET.parse(united).getroot().findall(f".//{{{SVG}}}path")
    if len(paths) != 1:
        raise RuntimeError(f"Inkscape union produced {len(paths)} paths; expected one asterisk.")
    path = el("path", id="asterisk", d=paths[0].get("d", ""))
    if paths[0].get("transform"):
        path.set("transform", paths[0].get("transform"))
    path.set(f"{{{INK}}}label", "Asterisk — six-arm boolean union")
    return path


def mark(path: ET.Element, g: dict, color: str, scale: float = 1) -> ET.Element:
    group = layer("Mark — asterisk and period", "mark")
    group.set("fill", color)
    if scale != 1:
        group.set("transform", f"translate(512 512) scale({scale}) translate(-512 -512)")
    group.append(copy.deepcopy(path))
    circle = el("circle", id="period", cx=number(g["dot_cx"]), cy=number(g["dot_cy"]), r=g["period_radius"])
    circle.set(f"{{{INK}}}label", "Period — shared lower baseline")
    group.append(circle)
    return group


def guides(g: dict, scale: float) -> ET.Element:
    group = layer("Construction guides — enable to inspect", "guides")
    group.set("style", "display:none")
    group.set("fill", "none")
    group.set("stroke", "#EA4A60")
    group.set("stroke-width", "1")
    group.append(el("line", x1=512, y1=100, x2=512, y2=924))
    group.append(el("line", x1=100, y1=512, x2=924, y2=512))
    group.append(el("rect", x=104, y=104, width=816, height=816, rx=182))
    symbol = el("g", id="symbol-guides",
                transform=f"translate(512 512) scale({scale}) translate(-512 -512)")
    for x in [g["cx"], g["dot_cx"]]:
        symbol.append(el("line", x1=number(x), y1=100, x2=number(x), y2=924))
    for y in [g["cy"], g["baseline"]]:
        symbol.append(el("line", x1=100, y1=number(y), x2=924, y2=number(y)))
    symbol.append(el("circle", cx=number(g["cx"]), cy=number(g["cy"]), r=g["arm_radius"]))
    group.append(symbol)
    return group


def write_family(out: Path, variant: str, g: dict, united: ET.Element, cfg: dict) -> None:
    suffix = "-small" if variant == "small" else ""
    palette, layout = cfg["colors"], cfg["layout"]
    for kind in ("mark", "app-tile", "app-square", "app-windows", "app-macos"):
        root = document(f"Aster — {kind}{suffix}",
                        "Geometric six-arm asterisk and period. No raster images or font dependencies.")
        scale = 1
        if kind != "mark":
            bg = layer("Background — paper", "background")
            if kind == "app-macos":
                inset = layout["macos_tile_inset"]
                bg.append(el("rect", id="tile", x=inset, y=inset, width=1024 - inset * 2,
                             height=1024 - inset * 2, rx=layout["macos_tile_corner_radius"], fill=palette["paper"]))
                scale = layout["macos_symbol_scale"]
            else:
                corner = {"app-tile": layout["web_tile_corner_radius"],
                          "app-windows": layout["windows_tile_corner_radius"]}.get(kind, 0)
                bg.append(el("rect", id="tile", x=0, y=0, width=1024, height=1024,
                             rx=corner, fill=palette["paper"]))
                scale = layout["tile_symbol_scale"]
            root.append(bg)
        root.append(mark(united, g, palette["indigo"], scale))
        save(root, out / f"{kind}{suffix}.svg")
    for name, color in [("mark-ink", palette["ink"]), ("mark-inverse", palette["paper"]), ("mark-current", "currentColor")]:
        root = document(f"Aster — {name}{suffix}", "Transparent monochrome mark.")
        root.append(mark(united, g, color))
        save(root, out / f"{name}{suffix}.svg")


def write_windows_sources(out: Path, cfg: dict) -> None:
    """Reuse the exact union geometry; changing tile corners needs no new union."""
    for suffix in ("", "-small"):
        root = ET.parse(out / f"app-square{suffix}.svg").getroot()
        title = root.find(f"{{{SVG}}}title")
        tile = root.find(f".//{{{SVG}}}rect[@id='tile']")
        if title is None or tile is None:
            raise ValueError("The existing square master must contain its title and background tile.")
        title.text = f"Aster — app-windows{suffix}"
        tile.set("rx", str(cfg["layout"]["windows_tile_corner_radius"]))
        save(root, out / f"app-windows{suffix}.svg")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inkscape", default=shutil.which("inkscape"))
    parser.add_argument("--geometry-json", type=Path, default=ROOT / "assets/brand/geometry.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "assets/brand/source")
    parser.add_argument("--windows-only", action="store_true",
                        help="Derive rounded Windows masters from the existing square masters without regenerating other sources.")
    args = parser.parse_args()
    cfg = json.loads(args.geometry_json.read_text(encoding="utf-8"))
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if args.windows_only:
        write_windows_sources(out, cfg)
        print(f"Built editable Windows vector sources: {out}")
        return
    if not args.inkscape:
        parser.error("Inkscape is required; supply --inkscape /path/to/inkscape.")
    computed = {}
    with tempfile.TemporaryDirectory(prefix="aster-vector-") as folder:
        for variant in ("standard", "small"):
            g = geometry(cfg[variant])
            computed[variant] = g
            raw = construction(g, cfg["colors"]["indigo"], cfg["arm_rotations_degrees"])
            save(raw, out / f"construction-{variant}.svg")
            united = union_path(raw, args.inkscape, Path(folder), variant)
            write_family(out, variant, g, united, cfg)
            if variant == "standard":
                master = ET.parse(out / "app-macos.svg").getroot()
                master.append(guides(g, cfg["layout"]["macos_symbol_scale"]))
                save(master, out / "aster-master.svg")
                # Separate, unmasked vector layers for a future Icon Composer
                # document. These do not pretend to be a compiled .icon file.
                for ident in ("asterisk", "period"):
                    root = document(f"Aster Icon Composer layer — {ident}", "1024-square unmasked foreground layer.")
                    group = mark(united, g, cfg["colors"]["indigo"], cfg["layout"]["tile_symbol_scale"])
                    for child in list(group):
                        if child.get("id") != ident:
                            group.remove(child)
                    root.append(group)
                    save(root, out / f"composer-{ident}.svg")
                root = document("Aster Icon Composer background", "Unmasked solid square background; configure appearances in Icon Composer.")
                root.append(el("rect", x=0, y=0, width=1024, height=1024, fill=cfg["colors"]["paper"]))
                save(root, out / "composer-background.svg")
    (out / "computed-geometry.json").write_text(json.dumps(computed, indent=2) + "\n")
    print(f"Built editable vector sources with Inkscape: {out}")


if __name__ == "__main__":
    main()
