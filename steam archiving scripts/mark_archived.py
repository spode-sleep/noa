#!/usr/bin/env python3
"""Пометка игр как заархивированных в games.json.

Принимает .txt файл с AppID (формат my_games.txt) и проставляет
isArchived: true и archivePath для каждой найденной игры.

Использование:
    python3 mark_archived.py installed.txt
    python3 mark_archived.py installed.txt --hdd ARCHIVE1
    python3 mark_archived.py installed.txt --games-json ../data/games/games.json
    python3 mark_archived.py installed.txt --rawg   # TODO: не реализовано
"""

import json
import sys
import os
import argparse

GAMES_JSON = os.path.join(os.path.dirname(__file__), "..", "data", "games", "games.json")


def parse_appid_file(path):
    """Читает файл AppID (формат my_games.txt): один AppID на строку, # — комментарии."""
    app_ids = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            app_ids.append(line)
    return app_ids


def main():
    parser = argparse.ArgumentParser(description="Пометка игр как заархивированных")
    parser.add_argument("appid_file", help="Файл с AppID (формат my_games.txt)")
    parser.add_argument("--games-json", default=GAMES_JSON, help="Путь к games.json")
    parser.add_argument("--hdd", default=None, help="Имя HDD (например ARCHIVE1 → /mnt/ARCHIVE1/steam/{appId})")
    parser.add_argument("--rawg", action="store_true", help="Обогащение данными из RAWG API (не реализовано)")
    args = parser.parse_args()

    if args.rawg:
        print("⚠ Опция --rawg пока не реализована")
        sys.exit(1)

    hdd_name = args.hdd
    if hdd_name is None:
        hdd_name = input("Имя HDD (например ARCHIVE1): ").strip()
    if not hdd_name:
        print("Ошибка: имя HDD не указано")
        sys.exit(1)

    app_ids = parse_appid_file(args.appid_file)
    if not app_ids:
        print(f"Нет AppID в файле: {args.appid_file}")
        sys.exit(1)

    with open(args.games_json, "r", encoding="utf-8") as f:
        games = json.load(f)

    marked = 0
    not_found = []
    for app_id in app_ids:
        if app_id in games:
            games[app_id]["isArchived"] = True
            games[app_id]["archivePath"] = f"/mnt/{hdd_name}/steam/{app_id}"
            marked += 1
        else:
            not_found.append(app_id)

    with open(args.games_json, "w", encoding="utf-8") as f:
        json.dump(games, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"✓ Помечено как заархивированные: {marked}/{len(app_ids)}")
    print(f"  Путь: /mnt/{hdd_name}/steam/{{appId}}")
    if not_found:
        print(f"⚠ Не найдены в games.json ({len(not_found)}):")
        for nf in not_found:
            print(f"  {nf}")


if __name__ == "__main__":
    main()
