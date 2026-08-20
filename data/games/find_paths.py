import os
import sys

# Корни архивных дисков. На Windows задайте ARCHIVE_MOUNTS, например:
#   set ARCHIVE_MOUNTS=E:\;F:\
DEFAULT_MOUNTS = [
    "/mnt/ARCHIVE1",
    "/mnt/ARCHIVE2",
    "/mnt/ARCHIVE3",
    "/mnt/ARCHIVE4",
]


def archive_mounts(defaults):
    """Корни архивных дисков: ARCHIVE_MOUNTS (через ';' или ',') или defaults."""
    raw = os.environ.get("ARCHIVE_MOUNTS", "").strip()
    if not raw:
        return defaults
    return [m.strip() for m in raw.replace(",", ";").split(";") if m.strip()]


DRIVES = [os.path.join(mount, "steam") for mount in archive_mounts(DEFAULT_MOUNTS)]

def find_game_paths(app_id):
    return [
        os.path.join(drive, app_id)
        for drive in DRIVES
        if os.path.isdir(os.path.join(drive, app_id))
    ]

def main():
    if len(sys.argv) < 2:
        print("Использование: python3 find_paths.py <input.txt>")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = "with_paths.txt"

    with open(input_path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()

    entries = []
    i = 0
    while i < len(lines):
        if lines[i].startswith("#") and i + 1 < len(lines):
            name = lines[i]
            app_id = lines[i + 1].strip()
            entries.append((name, app_id))
            i += 2
        else:
            i += 1

    with open(output_path, "w", encoding="utf-8") as f:
        for name, app_id in entries:
            paths = find_game_paths(app_id)
            f.write(f"{name}\n{app_id}\n")
            if paths:
                for p in paths:
                    f.write(f"  -> {p}\n")
            else:
                f.write(f"  -> NOT FOUND\n")

    print(f"Обработано игр: {len(entries)}")
    print(f"Результат записан в {output_path}")

if __name__ == "__main__":
    main()
