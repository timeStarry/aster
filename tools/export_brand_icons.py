#!/usr/bin/env python3
"""Render the Aster SVG masters into platform icons without raster resampling.

Examples:
    python3 tools/export_brand_icons.py --check-deps
    python3 tools/export_brand_icons.py --renderer inkscape \
        --renderer-path /Applications/Inkscape.app/Contents/MacOS/inkscape
    python3 tools/export_brand_icons.py --output-dir /tmp/aster-icons
    python3 tools/export_brand_icons.py --windows-only --renderer sharp --overwrite

Requires Pillow for PNG inspection and ICO packaging. SVG rasterization uses
Inkscape, rsvg-convert, resvg, or Node.js with Sharp; macOS ICNS packaging uses Apple's iconutil.
The default destination is assets/brand/export, never the existing Tauri icons.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from typing import Any
import xml.etree.ElementTree as ET

try:
    from PIL import Image, ImageChops
except ImportError:
    Image = None


ROOT = Path(__file__).resolve().parents[1]
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
MASTER_NAMES = (
    "mark", "mark-small", "app-tile", "app-tile-small", "app-square",
    "app-square-small", "app-windows", "app-windows-small", "app-macos", "app-macos-small",
)
WINDOWS_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
FAVICON_SIZES = (16, 32, 48)
MACOS_REPRESENTATIONS = tuple(
    (size, size, scale) for size in (16, 32, 128, 256, 512) for scale in (1, 2)
)
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class ExportError(RuntimeError):
    """A dependency, source, or output failed validation."""


def run(command: list[str]) -> str:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ExportError(f"Cannot run {command[0]}: {exc}") from exc
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        raise ExportError(f"Command failed ({result.returncode}): {command!r}\n{detail}")
    return (result.stdout + result.stderr).strip()


@dataclass(frozen=True)
class Renderer:
    name: str
    executable: str
    version: str

    def render(self, source: Path, destination: Path, pixels: int) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if self.name == "inkscape":
            command = [
                self.executable, str(source), "--export-area-page", "--export-type=png",
                f"--export-filename={destination}", f"--export-width={pixels}",
                f"--export-height={pixels}", "--export-background-opacity=0",
            ]
        elif self.name == "rsvg":
            command = [
                self.executable, "--format", "png", "--width", str(pixels),
                "--height", str(pixels), "--output", str(destination), str(source),
            ]
        elif self.name == "sharp":
            # Set the SVG viewport before rasterizing; never resize a raster.
            script = """
const fs = require('node:fs');
const sharp = require('sharp');
const [source, destination, pixels] = process.argv.slice(1);
const svg = fs.readFileSync(source, 'utf8').replace(/<svg\\b[^>]*>/, tag =>
  tag.replace(/\\bwidth="[^"]*"/, `width="${pixels}"`)
     .replace(/\\bheight="[^"]*"/, `height="${pixels}"`));
sharp(Buffer.from(svg)).png().toFile(destination).catch(error => {
  process.stderr.write(String(error)); process.exitCode = 1;
});
"""
            command = [self.executable, "-e", script, str(source), str(destination), str(pixels)]
        else:
            command = [
                self.executable, "--width", str(pixels), "--height", str(pixels),
                str(source), str(destination),
            ]
        run(command)
        if not destination.is_file():
            raise ExportError(f"Renderer did not create {destination}")


def find_renderer(requested: str, explicit: str | None) -> Renderer:
    if explicit and requested == "auto":
        basename = Path(explicit).name.lower()
        requested = next((name for name in ("inkscape", "rsvg", "resvg") if name in basename), "")
        if not requested:
            raise ExportError("Use --renderer with an executable whose name does not identify it.")
    candidates = {
        "inkscape": ("inkscape", "/Applications/Inkscape.app/Contents/MacOS/inkscape"),
        "rsvg": ("rsvg-convert",),
        "resvg": ("resvg",),
        "sharp": ("node",),
    }
    names = tuple(name for name in candidates if name != "sharp") if requested == "auto" else (requested,)
    for name in names:
        options = (explicit,) if explicit else candidates[name]
        for option in options:
            executable = shutil.which(option)
            if executable:
                if name == "sharp":
                    script = "process.stdout.write('Sharp ' + require('sharp').versions.sharp + '; librsvg ' + require('sharp').versions.rsvg)"
                    version = run([executable, "-e", script])
                else:
                    version = run([executable, "--version"])
                return Renderer(name, executable, version)
    raise ExportError(
        "No SVG renderer found. Install Inkscape (preferred), rsvg-convert, or resvg, "
        "or supply --renderer and --renderer-path."
    )


def file_info(path: Path) -> dict[str, Any]:
    content = path.read_bytes()
    return {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}


def read_master(path: Path) -> ET.Element:
    try:
        content = path.read_text(encoding="utf-8")
        root = ET.fromstring(content)
    except (OSError, UnicodeError, ET.ParseError) as exc:
        raise ExportError(f"Invalid SVG master {path}: {exc}") from exc
    if root.tag != f"{{{SVG_NS}}}svg":
        raise ExportError(f"{path.name}: root must be an SVG element with the SVG namespace.")
    try:
        box = [float(value) for value in re.split(r"[\s,]+", root.attrib.get("viewBox", "").strip())]
    except ValueError as exc:
        raise ExportError(f"{path.name}: invalid viewBox") from exc
    if len(box) != 4 or not all(math.isfinite(value) for value in box) or box != [0, 0, 1024, 1024]:
        raise ExportError(f"{path.name}: viewBox must be '0 0 1024 1024', got {box!r}")
    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag in ("image", "foreignObject", "script"):
            raise ExportError(f"{path.name}: {tag} is unsuitable for a self-contained vector master.")
        if tag == "text":
            raise ExportError(f"{path.name}: convert text to vector paths to avoid font dependencies.")
        for key, value in element.attrib.items():
            if key.rsplit("}", 1)[-1] == "href" and value and not value.startswith("#"):
                raise ExportError(f"{path.name}: external reference {value!r}")
    for reference in re.findall(r"url\(\s*(['\"]?)(.*?)\1\s*\)", content, re.I):
        if not reference[1].startswith("#"):
            raise ExportError(f"{path.name}: external CSS URL {reference[1]!r}")
    if re.search(r"@import\b", content, re.I):
        raise ExportError(f"{path.name}: external CSS imports are not supported.")
    return root


def alpha_info(image: Any) -> dict[str, Any]:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    histogram = alpha.histogram()
    width, height = rgba.size
    return {
        "extrema": list(alpha.getextrema()),
        "transparent_pixels": histogram[0],
        "partial_pixels": sum(histogram[1:255]),
        "opaque_pixels": histogram[255],
        "visible_bbox": list(alpha.getbbox()) if alpha.getbbox() else None,
        "corner_alpha": [alpha.getpixel(point) for point in (
            (0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1),
        )],
    }


def inspect_png(path: Path, expected_size: int, master: str) -> dict[str, Any]:
    try:
        with Image.open(path) as image:
            image.load()
            if image.format != "PNG" or image.size != (expected_size, expected_size):
                raise ExportError(f"{path}: expected PNG {expected_size}×{expected_size}, got {image.format} {image.size}")
            result = {"format": "PNG", "width": image.width, "height": image.height,
                      "mode": image.mode, "alpha": alpha_info(image)}
    except (OSError, ValueError) as exc:
        raise ExportError(f"Cannot decode {path}: {exc}") from exc
    check_alpha(result["alpha"], expected_size, master, str(path))
    return result


def check_alpha(alpha: dict[str, Any], pixels: int, master: str, label: str) -> None:
    bounds = alpha["visible_bbox"]
    if bounds is None or alpha["extrema"][1] < 128:
        raise ExportError(f"{label}: empty or effectively invisible artwork")
    if master.startswith("app-square"):
        if alpha["extrema"] != [255, 255]:
            raise ExportError(f"{label}: square artwork must fill the canvas with an opaque background")
    elif master.startswith(("app-tile", "app-windows")):
        # A small rounded corner can partially cover its outermost pixel even
        # though the vector corner is transparent. Keep this antialiasing.
        if any(value == 255 for value in alpha["corner_alpha"]):
            raise ExportError(f"{label}: rounded tile must retain transparency at every corner")
    elif any(alpha["corner_alpha"]):
        raise ExportError(f"{label}: transparent artwork must have transparent corners")
    if master.startswith(("mark", "app-macos")):
        left, top, right, bottom = bounds
        if left <= 0 or top <= 0 or right >= pixels or bottom >= pixels:
            raise ExportError(f"{label}: visible artwork touches the canvas edge; check padding/cropping")


def validate_master_geometry(renderer: Renderer, masters: dict[str, Path], work: Path) -> dict[str, Any]:
    """Inspect originals and render an expanded viewport to detect clipped shapes."""
    result = {}
    padding = 64
    for name, source in masters.items():
        root = read_master(source)
        original = work / f"{name}-original.png"
        renderer.render(source, original, 1024)
        summary = inspect_png(original, 1024, name)
        expanded = ET.Element(f"{{{SVG_NS}}}svg", {
            "viewBox": "-64 -64 1152 1152", "width": "1152", "height": "1152",
        })
        # A nested viewport preserves percentages and the source coordinate system.
        # Exposing its overflow makes artwork beyond the original bounds visible.
        root.set("x", "0")
        root.set("y", "0")
        root.set("width", "1024")
        root.set("height", "1024")
        root.set("overflow", "visible")
        root.set("style", root.attrib.get("style", "") + ";overflow:visible!important")
        expanded.append(root)
        expanded_svg = work / f"{name}-expanded.svg"
        expanded_svg.write_bytes(ET.tostring(expanded, encoding="utf-8", xml_declaration=True))
        expanded_png = work / f"{name}-expanded.png"
        renderer.render(expanded_svg, expanded_png, 1152)
        with Image.open(expanded_png) as image:
            image.load()
            if image.size != (1152, 1152):
                raise ExportError(f"{name}: expanded viewport has incorrect raster dimensions")
            # Ignore subpixel antialiasing and one pixel of edge rounding.
            visible = image.convert("RGBA").getchannel("A").point(lambda value: 255 if value > 16 else 0)
            bounds = visible.getbbox()
            if bounds is None or bounds[0] < padding - 1 or bounds[1] < padding - 1 or bounds[2] > padding + 1025 or bounds[3] > padding + 1025:
                raise ExportError(f"{name}: artwork exceeds the 1024×1024 master viewBox (expanded bbox {bounds})")
        result[name] = {"file": source.name, **file_info(source), "viewBox": [0, 0, 1024, 1024],
                        "validation_raster": summary, "overflow_check": "passed"}
        print(f"Validated master: {source.name}", flush=True)
    return result


@dataclass(frozen=True)
class RasterJob:
    destination: str
    master: str
    pixels: int


def optical_master(base: str, pixels: int) -> str:
    return base + ("-small" if pixels <= 32 else "")


def export_plan() -> tuple[list[RasterJob], dict[str, str]]:
    jobs = []
    for width, _, scale in MACOS_REPRESENTATIONS:
        suffix = "@2x" if scale == 2 else ""
        pixels = width * scale
        jobs.append(RasterJob(f"macos/Aster.iconset/icon_{width}x{width}{suffix}.png",
                              optical_master("app-macos", pixels), pixels))
    for pixels in WINDOWS_SIZES:
        jobs.append(RasterJob(f"windows/png/icon-{pixels}.png", optical_master("app-windows", pixels), pixels))
    for pixels in FAVICON_SIZES:
        jobs.append(RasterJob(f"web/favicon-{pixels}.png", optical_master("app-tile", pixels), pixels))
    jobs.append(RasterJob("web/favicon-96.png", "app-tile", 96))
    jobs.append(RasterJob("web/apple-touch-icon.png", "app-square", 180))
    for pixels in (192, 512):
        jobs.append(RasterJob(f"web/pwa-{pixels}.png", "app-square", pixels))
    for pixels in (16, 20, 24, 32, 48, 64):
        jobs.append(RasterJob(f"in-app/mark-{pixels}.png", optical_master("mark", pixels), pixels))
    for pixels in (256, 512):
        for base in ("mark", "app-tile"):
            jobs.append(RasterJob(f"readme/{base}-{pixels}.png", base, pixels))
    for filename, pixels in (("32x32.png", 32), ("64x64.png", 64), ("128x128.png", 128), ("256x256.png", 256), ("512x512.png", 512),
                             ("128x128@2x.png", 256), ("icon.png", 1024)):
        jobs.append(RasterJob(f"tauri/{filename}", optical_master("app-square", pixels), pixels))
    copies = {f"svg/{name}.svg": name for name in MASTER_NAMES}
    copies.update({
        "web/favicon.svg": "app-tile-small", "web/app-icon.svg": "app-square",
        "in-app/mark.svg": "mark", "in-app/mark-small.svg": "mark-small",
        "readme/mark.svg": "mark", "readme/app-tile.svg": "app-tile",
    })
    return jobs, copies


def pack_ico(destination: Path, pngs: dict[int, Path]) -> None:
    sizes = sorted(pngs)
    frames = []
    try:
        for size in sizes:
            with Image.open(pngs[size]) as image:
                image.load()
                if image.size != (size, size):
                    raise ExportError(f"Incorrect ICO source size: {pngs[size]}")
                frames.append(image.convert("RGBA"))
        # Every requested frame is supplied explicitly. Pillow never has to resize.
        frames[-1].save(destination, format="ICO", sizes=[(size, size) for size in sizes],
                        append_images=frames[:-1])
    finally:
        for frame in frames:
            frame.close()


def inspect_ico(path: Path, pngs: dict[int, Path]) -> dict[str, Any]:
    content = path.read_bytes()
    if len(content) < 6:
        raise ExportError(f"{path}: truncated ICO header")
    reserved, kind, count = struct.unpack_from("<HHH", content)
    if (reserved, kind, count) != (0, 1, len(pngs)):
        raise ExportError(f"{path}: unexpected ICO header {(reserved, kind, count)}")
    header_end = 6 + 16 * count
    if len(content) < header_end:
        raise ExportError(f"{path}: truncated ICO directory")
    entries = []
    observed = set()
    spans = []
    for index in range(count):
        width, height, colors, entry_reserved, planes, bits, length, offset = struct.unpack_from("<BBBBHHII", content, 6 + 16 * index)
        size = width or 256
        if size != (height or 256) or size not in pngs or size in observed:
            raise ExportError(f"{path}: unexpected/duplicate ICO dimensions {size}×{height or 256}")
        if entry_reserved or offset < header_end or offset + length > len(content):
            raise ExportError(f"{path}: malformed ICO entry {index}")
        spans.append((offset, offset + length))
        payload = content[offset:offset + length]
        if not payload.startswith(PNG_SIGNATURE):
            raise ExportError(f"{path}: frame {size} is not a PNG payload")
        with Image.open(io.BytesIO(payload)) as image, Image.open(pngs[size]) as original:
            image.load()
            original.load()
            if image.size != (size, size) or image.convert("RGBA").tobytes() != original.convert("RGBA").tobytes():
                raise ExportError(f"{path}: ICO frame {size} differs from its direct SVG render")
            entries.append({"width": size, "height": size, "bits": bits,
                            "payload": "PNG", "alpha": alpha_info(image)})
        observed.add(size)
    spans.sort()
    if spans[0][0] != header_end or spans[-1][1] != len(content) or any(a[1] != b[0] for a, b in zip(spans, spans[1:])):
        raise ExportError(f"{path}: overlapping ICO payloads, gaps, or trailing bytes")
    with Image.open(path) as image:
        if image.format != "ICO" or image.ico.sizes() != {(size, size) for size in pngs}:
            raise ExportError(f"{path}: Pillow could not recover every ICO representation")
    return {"format": "ICO", "representations": entries, "container_validation": "passed"}


def inspect_icns(path: Path, iconutil: str, work: Path) -> dict[str, Any]:
    content = path.read_bytes()
    if len(content) < 8 or content[:4] != b"icns" or struct.unpack_from(">I", content, 4)[0] != len(content):
        raise ExportError(f"{path}: invalid ICNS header or length")
    offset = 8
    chunks = []
    while offset < len(content):
        if offset + 8 > len(content):
            raise ExportError(f"{path}: truncated ICNS chunk")
        kind, length = struct.unpack_from(">4sI", content, offset)
        if length < 8 or offset + length > len(content):
            raise ExportError(f"{path}: invalid ICNS chunk length")
        chunks.append(kind.decode("ascii", errors="replace"))
        offset += length
    # Current iconutil can encode 16/32px using ic04/ic05 ARGB chunks that Pillow
    # does not recognize. Let Apple's decoder recover the native representations,
    # then inspect every PNG with Pillow rather than reporting false omissions.
    unpacked = work / "icns-roundtrip.iconset"
    run([iconutil, "--convert", "iconset", "--output", str(unpacked), str(path)])
    expected = set()
    entries = []
    for width, height, scale in MACOS_REPRESENTATIONS:
        suffix = "@2x" if scale == 2 else ""
        filename = f"icon_{width}x{height}{suffix}.png"
        expected.add(filename)
        decoded = unpacked / filename
        if not decoded.is_file():
            raise ExportError(f"{path}: missing ICNS representation {filename}")
        info = inspect_png(decoded, width * scale, "app-macos")
        with Image.open(decoded) as image, Image.open(path.parent / "Aster.iconset" / filename) as original:
            image.load()
            original.load()
            rgba, original_rgba = image.convert("RGBA"), original.convert("RGBA")
            if rgba.getchannel("A").tobytes() != original_rgba.getchannel("A").tobytes():
                raise ExportError(f"{path}: ICNS representation {filename} changes the source alpha/padding")
            raw_difference = ImageChops.difference(rgba.convert("RGB"), original_rgba.convert("RGB"))
            raw_maximum = max(upper for _, upper in raw_difference.getextrema())
            visible_mask = rgba.getchannel("A").point(lambda value: 255 if value else 0)
            raw_visible_maximum = max(ImageChops.multiply(channel, visible_mask).getextrema()[1]
                                      for channel in raw_difference.split())
            # Apple may transform colors when packing 16/32px legacy ARGB slots.
            # Preserve native output; expose the measured difference rather than
            # replacing native slots with PNG chunks that lose alpha on macOS.
            maximum_difference = 0
            composite_diagnostics = []
            for value in (0, 255):
                background = Image.new("RGBA", rgba.size, (value, value, value, 255))
                difference = ImageChops.difference(Image.alpha_composite(background, rgba),
                                                   Image.alpha_composite(background, original_rgba))
                channel_maximum = max(upper for _, upper in difference.getextrema()[:3])
                maximum_difference = max(maximum_difference, channel_maximum)
                channel_sum = sum(sum(index * count for index, count in enumerate(channel.histogram()))
                                  for channel in difference.split()[:3])
                composite_diagnostics.append({"background": f"#{value:02x}{value:02x}{value:02x}",
                                              "max_channel_difference": channel_maximum,
                                              "mean_absolute_channel_difference": round(channel_sum / (3 * rgba.width * rgba.height), 6)})
        entries.append({"logical_width": width, "logical_height": height, "scale": scale,
                        "width": width * scale, "height": height * scale, "alpha": info["alpha"],
                        "roundtrip_alpha_exact": True,
                        "roundtrip_raw_unassociated_rgb_max_channel_difference": raw_maximum,
                        "roundtrip_raw_visible_unassociated_rgb_max_channel_difference": raw_visible_maximum,
                        "roundtrip_composite_max_channel_difference": maximum_difference,
                        "roundtrip_composite_diagnostics": composite_diagnostics})
    if {entry.name for entry in unpacked.iterdir()} != expected:
        raise ExportError(f"{path}: unexpected ICNS representations after native decoding")
    return {"format": "ICNS", "chunks": chunks, "representations": entries,
            "container_validation": "passed", "native_color_conversion_observed":
            any(entry["roundtrip_composite_max_channel_difference"] for entry in entries)}


def publish(stage: Path, output: Path, overwrite: bool) -> None:
    backup = None
    if output.exists():
        if not output.is_dir() or output.is_symlink():
            raise ExportError(f"Output must be a normal directory: {output}")
        if any(output.iterdir()) and not overwrite:
            raise ExportError(f"Output is nonempty: {output}. Use --overwrite to replace this export.")
        backup = output.parent / f".{output.name}-backup-{stage.name}"
        output.rename(backup)
    try:
        stage.rename(output)
    except OSError:
        if backup is not None:
            backup.rename(output)
        raise
    if backup is not None:
        shutil.rmtree(backup)


def export_windows(renderer: Renderer, source_dir: Path, output: Path, overwrite: bool) -> int:
    """Refresh Windows only, preserving every other platform's validated bytes."""
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}-stage-", dir=output.parent))
    try:
        previous = {}
        reconciled = []
        source_reconciled = []
        if output.exists() and any(output.iterdir()):
            manifest_path = output / "manifest.json"
            if not manifest_path.is_file():
                raise ExportError("Windows-only refresh requires the existing export manifest.")
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
            old_windows_export = previous.get("windows_export", {})
            reconciled = list(old_windows_export.get("preserved_svg_hash_reconciliation", []))
            source_reconciled = list(old_windows_export.get("preserved_source_hash_reconciliation", []))
            files = previous.get("files", {})
            actual = {path.relative_to(output).as_posix() for path in output.rglob("*")
                      if path.is_file() and path != manifest_path}
            if actual != set(files):
                raise ExportError("Existing export manifest does not cover every file.")
            for relative, info in files.items():
                actual_info = file_info(output / relative)
                expected_info = {key: info[key] for key in ("bytes", "sha256")}
                if actual_info != expected_info:
                    if Path(relative).suffix != ".svg":
                        raise ExportError(f"Existing exported asset changed outside its manifest: {relative}")
                    # Text masters can have been edited or normalized by Git.
                    # Retain their bytes and disclose the old manifest mismatch.
                    read_master(output / relative)
                    reconciled.append({"file": relative, "previous": expected_info, "retained": actual_info})
                    files[relative] = {**info, **actual_info}
            shutil.copytree(output, stage, dirs_exist_ok=True)
            (stage / "manifest.json").unlink()
        masters = {name: source_dir / f"{name}.svg" for name in ("app-windows", "app-windows-small")}
        work = stage / ".validation"
        work.mkdir()
        source_manifest = validate_master_geometry(renderer, masters, work)
        files = dict(previous.get("files", {}))
        for pixels in WINDOWS_SIZES:
            master = optical_master("app-windows", pixels)
            relative = f"windows/png/icon-{pixels}.png"
            destination = stage / relative
            renderer.render(masters[master], destination, pixels)
            files[relative] = {**file_info(destination), **inspect_png(destination, pixels, master),
                               "source": f"{master}.svg", "direct_svg_render": True}
            print(f"Rendered: {relative} ({pixels}×{pixels})", flush=True)
        for master, source in masters.items():
            relative = f"svg/{master}.svg"
            destination = stage / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            files[relative] = {**file_info(destination), "format": "SVG", "viewBox": [0, 0, 1024, 1024],
                               "source": source.name, "self_contained": True,
                               "alpha": source_manifest[master]["validation_raster"]["alpha"]}
        pngs = {size: stage / f"windows/png/icon-{size}.png" for size in WINDOWS_SIZES}
        destination = stage / "windows/Aster.ico"
        pack_ico(destination, pngs)
        files["windows/Aster.ico"] = {**file_info(destination), **inspect_ico(destination, pngs)}
        copied = stage / "tauri/icon.ico"
        copied.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(destination, copied)
        files["tauri/icon.ico"] = {**files["windows/Aster.ico"], "copied_from": "windows/Aster.ico"}
        shutil.rmtree(work)
        if {path.relative_to(stage).as_posix() for path in stage.rglob("*") if path.is_file()} != set(files):
            raise ExportError("Export manifest does not cover every generated file.")
        policy = dict(previous.get("policy", {}))
        policy.pop("pwa_apple_windows", None)
        policy.update({"raster_resampling": False, "ico_payloads": "PNG",
                       "pwa_apple": "opaque square; platform applies its own mask",
                       "windows": "rounded tile with transparent outer corners"})
        retained_masters = dict(previous.get("masters", {}))
        for name, info in retained_masters.items():
            source = source_dir / info["file"]
            read_master(source)
            actual_info = file_info(source)
            expected_info = {key: info[key] for key in ("bytes", "sha256")}
            if actual_info != expected_info:
                source_reconciled.append({"file": info["file"], "previous": expected_info, "retained": actual_info})
                retained_masters[name] = {**info, **actual_info}
        timestamp = datetime.now(timezone.utc).isoformat()
        manifest = {**previous, "schema_version": 1, "generator": "tools/export_brand_icons.py",
                    "generated_at": timestamp, "complete": previous.get("complete", False),
                    "small_master_max_pixels": 32, "policy": policy,
                    "windows_export": {"generated_at": timestamp, "scope": "windows-only",
                                       "renderer": {"name": renderer.name,
                                                    "executable": Path(renderer.executable).name,
                                                    "version": renderer.version},
                                       "preserved_svg_hash_reconciliation": reconciled,
                                       "preserved_source_hash_reconciliation": source_reconciled},
                    "masters": {**retained_masters, **source_manifest},
                    "files": dict(sorted(files.items()))}
        (stage / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        publish(stage, output, overwrite)
        print(f"Refreshed and validated Windows assets; preserved all other platform assets: {output}")
        return 0
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source-dir", type=Path, default=ROOT / "assets/brand/source")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "assets/brand/export")
    parser.add_argument("--renderer", choices=("auto", "inkscape", "rsvg", "resvg", "sharp"), default="auto")
    parser.add_argument("--renderer-path", help="Executable path; with auto, its name must identify the renderer.")
    parser.add_argument("--iconutil-path", help="Apple iconutil executable path.")
    parser.add_argument("--skip-icns", action="store_true", help="Export the iconset without ICNS (for non-macOS hosts).")
    parser.add_argument("--windows-only", action="store_true",
                        help="Refresh Windows PNG/ICO and vector copies while preserving all existing non-Windows assets. Sharp requires Node.js with the sharp package available.")
    parser.add_argument("--check-deps", action="store_true", help="Check dependencies only, without reading or writing assets.")
    parser.add_argument("--overwrite", action="store_true", help="Replace the dedicated export directory after all checks pass.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if Image is None:
        raise ExportError("Pillow is required for container packaging/inspection. Run with a Python that provides Pillow.")
    renderer = find_renderer(args.renderer, args.renderer_path)
    iconutil = None if args.skip_icns or args.windows_only else shutil.which(args.iconutil_path or "iconutil")
    if not args.skip_icns and not args.windows_only and not iconutil:
        raise ExportError("Apple iconutil is required for ICNS. Use --skip-icns only for an intentionally incomplete cross-platform export.")
    print(f"Renderer: {renderer.name} ({renderer.version})", flush=True)
    if args.check_deps:
        print(f"Pillow: {Image.__version__}; iconutil: {iconutil or 'skipped'}")
        return 0
    source_dir = args.source_dir.expanduser().resolve()
    output = args.output_dir.expanduser().resolve()
    # Dedicated exports must never replace the masters, source tree, or Tauri icons.
    protected = (ROOT, ROOT / "crates/aster-app/icons", source_dir)
    if any(output == path or output in path.parents or path in output.parents for path in protected[1:]) or output == ROOT or output in ROOT.parents:
        raise ExportError("Choose an output directory separate from the source masters and existing Tauri icons.")
    if output.exists() and (not output.is_dir() or (any(output.iterdir()) and not args.overwrite)):
        raise ExportError(f"Output already exists: {output}. Use --overwrite to replace a dedicated export directory.")
    if args.windows_only:
        return export_windows(renderer, source_dir, output, args.overwrite)
    masters = {name: source_dir / f"{name}.svg" for name in MASTER_NAMES}
    for path in masters.values():
        read_master(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}-stage-", dir=output.parent))
    try:
        work = stage / ".validation"
        work.mkdir()
        source_manifest = validate_master_geometry(renderer, masters, work)
        files = {}
        jobs, copies = export_plan()
        for job in jobs:
            destination = stage / job.destination
            renderer.render(masters[job.master], destination, job.pixels)
            files[job.destination] = {**file_info(destination), **inspect_png(destination, job.pixels, job.master),
                                      "source": f"{job.master}.svg", "direct_svg_render": True}
            print(f"Rendered: {job.destination} ({job.pixels}×{job.pixels})", flush=True)
        for relative, master in copies.items():
            destination = stage / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(masters[master], destination)
            read_master(destination)
            files[relative] = {**file_info(destination), "format": "SVG", "viewBox": [0, 0, 1024, 1024],
                               "source": f"{master}.svg", "self_contained": True,
                               "alpha": source_manifest[master]["validation_raster"]["alpha"]}
        for relative, pngs in (
            ("windows/Aster.ico", {size: stage / f"windows/png/icon-{size}.png" for size in WINDOWS_SIZES}),
            ("web/favicon.ico", {size: stage / f"web/favicon-{size}.png" for size in FAVICON_SIZES}),
        ):
            destination = stage / relative
            pack_ico(destination, pngs)
            files[relative] = {**file_info(destination), **inspect_ico(destination, pngs)}
        if iconutil:
            destination = stage / "macos/Aster.icns"
            run([iconutil, "--convert", "icns", "--output", str(destination), str(stage / "macos/Aster.iconset")])
            files["macos/Aster.icns"] = {
                **file_info(destination), **inspect_icns(destination, iconutil, work),
                "packaged_by": "iconutil",
            }
        for source_relative, destination_relative in (
            ("windows/Aster.ico", "tauri/icon.ico"), ("macos/Aster.icns", "tauri/icon.icns"),
        ):
            if source_relative in files:
                shutil.copyfile(stage / source_relative, stage / destination_relative)
                files[destination_relative] = {
                    **files[source_relative], **file_info(stage / destination_relative),
                    "copied_from": source_relative,
                }
        shutil.rmtree(work)
        actual_files = {path.relative_to(stage).as_posix() for path in stage.rglob("*") if path.is_file()}
        if actual_files != set(files):
            raise ExportError("Export manifest does not cover every generated file.")
        manifest = {
            "schema_version": 1, "generator": "tools/export_brand_icons.py",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "renderer": {"name": renderer.name, "executable": Path(renderer.executable).name, "version": renderer.version},
            "iconutil": iconutil, "complete": not args.skip_icns,
            "source_dir": source_dir.resolve().relative_to(ROOT).as_posix() if source_dir.resolve().is_relative_to(ROOT) else source_dir.name, "small_master_max_pixels": 32,
            "policy": {"raster_resampling": False, "ico_payloads": "PNG",
                       "pwa_apple": "opaque square; platform applies its own mask",
                       "windows": "rounded tile with transparent outer corners",
                       "macos": "transparent perimeter with rounded inset tile",
                       "favicon": "prerounded tile", "in_app": "transparent mark"},
            "validation": {"dimensions": "passed", "alpha": "passed", "clipping": "passed",
                           "container_integrity": "passed", "svg_self_contained": "passed"},
            "masters": source_manifest, "files": dict(sorted(files.items())),
        }
        (stage / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        publish(stage, output, args.overwrite)
        print(f"Exported and validated {len(files)} assets to {output}")
        if args.skip_icns:
            print("ICNS skipped; manifest complete=false.")
        return 0
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ExportError, OSError) as exc:
        print(f"Export failed: {exc}", file=sys.stderr)
        sys.exit(1)
