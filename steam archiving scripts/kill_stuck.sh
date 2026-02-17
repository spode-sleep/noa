#!/bin/bash

# Убийство зависших процессов DepotDownloader / SteamCMD

echo "════════════════════════════════════════"
echo "Остановка процессов загрузки"
echo "════════════════════════════════════════"
echo ""

# Найти все процессы связанные с DepotDownloader или steamcmd
PIDS=$(pgrep -f "DepotDownloader\|steamcmd\|steam" 2>/dev/null)

if [ -z "$PIDS" ]; then
    echo "✓ Процессов загрузки не найдено"
else
    echo "Найдены процессы:"
    ps aux | grep -E "DepotDownloader|steamcmd|steam" | grep -v grep | grep -v kill_stuck
    echo ""
    
    read -p "Убить все процессы? (y/n): " CONFIRM
    
    if [ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ]; then
        echo ""
        echo "Убиваем процессы..."
        
        pkill -9 -f DepotDownloader 2>/dev/null
        pkill -9 -f steamcmd 2>/dev/null
        
        sleep 2
        
        # Проверка
        if pgrep -f "DepotDownloader\|steamcmd" > /dev/null 2>&1; then
            echo "✗ Некоторые процессы еще работают"
            echo "Попробуйте с sudo"
        else
            echo "✓ Все процессы убиты"
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
