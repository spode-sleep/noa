#!/usr/bin/env python3
"""Пометка rawg-игр как заархивированных в games.json.

В отличие от steam-версии, здесь поиск идёт по имени игры (name),
а не по ключу (AppID). Работает только с играми source == "rawg".

Имена в файле могут быть неточными (взяты из games.json → name),
поэтому скрипт сначала пробует точное совпадение, затем — нечёткое
(case-insensitive, без спецсимволов).

Использование:
    python mark_archived.py installed.txt
    python mark_archived.py installed.txt --hdd ARCHIVE1
    python mark_archived.py installed.txt --games-json ../data/games/games.json
"""

import json
import sys
import os
import re
import argparse

GAMES_JSON = os.path.join(os.path.dirname(__file__), "..", "data", "games", "games.json")


def normalize(name):
    """Убирает спецсимволы и приводит к нижнему регистру для нечёткого сравнения."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def parse_names_file(path):
    """Читает файл с именами игр.

    Поддерживает два формата:
    - простой: одно имя на строку
    - табулированный: name<TAB>service<TAB>folder_id (из installed.txt)

    Возвращает список кортежей (name, folder_id или None).
    """
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            name = parts[0].strip()
            folder_id = parts[2].strip() if len(parts) >= 3 else None
            entries.append((name, folder_id))
    return entries


def find_rawg_game(games, name):
    """Ищет rawg-игру по имени: сначала точное совпадение, потом нечёткое.

    Возвращает (key, game_dict) или (None, None).
    """
    norm_name = normalize(name)

    # Точное совпадение
    for key, game in games.items():
        if game.get("source") != "rawg":
            continue
        if game.get("name") == name:
            return key, game

    # Нечёткое совпадение
    for key, game in games.items():
        if game.get("source") != "rawg":
            continue
        if normalize(game.get("name", "")) == norm_name:
            return key, game

    return None, None


def main():
    parser = argparse.ArgumentParser(description="Пометка rawg-игр как заархивированных")
    parser.add_argument("names_file", help="Файл с именами игр (одно на строку)")
    parser.add_argument("--games-json", default=GAMES_JSON, help="Путь к games.json")
    parser.add_argument(
        "--hdd", default=None,
        help="Имя HDD (например ARCHIVE1 → /mnt/ARCHIVE1/rawg/{name})",
    )
    args = parser.parse_args()

    hdd_name = args.hdd
    if hdd_name is None:
        hdd_name = input("Имя HDD (например ARCHIVE1): ").strip()
    if not hdd_name:
        print("Ошибка: имя HDD не указано")
        sys.exit(1)

    entries = parse_names_file(args.names_file)
    if not entries:
        print(f"Нет имён игр в файле: {args.names_file}")
        sys.exit(1)

    with open(args.games_json, "r", encoding="utf-8") as f:
        games = json.load(f)

    marked = 0
    not_found = []
    fuzzy_matched = []

    for name, folder_id in entries:
        key, game = find_rawg_game(games, name)
        if key is not None:
            # Папка на HDD: folder_id из installed.txt, или ключ games.json
            folder = folder_id if folder_id else key
            games[key]["isArchived"] = True
            games[key]["archivePath"] = f"/mnt/{hdd_name}/rawg/{folder}"
            marked += 1

            if game["name"] != name:
                fuzzy_matched.append((name, game["name"]))
        else:
            not_found.append(name)

    with open(args.games_json, "w", encoding="utf-8") as f:
        json.dump(games, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"✓ Помечено как заархивированные: {marked}/{len(entries)}")
    print(f"  Путь: /mnt/{hdd_name}/rawg/{{key}}")

    if fuzzy_matched:
        print(f"\n⚠ Нечёткие совпадения ({len(fuzzy_matched)}):")
        for original, found in fuzzy_matched:
            print(f"  «{original}» → «{found}»")

    if not_found:
        print(f"\n✗ Не найдены в games.json (rawg) ({len(not_found)}):")
        for nf in not_found:
            print(f"  {nf}")


if __name__ == "__main__":
    main()
