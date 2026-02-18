#!/usr/bin/env python3
"""
Убийство зависших процессов DepotDownloader (Windows).

Аналог kill_stuck.sh для Windows.

Использование:
    python kill_stuck.py
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path


def find_processes(name: str) -> list[tuple[int, str]]:
    """Поиск процессов по имени (Windows tasklist)."""
    results = []
    try:
        output = subprocess.check_output(
            ["tasklist", "/FI", f"IMAGENAME eq {name}", "/FO", "CSV", "/NH"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        for line in output.strip().splitlines():
            parts = line.strip('"').split('","')
            if len(parts) >= 2 and parts[0].lower() != "info:":
                try:
                    pid = int(parts[1])
                    results.append((pid, parts[0]))
                except (ValueError, IndexError):
                    pass
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    return results


def kill_process(pid: int) -> bool:
    """Убить процесс по PID."""
    try:
        subprocess.run(
            ["taskkill", "/F", "/PID", str(pid)],
            capture_output=True,
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def main() -> None:
    print("════════════════════════════════════════")
    print("Остановка процессов загрузки")
    print("════════════════════════════════════════")
    print()

    # Ищем процессы
    processes = []
    for name in ["DepotDownloader.exe", "steamcmd.exe"]:
        processes.extend(find_processes(name))

    if not processes:
        print("✓ Процессов загрузки не найдено")
    else:
        print("Найдены процессы:")
        for pid, name in processes:
            print(f"  PID {pid}: {name}")
        print()

        answer = input("Убить все процессы? (y/n): ").strip().lower()
        if answer == "y":
            print()
            print("Убиваем процессы...")
            for pid, name in processes:
                if kill_process(pid):
                    print(f"  ✓ PID {pid} ({name}) убит")
                else:
                    print(f"  ✗ PID {pid} ({name}) не удалось убить")
            print()
            print("✓ Готово")
        else:
            print("Отменено")
            sys.exit(0)

    print()
    print("════════════════════════════════════════")
    print("Проверка частично установленных игр")
    print("════════════════════════════════════════")
    print()

    # Проверяем возможные пути
    check_dirs = [
        Path.home() / "steam_downloads",
        Path("D:/steam"),
        Path("E:/steam"),
    ]

    for steam_dir in check_dirs:
        if not steam_dir.exists():
            continue

        print(f"Проверка: {steam_dir}")
        small_dirs = []

        for entry in steam_dir.iterdir():
            if entry.is_dir() and entry.name.isdigit():
                # Размер в MB
                size_mb = sum(
                    f.stat().st_size for f in entry.rglob("*") if f.is_file()
                ) / 1_048_576
                if size_mb < 100:
                    small_dirs.append((entry, size_mb))

        if not small_dirs:
            print("  ✓ Подозрительных директорий не найдено")
        else:
            print("  Маленькие директории (< 100MB):")
            for d, size in small_dirs:
                print(f"    {d} ({size:.0f}MB)")
            print()

            answer = input("  Удалить их? (y/n): ").strip().lower()
            if answer == "y":
                for d, _ in small_dirs:
                    print(f"    Удаление {d}...")
                    shutil.rmtree(d, ignore_errors=True)
                print("  ✓ Очищено")
        print()

    print("════════════════════════════════════════")
    print("Готово!")
    print("════════════════════════════════════════")


if __name__ == "__main__":
    main()
