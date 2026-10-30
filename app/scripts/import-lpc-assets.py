"""Import pinned LPC artwork. Requires Pillow: python3 -m pip install Pillow==12.2.0.

Usage: python3 app/scripts/import-lpc-assets.py /path/to/Universal-LPC-Spritesheet-Character-Generator
Only selected source blobs are checked out. Output is content-addressed, with per-layer
credits and authored frame rectangles; importing does not execute upstream code.
"""
import hashlib
import copy
import io
import json
import pathlib
import subprocess
import sys
from PIL import Image, ImageDraw, ImageOps

REVISION = "86160e7507d6841259cff624a51a63c1d4847ee3"
ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(sys.argv[1]).resolve()
OUT = ROOT / "scripts/.artifacts/lpc"
LIB = ROOT / "src/libs/lpc"
PROFILES = json.loads((LIB / "profiles.json").read_text())
COLORS = ["black", "blue", "brown", "gray", "green", "orange", "purple", "red", "white", "yellow", "gold", "silver"]
SKINS = ["light", "black", "olive", "ivory"]
EYES = ["blue", "black", "brown", "gray", "green", "red", "yellow", "white"]
CYCLES = {"idle": [0], "walk": list(range(1, 9)), "slash": list(range(6)), "thrust": list(range(8)), "spellcast": list(range(7)), "shoot": list(range(13)), "hurt": list(range(6))}
subprocess.run(["git", "-C", str(SOURCE), "rev-parse", "--verify", REVISION + "^{commit}"], check=True, stdout=subprocess.DEVNULL)
if subprocess.check_output(["git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True).strip() != REVISION:
    raise SystemExit("LPC checkout must be at the pinned revision " + REVISION)
FILES = set(subprocess.check_output(["git", "-C", str(SOURCE), "ls-tree", "-r", "--name-only", "HEAD"], text=True).splitlines())
def load_definition(path):
    """Resolve an upstream definition, merging body-specific selections and credits."""
    if isinstance(path, str):
        return json.loads((SOURCE / "sheet_definitions" / path).read_text())
    result = {"credits": []}
    for body, selected_path in path.items():
        selected_definition = load_definition(selected_path)
        for key, layer in selected_definition.items():
            if key.startswith("layer_"):
                result["layer_" + str(len(result))] = {k: v for k, v in layer.items() if k not in ["male", "female"] or k == body}
        # Legacy body-specific coats share their own variants and palettes.
        for key in ["variants", "recolors"]:
            if key in selected_definition:
                result[key] = selected_definition[key]
        result["credits"].extend(selected_definition.get("credits", []))
    return result

definitions = {key: load_definition(path) for key, path in PROFILES.items()}
definitions["boomerang"]["resting_pose_fallback"] = True
for profile, template in {"tattoo": "head-hard", "scar": "head-hard", "fan": "gloves", "shuriken": "gloves", "ring": "gloves", "bracelet": "gloves"}.items():
    definitions[profile] = copy.deepcopy(definitions[template])
    definitions[profile]["supplement"] = profile
    definitions[profile].pop("recolors", None)
    for key, layer in definitions[profile].items():
        if key.startswith("layer_"):
            layer["zPos"] = 106 if profile in ["tattoo", "scar"] else 142 if profile in ["fan", "shuriken"] else 76
selected = set()
for definition in definitions.values():
    for key, layer in definition.items():
        if key.startswith("layer_"):
            for body in ["male", "female"]:
                path = layer.get(body)
                if path:
                    selected.update(f for f in FILES if f.startswith("spritesheets/" + path) and f.endswith(".png"))
# The explicit file list avoids pulling the entire multi-gigabyte artwork repository.
patterns = ["/sheet_definitions/", "/palette_definitions/", "/CREDITS.csv", "/LICENSE"] + ["/" + p for p in sorted(selected)]
subprocess.run(["git", "-C", str(SOURCE), "sparse-checkout", "set", "--no-cone", "--stdin"], input="\n".join(patterns), text=True, check=True)
OUT.mkdir(parents=True, exist_ok=True)
palettes = {}
for material in ["body", "hair", "eye", "cloth", "metal"]:
    palettes[material] = json.loads((SOURCE / f"palette_definitions/{material}/{material}_ulpc.json").read_text())
bases = {"body": "light", "hair": "orange", "eye": "blue", "cloth": "white", "metal": "steel"}
catalog, credits, generated = {}, [], set()
images = {}

def read_image(path):
    """Cache source PNGs as RGBA so palette and alpha processing share one decoder."""
    if path not in images:
        images[path] = Image.open(SOURCE / path).convert("RGBA")
    return images[path]

def palette(material, color):
    """Choose a six-shade material ramp, including coloured metal adaptations."""
    values = palettes[material]
    aliases = {"yellow": "blonde", "gray": "grey", "ivory": "white", "gold": "yellow", "silver": "gray"}
    selected = values.get(color) or values.get(aliases.get(color))
    if not selected and material == "metal":
        # The metal palette has only natural alloys; coloured armour uses the
        # matching six-shade cloth ramp while keeping metal highlights/shadows.
        selected = palettes["cloth"].get(color) or palettes["cloth"].get(aliases.get(color))
    return selected or values.get("light" if material == "body" else bases[material])

def recolor(image, definition, color, eyes, source_variant):
    """Apply authored ramps or legacy tinting without changing the alpha channel."""
    config = definition.get("recolors", {})
    configs = list(config.values()) if "color_1" in config else [config]
    replacements = {}
    for part in configs:
        material = part.get("material")
        if material in palettes:
            target = eyes if material == "eye" else color
            for old, new in zip(palettes[material][bases[material]], palette(material, target)):
                replacements[tuple(bytes.fromhex(old.lstrip("#")))] = tuple(bytes.fromhex(new.lstrip("#")))
    if not replacements:
        # Legacy fixed-variant weapons do not have palette metadata. A shaded
        # colour ramp gives those silhouettes the same variant controls as cloth.
        if definition.get("variants") and source_variant != color and not definition.get("supplement"):
            tones = {"black": "#414052", "blue": "#5483bf", "brown": "#93694e", "gray": "#8b92a2", "green": "#628d59", "orange": "#d58d4c", "purple": "#9969b0", "red": "#bd555d", "white": "#d6d6dc", "yellow": "#dbc45e", "gold": "#caa154", "silver": "#b9c5d6"}
            painted = ImageOps.colorize(ImageOps.grayscale(image), black="#201c2a", mid=tones[color], white="#f5f3f8", midpoint=164).convert("RGBA")
            painted.putalpha(image.getchannel("A"))
            return painted
        return image
    indexed = image.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    values = indexed.getpalette("RGBA")
    for i in range(0, len(values), 4):
        values[i:i + 3] = replacements.get(tuple(values[i:i + 3]), values[i:i + 3])
    indexed.putpalette(values, "RGBA")
    return indexed.convert("RGBA")

def candidates(definition, layer, body, state, color):
    """Locate source poses while keeping alternative slash animations mutually exclusive."""
    path = layer.get(body)
    if not path:
        return []
    custom = layer.get("custom_animation", "")
    animation = "walk" if state == "idle" else state
    stem = custom.removesuffix("_oversize").removesuffix("_128")
    if stem == "slash_reverse":
        # Forward and reverse slash are alternatives, not simultaneous layers.
        if any(value.get("custom_animation", "").removesuffix("_oversize").removesuffix("_128") == "slash" for key, value in definition.items() if key.startswith("layer_")):
            return []
        stem = "slash"
    if custom and stem != animation:
        return []
    variants = definition.get("variants", [])
    variant = (color if color in variants else (variants[0] if variants else None))
    if variant:
        variant = variant.replace(" ", "_")
    result = []
    if custom:
        result.extend(["spritesheets/" + path + (variant or "") + ".png", "spritesheets/" + path + animation + "/" + (variant or "") + ".png"])
    else:
        result.extend(["spritesheets/" + path + animation + ("/" + variant if variant else "") + ".png"])
    found = [p for p in result if p in FILES]
    if not found and variant:
        for fallback in variants:
            suffix = fallback.replace(" ", "_") + ".png"
            for path_candidate in result:
                candidate = path_candidate[:-(len(variant) + 4)] + suffix
                if candidate in FILES:
                    found.append(candidate)
    return found

def pack(definition, layer, body, color, eyes):
    """Collect directional frames and produce combat and compact movement atlases."""
    clips, frames, cell = {}, [], 64
    for state, cycle in CYCLES.items():
        options = candidates(definition, layer, body, state, color)
        if not options:
            continue
        path = options[0]
        image = read_image(path)
        rows = 1 if state == "hurt" else 4
        size = image.height // rows
        if size not in [64, 128, 192]:
            raise ValueError(f"Unexpected LPC frame size {size}: {path}")
        cell = max(cell, size)
        columns = image.width // size
        directions = []
        for direction in range(4):
            indices = []
            for frame in cycle:
                if frame >= columns:
                    continue
                indices.append(len(frames))
                row = 0 if rows == 1 else direction
                cropped = image.crop((frame * size, row * size, (frame + 1) * size, (row + 1) * size))
                if definition.get("supplement"):
                    cropped = supplement(cropped, definition["supplement"], direction, color)
                frames.append(cropped)
            directions.append(indices)
        clips[state] = directions
    if not frames:
        return None
    if definition.get("resting_pose_fallback") and "idle" not in clips:
        # Some authored weapons supply only an attack. Hold its initial pose at rest.
        resting = [[indices[0]] for indices in next(iter(clips.values()))]
        clips["idle"] = resting
        clips["walk"] = resting
    packed = write_atlas(frames, clips, cell, definition, layer, color, eyes, pathlib.Path(path).stem)
    travel_clips, travel_frames = {}, []
    for state in ["idle", "walk"]:
        if state not in clips:
            continue
        travel_clips[state] = []
        for indices in clips[state]:
            travel_clips[state].append(list(range(len(travel_frames), len(travel_frames) + len(indices))))
            travel_frames.extend(frames[i] for i in indices)
    if travel_frames:
        packed["travel"] = write_atlas(travel_frames, travel_clips, cell, definition, layer, color, eyes, pathlib.Path(path).stem, compact=True)
    return packed

def write_atlas(frames, clips, cell, definition, layer, color, eyes, source_variant, compact=False):
    """Pack bounded PNGs, record their content hashes, and retain authored frame indices."""
    # WebGL 1 guarantees 2048px textures, including on older native/web devices.
    columns = min(9 if compact else 16, 2048 // cell)
    atlas = Image.new("RGBA", (cell * columns, cell * ((len(frames) + columns - 1) // columns)))
    for i, frame in enumerate(frames):
        # Oversized weapons are centered on the same 64px actor origin.
        atlas.alpha_composite(frame, ((i % columns) * cell + (cell - frame.width) // 2, (i // columns) * cell + (cell - frame.height) // 2))
    atlas = recolor(atlas, definition, color, eyes, source_variant)
    trim = None
    if compact:
        atlas, columns, clips, trim = pack_movement_frames(atlas, clips, cell, columns)
    data = io.BytesIO()
    atlas.save(data, format="PNG", optimize=True)
    digest = hashlib.sha256(data.getvalue()).hexdigest()[:24]
    name = digest + ".png"
    generated.add(name)
    if not (OUT / name).exists():
        (OUT / name).write_bytes(data.getvalue())
    return {"image": name, "cell": cell, "columns": columns, "z": layer["zPos"], "clips": clips, **({"trim": trim} if trim else {})}

def pack_movement_frames(atlas, clips, cell, columns):
    """Trim shared transparent margins and deduplicate poses without changing their timing or origin."""
    # Invisible RGB cannot affect nearest-sampled artwork; preserve every alpha and visible RGBA value.
    atlas = Image.composite(atlas, Image.new("RGBA", atlas.size), atlas.getchannel("A").point(lambda alpha: 255 if alpha else 0))
    indices = sorted({index for directions in clips.values() for frames in directions for index in frames})
    frames = {index: atlas.crop((index % columns * cell, index // columns * cell, (index % columns + 1) * cell, (index // columns + 1) * cell)) for index in indices}
    bounds = [box for frame in frames.values() if (box := frame.getchannel("A").getbbox())]
    box = (min(b[0] for b in bounds), min(b[1] for b in bounds), max(b[2] for b in bounds), max(b[3] for b in bounds)) if bounds else (0, 0, 1, 1)
    width, height = box[2] - box[0], box[3] - box[1]
    unique, lookup, remap = [], {}, {}
    for index, frame in frames.items():
        cropped = frame.crop(box)
        key = cropped.tobytes()
        if key not in lookup:
            lookup[key] = len(unique)
            unique.append(cropped)
        remap[index] = lookup[key]
    stride_x, stride_y = width + 2, height + 2
    # Keep the existing uniform grid, choosing the smallest bounded allocation with a square tie-break.
    choices = []
    for count in range(1, min(len(unique), 2048 // stride_x) + 1):
        rows = (len(unique) + count - 1) // count
        w, h = count * stride_x, rows * stride_y
        if h <= 2048:
            choices.append(((w * h, abs(w - h), max(w, h), w), count, w, h))
    _, columns, w, h = min(choices)
    packed = Image.new("RGBA", (w, h))
    for index, cropped in enumerate(unique):
        x, y = index % columns * stride_x + 1, index // columns * stride_y + 1
        packed.paste(cropped, (x, y))
        # Extruded pixels stay outside the sampled rectangle, avoiding neighbouring-frame seams.
        packed.paste(cropped.crop((0, 0, width, 1)), (x, y - 1))
        packed.paste(cropped.crop((0, height - 1, width, height)), (x, y + height))
        packed.paste(cropped.crop((0, 0, 1, height)), (x - 1, y))
        packed.paste(cropped.crop((width - 1, 0, width, height)), (x + width, y))
        for dx, dy, sx, sy in [(-1, -1, 0, 0), (width, -1, width - 1, 0), (-1, height, 0, height - 1), (width, height, width - 1, height - 1)]:
            packed.putpixel((x + dx, y + dy), cropped.getpixel((sx, sy)))
    for index, original in frames.items():
        frame = remap[index]
        x, y = frame % columns * stride_x + 1, frame // columns * stride_y + 1
        restored = Image.new("RGBA", (cell, cell))
        restored.paste(packed.crop((x, y, x + width, y + height)), box[:2])
        if restored.tobytes() != original.tobytes():
            raise ValueError(f"Movement packing changed frame {index}")
    clips = {state: [[remap[index] for index in frames] for frames in directions] for state, directions in clips.items()}
    return packed, columns, clips, {"x": box[0], "y": box[1], "width": width, "height": height}

def supplement(template, profile, direction, color):
    """Original pixel details follow the authored head/hand pose, never a fixed screen position."""
    output = Image.new("RGBA", template.size)
    bbox = template.getbbox()
    if not bbox:
        return output
    x0, y0, x1, y1 = bbox
    draw = ImageDraw.Draw(output)
    rgb = {"black": "#242331", "blue": "#528cdb", "red": "#c7474b", "green": "#528344", "white": "#e9e6dc", "gold": "#e6b64e", "silver": "#b7c5cf", "purple": "#8a579d", "orange": "#db8743", "brown": "#805c46", "yellow": "#e1c568", "gray": "#777f8e"}.get(color, "#777f8e")
    if profile in ["scar", "tattoo"]:
        if direction == 0:
            return output
        x = (x0 + x1) // 2 + (3 if direction == 3 else -3)
        y = y1 - 5
        if profile == "scar":
            draw.line([(x, y - 2), (x + 2, y + 1)], fill="#a96d68", width=1)
        else:
            draw.line([(x - 1, y - 2), (x + 1, y), (x - 1, y + 2)], fill="#3c4e68", width=1)
        output.putalpha(Image.composite(output.getchannel("A"), Image.new("L", template.size), template.getchannel("A")))
        return output
    # Follow one connected hand component, rather than the midpoint between both hands.
    pixels = template.getchannel("A")
    start = next(((x, y) for y in range(y0, y1) for x in range(x0, x1) if pixels.getpixel((x, y))), None)
    if not start:
        return output
    component, todo = set(), [start]
    while todo:
        x, y = todo.pop()
        if (x, y) in component or not (0 <= x < template.width and 0 <= y < template.height) or not pixels.getpixel((x, y)):
            continue
        component.add((x, y))
        todo.extend([(x-1,y),(x+1,y),(x,y-1),(x,y+1)])
    x = round(sum(p[0] for p in component) / len(component))
    y = round(sum(p[1] for p in component) / len(component))
    if profile == "fan":
        draw.polygon([(x,y+1),(x-7,y-6),(x-5,y-9),(x,y-11),(x+5,y-9),(x+7,y-6)], fill=rgb, outline="#302c38")
        for dx in [-5,0,5]:
            draw.line([(x,y),(x+dx,y-8)], fill="#d4b98c")
    elif profile == "shuriken":
        draw.polygon([(x,y-5),(x+1,y-1),(x+5,y),(x+1,y+1),(x,y+5),(x-1,y+1),(x-5,y),(x-1,y-1)], fill=rgb, outline="#303745")
        draw.point((x,y), fill="#343b48")
    elif profile == "ring":
        draw.rectangle((x,y,x+1,y+1), fill=rgb)
    else:
        draw.line([(x-2,y-1),(x+2,y-1)], fill=rgb, width=2)
    return output

for profile, definition in definitions.items():
    colors = SKINS if profile == "body" or profile.startswith("head-") else COLORS
    if profile.startswith("hair-") or profile.startswith("beard-"):
        colors = ["yellow", "black", "brown", "blue", "red", "white", "gray"]
    for body in ["male", "female"]:
        for color in colors:
            for eyes in EYES if profile.startswith("head-") else ["blue"]:
                layers = [pack(definition, layer, body, color, eyes) for key, layer in definition.items() if key.startswith("layer_")]
                layers = [layer for layer in layers if layer]
                if not layers:
                    raise ValueError(f"No artwork for {profile}/{body}")
                catalog[f"{profile}/{body}/{color}/{eyes}"] = layers
    for credit in definition.get("credits", []):
        licenses = credit["licenses"]
        chosen = next((v for prefix in ["CC0", "OGA-BY", "CC-BY ", "CC-BY-SA"] for v in licenses if v.startswith(prefix)), None)
        if not chosen:
            raise ValueError(f"No supported artwork license for {profile}: {licenses}")
        credits.append({"profile": profile, **credit, "chosenLicense": chosen})
    print(profile, flush=True)

# Empty source metadata is never silently published; compatibility comes from actual frames.
layouts, layout_ids = [], {}
for layers in catalog.values():
    for layer in [part for layer in layers for part in [layer, *([layer["travel"]] if "travel" in layer else [])]]:
        layout = {"cell": layer.pop("cell"), "columns": layer.pop("columns"), "clips": layer.pop("clips"), **({"trim": layer.pop("trim")} if "trim" in layer else {})}
        key = json.dumps(layout, sort_keys=True)
        if key not in layout_ids:
            layout_ids[key] = len(layouts)
            layouts.append(layout)
        layer["layout"] = layout_ids[key]
(OUT / "catalog.json").write_text(json.dumps({"revision": REVISION, "entries": catalog, "layouts": layouts}, separators=(",", ":")) + "\n")
(OUT / "credits.json").write_text(json.dumps(credits, indent=2, ensure_ascii=False) + "\n")
for path in OUT.glob("*.png"):
    if path.name not in generated:
        path.unlink()
print(f"Imported {len(generated)} unique atlases, {len(catalog)} selections")
