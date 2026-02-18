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
MIN_GAME_SIZE_BYTES=1048576  # 1MB — меньше = подозрительно (возможно только метаданные)

# Настройки rsync и восстановления HDD
RSYNC_TIMEOUT=300       # Таймаут бездействия rsync (секунды): если нет прогресса — значит завис
RSYNC_MAX_RETRIES=3     # Максимум попыток копирования
HDD_RECOVER_WAIT=10     # Секунды ожидания после повторной монтировки

# Dirty page tuning для предотвращения зависания при копировании на USB HDD
# Проблема: Linux с 64GB RAM позволяет до ~6.4GB грязных страниц (10% RAM).
# При копировании с быстрого SSD на медленный USB HDD ядро накапливает огромный
# буфер, а потом пытается сбросить его разом — USB контроллер не справляется и зависает.
# Решение: ограничить dirty pages до маленьких значений, чтобы данные писались постоянно.
DIRTY_BYTES=50331648            # 48MB — макс. dirty pages до блокировки записи
DIRTY_BACKGROUND_BYTES=16777216 # 16MB — порог начала фоновой записи
SAVED_DIRTY_BYTES=""
SAVED_DIRTY_BG_BYTES=""

tune_dirty_pages() {
    if [ -r /proc/sys/vm/dirty_bytes ]; then
        SAVED_DIRTY_BYTES=$(cat /proc/sys/vm/dirty_bytes)
        SAVED_DIRTY_BG_BYTES=$(cat /proc/sys/vm/dirty_background_bytes)
        if sudo sysctl -q vm.dirty_bytes=$DIRTY_BYTES vm.dirty_background_bytes=$DIRTY_BACKGROUND_BYTES 2>/dev/null; then
            log "Dirty pages ограничены (48MB/16MB) для стабильного копирования на USB"
        else
            warn "Не удалось настроить dirty pages (нужен sudo)"
        fi
    fi
}

restore_dirty_pages() {
    if [ -n "$SAVED_DIRTY_BYTES" ]; then
        sudo sysctl -q vm.dirty_bytes="$SAVED_DIRTY_BYTES" vm.dirty_background_bytes="$SAVED_DIRTY_BG_BYTES" 2>/dev/null
        SAVED_DIRTY_BYTES=""
        SAVED_DIRTY_BG_BYTES=""
    fi
}

# ionice для снижения нагрузки на диск (best-effort, низкий приоритет)
IONICE_CMD=""
if command -v ionice &> /dev/null; then
    IONICE_CMD="ionice -c2 -n7"
fi

# Безопасный временный файл для вывода DepotDownloader
DD_OUTPUT=$(mktemp /tmp/dd_output.XXXXXX)

# Очистка при прерывании (Ctrl+C, завершение)
cleanup_on_exit() {
    echo ""
    warn "Прерывание! Очистка..."
    restore_dirty_pages
    rm -f "$DD_OUTPUT"
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

# Попытка восстановления зависшего USB HDD
# Unmount → power-cycle USB → remount → проверка
recover_hdd() {
    local mount_dir="$1"
    
    warn "Попытка восстановления HDD: $mount_dir"
    
    # Определяем блочное устройство для точки монтирования
    local dev
    dev=$(findmnt -n -o SOURCE "$mount_dir" 2>/dev/null)
    
    if [ -z "$dev" ]; then
        warn "Не могу определить устройство для $mount_dir"
        warn "Попробуйте переподключить HDD вручную"
        warn "Ожидание 30 секунд..."
        sleep 30
        # Проверяем, вернулся ли HDD
        if mountpoint -q "$mount_dir" 2>/dev/null; then
            log "HDD доступен после ожидания"
            return 0
        fi
        return 1
    fi
    
    log "Устройство: $dev"
    
    # 1. Сброс буферов
    warn "Сброс буферов (sync)..."
    sync 2>/dev/null
    
    # 2. Пробуем мягкий сброс: unmount → mount
    # Требует sudo (настройте NOPASSWD для mount/umount если нужно автоматическое восстановление)
    warn "Попытка ремонтирования..."
    if sudo umount "$mount_dir" 2>/dev/null; then
        sleep 2
        if sudo mount "$dev" "$mount_dir" 2>/dev/null; then
            sleep "$HDD_RECOVER_WAIT"
            if mountpoint -q "$mount_dir" 2>/dev/null; then
                log "✓ HDD восстановлен через перемонтирование"
                return 0
            fi
        fi
    fi
    
    # 3. Если мягкий сброс не помог, ждём ручного переподключения
    warn "Автоматическое восстановление не удалось"
    warn "Переподключите HDD вручную и нажмите Enter..."
    read -r
    
    if mountpoint -q "$mount_dir" 2>/dev/null; then
        log "✓ HDD доступен"
        return 0
    fi
    
    return 1
}

# rsync с таймаутом и авто-восстановлением
# Использует --timeout rsync (I/O таймаут) + retry логику
rsync_with_retry() {
    local src="$1"
    local dst="$2"
    local mount_dir="$3"
    local attempt
    
    for ((attempt=1; attempt<=RSYNC_MAX_RETRIES; attempt++)); do
        if [ "$attempt" -gt 1 ]; then
            warn "Попытка копирования $attempt/$RSYNC_MAX_RETRIES"
        fi
        
        # --timeout: I/O таймаут (если нет данных N секунд — rsync выходит с ошибкой)
        # --partial: сохранять частично переданные файлы
        # --partial-dir: класть частичные файлы в отдельную папку
        if $IONICE_CMD rsync -a --info=progress2 \
            --timeout="$RSYNC_TIMEOUT" \
            --partial --partial-dir=.rsync-partial \
            "$src" "$dst"; then
            # Удаляем папку с частичными файлами если осталась
            rm -rf "${dst}/.rsync-partial" 2>/dev/null
            return 0
        fi
        
        local rsync_exit=$?
        warn "rsync завершился с кодом $rsync_exit"
        
        if [ "$attempt" -lt "$RSYNC_MAX_RETRIES" ]; then
            warn "Копирование зависло или прервалось. Восстановление HDD..."
            
            if recover_hdd "$mount_dir"; then
                log "Повторяем копирование..."
                sleep 3
            else
                err "HDD не восстановлен"
                return 1
            fi
        fi
    done
    
    err "Все $RSYNC_MAX_RETRIES попыток копирования неудачны"
    return 1
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
if [ -n "$IONICE_CMD" ]; then
    log "Используем ionice для снижения нагрузки на диск"
fi
log "Dirty pages будут ограничены при копировании на USB HDD (предотвращение зависаний)"
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

# Результаты — в подпапку results/TIMESTAMP/
TS=$(date +%Y%m%d_%H%M%S)
RESULTS_DIR="results/${TS}"
mkdir -p "$RESULTS_DIR"

LOG="$RESULTS_DIR/install.log"
SUCCESS="$RESULTS_DIR/installed.txt"
FAILED="$RESULTS_DIR/failed.txt"
WARNINGS="$RESULTS_DIR/warnings.txt"

touch "$SUCCESS" "$FAILED" "$WARNINGS"

OK=0; FAIL=0; WARN=0
FAILED_APPIDS=()
WARNED_APPIDS=()

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
        FAILED_APPIDS+=("$APPID")
        ((FAIL++))
        continue
    fi
    
    # Проверка места
    if ! check_disk_space 15; then
        err "Недостаточно места на основном диске"
        FAILED_APPIDS+=("$APPID")
        ((FAIL++))
        continue
    fi
    
    [ -d "$LOCAL_DIR" ] && rm -rf "$LOCAL_DIR"
    mkdir -p "$LOCAL_DIR"
    
    echo ""
    log "Скачиваем в: $LOCAL_DIR"
    
    # Скачивание через DepotDownloader
    # Пробуем комбинации: язык (russian → english) × платформа (linux → windows)
    # 5-й вариант: все платформы, без языкового фильтра (скачивает всё что есть)
    DOWNLOAD_OK=false
    TRIED=""
    for TRY_LANG in "$GAME_LANG" "english"; do
        for TRY_OS in "$GAME_OS" "windows"; do
            # Не пробуем одну комбинацию дважды
            KEY="${TRY_OS}:${TRY_LANG}"
            case "$TRIED" in *"$KEY"*) continue ;; esac
            TRIED="$TRIED $KEY"
            
            log "Платформа: $TRY_OS, язык: $TRY_LANG"
            
            $IONICE_CMD "$DEPOT_DOWNLOADER" \
                -app "$APPID" \
                -username "$STEAM_USER" -remember-password \
                -language "$TRY_LANG" \
                -os "$TRY_OS" \
                -dir "$LOCAL_DIR" \
                2>&1 | tee -a "$LOG" | tee "$DD_OUTPUT" | while IFS= read -r line; do
                    # Показываем только строки с процентом загрузки
                    if [[ "$line" =~ ([0-9]+(\.[0-9]+)?%) ]]; then
                        printf "\r\033[K  %s" "${BASH_REMATCH[0]}"
                    fi
                done
            echo ""
            
            # Если нет депотов — пробуем следующую комбинацию
            if grep -q "Couldn't find any depots" "$DD_OUTPUT" 2>/dev/null; then
                warn "Нет депотов для $TRY_OS/$TRY_LANG"
                rm -rf "$LOCAL_DIR"
                mkdir -p "$LOCAL_DIR"
                continue
            fi
            
            DOWNLOAD_OK=true
            break 2
        done
    done
    
    # 5-й вариант: все платформы, без языкового фильтра
    if [ "$DOWNLOAD_OK" = false ]; then
        warn "Все комбинации ОС/язык не дали результата"
        log "Попытка: все платформы, без языкового фильтра"
        
        $IONICE_CMD "$DEPOT_DOWNLOADER" \
            -app "$APPID" \
            -username "$STEAM_USER" -remember-password \
            -all-platforms \
            -dir "$LOCAL_DIR" \
            2>&1 | tee -a "$LOG" | tee "$DD_OUTPUT" | while IFS= read -r line; do
                # Показываем только строки с процентом загрузки
                if [[ "$line" =~ ([0-9]+(\.[0-9]+)?%) ]]; then
                    printf "\r\033[K  %s" "${BASH_REMATCH[0]}"
                fi
            done
        echo ""
        
        if ! grep -q "Couldn't find any depots" "$DD_OUTPUT" 2>/dev/null; then
            DOWNLOAD_OK=true
        else
            warn "Нет депотов даже без фильтров"
        fi
    fi
    rm -f "$DD_OUTPUT"
    
    echo ""
    
    # Проверка результата скачивания (любые файлы = успех)
    if [ -d "$LOCAL_DIR" ] && [ -n "$(find "$LOCAL_DIR" -type f 2>/dev/null | head -1)" ]; then
        SIZE=$(du -sh "$LOCAL_DIR" 2>/dev/null | cut -f1)
        LOCAL_BYTES=$(du -sb "$LOCAL_DIR" 2>/dev/null | cut -f1)
        log "✓ Скачано локально: $SIZE"
        
        # Копирование на HDD (с автовосстановлением при зависании)
        # Ограничиваем dirty pages чтобы USB HDD не зависал
        tune_dirty_pages
        log "Копирование на HDD: $DIR ..."
        [ -d "$DIR" ] && rm -rf "$DIR"
        
        # Определяем точку монтирования для HDD
        MOUNT_POINT=$(df "$INSTALL_DIR" 2>/dev/null | tail -1 | awk '{print $6}')
        [ -z "$MOUNT_POINT" ] && MOUNT_POINT="$INSTALL_DIR"
        
        if rsync_with_retry "$LOCAL_DIR/" "$DIR" "$MOUNT_POINT"; then
            restore_dirty_pages
            
            # Верификация копирования
            HDD_BYTES=$(du -sb "$DIR" 2>/dev/null | cut -f1)
            if [ "$LOCAL_BYTES" = "$HDD_BYTES" ]; then
                log "✓ Скопировано на HDD (верифицировано: ${SIZE})"
                
                rm -rf "$LOCAL_DIR"
                CURRENT_LOCAL_DIR=""
                # Очистка кэша .steam чтобы не копилось
                rm -rf "${HOME:?}/.steam/debian-installation/steamapps/shadercache/$APPID" 2>/dev/null
                log "✓ Локальная копия удалена"
                
                echo "$APPID" >> "$SUCCESS"
                ((OK++))
                
                # Предупреждение: подозрительно маленькая игра (< 1MB)
                if [ "$LOCAL_BYTES" -lt "$MIN_GAME_SIZE_BYTES" ]; then
                    warn "⚠ AppID $APPID очень маленький ($SIZE) — возможно скачались только метаданные"
                    WARNED_APPIDS+=("$APPID")
                    ((WARN++))
                fi
            else
                err "✗ Ошибка верификации! Локально: ${LOCAL_BYTES}B, HDD: ${HDD_BYTES}B"
                err "Локальная копия сохранена: $LOCAL_DIR"
                CURRENT_LOCAL_DIR=""
                FAILED_APPIDS+=("$APPID")
                ((FAIL++))
            fi
        else
            restore_dirty_pages
            err "✗ Ошибка копирования на HDD"
            FAILED_APPIDS+=("$APPID")
            ((FAIL++))
        fi
    else
        err "✗ Не скачан (нет файлов)"
        FAILED_APPIDS+=("$APPID")
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

# Восстановление системных настроек dirty pages
restore_dirty_pages

# Запись итогов в файлы
# Формат success/failed/warnings — как входной файл (AppID по одному на строку)
echo "# OK: $OK/$TOTAL" >> "$SUCCESS"

if [ ${#FAILED_APPIDS[@]} -gt 0 ]; then
    for fid in "${FAILED_APPIDS[@]}"; do
        echo "$fid" >> "$FAILED"
    done
fi
echo "# FAILED: $FAIL/$TOTAL" >> "$FAILED"

if [ ${#WARNED_APPIDS[@]} -gt 0 ]; then
    for wid in "${WARNED_APPIDS[@]}"; do
        echo "$wid" >> "$WARNINGS"
    done
fi
echo "# WARNINGS: $WARN/$TOTAL (подозрительно маленькие, проверьте вручную)" >> "$WARNINGS"

log "════════════════════════════════════════════"
log "✓ Успешно: $OK/$TOTAL"
[ $FAIL -gt 0 ] && err "✗ Неудачно: $FAIL"
[ $WARN -gt 0 ] && warn "⚠ Предупреждения: $WARN (подозрительно маленькие)"
log "Результаты: $RESULTS_DIR/"
log "  Лог:          $LOG"
log "  Успешные:     $SUCCESS"
log "  Неудачные:    $FAILED"
log "  Подозрительные: $WARNINGS"
