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

def read_entries(path):
    """Читает файл батча: строка-комментарий с названием + строка с AppID.

    Устойчиво к шапке файла, пустым строкам и закомментированным AppID
    (`#1165870` — уже скачанные): названием считается последний комментарий
    перед числовой строкой, всё остальное игнорируется.
    """
    entries = []
    name = None
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith("#"):
                name = line
                continue
            if line.isdigit():
                entries.append((name or "#(без названия)", line))
                name = None
    return entries


def game_exists_on_drives(app_id):
    return any(os.path.isdir(os.path.join(drive, app_id)) for drive in DRIVES)

def main():
    if len(sys.argv) < 2:
        print("Использование: python filter.py <input.txt>")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = "filtered.txt"

    entries = read_entries(input_path)

    filtered = [(name, app_id) for name, app_id in entries if not game_exists_on_drives(app_id)]

    with open(output_path, "w", encoding="utf-8") as f:
        for name, app_id in filtered:
            f.write(f"{name}\n{app_id}\n")

    print(f"Всего игр: {len(entries)}")
    print(f"Уже на флешках: {len(entries) - len(filtered)}")
    print(f"Осталось (записано в {output_path}): {len(filtered)}")

if __name__ == "__main__":
    main()
