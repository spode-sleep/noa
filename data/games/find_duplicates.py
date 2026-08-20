import json
import os
from collections import defaultdict
from pathlib import Path


def archive_mounts(defaults: list[str]) -> list[str]:
    """Корни архивных дисков: ARCHIVE_MOUNTS (через ';' или ',') или defaults."""
    raw = os.environ.get("ARCHIVE_MOUNTS", "").strip()
    if not raw:
        return defaults
    return [m.strip() for m in raw.replace(",", ";").split(";") if m.strip()]


GAMES_JSON_PATH = str(Path(__file__).resolve().parent / "games.json")

# Корни архивных дисков. На Windows задайте ARCHIVE_MOUNTS, например:
#   set ARCHIVE_MOUNTS=E:\;F:\
DEFAULT_USB_MOUNTS = [
    "/mnt/ARCHIVE1",
    "/mnt/ARCHIVE2",
    "/mnt/ARCHIVE3",
    "/mnt/ARCHIVE4",
]
USB_MOUNTS = archive_mounts(DEFAULT_USB_MOUNTS)

def find_duplicates(games_json_path: str) -> None:
    with open(games_json_path, "r", encoding="utf-8") as f:
        games: dict = json.load(f)

    # Собираем только архивированные игры для справки по именам
    archived_games = {
        app_id: game
        for app_id, game in games.items()
        if game.get("isArchived")
    }

    # Сканируем флешки: { app_id: [путь1, путь2, ...] }
    found: dict[str, list[str]] = defaultdict(list)

    for mount in USB_MOUNTS:
        if not os.path.isdir(mount):
            print(f"[!] Флешка не найдена или не примонтирована: {mount}")
            continue

        # Проходим по всем подпапкам на флешке (steam/, gog/, и т.д.)
        for source_dir in os.scandir(mount):
            if not source_dir.is_dir():
                continue

            for entry in os.scandir(source_dir.path):
                if entry.is_dir():
                    app_id = entry.name
                    found[app_id].append(entry.path)

    # Фильтруем только дубли (папка встречается на 2+ флешках)
    duplicates = {
        app_id: paths
        for app_id, paths in found.items()
        if len(paths) > 1
    }

    if not duplicates:
        print("Дублей не найдено.")
        return

    print(f"Найдено игр с дублями: {len(duplicates)}\n")
    print("=" * 60)

    for app_id, paths in sorted(duplicates.items(), key=lambda x: x[0]):
        game = archived_games.get(app_id)
        name = game["name"] if game else "(не найдено в games.json)"
        print(f"Игра:  {name} (appId: {app_id})")
        for path in paths:
            print(f"  → {path}")
        print()


if __name__ == "__main__":
    find_duplicates(GAMES_JSON_PATH)
