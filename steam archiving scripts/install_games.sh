#!/bin/bash

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; NC='\033[0m'
log() { echo -e "${G}[$(date '+%H:%M:%S')]${NC} $1"; }
err() { echo -e "${R}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${Y}[$(date '+%H:%M:%S')]${NC} $1"; }

STEAMCMD="$HOME/steamcmd/steamcmd.sh"
LANG="russian"
CACHE_SAFETY_GB=10

# Использование
if [ $# -lt 1 ]; then
    echo "Использование: $0 <файл_appid> [директория_установки]"
    echo ""
    echo "Примеры:"
    echo "  $0 my_games.txt"
    echo "  $0 my_games.txt /mnt/steam_hdd/steam"
    echo "  $0 my_games.txt /media/repeater/ARCHIVE11/steam"
    echo ""
    echo "По умолчанию: /media/repeater/ARCHIVE11/steam"
    exit 1
fi

APPID_FILE="$1"
INSTALL_DIR="${2:-/media/repeater/ARCHIVE11/steam}"

[ ! -f "$APPID_FILE" ] && { err "Файл не найден: $APPID_FILE"; exit 1; }
[ ! -f "$STEAMCMD" ] && { err "SteamCMD не найден!"; exit 1; }

mkdir -p "$INSTALL_DIR"

# Функция очистки кэша
clean_cache() {
    log "Очистка кэша Steam..."
    rm -rf ~/.steam/debian-installation/steamapps/downloading/* 2>/dev/null
    rm -rf ~/.steam/debian-installation/steamapps/temp/* 2>/dev/null
    rm -rf ~/.steam/debian-installation/steamapps/workshop/temp/* 2>/dev/null
    sync
    sleep 2
}

# Функция проверки места
check_disk_space() {
    local game_size_gb=$1
    local required_gb=$((game_size_gb + CACHE_SAFETY_GB))
    local available_gb=$(df -BG / | tail -1 | awk '{print $4}' | sed 's/G//')
    
    if [ "$available_gb" -lt "$required_gb" ]; then
        warn "Мало места на основном диске (нужно ${required_gb}GB, доступно ${available_gb}GB)"
        clean_cache
        available_gb=$(df -BG / | tail -1 | awk '{print $4}' | sed 's/G//')
        log "После очистки доступно: ${available_gb}GB"
    fi
}

# Читаем AppID
mapfile -t APPIDS < <(grep -v '^#' "$1" | grep -v '^[[:space:]]*$' | tr -d '\r' | xargs -n1)
TOTAL=${#APPIDS[@]}
[ $TOTAL -eq 0 ] && { err "Нет AppID!"; exit 1; }

log "════════════════════════════════════════════"
log "Установка $TOTAL игр"
log "Директория: $INSTALL_DIR"
log "════════════════════════════════════════════"

read -p "Логин: " USER
read -sp "Пароль: " PASS
echo ""
echo ""

# Авторизация
log "Авторизация..."
log "Подтвердите вход в мобильном приложении Steam!"
echo ""

cat > /tmp/login_$$.txt << EOF
login $USER $PASS
@NoPromptForPassword 1
quit
EOF

$STEAMCMD +runscript /tmp/login_$$.txt

rm /tmp/login_$$.txt

echo ""
log "✓ Начинаем установку"
echo ""

# Результаты
TS=$(date +%Y%m%d_%H%M%S)
LOG="install_${TS}.log"
SUCCESS="installed_${TS}.txt"
echo "# Установленные - $(date)" > "$SUCCESS"

OK=0; FAIL=0

for ((i=0; i<TOTAL; i++)); do
    APPID="${APPIDS[$i]}"
    DIR="$INSTALL_DIR/$APPID"
    
    log "════════════════════════════════════════════"
    log "[$((i+1))/$TOTAL] AppID: $APPID"
    log "════════════════════════════════════════════"
    
    # Проверка места (предполагаем ~5GB на игру, если нужно точнее - можно добавить API запрос)
    check_disk_space 5
    
    [ -d "$DIR" ] && rm -rf "$DIR"
    
    echo ""
    
    # Запуск установки с прогрессом и ionice
    IONICE_CMD=""
    if command -v ionice &> /dev/null; then
        IONICE_CMD="ionice -c2 -n7"
        log "Используем ionice для снижения нагрузки на диск"
    fi
    
    $IONICE_CMD $STEAMCMD \
        +@ShutdownOnFailedCommand 0 \
        +@NoPromptForPassword 1 \
        +login $USER \
        +force_install_dir $DIR \
        +app_update $APPID -language $LANG \
        +quit \
        2>&1 | tee -a "$LOG" | while IFS= read -r line; do
            if [[ "$line" =~ progress:\ ([0-9.]+)\ \(([0-9]+)\ /\ ([0-9]+)\) ]]; then
                percent="${BASH_REMATCH[1]}"
                downloaded="${BASH_REMATCH[2]}"
                total="${BASH_REMATCH[3]}"
                downloaded_gb=$(echo "scale=2; $downloaded / 1073741824" | bc)
                total_gb=$(echo "scale=2; $total / 1073741824" | bc)
                printf "\r\033[K[%.1f%%] %.2fGB / %.2fGB" "$percent" "$downloaded_gb" "$total_gb"
            elif [[ "$line" =~ Update\ state.*progress:\ ([0-9.]+) ]]; then
                percent="${BASH_REMATCH[1]}"
                printf "\r\033[K[%.1f%%] Загрузка..." "$percent"
            fi
        done
    
    echo ""
    echo ""
    
    # Проверка результата
    if [ -d "$DIR" ] && [ -n "$(find "$DIR" -type f -size +10M 2>/dev/null | head -1)" ]; then
        SIZE=$(du -sh "$DIR" 2>/dev/null | cut -f1)
        echo "$APPID|$APPID|$SIZE|$(date)" >> "$SUCCESS"
        log "✓ Установлен: $SIZE"
        ((OK++))
    else
        err "✗ Не установлен"
        ((FAIL++))
        [ -d "$DIR" ] && rm -rf "$DIR"
    fi
    
    echo ""
    log "Пауза 5 сек..."
    sleep 5
    echo ""
done

# Финальная очистка кэша через 10 минут после последней игры
log "Установка завершена, очистка кэша через 10 минут..."
(sleep 600 && clean_cache) &

log "════════════════════════════════════════════"
log "✓ Успешно: $OK/$TOTAL"
[ $FAIL -gt 0 ] && err "✗ Неудачно: $FAIL"
log "$SUCCESS | $LOG"
