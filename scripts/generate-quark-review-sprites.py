import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "character-remaster" / "quark-source"
SET = "theseus_quark_review"
DESTINATIONS = [
    ROOT / "frontend" / "assets" / "sprites",
    ROOT / "website" / "app" / "assets" / "sprites",
]
DIRECTIONS = ["south", "south-east", "east", "north-east",
              "north", "north-west", "west", "south-west"]
CARDINAL = ["south", "east", "north", "west"]


def source_frame(relative_path):
    return Image.open(SOURCE / relative_path).convert("RGBA")


def normalize(image, scale):
    bounds = image.getbbox()
    if not bounds:
        raise ValueError(f"Empty sprite frame: {image}")
    image = image.crop(bounds)
    size = (round(image.width * scale), round(image.height * scale))
    image = image.resize(size, Image.Resampling.NEAREST)
    result = Image.new("RGBA", (144, 144))
    result.alpha_composite(image, ((144 - size[0]) // 2, 111 - size[1]))
    return result


def main():
    standing = source_frame("Idle/rotations/south.png")
    height = standing.getbbox()[3] - standing.getbbox()[1]
    scale = 76 / height
    frames = {}
    tracks = {}

    def add(track, name, image):
        frames[name] = image
        tracks.setdefault(f"{SET}.{track}", []).append(f"{SET}/{name}")

    for direction in DIRECTIONS:
        add(f"rot.{direction}", f"rot_{direction}.png",
            normalize(source_frame(f"Idle/rotations/{direction}.png"), scale))
        for index in range(6):
            image = source_frame(f"Idle/animations/walking/{direction}/frame_{index:03}.png")
            add(f"walk.{direction}", f"walk_{direction}_{index}.png", normalize(image, scale))
    for direction in CARDINAL:
        add(f"sit.{direction}", f"sit_{direction}.png",
            normalize(source_frame(f"Seated/rotations/{direction}.png"), scale))
    for index in range(4):
        image = source_frame(
            f"Seated/animations/Seated_north-facing_Treasurer/north/frame_{index:03}.png")
        add("type.north", f"type_north_{index}.png", normalize(image, scale))

    for destination in DESTINATIONS:
        folder = destination / SET
        folder.mkdir(exist_ok=True)
        for name, image in frames.items():
            image.save(folder / name)
        manifest_path = destination / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["sprites"].update(tracks)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"Generated {len(frames)} Treasurer review frames across {len(tracks)} tracks.")


if __name__ == "__main__":
    main()
