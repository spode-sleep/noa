#!/bin/bash

# Просмотр установленных игр

LATEST=$(ls -t installed_*.txt 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
    echo "Файлы с установленными играми не найдены"
    exit 1
fi

echo "════════════════════════════════════════"
echo "Установленные игры"
echo "════════════════════════════════════════"
echo "Файл: $LATEST"
echo ""

TOTAL=$(grep -c '^[0-9]' "$LATEST")
echo "Всего игр: $TOTAL"
echo ""

# Подсчет размера
echo "Вычисление общего размера..."
TOTAL_GB=0

while IFS='|' read -r appid path size timestamp; do
    [[ "$appid" =~ ^# ]] && continue
    
    if [[ "$size" =~ ([0-9.]+)G ]]; then
        num="${BASH_REMATCH[1]}"
        TOTAL_GB=$(echo "$TOTAL_GB + $num" | bc)
    fi
done < "$LATEST"

echo "Общий размер: ${TOTAL_GB}GB"
echo ""

echo "════════════════════════════════════════"
printf "%-10s | %-30s | %-10s\n" "AppID" "Путь" "Размер"
echo "════════════════════════════════════════"

while IFS='|' read -r appid path size timestamp; do
    [[ "$appid" =~ ^# ]] && continue
    printf "%-10s | %-30s | %-10s\n" "$appid" "$path" "$size"
done < "$LATEST"

echo ""
