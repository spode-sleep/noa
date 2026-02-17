#!/bin/bash
set -uo pipefail

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; NC='\033[0m'
log() { echo -e "${G}[$(date '+%H:%M:%S')]${NC} $1"; }
err() { echo -e "${R}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${Y}[$(date '+%H:%M:%S')]${NC} $1"; }

DEPOT_DOWNLOADER="$HOME/depotdownloader/DepotDownloader"
GAME_LANG="russian"
GAME_OS="linux"
LOCAL_DOWNLOAD_DIR="$HOME/steam_downloads"

# Очистка при прерывании (Ctrl+C, завершение)
cleanup_on_exit() {
    echo ""
    warn "Прерывание! Очистка..."
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
    echo "Используется DepotDownloader (https://github.com/SteamRE/DepotDownloader)"
    echo "Игры сначала скачиваются в $HOME/steam_downloads,"
    echo "потом копируются на HDD, потом удаляются с компьютера."
    exit 1
fi

APPID_FILE="$1"
INSTALL_DIR="${2:-/media/repeater/ARCHIVE11/steam}"

[ ! -f "$APPID_FILE" ] && { err "Файл не найден: $APPID_FILE"; exit 1; }

# Проверка DepotDownloader
if [ ! -x "$DEPOT_DOWNLOADER" ]; then
    err "DepotDownloader не найден: $DEPOT_DOWNLOADER"
    echo ""
    echo "Установка:"
    echo "  mkdir -p ~/depotdownloader && cd ~/depotdownloader"
    echo "  curl -sqL https://github.com/SteamRE/DepotDownloader/releases/download/DepotDownloader_3.4.0/DepotDownloader-linux-x64.zip -o dd.zip"
    echo "  unzip dd.zip && chmod +x DepotDownloader && rm dd.zip"
    exit 1
fi

mkdir -p "$INSTALL_DIR"
mkdir -p "$LOCAL_DOWNLOAD_DIR"

# Функция проверки места
check_disk_space() {
    local required_gb=$1
    local available_gb
    available_gb=$(df -BG / | tail -1 | awk '{print $4}' | sed 's/G//')
    
    if [ "$available_gb" -lt "$required_gb" ]; then
        warn "Мало места на основном диске (нужно ${required_gb}GB, доступно ${available_gb}GB)"
        return 1
    fi
    return 0
}

# Читаем AppID
mapfile -t APPIDS < <(grep -v '^#' "$1" | grep -v '^[[:space:]]*$' | tr -d '\r' | xargs -n1)
TOTAL=${#APPIDS[@]}
[ "$TOTAL" -eq 0 ] && { err "Нет AppID!"; exit 1; }

log "════════════════════════════════════════════"
log "Установка $TOTAL игр (DepotDownloader)"
log "Локальная папка: $LOCAL_DOWNLOAD_DIR"
log "HDD директория: $INSTALL_DIR"
log "Схема: скачать → скопировать на HDD → удалить локально"
log "════════════════════════════════════════════"

read -p "Логин Steam: " STEAM_USER
echo ""

# Первый запуск — авторизация и сохранение пароля
# Используем AppID 730 (CS2, бесплатная) с -manifest-only для проверки авторизации без скачивания
# НЕ перенаправляем вывод — DepotDownloader запросит пароль и Steam Guard интерактивно
log "Авторизация..."
"$DEPOT_DOWNLOADER" -app 730 -depot 731 -manifest-only \
    -username "$STEAM_USER" -remember-password
echo ""
log "✓ Авторизация завершена"
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
    
    # Проверка доступности HDD
    if [ ! -d "$INSTALL_DIR" ]; then
        err "HDD недоступен: $INSTALL_DIR"
        err "Проверьте подключение диска!"
        ((FAIL++))
        continue
    fi
    
    # Проверка места
    if ! check_disk_space 15; then
        err "Недостаточно места на основном диске"
        ((FAIL++))
        continue
    fi
    
    [ -d "$LOCAL_DIR" ] && rm -rf "$LOCAL_DIR"
    mkdir -p "$LOCAL_DIR"
    
    echo ""
    log "Скачиваем в: $LOCAL_DIR"
    
    # Скачивание через DepotDownloader
    # -remember-password использует сохранённую сессию
    # -language задаёт язык контента
    # -os задаёт платформу
    # -dir задаёт директорию для скачивания
    if "$DEPOT_DOWNLOADER" \
        -app "$APPID" \
        -username "$STEAM_USER" -remember-password \
        -language "$GAME_LANG" \
        -os "$GAME_OS" \
        -dir "$LOCAL_DIR" \
        2>&1 | tee -a "$LOG"; then
        
        echo ""
        
        # Проверка результата скачивания
        if [ -d "$LOCAL_DIR" ] && [ -n "$(find "$LOCAL_DIR" -type f -size +1M 2>/dev/null | head -1)" ]; then
            SIZE=$(du -sh "$LOCAL_DIR" 2>/dev/null | cut -f1)
            LOCAL_BYTES=$(du -sb "$LOCAL_DIR" 2>/dev/null | cut -f1)
            log "✓ Скачано локально: $SIZE"
            
            # Копирование на HDD
            log "Копирование на HDD: $DIR ..."
            [ -d "$DIR" ] && rm -rf "$DIR"
            
            if rsync -a --info=progress2 "$LOCAL_DIR/" "$DIR"; then
                
                # Верификация копирования
                HDD_BYTES=$(du -sb "$DIR" 2>/dev/null | cut -f1)
                if [ "$LOCAL_BYTES" = "$HDD_BYTES" ]; then
                    log "✓ Скопировано на HDD (верифицировано: ${SIZE})"
                    
                    rm -rf "$LOCAL_DIR"
                    CURRENT_LOCAL_DIR=""
                    log "✓ Локальная копия удалена"
                    
                    echo "$APPID|$APPID|$SIZE|$(date)" >> "$SUCCESS"
                    ((OK++))
                else
                    err "✗ Ошибка верификации! Локально: ${LOCAL_BYTES}B, HDD: ${HDD_BYTES}B"
                    err "Локальная копия сохранена: $LOCAL_DIR"
                    CURRENT_LOCAL_DIR=""
                    ((FAIL++))
                fi
            else
                err "✗ Ошибка копирования на HDD"
                ((FAIL++))
            fi
        else
            err "✗ Не скачан (пустая директория)"
            ((FAIL++))
            [ -d "$LOCAL_DIR" ] && rm -rf "$LOCAL_DIR"
        fi
    else
        err "✗ DepotDownloader вернул ошибку"
        ((FAIL++))
        [ -d "$LOCAL_DIR" ] && rm -rf "$LOCAL_DIR"
    fi
    
    CURRENT_LOCAL_DIR=""
    echo ""
    log "Пауза 3 сек..."
    sleep 3
    echo ""
done

# Удаление локальной папки если пуста
rmdir "$LOCAL_DOWNLOAD_DIR" 2>/dev/null

log "════════════════════════════════════════════"
log "✓ Успешно: $OK/$TOTAL"
[ $FAIL -gt 0 ] && err "✗ Неудачно: $FAIL"
log "Результаты: $SUCCESS"
log "Лог: $LOG"
