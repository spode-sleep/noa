#!/bin/bash
# download-zim-library.sh — Автоматическая загрузка ZIM-архивов для оффлайн-библиотеки NOA
#
# Использование:
#   ./download-zim-library.sh [TIER] [DOWNLOAD_DIR]
#
# TIER:
#   minimal  — ~80 GB: Wiktionary, Gutenberg, MedlinePlus (основа)
#   optimal  — ~180 GB: + Stack Overflow, Wikibooks, наука, Wikisource, PhET
#   full     — ~290 GB: + всё остальное из рекомендованного списка
#   custom   — только архивы из файла $DOWNLOAD_DIR/custom-zim-list.txt (по одному имени на строку)
#
# DOWNLOAD_DIR — куда скачивать (по умолчанию ~/zim-library)
#
# Примеры:
#   ./download-zim-library.sh minimal ~/my-zims
#   ./download-zim-library.sh full /media/user/HDD/ZIM
#   ./download-zim-library.sh                          # по умолчанию: optimal, ~/zim-library
#
# Особенности:
#   - DevDocs ZIM НЕ скачиваются (пользователь загружает их отдельно)
#   - Поддержка докачки (wget -c)
#   - Проверка SHA256 при наличии .sha256 файлов
#   - Лог всех операций
#   - Пропуск уже скачанных файлов
#   - Отдельная команда для зеркалирования документации Minecraft-модов

set -uo pipefail

# ─── Цвета ───────────────────────────────────────────────────────────────────
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; C='\033[0;36m'; B='\033[1m'; NC='\033[0m'
log()  { echo -e "${G}[$(date '+%H:%M:%S')]${NC} $1"; }
err()  { echo -e "${R}[$(date '+%H:%M:%S')] ❌${NC} $1"; }
warn() { echo -e "${Y}[$(date '+%H:%M:%S')] ⚠${NC} $1"; }
info() { echo -e "${C}[$(date '+%H:%M:%S')] ℹ${NC} $1"; }

# ─── Параметры ───────────────────────────────────────────────────────────────
TIER="${1:-optimal}"
DOWNLOAD_DIR="${2:-$HOME/zim-library}"
KIWIX_BASE="https://download.kiwix.org/zim"
LOG_FILE="$DOWNLOAD_DIR/download.log"
FAILED_FILE="$DOWNLOAD_DIR/failed.txt"
WGET_OPTS="--continue --timeout=60 --tries=3 --waitretry=5"
DOWNLOADED=0
FAILED=0
SKIPPED=0

# ─── ZIM-архивы по тирам ─────────────────────────────────────────────────────
# Формат: "подпапка_на_kiwix/имя_файла_без_даты"
# Скрипт найдёт последнюю версию автоматически.

# 🔴 Минимальный набор (~80 GB)
TIER_MINIMAL=(
    # Словари
    "wiktionary/wiktionary_ru_all_maxi"
    "wiktionary/wiktionary_en_all_maxi"
    # Медицина
    "other/medlineplus.gov_en_all"
    # Литература
    "gutenberg/gutenberg_en_all"
)

# 🟡 Оптимальный набор (добавляет ~100 GB)
TIER_OPTIMAL=(
    # Программирование
    "stack_exchange/stackoverflow.com_en_all"
    "other/devdocs_en_all"
    "stack_exchange/superuser.com_en_all"
    "stack_exchange/askubuntu.com_en_all"
    "stack_exchange/unix.stackexchange.com_en_all"
    "stack_exchange/serverfault.com_en_all"
    "other/freecodecamp_en_all"
    # Наука
    "stack_exchange/mathematics.stackexchange.com_en_all"
    "stack_exchange/physics.stackexchange.com_en_all"
    "stack_exchange/chemistry.stackexchange.com_en_all"
    "stack_exchange/biology.stackexchange.com_en_all"
    "stack_exchange/astronomy.stackexchange.com_en_all"
    "phet/phet_en_all"
    # Образование
    "wikibooks/wikibooks_ru_all"
    "wikibooks/wikibooks_en_all_maxi"
    "wikiversity/wikiversity_en_all_maxi"
    # Медицина (расширено)
    "other/fas-military-medicine_en"
    "other/nhs.uk_en_medicines"
    # Литература
    "wikisource/wikisource_ru_all_maxi"
    "wikisource/wikisource_en_all_maxi"
    "wikiquote/wikiquote_ru_all_maxi"
    "wikiquote/wikiquote_en_all_maxi"
    # Устойчивое развитие
    "other/appropedia_en_all_maxi"
    # Учебники (академические)
    "stack_exchange/stats.stackexchange.com_en_all"
    "stack_exchange/cs.stackexchange.com_en_all"
    "stack_exchange/datascience.stackexchange.com_en_all"
)

# 🟢 Полный набор (добавляет ещё ~110 GB)
TIER_FULL=(
    # Программирование (полный)
    "other/docs.python.org_en"
    # Образование (полный)
    "other/libretexts_en_all"
    "videos/crashcourse_en_all"
    "ted/ted_en_all"
    # DIY & Repair
    "stack_exchange/diy.stackexchange.com_en_all"
    "stack_exchange/3dprinting.stackexchange.com_en_all"
    "stack_exchange/arduino.stackexchange.com_en_all"
    # Sustainability
    "other/energypedia_en_all_maxi"
    "other/cd3wdproject.org_en_all"
    "zimit/100r.co_en_all"
    "stack_exchange/sustainability.stackexchange.com_en_all"
    # Outdoors
    "stack_exchange/gardening.stackexchange.com_en_all"
    "stack_exchange/outdoors.stackexchange.com_en_all"
    "stack_exchange/bicycles.stackexchange.com_en_all"
    "stack_exchange/pets.stackexchange.com_en_all"
    # Electronics
    "stack_exchange/electronics.stackexchange.com_en_all"
    "stack_exchange/engineering.stackexchange.com_en_all"
    # Travel
    "wikivoyage/wikivoyage_en_all_maxi"
    # Security
    "zimit/anonymousplanet.org_en_all"
    "stack_exchange/security.stackexchange.com_en_all"
    # Finance
    "stack_exchange/money.stackexchange.com_en_all"
    # Music & Art (творчество)
    "stack_exchange/music.stackexchange.com_en_all"
    "zimit/openmusictheory.com_en_all"
    # Optional
    "vikidia/vikidia_en_all"
    "other/cheatography.com_en_all"
    # Minecraft-related
    "stack_exchange/gaming.stackexchange.com_en_all"
)

# ─── Функции ─────────────────────────────────────────────────────────────────

usage() {
    echo -e "${B}Использование:${NC} $0 [TIER] [DOWNLOAD_DIR]"
    echo ""
    echo -e "  TIER: ${G}minimal${NC} | ${Y}optimal${NC} (default) | ${R}full${NC} | ${C}custom${NC}"
    echo "  DOWNLOAD_DIR: куда скачивать (default: ~/zim-library)"
    echo ""
    echo -e "  ${G}minimal${NC}  ~80 GB  — Wiktionary, MedlinePlus, Gutenberg"
    echo -e "  ${Y}optimal${NC}  ~180 GB — + SO, Wikibooks, наука, Wikisource, PhET"
    echo -e "  ${R}full${NC}     ~290 GB — + всё остальное"
    echo -e "  ${C}custom${NC}   — из файла \$DOWNLOAD_DIR/custom-zim-list.txt"
    echo ""
    echo "Дополнительные команды:"
    echo "  $0 minecraft [DOCS_DIR]  — скачать документацию Minecraft-модов"
    echo "  $0 list [TIER]           — показать список архивов без скачивания"
}

# Найти последнюю версию ZIM-файла на kiwix.org
# Аргумент: "subfolder/basename" (напр. "wikipedia/wikipedia_en_all_maxi")
find_latest_zim_url() {
    local spec="$1"
    local subfolder="${spec%%/*}"
    local basename="${spec#*/}"
    local index_url="$KIWIX_BASE/$subfolder/"

    # Получаем список файлов из индекса, ищем последнюю версию
    local latest
    latest=$(wget -q -O - "$index_url" 2>/dev/null \
        | grep -oP "href=\"${basename}_[0-9]{4}-[0-9]{2}\.zim\"" \
        | sed 's/href="//;s/"//' \
        | sort -V \
        | tail -1)

    if [ -z "$latest" ]; then
        # Попробуем без даты (некоторые файлы имеют другой формат)
        latest=$(wget -q -O - "$index_url" 2>/dev/null \
            | grep -oP "href=\"${basename}[^\"]*\.zim\"" \
            | sed 's/href="//;s/"//' \
            | grep -v '.meta4' \
            | grep -v '.sha256' \
            | sort -V \
            | tail -1)
    fi

    if [ -n "$latest" ]; then
        echo "$KIWIX_BASE/$subfolder/$latest"
    fi
}

# Скачать один ZIM-файл с проверкой
download_zim() {
    local spec="$1"
    local basename="${spec#*/}"

    log "Поиск последней версии: ${B}$basename${NC}..."
    local url
    url=$(find_latest_zim_url "$spec")

    if [ -z "$url" ]; then
        err "Не найден ZIM для: $spec"
        echo "$spec" >> "$FAILED_FILE"
        ((FAILED++))
        return 1
    fi

    local filename
    filename=$(basename "$url")
    local filepath="$DOWNLOAD_DIR/$filename"

    # Пропускаем если уже есть файл с таким именем (без .part)
    if [ -f "$filepath" ] && [ ! -f "${filepath}.part" ]; then
        info "Уже скачан: $filename — пропускаю"
        ((SKIPPED++))
        return 0
    fi

    # Также пропускаем если есть файл с таким же базовым именем но другой датой
    local existing
    existing=$(find "$DOWNLOAD_DIR" -maxdepth 1 -name "${basename}_*.zim" -not -name "*.part" 2>/dev/null | head -1)
    if [ -n "$existing" ]; then
        local existing_name
        existing_name=$(basename "$existing")
        if [ "$existing_name" = "$filename" ]; then
            info "Уже скачан: $filename — пропускаю"
            ((SKIPPED++))
            return 0
        else
            warn "Есть старая версия: $existing_name"
            warn "Скачиваю новую: $filename"
        fi
    fi

    log "Скачиваю: ${B}$filename${NC}"
    log "URL: $url"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] DOWNLOAD $filename $url" >> "$LOG_FILE"

    if wget $WGET_OPTS -O "$filepath" "$url" 2>&1 | tail -5; then
        log "✅ Скачан: $filename"
        ((DOWNLOADED++))

        # Попробуем проверить SHA256
        verify_checksum "$url" "$filepath"
    else
        err "Ошибка загрузки: $filename"
        echo "$spec" >> "$FAILED_FILE"
        ((FAILED++))
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] FAILED $filename" >> "$LOG_FILE"
    fi
}

verify_checksum() {
    local url="$1"
    local filepath="$2"
    local sha_url="${url}.sha256"
    local filename
    filename=$(basename "$filepath")

    local sha_expected
    sha_expected=$(wget -q -O - "$sha_url" 2>/dev/null | awk '{print $1}')
    if [ -n "$sha_expected" ]; then
        info "Проверяю SHA256 для $filename..."
        local sha_actual
        sha_actual=$(sha256sum "$filepath" | awk '{print $1}')
        if [ "$sha_expected" = "$sha_actual" ]; then
            log "✅ SHA256 совпадает: $filename"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] SHA256 OK $filename" >> "$LOG_FILE"
        else
            err "SHA256 НЕ совпадает для $filename!"
            err "  Ожидалось: $sha_expected"
            err "  Получено:  $sha_actual"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] SHA256 MISMATCH $filename" >> "$LOG_FILE"
        fi
    fi
}

# Скачать документацию Minecraft-модов
download_minecraft_docs() {
    local docs_dir="${1:-$HOME/minecraft-mod-docs}"
    mkdir -p "$docs_dir"

    log "═══════════════════════════════════════════════════════════"
    log "  Загрузка документации Minecraft-модов → $docs_dir"
    log "═══════════════════════════════════════════════════════════"

    # Fabric Wiki
    log "📘 Fabric Wiki..."
    wget --mirror --convert-links --adjust-extension --page-requisites \
         --wait=1 --random-wait --no-parent \
         -P "$docs_dir/fabric-wiki" https://wiki.fabricmc.net/ 2>&1 | tail -3
    log "✅ Fabric Wiki сохранена"

    # Fabric Docs (GitHub)
    log "📘 Fabric Docs (GitHub)..."
    if [ -d "$docs_dir/fabric-docs/.git" ]; then
        (cd "$docs_dir/fabric-docs" && git pull)
    else
        git clone --depth=1 https://github.com/FabricMC/fabric-docs "$docs_dir/fabric-docs"
    fi
    log "✅ Fabric Docs клонированы"

    # CC:Tweaked
    log "🐢 CC:Tweaked docs (tweaked.cc)..."
    wget --mirror --convert-links --adjust-extension --page-requisites \
         --wait=1 --random-wait --no-parent \
         -P "$docs_dir/cctweaked" https://tweaked.cc/ 2>&1 | tail -3
    log "✅ CC:Tweaked docs сохранены"

    # CC:Tweaked source (для doc/ папки)
    log "🐢 CC:Tweaked source..."
    if [ -d "$docs_dir/cctweaked-src/.git" ]; then
        (cd "$docs_dir/cctweaked-src" && git pull)
    else
        git clone --depth=1 https://github.com/cc-tweaked/CC-Tweaked "$docs_dir/cctweaked-src"
    fi
    log "✅ CC:Tweaked source клонирован"

    # Create Wiki
    log "⚙️ Create Wiki..."
    if [ -d "$docs_dir/create-wiki/.git" ]; then
        (cd "$docs_dir/create-wiki" && git pull)
    else
        git clone --depth=1 https://github.com/Creators-of-Create/Create.wiki.git "$docs_dir/create-wiki"
    fi
    log "✅ Create Wiki клонирована"

    # Terra Docs
    log "🌍 Terra Docs..."
    wget --mirror --convert-links --adjust-extension --page-requisites \
         --wait=1 --random-wait --no-parent \
         -P "$docs_dir/terra" https://terra.polydev.org/ 2>&1 | tail -3
    log "✅ Terra Docs сохранены"

    # Terra source
    log "🌍 Terra source..."
    if [ -d "$docs_dir/terra-src/.git" ]; then
        (cd "$docs_dir/terra-src" && git pull)
    else
        git clone --depth=1 https://github.com/PolyhedralDev/Terra "$docs_dir/terra-src"
    fi
    log "✅ Terra source клонирован"

    # Gradle Docs
    log "🔨 Gradle Docs..."
    wget --mirror --convert-links --adjust-extension --page-requisites \
         --wait=1 --random-wait --no-parent \
         -P "$docs_dir/gradle" https://docs.gradle.org/current/userguide/userguide.html 2>&1 | tail -3
    log "✅ Gradle Docs сохранены"

    # Maven Docs
    log "📦 Maven Docs..."
    wget --mirror --convert-links --adjust-extension --page-requisites \
         --wait=1 --random-wait --no-parent \
         -P "$docs_dir/maven" https://maven.apache.org/guides/ 2>&1 | tail -3
    log "✅ Maven Docs сохранены"

    echo ""
    log "═══════════════════════════════════════════════════════════"
    log "  ✅ Документация Minecraft-модов сохранена в: $docs_dir"
    log "═══════════════════════════════════════════════════════════"
    echo ""
    info "Не забудьте также подготовить Gradle cache для оффлайн-сборки:"
    info "  cd endlessrail/ && ./gradlew build --refresh-dependencies"
    info "  cd zadanie/     && ./gradlew build --refresh-dependencies"
}

# Показать список архивов для указанного тира
list_archives() {
    local tier="${1:-optimal}"
    local archives=()

    case "$tier" in
        minimal)
            archives=("${TIER_MINIMAL[@]}")
            ;;
        optimal)
            archives=("${TIER_MINIMAL[@]}" "${TIER_OPTIMAL[@]}")
            ;;
        full)
            archives=("${TIER_MINIMAL[@]}" "${TIER_OPTIMAL[@]}" "${TIER_FULL[@]}")
            ;;
        *)
            err "Неизвестный тир: $tier"
            return 1
            ;;
    esac

    echo -e "${B}ZIM-архивы для тира '${tier}' (${#archives[@]} шт.):${NC}"
    echo ""
    local i=1
    for spec in "${archives[@]}"; do
        local name="${spec#*/}"
        printf "  %3d. %s\n" "$i" "$name"
        ((i++))
    done
    echo ""
    echo -e "Всего: ${B}${#archives[@]}${NC} архивов"
}

# Собрать список архивов по тиру
get_archives_for_tier() {
    local tier="$1"
    case "$tier" in
        minimal)
            echo "${TIER_MINIMAL[@]}"
            ;;
        optimal)
            echo "${TIER_MINIMAL[@]}" "${TIER_OPTIMAL[@]}"
            ;;
        full)
            echo "${TIER_MINIMAL[@]}" "${TIER_OPTIMAL[@]}" "${TIER_FULL[@]}"
            ;;
        custom)
            local listfile="$DOWNLOAD_DIR/custom-zim-list.txt"
            if [ ! -f "$listfile" ]; then
                err "Файл не найден: $listfile"
                err "Создайте файл с именами архивов (по одному на строку), например:"
                err "  wikipedia/wikipedia_ru_all_maxi"
                err "  stack_exchange/stackoverflow.com_en_all"
                exit 1
            fi
            grep -v '^#' "$listfile" | grep -v '^$' | tr '\n' ' '
            ;;
        *)
            err "Неизвестный тир: $tier"
            err "Допустимые значения: minimal, optimal, full, custom"
            exit 1
            ;;
    esac
}

# ─── Главная логика ──────────────────────────────────────────────────────────

# Обработка специальных команд
case "${1:-}" in
    help|-h|--help)
        usage
        exit 0
        ;;
    minecraft)
        download_minecraft_docs "${2:-}"
        exit $?
        ;;
    list)
        list_archives "${2:-optimal}"
        exit 0
        ;;
esac

# Проверяем зависимости
for cmd in wget sha256sum; do
    if ! command -v "$cmd" &>/dev/null; then
        err "Требуется: $cmd"
        exit 1
    fi
done

# Создаём директорию и лог
mkdir -p "$DOWNLOAD_DIR"
: > "$FAILED_FILE"

echo ""
echo -e "${B}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${B}║  NOA ZIM Library Downloader                                 ║${NC}"
echo -e "${B}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${B}║${NC}  Тир:       ${Y}$TIER${NC}"
echo -e "${B}║${NC}  Каталог:   ${C}$DOWNLOAD_DIR${NC}"
echo -e "${B}║${NC}  Лог:       ${C}$LOG_FILE${NC}"
echo -e "${B}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Получаем список архивов
read -ra ARCHIVES <<< "$(get_archives_for_tier "$TIER")"
TOTAL=${#ARCHIVES[@]}

log "Архивов для загрузки: $TOTAL"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] START tier=$TIER total=$TOTAL dir=$DOWNLOAD_DIR" >> "$LOG_FILE"

# Проверяем свободное место
AVAILABLE_GB=$(df -BG "$DOWNLOAD_DIR" | awk 'NR==2{print $4}' | tr -d 'G')
case "$TIER" in
    minimal) NEEDED_GB=90 ;;
    optimal) NEEDED_GB=190 ;;
    full)    NEEDED_GB=300 ;;
    *)       NEEDED_GB=100 ;;
esac

if [ "$AVAILABLE_GB" -lt "$NEEDED_GB" ] 2>/dev/null; then
    warn "Свободно ~${AVAILABLE_GB} GB, рекомендуется ~${NEEDED_GB} GB для тира '$TIER'"
    warn "Продолжить? (y/N)"
    read -r confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        log "Отменено."
        exit 0
    fi
fi

# Скачиваем каждый архив
for i in "${!ARCHIVES[@]}"; do
    local_i=$((i + 1))
    echo ""
    log "━━━ [$local_i/$TOTAL] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    download_zim "${ARCHIVES[$i]}"
done

# Итоги
echo ""
echo -e "${B}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${B}║  Итоги загрузки                                            ║${NC}"
echo -e "${B}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${B}║${NC}  ✅ Скачано:    ${G}$DOWNLOADED${NC}"
echo -e "${B}║${NC}  ⏭️  Пропущено:  ${C}$SKIPPED${NC}"
echo -e "${B}║${NC}  ❌ Ошибки:     ${R}$FAILED${NC}"
echo -e "${B}║${NC}  📁 Каталог:    $DOWNLOAD_DIR"
echo -e "${B}╚══════════════════════════════════════════════════════════════╝${NC}"

if [ "$FAILED" -gt 0 ]; then
    echo ""
    warn "Не удалось скачать (см. $FAILED_FILE):"
    cat "$FAILED_FILE"
    echo ""
    warn "Повторите: $0 custom $DOWNLOAD_DIR"
    warn "(скопируйте содержимое failed.txt в custom-zim-list.txt)"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] DONE downloaded=$DOWNLOADED skipped=$SKIPPED failed=$FAILED" >> "$LOG_FILE"

# Подсказка про DevDocs
echo ""
info "DevDocs ZIM не включены — скачайте их отдельно с:"
info "  https://download.kiwix.org/zim/devdocs/"
info "Или агрегированный архив: devdocs_en_all (~700 MB)"
echo ""
info "Для документации Minecraft-модов запустите:"
info "  $0 minecraft [DOWNLOAD_DIR]"
