#!/usr/bin/env python3
"""
check_archive_paths.py

Verifies that archived games in games.json exist at their described archivePath.
If a game is not found at the listed path, checks other drives (ARCHIVE1..4)
and updates the path if found, or warns if not found anywhere.

Linux only: archivePath in games.json is always /mnt/ARCHIVEx/... — on Windows
nothing resolves and every game looks missing.

IMPORTANT: run this only with ALL archive drives connected. If a drive is not
mounted the script would consider its games missing and rewrite good paths, so
it refuses to start unless every drive in DRIVES is mounted and non-empty
(--force overrides, e.g. when a drive is retired).

Usage:
    python3 check_archive_paths.py [games.json] [--force]
"""

import json
import os
import sys
from pathlib import Path

GAMES_JSON_PATH = str(Path(__file__).resolve().parent / "games.json")
DRIVES = ["ARCHIVE1", "ARCHIVE2", "ARCHIVE3", "ARCHIVE4"]


def get_drive_from_path(path: str) -> str | None:
    """Extract the drive name from a path like /mnt/ARCHIVE1/..."""
    parts = Path(path).parts
    if len(parts) >= 3 and parts[1] == "mnt":
        return parts[2]
    return None


def get_relative_subpath(path: str) -> str:
    """
    Extract the part of the path after the drive name.
    e.g. /mnt/ARCHIVE1/steam/3566150 -> steam/3566150
    """
    parts = Path(path).parts
    # parts[0] = '/', parts[1] = 'mnt', parts[2] = 'ARCHIVEX', rest = subpath
    if len(parts) > 3:
        return str(Path(*parts[3:]))
    return ""


def build_path(drive: str, subpath: str) -> str:
    """Build a full path for a given drive and subpath."""
    return str(Path("/mnt") / drive / subpath)


def check_drives_mounted() -> list[str]:
    """Returns the drives that are missing, unmounted, or empty."""
    problems = []
    for drive in DRIVES:
        mount = Path("/mnt") / drive
        if not mount.is_dir():
            problems.append(f"{mount} — нет точки монтирования")
        elif not any(mount.iterdir()):
            problems.append(f"{mount} — пусто (диск не примонтирован?)")
    return problems


def check_and_fix_paths(games_json_path: str) -> None:
    # Load games.json
    with open(games_json_path, "r", encoding="utf-8") as f:
        games = json.load(f)

    changed = 0
    not_found = 0
    ok = 0

    for app_id, game in games.items():
        # Only process archived games with an archivePath
        if not game.get("isArchived"):
            continue
        archive_path = game.get("archivePath")
        if not archive_path:
            continue

        # Case 1: Path exists — nothing to do
        if os.path.isdir(archive_path):
            ok += 1
            continue

        # Case 2: Path does not exist — search other drives
        game_name = game.get("name", app_id)
        current_drive = get_drive_from_path(archive_path)
        subpath = get_relative_subpath(archive_path)

        found_on_drive = None
        for drive in DRIVES:
            if drive == current_drive:
                continue  # Already checked this one (it failed)
            candidate = build_path(drive, subpath)
            if os.path.isdir(candidate):
                found_on_drive = (drive, candidate)
                break

        if found_on_drive:
            new_drive, new_path = found_on_drive
            print(
                f"[MOVED]   '{game_name}' (appId: {app_id})\n"
                f"          {archive_path}\n"
                f"       -> {new_path}"
            )
            game["archivePath"] = new_path
            changed += 1
        else:
            print(
                f"[WARNING] '{game_name}' (appId: {app_id}) not found on any drive.\n"
                f"          Expected path: {archive_path}"
            )
            not_found += 1

    # Write updated games.json back if anything changed
    if changed > 0:
        with open(games_json_path, "w", encoding="utf-8") as f:
            json.dump(games, f, indent=2, ensure_ascii=False)
        print(f"\ngames.json updated ({changed} path(s) fixed).")

    # Summary
    total_archived = ok + changed + not_found
    print(
        f"\n--- Summary ---\n"
        f"  Archived games checked : {total_archived}\n"
        f"  Paths OK               : {ok}\n"
        f"  Paths fixed            : {changed}\n"
        f"  Not found anywhere     : {not_found}"
    )

    if not_found > 0:
        sys.exit(1)  # Non-zero exit so CI/scripts can detect missing games


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--force"]
    force = "--force" in sys.argv[1:]

    json_path = args[0] if args else GAMES_JSON_PATH
    if not os.path.isfile(json_path):
        print(f"Error: '{json_path}' not found.")
        sys.exit(2)

    problems = check_drives_mounted()
    if problems:
        print("Не все архивные диски доступны — пути будут переписаны неверно:")
        for problem in problems:
            print(f"  {problem}")
        if not force:
            print("\nПодключите диски и повторите (или запустите с --force).")
            sys.exit(2)
        print("\n--force: продолжаю несмотря на недоступные диски.")

    check_and_fix_paths(json_path)
