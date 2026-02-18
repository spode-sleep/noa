#!/usr/bin/env python3
"""Инициализация полей архивации в games.json.

Добавляет isArchived (false) и archivePath ("") ко всем играм,
у которых этих полей ещё нет. Безопасно запускать повторно.
"""

import json
import sys
import os

GAMES_JSON = os.path.join(os.path.dirname(__file__), "..", "data", "games", "games.json")


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else GAMES_JSON

    with open(path, "r", encoding="utf-8") as f:
        games = json.load(f)

    added = 0
    for app_id, game in games.items():
        changed = False
        if "isArchived" not in game:
            game["isArchived"] = False
            changed = True
        if "archivePath" not in game:
            game["archivePath"] = ""
            changed = True
        if changed:
            added += 1

    with open(path, "w", encoding="utf-8") as f:
        json.dump(games, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Готово: {added} игр обновлено из {len(games)}")


if __name__ == "__main__":
    main()
