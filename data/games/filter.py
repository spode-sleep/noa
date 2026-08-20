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

def game_exists_on_drives(app_id):
    return any(os.path.isdir(os.path.join(drive, app_id)) for drive in DRIVES)

def main():
    if len(sys.argv) < 2:
        print("Использование: python filter.py <input.txt>")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = "filtered.txt"

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

    filtered = [(name, app_id) for name, app_id in entries if not game_exists_on_drives(app_id)]

    with open(output_path, "w", encoding="utf-8") as f:
        for name, app_id in filtered:
            f.write(f"{name}\n{app_id}\n")

    print(f"Всего игр: {len(entries)}")
    print(f"Уже на флешках: {len(entries) - len(filtered)}")
    print(f"Осталось (записано в {output_path}): {len(filtered)}")

if __name__ == "__main__":
    main()
