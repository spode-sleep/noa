#!/usr/bin/env python3
"""Пометка игр как заархивированных на основе with_paths.txt.

Читает файл формата:
  #Game Name
  1234567
    -> /mnt/ARCHIVE1/steam/1234567

И проставляет isArchived: true + archivePath для игр, у которых есть путь.
Игры с "-> NOT FOUND" пропускаются.

Использование:
    python3 mark_from_paths.py with_paths.txt
    python3 mark_from_paths.py with_paths.txt --games-json ../data/games/games.json
"""

import json
import sys
import os
import argparse

GAMES_JSON = os.path.join(os.path.dirname(__file__), "games.json")


def parse_with_paths(path):
    """Парсит with_paths.txt, возвращает список (app_id, archive_path | None)."""
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()

    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("#") and i + 1 < len(lines):
            app_id = lines[i + 1].strip()
            paths = []
            j = i + 2
            while j < len(lines) and lines[j].startswith("  ->"):
                p = lines[j].strip()[3:].strip()  # убираем "->"
                if p != "NOT FOUND":
                    paths.append(p)
                j += 1
            entries.append((app_id, paths[0] if paths else None))
            i = j
        else:
            i += 1

    return entries


def main():
    parser = argparse.ArgumentParser(description="Пометка игр из with_paths.txt как заархивированных")
    parser.add_argument("paths_file", help="Файл with_paths.txt")
    parser.add_argument("--games-json", default=GAMES_JSON, help="Путь к games.json")
    args = parser.parse_args()

    entries = parse_with_paths(args.paths_file)
    if not entries:
        print("Нет записей в файле.")
        sys.exit(1)

    with open(args.games_json, "r", encoding="utf-8") as f:
        games = json.load(f)

    marked = 0
    skipped_no_path = []
    not_found_in_json = []

    for app_id, archive_path in entries:
        if archive_path is None:
            skipped_no_path.append(app_id)
            continue
        if app_id not in games:
            not_found_in_json.append(app_id)
            continue
        games[app_id]["isArchived"] = True
        games[app_id]["archivePath"] = archive_path
        marked += 1

    with open(args.games_json, "w", encoding="utf-8") as f:
        json.dump(games, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"✓ Помечено как заархивированные: {marked}")
    if skipped_no_path:
        print(f"⚠ Пропущено (NOT FOUND на флешках): {len(skipped_no_path)}")
        for a in skipped_no_path:
            print(f"  {a}")
    if not_found_in_json:
        print(f"⚠ Не найдены в games.json: {len(not_found_in_json)}")
        for a in not_found_in_json:
            print(f"  {a}")


if __name__ == "__main__":
    main()
