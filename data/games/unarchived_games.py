#!/usr/bin/env python3
"""
Выводит неархивированные игры из games.json,
исключая те, что перечислены в excluded.txt.

Использование:
    python unarchived_games.py
    python unarchived_games.py --games path/to/games.json
    python unarchived_games.py --games path/to/games.json --excluded path/to/excluded.txt
    python unarchived_games.py --output my_games.txt
"""

import argparse
import json
import sys
from pathlib import Path

# Пути считаются от корня репозитория — работает и на Linux, и на Windows-клоне.
REPO_ROOT = Path(__file__).resolve().parents[2]
STEAM_SCRIPTS = REPO_ROOT / "steam archiving scripts"

DEFAULT_GAMES = REPO_ROOT / "data" / "games" / "games.json"
DEFAULT_EXCLUDED = STEAM_SCRIPTS / "batches" / "excluded.txt"
DEFAULT_OUTPUT = STEAM_SCRIPTS / "batches" / "unarchived.txt"


def read_excluded(path: Path) -> set[str]:
    """Читает AppID из excluded.txt (формат: #Название / AppID)."""
    excluded = set()
    if not path.exists():
        print(f"[warn] excluded.txt не найден: {path}", file=sys.stderr)
        return excluded
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.isdigit():
                excluded.add(line)
    return excluded


def read_games(path: Path) -> dict:
    """Читает games.json."""
    if not path.exists():
        print(f"[error] games.json не найден: {path}", file=sys.stderr)
        sys.exit(1)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Список неархивированных Steam-игр (исключая excluded.txt)"
    )
    parser.add_argument("--games",    default=str(DEFAULT_GAMES),    help="Путь к games.json")
    parser.add_argument("--excluded", default=str(DEFAULT_EXCLUDED), help="Путь к excluded.txt")
    parser.add_argument("--output",   default=str(DEFAULT_OUTPUT),   help="Куда записать результат (по умолчанию stdout если '-')")
    parser.add_argument("--stdout",   action="store_true",            help="Вывести в stdout вместо файла")
    args = parser.parse_args()

    games    = read_games(Path(args.games))
    excluded = read_excluded(Path(args.excluded))

    unarchived = [
        game
        for game in games.values()
        if not game.get("isArchived", False)
        and game["appId"] not in excluded
        and game["source"] == "steam"
    ]

    # Сортировка по имени для удобства
    unarchived.sort(key=lambda g: g.get("name", "").lower())

    lines = []
    for game in unarchived:
        lines.append(f"#{game.get('name', '???')}")
        lines.append(game["appId"])
    output = "\n".join(lines) + "\n" if lines else ""

    if args.stdout:
        print(output, end="")
    else:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"Записано {len(unarchived)} игр → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
