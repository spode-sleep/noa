#!/bin/bash

# Убийство зависших процессов SteamCMD

echo "════════════════════════════════════════"
echo "Поиск зависших процессов SteamCMD..."
echo "════════════════════════════════════════"
echo ""

# Найти процессы
PIDS=$(pgrep -f steamcmd)

if [ -z "$PIDS" ]; then
    echo "✓ Зависших процессов не найдено"
    exit 0
fi

echo "Найдены процессы SteamCMD:"
ps aux | grep steamcmd | grep -v grep
echo ""

read -p "Убить все? (y/n): " CONFIRM

if [ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ]; then
    pkill -9 steamcmd
    sleep 2
    
    if pgrep -f steamcmd > /dev/null; then
        echo "✗ Некоторые процессы еще работают"
        echo "Попробуйте: sudo pkill -9 steamcmd"
    else
        echo "✓ Все процессы убиты"
    fi
else
    echo "Отменено"
fi

echo ""
echo "Проверка частично установленных игр..."

STEAM_DIR="/media/repeater/ARCHIVE1/steam"

if [ ! -d "$STEAM_DIR" ]; then
    echo "Директория $STEAM_DIR не найдена"
    exit 0
fi

# Ищем маленькие директории (< 100MB)
SMALL=$(find "$STEAM_DIR" -maxdepth 1 -name "game_*" -type d -exec du -sm {} \; 2>/dev/null | awk '$1 < 100')

if [ -z "$SMALL" ]; then
    echo "✓ Подозрительных директорий не найдено"
else
    echo "Маленькие директории (< 100MB):"
    echo "$SMALL" | while read size dir; do
        echo "  $dir (${size}MB)"
    done
    echo ""
    
    read -p "Удалить их? (y/n): " DEL
    if [ "$DEL" = "y" ] || [ "$DEL" = "Y" ]; then
        echo "$SMALL" | cut -f2 | while read dir; do
            echo "Удаление $dir..."
            rm -rf "$dir"
        done
        echo "✓ Очищено"
    fi
fi
