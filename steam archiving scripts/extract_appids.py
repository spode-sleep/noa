#!/usr/bin/env python3
"""Извлечение AppID из файлов appmanifest_*.acf"""

import os
import re
import sys
from pathlib import Path
from datetime import datetime


def extract_appid(filename):
    """Извлекает AppID из имени файла appmanifest_XXXXX.acf"""
    match = re.match(r'appmanifest_(\d+)\.acf', filename)
    return match.group(1) if match else None


def extract_game_name(filepath):
    """Извлекает название игры из файла манифеста"""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            match = re.search(r'"name"\s+"([^"]+)"', content)
            return match.group(1) if match else None
    except:
        return None


if len(sys.argv) < 2:
    print("Использование: python3 extract_appids.py <директория_steamapps>")
    print("\nПример:")
    print("  python3 extract_appids.py ~/.steam/steam/steamapps")
    print("  python3 extract_appids.py /media/repeater/ARCHIVE1/steam/steamapps")
    sys.exit(1)

directory = Path(sys.argv[1])
output = sys.argv[2] if len(sys.argv) > 2 else "extracted_appids.txt"

if not directory.exists():
    print(f"Ошибка: {directory} не существует")
    sys.exit(1)

# Поиск файлов
manifests = list(directory.glob('appmanifest_*.acf'))

if not manifests:
    print(f"В {directory} не найдено файлов appmanifest_*.acf")
    sys.exit(1)

print(f"Найдено файлов: {len(manifests)}")

# Извлечение AppID
appids = []
for m in sorted(manifests):
    appid = extract_appid(m.name)
    if appid:
        appids.append(appid)
        name = extract_game_name(m)
        print(f"  {appid:10s} - {name or '(название не найдено)'}")

# Сохранение
with open(output, 'w') as f:
    f.write(f"# AppID извлечены из {directory}\n")
    f.write(f"# Создано: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    f.write(f"# Всего: {len(appids)}\n\n")
    for appid in appids:
        f.write(f"{appid}\n")

print(f"\n✓ Сохранено {len(appids)} AppID в {output}")
print(f"\nИспользуйте: ./install_games.sh {output}")
