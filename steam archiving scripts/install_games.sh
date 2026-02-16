#!/bin/bash
set -uo pipefail

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; NC='\033[0m'
log() { echo -e "${G}[$(date '+%H:%M:%S')]${NC} $1"; }
err() { echo -e "${R}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${Y}[$(date '+%H:%M:%S')]${NC} $1"; }

STEAMCMD="$HOME/steamcmd/steamcmd.sh"
GAME_LANG="russian"
CACHE_SAFETY_GB=10
LOCAL_DOWNLOAD_DIR="$HOME/steam_downloads"

# Очистка при прерывании (Ctrl+C, завершение)
cleanup_on_exit() {
    echo ""
    warn "Прерывание! Очистка..."
    rm -f "/tmp/login_$$.txt"
    if [ -n "${CURRENT_LOCAL_DIR:-}" ] && [ -d "$CURRENT_LOCAL_DIR" ]; then
        warn "Удаление частичной загрузки: $CURRENT_LOCAL_DIR"
        rm -rf "$CURRENT_LOCAL_DIR"
    fi
    warn "Очистка завершена"
    exit 1
}
trap cleanup_on_exit INT TERM

# Использование
if [ $# -lt 1 ]; then
    echo "Использование: $0 <файл_appid> [директория_установки]"
    echo ""
    echo "Примеры:"
    echo "  $0 my_games.txt"
    echo "  $0 my_games.txt /mnt/ARCHIVE1/steam"
    echo "  $0 my_games.txt /media/repeater/ARCHIVE11/steam"
    echo ""
    echo "По умолчанию: /media/repeater/ARCHIVE11/steam"
    echo ""
    echo "Игры сначала скачиваются в $HOME/steam_downloads,"
    echo "потом копируются на HDD, потом удаляются с компьютера."
    exit 1
fi

APPID_FILE="$1"
INSTALL_DIR="${2:-/media/repeater/ARCHIVE11/steam}"

[ ! -f "$APPID_FILE" ] && { err "Файл не найден: $APPID_FILE"; exit 1; }
[ ! -f "$STEAMCMD" ] && { err "SteamCMD не найден!"; exit 1; }

mkdir -p "$INSTALL_DIR"
mkdir -p "$LOCAL_DOWNLOAD_DIR"

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
log "Локальная папка: $LOCAL_DOWNLOAD_DIR"
log "HDD директория: $INSTALL_DIR"
log "Схема: скачать → скопировать на HDD → удалить локально"
log "════════════════════════════════════════════"

read -p "Логин: " STEAM_USER
read -sp "Пароль: " STEAM_PASS
echo ""
echo ""

# Авторизация
log "Авторизация..."
log "Подтвердите вход в мобильном приложении Steam!"
echo ""

umask 077
cat > /tmp/login_$$.txt << EOF
login $STEAM_USER $STEAM_PASS
@NoPromptForPassword 1
quit
EOF
umask 022

"$STEAMCMD" +runscript /tmp/login_$$.txt

rm -f /tmp/login_$$.txt

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
    LOCAL_DIR="$LOCAL_DOWNLOAD_DIR/$APPID"
    CURRENT_LOCAL_DIR="$LOCAL_DIR"
    DIR="$INSTALL_DIR/$APPID"
    
    log "════════════════════════════════════════════"
    log "[$((i+1))/$TOTAL] AppID: $APPID"
    log "════════════════════════════════════════════"
    
    # Пропуск уже установленных игр
    if [ -d "$DIR" ] && [ -n "$(find "$DIR" -type f -size +10M 2>/dev/null | head -1)" ]; then
        SIZE=$(du -sh "$DIR" 2>/dev/null | cut -f1)
        log "⏭ Уже установлен на HDD ($SIZE), пропускаем"
        echo "$APPID|$APPID|$SIZE|$(date)|skipped" >> "$SUCCESS"
        ((OK++))
        continue
    fi
    
    # Проверка доступности HDD
    if ! mountpoint -q "$(df "$INSTALL_DIR" 2>/dev/null | tail -1 | awk '{print $NF}')" 2>/dev/null && [ ! -d "$INSTALL_DIR" ]; then
        err "HDD недоступен: $INSTALL_DIR"
        err "Проверьте подключение диска!"
        ((FAIL++))
        continue
    fi
    
    # Проверка места (предполагаем ~5GB на игру, если нужно точнее - можно добавить API запрос)
    check_disk_space 5
    
    [ -d "$LOCAL_DIR" ] && rm -rf "$LOCAL_DIR"
    
    echo ""
    
    # Запуск установки с прогрессом и ionice
    # Скачиваем в локальную папку на основном диске
    IONICE_CMD=""
    if command -v ionice &> /dev/null; then
        IONICE_CMD="ionice -c2 -n7"
        log "Используем ionice для снижения нагрузки на диск"
    fi
    
    log "Скачиваем в локальную папку: $LOCAL_DIR"
    
    $IONICE_CMD "$STEAMCMD" \
        +@ShutdownOnFailedCommand 0 \
        +@NoPromptForPassword 1 \
        +login "$STEAM_USER" \
        +force_install_dir "$LOCAL_DIR" \
        +app_update "$APPID" -language "$GAME_LANG" \
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
    
    # Проверка результата скачивания
    if [ -d "$LOCAL_DIR" ] && [ -n "$(find "$LOCAL_DIR" -type f -size +10M 2>/dev/null | head -1)" ]; then
        SIZE=$(du -sh "$LOCAL_DIR" 2>/dev/null | cut -f1)
        LOCAL_BYTES=$(du -sb "$LOCAL_DIR" 2>/dev/null | cut -f1)
        log "✓ Скачано локально: $SIZE"
        
        # Копирование на HDD
        log "Копирование на HDD: $DIR ..."
        [ -d "$DIR" ] && rm -rf "$DIR"
        
        if cp -a "$LOCAL_DIR" "$DIR"; then
            sync
            
            # Верификация копирования — сравнение размеров
            HDD_BYTES=$(du -sb "$DIR" 2>/dev/null | cut -f1)
            if [ "$LOCAL_BYTES" = "$HDD_BYTES" ]; then
                log "✓ Скопировано на HDD (верифицировано: ${SIZE})"
                
                # Удаление локальной копии
                rm -rf "$LOCAL_DIR"
                CURRENT_LOCAL_DIR=""
                log "✓ Локальная копия удалена"
                
                echo "$APPID|$APPID|$SIZE|$(date)" >> "$SUCCESS"
                ((OK++))
            else
                err "✗ Ошибка верификации! Локально: ${LOCAL_BYTES}B, HDD: ${HDD_BYTES}B"
                err "Локальная копия сохранена в: $LOCAL_DIR"
                CURRENT_LOCAL_DIR=""
                ((FAIL++))
            fi
        else
            err "✗ Ошибка копирования на HDD"
            ((FAIL++))
        fi
    else
        err "✗ Не скачан"
        ((FAIL++))
        [ -d "$LOCAL_DIR" ] && rm -rf "$LOCAL_DIR"
    fi
    
    CURRENT_LOCAL_DIR=""
    echo ""
    log "Пауза 5 сек..."
    sleep 5
    echo ""
done

# Финальная очистка кэша через 10 минут после последней игры
log "Установка завершена, очистка кэша через 10 минут..."
(sleep 600 && clean_cache) &

# Удаление локальной папки если пуста
rmdir "$LOCAL_DOWNLOAD_DIR" 2>/dev/null

log "════════════════════════════════════════════"
log "✓ Успешно: $OK/$TOTAL"
[ $FAIL -gt 0 ] && err "✗ Неудачно: $FAIL"
log "$SUCCESS | $LOG"
