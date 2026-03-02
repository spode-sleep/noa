#!/usr/bin/env python3
"""
RAWG Library Archiver — Windows version (Python3)

Скачивает игры через legendary (Epic Games), lgogdownloader (GOG)
и nile (Amazon Games). Для каждой игры пробуются все три сервиса
по очереди, пока один из них не сработает.

Схема: скачать на локальный диск → скопировать на HDD → удалить локально.

Использование:
    python install_games.py batch_01.txt
    python install_games.py batch_01.txt D:/rawg
    python install_games.py batch_01.txt "E:/Archive/rawg"

Требования:
    - Python 3.10+  (https://www.python.org/downloads/)
    - legendary  (pip install legendary-gl)     — Epic Games Store
    - lgogdownloader                             — GOG.com
    - nile       (pip install nile)              — Amazon Games
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# ═══════════════════════════ Настройки ═══════════════════════════

MIN_GAME_SIZE_BYTES = 1_048_576  # 1MB — меньше = подозрительно
DOWNLOAD_TIMEOUT = 7200  # 2 часа — таймаут на скачивание одной игры
AUTH_CHECK_TIMEOUT = 30   # секунд на проверку авторизации
AUTH_LOGIN_TIMEOUT = 120  # секунд на интерактивный логин

# Локальная папка для загрузки
LOCAL_DOWNLOAD_DIR = Path("D:/rawg_downloads")

# Сервисы в порядке приоритета
SERVICES = ["legendary", "lgogdownloader", "nile"]

# ═══════════════════════════ Цвета ═══════════════════════════

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


def safe_dirname(name: str) -> str:
    """Имя директории: только буквы, цифры, подчёркивание."""
    return re.sub(r'[^a-zA-Z0-9_]', '_', name)


def read_names(filepath: str) -> list[str]:
    """Чтение имён игр из файла (одно на строку, # — комментарии)."""
    names = []
    with open(filepath, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            names.append(line)
    return names


def normalize_name(name: str) -> str:
    """Убирает спецсимволы и приводит к нижнему регистру для нечёткого сравнения."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def build_name_to_key(games_json_path: str) -> dict[str, str]:
    """Загружает games.json и строит маппинг name → key для rawg-игр.

    Возвращает два словаря в одном: точные и нормализованные имена.
    """
    with open(games_json_path, encoding="utf-8") as f:
        games = json.load(f)

    exact: dict[str, str] = {}
    fuzzy: dict[str, str] = {}

    for key, game in games.items():
        if game.get("source") != "rawg":
            continue
        name = game.get("name", "")
        exact[name] = key
        fuzzy[normalize_name(name)] = key

    return {**fuzzy, **exact}  # exact overwrites fuzzy for same normalized form


def lookup_game_key(name: str, name_to_key: dict[str, str]) -> str | None:
    """Ищет ключ games.json по имени игры (точное, затем нечёткое)."""
    if name in name_to_key:
        return name_to_key[name]
    norm = normalize_name(name)
    return name_to_key.get(norm)


def check_tool(name: str) -> bool:
    """Проверка доступности CLI-инструмента."""
    return shutil.which(name) is not None


def copy_with_robocopy(src: Path, dst: Path) -> bool:
    """Копирование через robocopy (Windows)."""
    try:
        result = subprocess.run(
            [
                "robocopy",
                str(src),
                str(dst),
                "/E", "/NP", "/NFL", "/NDL", "/NJH", "/NJS",
                "/R:3", "/W:5", "/MT:4",
            ],
            capture_output=True,
            text=True,
        )
        return result.returncode < 8
    except FileNotFoundError:
        return copy_with_shutil(src, dst)


def copy_with_shutil(src: Path, dst: Path) -> bool:
    """Копирование через shutil (fallback)."""
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


# ═══════════════════════════ Авторизация ═══════════════════════════


def auth_legendary() -> bool:
    """Проверка и авторизация в Epic Games Store через legendary.

    legendary status проверяет статус; legendary auth запускает логин.
    """
    log("[legendary] Проверка авторизации Epic Games...")
    try:
        result = subprocess.run(
            ["legendary", "status"],
            capture_output=True, text=True, timeout=AUTH_CHECK_TIMEOUT,
        )
        if result.returncode == 0 and "Logged in" in result.stdout:
            log("[legendary] ✓ Авторизован в Epic Games")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    warn("[legendary] Не авторизован — запускаю legendary auth...")
    try:
        result = subprocess.run(["legendary", "auth"], timeout=AUTH_LOGIN_TIMEOUT)
        if result.returncode == 0:
            log("[legendary] ✓ Авторизация Epic Games завершена")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    err("[legendary] ✗ Не удалось авторизоваться в Epic Games")
    return False


def auth_lgogdownloader() -> bool:
    """Проверка и авторизация в GOG через lgogdownloader."""
    log("[lgogdownloader] Проверка авторизации GOG...")
    try:
        result = subprocess.run(
            ["lgogdownloader", "--check-login-status"],
            capture_output=True, text=True, timeout=AUTH_CHECK_TIMEOUT,
        )
        if result.returncode == 0:
            log("[lgogdownloader] ✓ Авторизован в GOG")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    warn("[lgogdownloader] Не авторизован — запускаю lgogdownloader --login...")
    try:
        result = subprocess.run(["lgogdownloader", "--login"], timeout=AUTH_LOGIN_TIMEOUT)
        if result.returncode == 0:
            log("[lgogdownloader] ✓ Авторизация GOG завершена")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    err("[lgogdownloader] ✗ Не удалось авторизоваться в GOG")
    return False


def auth_nile() -> bool:
    """Проверка и авторизация в Amazon Games через nile."""
    log("[nile] Проверка авторизации Amazon Games...")
    try:
        # Быстрая проверка: если library list работает — значит авторизованы
        result = subprocess.run(
            ["nile", "library", "list"],
            capture_output=True, text=True, timeout=AUTH_CHECK_TIMEOUT,
        )
        if result.returncode == 0 and result.stdout.strip():
            log("[nile] ✓ Авторизован в Amazon Games")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    warn("[nile] Не авторизован — запускаю nile auth --login...")
    try:
        result = subprocess.run(["nile", "auth", "--login"], timeout=AUTH_LOGIN_TIMEOUT)
        if result.returncode == 0:
            log("[nile] ✓ Авторизация Amazon Games завершена")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    err("[nile] ✗ Не удалось авторизоваться в Amazon Games")
    return False


AUTH_FUNCS = {
    "legendary": auth_legendary,
    "lgogdownloader": auth_lgogdownloader,
    "nile": auth_nile,
}


# ═══════════════════════════ Сервисы ═══════════════════════════


def try_legendary(game_name: str, out_dir: Path, log_file: Path) -> bool:
    """Попытка скачать через legendary (Epic Games Store).

    legendary ищет по app_name, но мы не знаем его — используем поиск.
    legendary list показывает все купленные игры; ищем совпадение по имени.
    """
    log(f"  [legendary] Поиск «{game_name}» в библиотеке Epic Games...")

    try:
        result = subprocess.run(
            ["legendary", "list", "--csv"],
            capture_output=True, text=True, timeout=60,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        warn("  [legendary] Недоступен или таймаут")
        return False

    if result.returncode != 0:
        warn("  [legendary] Ошибка получения списка игр")
        return False

    # Парсим CSV: App name, App title, Version, Is DLC
    app_name = None
    norm_search = game_name.lower().strip()
    for line in result.stdout.splitlines():
        parts = line.split(",")
        if len(parts) >= 2:
            title = parts[1].strip().strip('"')
            if title.lower() == norm_search:
                app_name = parts[0].strip().strip('"')
                break

    if not app_name:
        warn(f"  [legendary] «{game_name}» не найдена в библиотеке")
        return False

    log(f"  [legendary] Найдена: {app_name}, скачиваем...")

    try:
        proc = subprocess.run(
            [
                "legendary", "install", app_name,
                "--base-path", str(out_dir.parent),
                "--game-folder", out_dir.name,
                "--yes",
            ],
            timeout=DOWNLOAD_TIMEOUT,
            capture_output=True,
            text=True,
        )
        with open(log_file, "a", encoding="utf-8") as lf:
            lf.write(f"=== legendary: {game_name} ({app_name}) ===\n")
            lf.write(proc.stdout)
            if proc.stderr:
                lf.write(proc.stderr)
    except subprocess.TimeoutExpired:
        err("  [legendary] Таймаут скачивания (2 часа)")
        return False
    except FileNotFoundError:
        warn("  [legendary] Недоступен")
        return False

    return proc.returncode == 0 and has_any_files(out_dir)


def try_lgogdownloader(game_name: str, out_dir: Path, log_file: Path) -> bool:
    """Попытка скачать через lgogdownloader (GOG.com).

    lgogdownloader --game поддерживает regex по имени.
    """
    log(f"  [lgogdownloader] Поиск «{game_name}» в библиотеке GOG...")

    # Экранируем спецсимволы regex в имени игры
    escaped = re.escape(game_name.lower())

    try:
        result = subprocess.run(
            ["lgogdownloader", "--list", "--game", escaped],
            capture_output=True, text=True, timeout=60,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        warn("  [lgogdownloader] Недоступен или таймаут")
        return False

    if result.returncode != 0 or not result.stdout.strip():
        warn(f"  [lgogdownloader] «{game_name}» не найдена в библиотеке")
        return False

    log(f"  [lgogdownloader] Найдена, скачиваем...")

    try:
        proc = subprocess.run(
            [
                "lgogdownloader",
                "--download",
                "--game", escaped,
                "--directory", str(out_dir),
                "--platform", "windows",
                "--language", "en",
                "--exclude", "extras",
            ],
            timeout=DOWNLOAD_TIMEOUT,
            capture_output=True,
            text=True,
        )
        with open(log_file, "a", encoding="utf-8") as lf:
            lf.write(f"=== lgogdownloader: {game_name} ===\n")
            lf.write(proc.stdout)
            if proc.stderr:
                lf.write(proc.stderr)
    except subprocess.TimeoutExpired:
        err("  [lgogdownloader] Таймаут скачивания (2 часа)")
        return False
    except FileNotFoundError:
        warn("  [lgogdownloader] Недоступен")
        return False

    return proc.returncode == 0 and has_any_files(out_dir)


def try_nile(game_name: str, out_dir: Path, log_file: Path) -> bool:
    """Попытка скачать через nile (Amazon Games).

    nile library list показывает все игры; ищем совпадение по имени.
    """
    log(f"  [nile] Поиск «{game_name}» в библиотеке Amazon Games...")

    try:
        result = subprocess.run(
            ["nile", "library", "list"],
            capture_output=True, text=True, timeout=60,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        warn("  [nile] Недоступен или таймаут")
        return False

    if result.returncode != 0:
        warn("  [nile] Ошибка получения списка игр")
        return False

    # Ищем совпадение по имени в выводе
    game_id = None
    norm_search = game_name.lower().strip()
    for line in result.stdout.splitlines():
        # nile выводит: Title (id: some_id)  или  Title - id
        line_lower = line.lower().strip()
        if norm_search in line_lower:
            # Попытка извлечь ID
            id_match = re.search(r"id:\s*(\S+)", line)
            if id_match:
                game_id = id_match.group(1).rstrip(")")
            break

    if not game_id:
        warn(f"  [nile] «{game_name}» не найдена в библиотеке")
        return False

    log(f"  [nile] Найдена: {game_id}, скачиваем...")

    try:
        proc = subprocess.run(
            ["nile", "install", game_id, "--path", str(out_dir)],
            timeout=DOWNLOAD_TIMEOUT,
            capture_output=True,
            text=True,
        )
        with open(log_file, "a", encoding="utf-8") as lf:
            lf.write(f"=== nile: {game_name} ({game_id}) ===\n")
            lf.write(proc.stdout)
            if proc.stderr:
                lf.write(proc.stderr)
    except subprocess.TimeoutExpired:
        err("  [nile] Таймаут скачивания (2 часа)")
        return False
    except FileNotFoundError:
        warn("  [nile] Недоступен")
        return False

    return proc.returncode == 0 and has_any_files(out_dir)


SERVICE_FUNCS = {
    "legendary": try_legendary,
    "lgogdownloader": try_lgogdownloader,
    "nile": try_nile,
}


# ═══════════════════════════ Main ═══════════════════════════


def main() -> None:
    parser = argparse.ArgumentParser(
        description="RAWG Library Archiver (Windows/Python3) — GOG, Epic, Amazon"
    )
    parser.add_argument("names_file", help="Файл с именами игр (одно на строку)")
    parser.add_argument(
        "install_dir",
        nargs="?",
        default="D:\\rawg",
        help="Директория на HDD (по умолчанию: D:\\rawg)",
    )
    parser.add_argument(
        "--games-json",
        default=os.path.join(os.path.dirname(__file__), "..", "data", "games", "games.json"),
        help="Путь к games.json (для маппинга имён → ключей/папок)",
    )
    args = parser.parse_args()

    # Включаем ANSI escape коды на Windows
    if os.name == "nt":
        os.system("")

    # Чтение имён
    if not os.path.isfile(args.names_file):
        err(f"Файл не найден: {args.names_file}")
        sys.exit(1)

    names = read_names(args.names_file)
    if not names:
        err("Нет имён игр!")
        sys.exit(1)

    # Загрузка games.json для маппинга имён → ключей (используются как имена папок)
    if not os.path.isfile(args.games_json):
        err(f"games.json не найден: {args.games_json}")
        sys.exit(1)
    name_to_key = build_name_to_key(args.games_json)
    log(f"✓ games.json загружен ({len(name_to_key)} rawg-игр)")

    install_dir = Path(args.install_dir)
    LOCAL_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    install_dir.mkdir(parents=True, exist_ok=True)

    # Проверка инструментов
    available = []
    for tool in SERVICES:
        if check_tool(tool):
            available.append(tool)
            log(f"✓ {tool} найден")
        else:
            warn(f"✗ {tool} не найден (пропускается)")

    if not available:
        err("Ни один из инструментов не найден!")
        print()
        print("Установка (нужен Python 3.10+ и pip):")
        print("  legendary:      pip install legendary-gl")
        print("  lgogdownloader: Linux / WSL only (sudo apt install lgogdownloader)")
        print("  nile:           pip install nile")
        print()
        print("Если pip не найден — попробуйте: py -m pip install ...")
        print("Подробнее: QUICKSTART.md")
        sys.exit(1)

    # Авторизация во всех доступных сервисах
    print()
    log("Авторизация в сервисах...")
    log("════════════════════════════════════════════")
    authed = []
    for tool in available:
        if AUTH_FUNCS[tool]():
            authed.append(tool)
        print()

    if not authed:
        err("Не удалось авторизоваться ни в одном сервисе!")
        sys.exit(1)

    if len(authed) < len(available):
        not_authed = [t for t in available if t not in authed]
        warn(f"Не авторизованы: {', '.join(not_authed)} (будут пропущены)")
    available = authed
    log(f"✓ Авторизованные сервисы: {', '.join(available)}")
    log("════════════════════════════════════════════")
    print()

    total = len(names)

    log("════════════════════════════════════════════")
    log(f"Архивация {total} игр (GOG / Epic / Amazon)")
    log(f"Доступные сервисы: {', '.join(available)}")
    log(f"Локальная папка: {LOCAL_DOWNLOAD_DIR}")
    log(f"HDD директория: {install_dir}")
    log("Схема: скачать → скопировать на HDD → удалить локально")
    log("════════════════════════════════════════════")
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
    failed_names: list[str] = []
    warned_names: list[str] = []
    source_map: dict[str, str] = {}  # name -> service

    local_dir: Path | None = None

    try:
        for i, name in enumerate(names):
            # Папка на HDD: ключ из games.json (sanitized), fallback — safe_dirname
            game_key = lookup_game_key(name, name_to_key)
            if game_key:
                folder_name = game_key
            else:
                folder_name = safe_dirname(name)
                warn(f"«{name}» не найдена в games.json — папка: {folder_name}")

            local_dir = LOCAL_DOWNLOAD_DIR / folder_name
            hdd_dir = install_dir / folder_name

            log("════════════════════════════════════════════")
            log(f"[{i + 1}/{total}] {name} → {folder_name}")
            log("════════════════════════════════════════════")

            # Очистка
            if local_dir.exists():
                shutil.rmtree(local_dir)
            local_dir.mkdir(parents=True)

            print()
            log(f"Скачиваем в: {local_dir}")

            # Пробуем все доступные сервисы
            download_ok = False
            used_service = None
            for service in available:
                func = SERVICE_FUNCS[service]
                try:
                    if func(name, local_dir, log_file):
                        download_ok = True
                        used_service = service
                        break
                except Exception as e:
                    err(f"  [{service}] Неожиданная ошибка: {e}")
                    # Очистка после ошибки
                    if local_dir.exists():
                        shutil.rmtree(local_dir)
                    local_dir.mkdir(parents=True)

            print()

            # Обработка результата
            if download_ok and local_dir.exists() and has_any_files(local_dir):
                local_bytes = dir_size_bytes(local_dir)
                size_str = dir_size_human(local_bytes)
                log(f"✓ Скачано через {used_service}: {size_str}")

                # Копирование на HDD
                log(f"Копирование на HDD: {hdd_dir} ...")

                if copy_to_hdd(local_dir, hdd_dir):
                    hdd_bytes = dir_size_bytes(hdd_dir)

                    if local_bytes == hdd_bytes:
                        log(f"✓ Скопировано на HDD (верифицировано: {size_str})")

                        shutil.rmtree(local_dir)
                        log("✓ Локальная копия удалена")

                        with open(success_file, "a", encoding="utf-8") as f:
                            f.write(f"{name}\t{used_service}\t{folder_name}\n")
                        ok += 1
                        source_map[name] = used_service

                        if local_bytes < MIN_GAME_SIZE_BYTES:
                            warn(f"⚠ «{name}» очень маленькая ({size_str}) — проверьте вручную")
                            warned_names.append(name)
                            warn_count += 1
                    else:
                        err(f"✗ Ошибка верификации! Локально: {local_bytes}B, HDD: {hdd_bytes}B")
                        err(f"Локальная копия сохранена: {local_dir}")
                        failed_names.append(name)
                        fail += 1
                else:
                    err("✗ Ошибка копирования на HDD")
                    failed_names.append(name)
                    fail += 1
            else:
                err(f"✗ «{name}» не найдена ни в одном сервисе")
                failed_names.append(name)
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
        f.write("# Формат: name<TAB>service<TAB>folder_key\n")
        for sname, svc in source_map.items():
            f.write(f"# {sname} <- {svc}\n")

    with open(failed_file, "a", encoding="utf-8") as f:
        for fn in failed_names:
            f.write(f"{fn}\n")
        f.write(f"# FAILED: {fail}/{total}\n")

    with open(warnings_file, "a", encoding="utf-8") as f:
        for wn in warned_names:
            f.write(f"{wn}\n")
        f.write(f"# WARNINGS: {warn_count}/{total}\n")

    log("════════════════════════════════════════════")
    log(f"✓ Успешно: {ok}/{total}")
    if fail > 0:
        err(f"✗ Неудачно: {fail}")
    if warn_count > 0:
        warn(f"⚠ Предупреждения: {warn_count}")
    log(f"Результаты: {results_dir}/")
    log(f"  Лог:            {log_file}")
    log(f"  Успешные:       {success_file}")
    log(f"  Неудачные:      {failed_file}")
    log(f"  Подозрительные: {warnings_file}")


if __name__ == "__main__":
    main()
