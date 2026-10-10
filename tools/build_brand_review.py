#!/usr/bin/env python3
"""Build a standalone review board from Aster's vector masters and real PNG exports.

This board is documentation, not a production icon source. Embedded PNGs in the
last row are the exact exported small assets, displayed at their native sizes.
"""
from __future__ import annotations

import base64
import copy
import json
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets/brand"
SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)


def node(name: str, **attrs: object) -> ET.Element:
    return ET.Element(f"{{{SVG}}}{name}", {k.replace("_", "-"): str(v) for k, v in attrs.items()})


def main() -> None:
    root = node("svg", width=1200, height=1000, viewBox="0 0 1200 1000")
    root.append(node("rect", width=1200, height=1000, fill="#ECEEF2"))

    def rect(x: int, y: int, width: int, height: int, fill: str = "#FFFFFF") -> None:
        root.append(node("rect", x=x, y=y, width=width, height=height, rx=20, fill=fill))

    def text(x: float, y: float, value: str, size: int = 16, fill: str = "#747B89", weight: int = 400) -> None:
        item = node("text", x=x, y=y, font_family="Helvetica Neue, Arial, sans-serif",
                    font_size=size, font_weight=weight, fill=fill)
        item.text = value
        root.append(item)

    def vector(filename: str, x: float, y: float, size: float, color: str | None = None) -> None:
        document = ET.parse(BRAND / filename).getroot()
        group = node("g", transform=f"translate({x} {y}) scale({size / 1024})")
        for child in document:
            if child.tag.rsplit("}", 1)[-1] in ("title", "desc"):
                continue
            part = copy.deepcopy(child)
            for item in part.iter():
                item.attrib.pop("id", None)
                if color and item.get("fill"):
                    item.set("fill", color)
            group.append(part)
        root.append(group)

    text(44, 60, "Aster", 34, "#191C26", 600)
    text(164, 59, "ASTERISK + PERIOD", 13, "#747B89", 500)
    text(898, 59, "VECTOR IDENTITY / 1.0", 13)

    rect(40, 94, 440, 420, "#DEE2EA")
    vector("source/app-macos.svg", 66, 92, 390)
    text(68, 464, "MAC APP ICON", 13, "#525A6A", 500)
    text(68, 490, "Paper + indigo / editable vector", 16, "#525A6A")

    rect(504, 94, 316, 420)
    vector("source/mark.svg", 522, 114, 278)
    text(532, 464, "PRIMARY MARK", 13, "#525A6A", 500)
    text(532, 490, "#4250DC", 16, "#525A6A")

    rect(844, 94, 316, 420, "#191C26")
    vector("source/mark-inverse.svg", 862, 114, 278)
    text(872, 464, "MONO / INVERSE", 13, "#B7BDCB", 500)
    text(872, 490, "#F7F4EE", 16, "#B7BDCB")

    rect(40, 538, 540, 248)
    text(68, 574, "OPTICAL COMPARISON", 13, "#525A6A", 500)
    vector("review/equal-width/mark.svg", 60, 570, 215)
    vector("source/mark.svg", 310, 570, 215)
    text(100, 750, "112 / 112", 15, "#747B89")
    text(350, 750, "112 / 118", 15, "#4250DC", 500)
    text(100, 774, "Equal width", 13)
    text(350, 774, "Selected: +5.4%", 13, "#4250DC")

    rect(604, 538, 556, 248)
    text(632, 574, "CONTROLLED OUTWARD TAPER", 13, "#525A6A", 500)
    computed = json.loads((BRAND / "source/computed-geometry.json").read_text())["standard"]
    import sys
    sys.path.insert(0, str(ROOT / "tools"))
    from build_brand_sources import rounded_tip_path
    arm = node("path", d=rounded_tip_path(computed), fill="#4250DC",
               transform=f"translate(728 754) scale(.56) translate(-{computed['cx']} -{computed['cy']})")
    root.append(arm)
    root.append(node("line", x1=689, y1=605, x2=767, y2=605, stroke="#747B89", stroke_width=1))
    root.append(node("line", x1=690, y1=764, x2=766, y2=764, stroke="#747B89", stroke_width=1))
    text(782, 613, "118 at the outer end", 15, "#191C26")
    text(782, 756, "112 at the inner end", 15, "#191C26")
    text(866, 646, "6 identical arms", 14)
    text(866, 670, "60° rotation", 14)
    text(866, 694, "r12 tip corners", 14)

    rect(40, 810, 540, 148)
    rect(604, 810, 556, 148, "#191C26")
    text(68, 840, "ACTUAL PNG EXPORTS / 1:1 PIXELS", 12, "#525A6A", 500)
    text(632, 840, "ACTUAL PNG EXPORTS / 1:1 PIXELS", 12, "#B7BDCB", 500)
    for offset, label_color in ((0, "#747B89"), (564, "#B7BDCB")):
        for index, size in enumerate((16, 24, 32, 48, 64)):
            x = 92 + 91 * index + offset
            png = BRAND / f"export/in-app/mark-{size}.png"
            root.append(node("image", x=x - size / 2, y=892 - size / 2, width=size, height=size,
                             href="data:image/png;base64," + base64.b64encode(png.read_bytes()).decode()))
            text(x - 8, 934, str(size), 12, label_color)
    text(44, 984, "Standard: 112 → 118   |   Small ≤32 px: 136 → 143   |   All production icons derive directly from SVG.", 13)
    out = BRAND / "review/design-proof.svg"
    ET.indent(root, space="  ")
    ET.ElementTree(root).write(out, encoding="utf-8", xml_declaration=True)
    executable = shutil.which("inkscape")
    if not executable:
        raise RuntimeError("Inkscape is required to render the review board")
    subprocess.run([executable, str(out), "--export-type=png",
                    f"--export-filename={out.with_suffix('.png')}", "--export-width=1200"], check=True)
    print(f"Built design review: {out}")


if __name__ == "__main__":
    main()
