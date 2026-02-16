#!/bin/bash

# Убийство зависших процессов SteamCMD

echo "════════════════════════════════════════"
echo "Остановка всех процессов SteamCMD"
echo "════════════════════════════════════════"
echo ""

# Найти все процессы связанные с steamcmd
PIDS=$(pgrep -f "steamcmd\|steam")

if [ -z "$PIDS" ]; then
    echo "✓ Процессов SteamCMD не найдено"
else
    echo "Найдены процессы:"
    ps aux | grep -E "steamcmd|steam" | grep -v grep | grep -v kill_stuck
    echo ""
    
    read -p "Убить все процессы SteamCMD и Steam? (y/n): " CONFIRM
    
    if [ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ]; then
        echo ""
        echo "Убиваем процессы..."
        
        # Убить все связанные процессы
        pkill -9 -f steamcmd
        pkill -9 -f "linux32/steamcmd"
        pkill -9 -f "linux64/steamcmd"
        
        sleep 2
        
        # Проверка
        if pgrep -f steamcmd > /dev/null; then
            echo "✗ Некоторые процессы еще работают"
            echo "Попробуйте с sudo:"
            echo "  sudo pkill -9 steamcmd"
        else
            echo "✓ Все процессы SteamCMD убиты"
        fi
    else
        echo "Отменено"
        exit 0
    fi
fi

echo ""
echo "════════════════════════════════════════"
echo "Проверка частично установленных игр"
echo "════════════════════════════════════════"
echo ""

# Проверяем оба возможных пути и локальную папку загрузок
for STEAM_DIR in /media/repeater/ARCHIVE11/steam /media/repeater/ARCHIVE1/steam /mnt/steam_hdd/steam /mnt/ARCHIVE1/steam $HOME/steam_downloads; do
    if [ ! -d "$STEAM_DIR" ]; then
        continue
    fi
    
    echo "Проверка: $STEAM_DIR"
    
    # Ищем маленькие директории (< 100MB)
    SMALL=$(find "$STEAM_DIR" -maxdepth 1 -type d -name "[0-9]*" -exec du -sm {} \; 2>/dev/null | awk '$1 < 100')
    
    if [ -z "$SMALL" ]; then
        echo "  ✓ Подозрительных директорий не найдено"
    else
        echo "  Маленькие директории (< 100MB):"
        echo "$SMALL" | while read size dir; do
            echo "    $dir (${size}MB)"
        done
        echo ""
        
        read -p "  Удалить их? (y/n): " DEL
        if [ "$DEL" = "y" ] || [ "$DEL" = "Y" ]; then
            echo "$SMALL" | cut -f2 | while read dir; do
                echo "    Удаление $dir..."
                rm -rf "$dir"
            done
            echo "  ✓ Очищено"
        fi
    fi
    echo ""
done

echo "════════════════════════════════════════"
echo "Готово!"
echo "════════════════════════════════════════"
