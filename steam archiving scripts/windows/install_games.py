#!/usr/bin/env python3
"""
Steam Library Archiver — Windows version (Python3)

Скачивает игры через DepotDownloader, копирует на HDD (NTFS),
удаляет локальную копию после верификации.

Аналог install_games.sh, но для Windows с нативным копированием
(robocopy) которое стабильно работает с NTFS HDD.

Использование:
    python install_games.py my_games.txt
    python install_games.py my_games.txt D:/steam
    python install_games.py my_games.txt "E:/Archive/steam"
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

# ═══════════════════════════ Настройки ═══════════════════════════

GAME_LANG = "russian"
GAME_OS = "linux"
MIN_GAME_SIZE_BYTES = 1_048_576  # 1MB — меньше = подозрительно

# DepotDownloader — по умолчанию ищем рядом со скриптом или в домашней папке
DEFAULT_DD_PATHS = [
    Path.home() / "depotdownloader" / "DepotDownloader.exe",
    Path(__file__).parent / "DepotDownloader.exe",
    Path.home() / "depotdownloader" / "depotdownloader.exe",
]

# Локальная папка для загрузки (диск D:)
LOCAL_DOWNLOAD_DIR = Path("D:/steam_downloads")

# ═══════════════════════════ Цвета ═══════════════════════════

# Windows 10+ поддерживает ANSI коды в cmd/PowerShell
G = "\033[0;32m"
R = "\033[0;31m"
Y = "\033[1;33m"
NC = "\033[0m"


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{G}[{ts}]{NC} {msg}")


def err(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{R}[{ts}]{NC} {msg}")


def warn(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{Y}[{ts}]{NC} {msg}")


# ═══════════════════════════ Утилиты ═══════════════════════════


def dir_size_bytes(path: Path) -> int:
    """Рекурсивный размер директории в байтах."""
    total = 0
    for entry in path.rglob("*"):
        if entry.is_file():
            total += entry.stat().st_size
    return total


def dir_size_human(size_bytes: int) -> str:
    """Человекочитаемый размер."""
    if size_bytes >= 1_073_741_824:
        return f"{size_bytes / 1_073_741_824:.1f}G"
    if size_bytes >= 1_048_576:
        return f"{size_bytes / 1_048_576:.1f}M"
    if size_bytes >= 1024:
        return f"{size_bytes / 1024:.1f}K"
    return f"{size_bytes}B"


def has_any_files(path: Path) -> bool:
    """Проверка наличия хотя бы одного файла."""
    try:
        return any(f.is_file() for f in path.rglob("*"))
    except OSError:
        return False


def find_depot_downloader() -> Path | None:
    """Поиск DepotDownloader."""
    for p in DEFAULT_DD_PATHS:
        if p.exists():
            return p
    # Проверяем PATH
    dd = shutil.which("DepotDownloader") or shutil.which("DepotDownloader.exe")
    if dd:
        return Path(dd)
    return None


def read_appids(filepath: str) -> list[str]:
    """Чтение AppID из файла (формат: один на строку, # — комментарии)."""
    appids = []
    with open(filepath, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # Может содержать несколько AppID через пробел
            for token in line.split():
                token = token.strip()
                if token.isdigit():
                    appids.append(token)
    return appids


def copy_with_robocopy(src: Path, dst: Path) -> bool:
    """Копирование через robocopy (Windows) с отображением прогресса.

    robocopy стабильнее shutil для больших файлов на NTFS HDD.
    Возвращает True при успехе.
    """
    # robocopy возвращает битовую маску, где < 8 = успех
    try:
        result = subprocess.run(
            [
                "robocopy",
                str(src),
                str(dst),
                "/E",        # Рекурсивно с пустыми папками
                "/NP",       # Без процента для отдельных файлов
                "/NFL",      # Без списка файлов
                "/NDL",      # Без списка директорий
                "/NJH",      # Без заголовка
                "/NJS",      # Без итогов
                "/R:3",      # 3 попытки при ошибке
                "/W:5",      # 5 секунд между попытками
                "/MT:4",     # 4 потока копирования
            ],
            capture_output=True,
            text=True,
        )
        # robocopy exit codes: 0-7 = success, >= 8 = error
        return result.returncode < 8
    except FileNotFoundError:
        # robocopy недоступен — используем shutil
        return copy_with_shutil(src, dst)


def copy_with_shutil(src: Path, dst: Path) -> bool:
    """Копирование через shutil (fallback если нет robocopy)."""
    try:
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
        return True
    except (OSError, shutil.Error) as e:
        err(f"Ошибка копирования: {e}")
        return False


def copy_to_hdd(src: Path, dst: Path) -> bool:
    """Копирование на HDD — robocopy на Windows, shutil как fallback."""
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True, exist_ok=True)

    if os.name == "nt":
        return copy_with_robocopy(src, dst)
    return copy_with_shutil(src, dst)


def run_depot_downloader(
    dd_path: Path,
    appid: str,
    username: str,
    out_dir: Path,
    language: str | None = None,
    game_os: str | None = None,
    all_platforms: bool = False,
    log_file: Path | None = None,
) -> tuple[bool, bool]:
    """Запуск DepotDownloader.

    Возвращает (download_ok, no_depots).
    """
    cmd = [
        str(dd_path),
        "-app", appid,
        "-username", username,
        "-remember-password",
        "-dir", str(out_dir),
    ]

    if all_platforms:
        cmd.append("-all-platforms")
    else:
        if language:
            cmd.extend(["-language", language])
        if game_os:
            cmd.extend(["-os", game_os])

    no_depots = False
    output_lines: list[str] = []

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        assert proc.stdout is not None
        for line in proc.stdout:
            line_stripped = line.rstrip()
            output_lines.append(line_stripped)

            # Лог
            if log_file:
                with open(log_file, "a", encoding="utf-8") as lf:
                    lf.write(line)

            # Показываем только процент
            m = re.search(r"(\d+(?:\.\d+)?%)", line_stripped)
            if m:
                print(f"\r\033[K  {m.group(1)}", end="", flush=True)

            if "Couldn't find any depots" in line_stripped:
                no_depots = True

        proc.wait()
        print()  # Новая строка после прогресса

    except Exception as e:
        err(f"Ошибка запуска DepotDownloader: {e}")
        return False, False

    return not no_depots, no_depots


# ═══════════════════════════ Main ═══════════════════════════


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Steam Library Archiver (Windows/Python3)"
    )
    parser.add_argument("appid_file", help="Файл с AppID (один на строку)")
    parser.add_argument(
        "install_dir",
        nargs="?",
        default="D:\\steam",
        help="Директория на HDD (по умолчанию: D:\\steam)",
    )
    parser.add_argument(
        "--dd",
        help="Путь к DepotDownloader.exe",
    )
    args = parser.parse_args()

    # Включаем ANSI escape коды на Windows
    if os.name == "nt":
        os.system("")

    # Поиск DepotDownloader
    if args.dd:
        dd_path = Path(args.dd)
    else:
        dd_path = find_depot_downloader()

    if not dd_path or not dd_path.exists():
        err("DepotDownloader не найден!")
        print()
        print("Установка:")
        print("  1. Скачайте https://github.com/SteamRE/DepotDownloader/releases")
        print("  2. Распакуйте в ~/depotdownloader/")
        print("  3. Или укажите путь: python install_games.py games.txt --dd путь/к/DepotDownloader.exe")
        sys.exit(1)

    # Чтение AppID
    if not os.path.isfile(args.appid_file):
        err(f"Файл не найден: {args.appid_file}")
        sys.exit(1)

    appids = read_appids(args.appid_file)
    if not appids:
        err("Нет AppID!")
        sys.exit(1)

    install_dir = Path(args.install_dir)
    install_dir.mkdir(parents=True, exist_ok=True)
    LOCAL_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    total = len(appids)

    log("════════════════════════════════════════════")
    log(f"Установка {total} игр (DepotDownloader)")
    log(f"Локальная папка: {LOCAL_DOWNLOAD_DIR}")
    log(f"HDD директория: {install_dir}")
    log("Схема: скачать → скопировать на HDD → удалить локально")
    log("════════════════════════════════════════════")
    print()

    username = input("Логин Steam: ").strip()
    print()

    # Авторизация
    log("Авторизация...")
    subprocess.run(
        [
            str(dd_path),
            "-app", "730",
            "-depot", "731",
            "-manifest-only",
            "-username", username,
            "-remember-password",
        ],
    )
    print()
    log("✓ Авторизация завершена")
    print()

    # Результаты
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_dir = Path("results") / ts
    results_dir.mkdir(parents=True, exist_ok=True)

    log_file = results_dir / "install.log"
    success_file = results_dir / "installed.txt"
    failed_file = results_dir / "failed.txt"
    warnings_file = results_dir / "warnings.txt"

    for f in [success_file, failed_file, warnings_file]:
        f.touch()

    ok = 0
    fail = 0
    warn_count = 0
    failed_appids: list[str] = []
    warned_appids: list[str] = []

    local_dir: Path | None = None

    try:
        for i, appid in enumerate(appids):
            local_dir = LOCAL_DOWNLOAD_DIR / appid
            hdd_dir = install_dir / appid

            log("════════════════════════════════════════════")
            log(f"[{i + 1}/{total}] AppID: {appid}")
            log("════════════════════════════════════════════")

            # Проверка HDD
            if not install_dir.exists():
                err(f"HDD недоступен: {install_dir}")
                failed_appids.append(appid)
                fail += 1
                continue

            # Очистка локальной папки
            if local_dir.exists():
                shutil.rmtree(local_dir)
            local_dir.mkdir(parents=True)

            print()
            log(f"Скачиваем в: {local_dir}")

            # Скачивание с фоллбэком по языку/ОС
            download_ok = False
            tried: set[str] = set()

            for try_lang in [GAME_LANG, "english"]:
                for try_os in [GAME_OS, "windows"]:
                    key = f"{try_os}:{try_lang}"
                    if key in tried:
                        continue
                    tried.add(key)

                    log(f"Платформа: {try_os}, язык: {try_lang}")

                    success, no_depots = run_depot_downloader(
                        dd_path, appid, username, local_dir,
                        language=try_lang, game_os=try_os,
                        log_file=log_file,
                    )

                    if no_depots:
                        warn(f"Нет депотов для {try_os}/{try_lang}")
                        if local_dir.exists():
                            shutil.rmtree(local_dir)
                        local_dir.mkdir(parents=True)
                        continue

                    download_ok = True
                    break
                if download_ok:
                    break

            # 5-й вариант: все платформы, без языка
            if not download_ok:
                warn("Все комбинации ОС/язык не дали результата")
                log("Попытка: все платформы, без языкового фильтра")

                success, no_depots = run_depot_downloader(
                    dd_path, appid, username, local_dir,
                    all_platforms=True,
                    log_file=log_file,
                )
                if not no_depots:
                    download_ok = True
                else:
                    warn("Нет депотов даже без фильтров")

            print()

            # Проверка скачанного
            if local_dir.exists() and has_any_files(local_dir):
                local_bytes = dir_size_bytes(local_dir)
                size_str = dir_size_human(local_bytes)
                log(f"✓ Скачано локально: {size_str}")

                # Копирование на HDD
                log(f"Копирование на HDD: {hdd_dir} ...")

                if copy_to_hdd(local_dir, hdd_dir):
                    # Верификация
                    hdd_bytes = dir_size_bytes(hdd_dir)

                    if local_bytes == hdd_bytes:
                        log(f"✓ Скопировано на HDD (верифицировано: {size_str})")

                        shutil.rmtree(local_dir)
                        log("✓ Локальная копия удалена")

                        with open(success_file, "a", encoding="utf-8") as f:
                            f.write(f"{appid}\n")
                        ok += 1

                        # Предупреждение о маленьких играх
                        if local_bytes < MIN_GAME_SIZE_BYTES:
                            warn(f"⚠ AppID {appid} очень маленький ({size_str}) — возможно только метаданные")
                            warned_appids.append(appid)
                            warn_count += 1
                    else:
                        err(f"✗ Ошибка верификации! Локально: {local_bytes}B, HDD: {hdd_bytes}B")
                        err(f"Локальная копия сохранена: {local_dir}")
                        failed_appids.append(appid)
                        fail += 1
                else:
                    err("✗ Ошибка копирования на HDD")
                    failed_appids.append(appid)
                    fail += 1
            else:
                err("✗ Не скачан (нет файлов)")
                failed_appids.append(appid)
                fail += 1
                if local_dir.exists():
                    shutil.rmtree(local_dir)

            print()
            log("Пауза 3 сек...")
            time.sleep(3)
            print()

    except KeyboardInterrupt:
        print()
        warn("Прерывание! (Ctrl+C)")
        # Очистка текущей локальной папки
        if local_dir is not None and local_dir.exists():
            warn(f"Удаление частичной загрузки: {local_dir}")
            shutil.rmtree(local_dir, ignore_errors=True)

    # Удаление локальной папки если пуста
    try:
        LOCAL_DOWNLOAD_DIR.rmdir()
    except OSError:
        pass

    # Запись итогов
    with open(success_file, "a", encoding="utf-8") as f:
        f.write(f"# OK: {ok}/{total}\n")

    with open(failed_file, "a", encoding="utf-8") as f:
        for fid in failed_appids:
            f.write(f"{fid}\n")
        f.write(f"# FAILED: {fail}/{total}\n")

    with open(warnings_file, "a", encoding="utf-8") as f:
        for wid in warned_appids:
            f.write(f"{wid}\n")
        f.write(f"# WARNINGS: {warn_count}/{total} (подозрительно маленькие, проверьте вручную)\n")

    log("════════════════════════════════════════════")
    log(f"✓ Успешно: {ok}/{total}")
    if fail > 0:
        err(f"✗ Неудачно: {fail}")
    if warn_count > 0:
        warn(f"⚠ Предупреждения: {warn_count} (подозрительно маленькие)")
    log(f"Результаты: {results_dir}/")
    log(f"  Лог:            {log_file}")
    log(f"  Успешные:       {success_file}")
    log(f"  Неудачные:      {failed_file}")
    log(f"  Подозрительные: {warnings_file}")


if __name__ == "__main__":
    main()
