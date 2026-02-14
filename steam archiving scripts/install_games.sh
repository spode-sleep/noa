#!/bin/bash

G='\033[0;32m'; R='\033[0;31m'; NC='\033[0m'
log() { echo -e "${G}[$(date '+%H:%M:%S')]${NC} $1"; }
err() { echo -e "${R}[$(date '+%H:%M:%S')]${NC} $1"; }

INSTALL_DIR="/media/repeater/ARCHIVE1/steam"
STEAMCMD="$HOME/steamcmd/steamcmd.sh"
LANG="russian"

[ $# -lt 1 ] && { echo "Использование: $0 <файл_appid>"; exit 1; }
[ ! -f "$1" ] && { err "Файл не найден!"; exit 1; }
[ ! -f "$STEAMCMD" ] && { err "SteamCMD не найден!"; exit 1; }

mkdir -p "$INSTALL_DIR"

mapfile -t APPIDS < <(grep -v '^#' "$1" | grep -v '^[[:space:]]*$' | tr -d '\r' | xargs -n1)
TOTAL=${#APPIDS[@]}
[ $TOTAL -eq 0 ] && { err "Нет AppID!"; exit 1; }

log "════════════════════════════════════════════"
log "Установка $TOTAL игр (каждая отдельно)"
log "════════════════════════════════════════════"

read -p "Логин: " USER
read -sp "Пароль: " PASS
echo ""
log "Подтвердите вход в приложении Steam!"
echo ""

# Первая авторизация
log "Авторизация..."
echo ""
log "⚠️  Когда увидите 'Please confirm the login' - подтвердите в приложении!"
echo ""

cat > /tmp/login_$$.txt << EOF
login $USER $PASS
@NoPromptForPassword 1
quit
EOF

$STEAMCMD +runscript /tmp/login_$$.txt

rm /tmp/login_$$.txt

echo ""
log "✓ Авторизация завершена, начинаем установку"
echo ""

TS=$(date +%Y%m%d_%H%M%S)
LOG="install_${TS}.log"
SUCCESS="installed_${TS}.txt"
echo "# Установленные - $(date)" > "$SUCCESS"

OK=0; FAIL=0

for ((i=0; i<TOTAL; i++)); do
    APPID="${APPIDS[$i]}"
    DIR="$INSTALL_DIR/game_$APPID"
    
    log "════════════════════════════════════════════"
    log "[$((i+1))/$TOTAL] Установка AppID: $APPID"
    log "Директория: $DIR"
    log "════════════════════════════════════════════"
    echo ""
    
    [ -d "$DIR" ] && rm -rf "$DIR"
    
    # Показываем прогресс в реальном времени
    $STEAMCMD \
        +@ShutdownOnFailedCommand 0 \
        +@NoPromptForPassword 1 \
        +login $USER \
        +force_install_dir $DIR \
        +app_update $APPID -language $LANG \
        +quit \
        2>&1 | tee -a "$LOG" | grep --line-buffered -E "progress:|Update state|Success"
    
    echo ""
    
    # Детальная проверка что скачалось
    if [ -d "$DIR" ]; then
        FILE_COUNT=$(find "$DIR" -type f 2>/dev/null | wc -l)
        ACTUAL_SIZE=$(du -sh "$DIR" 2>/dev/null | cut -f1)
        LARGE_FILES=$(find "$DIR" -type f -size +10M 2>/dev/null | wc -l)
        
        log "Проверка: $FILE_COUNT файлов, размер $ACTUAL_SIZE, больших файлов: $LARGE_FILES"
        
        if [ $LARGE_FILES -gt 0 ]; then
            echo "$APPID|steam/game_$APPID|$ACTUAL_SIZE|$(date)" >> "$SUCCESS"
            log "✓ УСПЕШНО установлен: $ACTUAL_SIZE"
            ((OK++))
        else
            err "✗ ОШИБКА: игра не скачалась (папка пустая или только мелкие файлы)"
            log "  Содержимое папки:"
            ls -lah "$DIR" 2>/dev/null | head -10
            ((FAIL++))
            rm -rf "$DIR"
        fi
    else
        err "✗ ОШИБКА: папка не создалась"
        ((FAIL++))
    fi
    
    echo ""
    log "Пауза 5 секунд..."
    sleep 5
    echo ""
done

log "════════════════════════════════════════════"
log "✓ $OK/$TOTAL успешно"
[ $FAIL -gt 0 ] && err "✗ $FAIL неудачно"
log "$SUCCESS | $LOG"
