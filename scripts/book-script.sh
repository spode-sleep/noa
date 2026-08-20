#!/bin/bash
# ============================================================
#  OFFLINE LIBRARY DOWNLOADER — Linux/bash
#  chmod +x download_offline_library.sh
#  ./download_offline_library.sh
# ============================================================

BASE="$HOME/OfflineLibrary"

# ---- Цвета ----
INFO='\033[0;36m'
OK='\033[0;32m'
WARN='\033[0;33m'
HDR='\033[0;35m'
NC='\033[0m'

info()   { echo -e "${INFO}[INFO] $1${NC}"; }
ok()     { echo -e "${OK}[OK]   $1${NC}"; }
warn()   { echo -e "${WARN}[WARN] $1${NC}"; }
header() { echo -e "\n${HDR}===== $1 =====${NC}"; }

# ---- Создать папки ----
mkdir -p \
  "$BASE/kiwix" \
  "$BASE/zim" \
  "$BASE/books" \
  "$BASE/sites/drawabox" \
  "$BASE/sites/musictheory" \
  "$BASE/sites/teoria" \
  "$BASE/video/ctrlpaint"

# ============================================================
# ШАГ 1 — Инструменты
# ============================================================
header "ШАГ 1: Установка инструментов"

# Определяем пакетный менеджер
if command -v apt-get &>/dev/null; then
    PKG="sudo apt-get install -y"
elif command -v dnf &>/dev/null; then
    PKG="sudo dnf install -y"
elif command -v pacman &>/dev/null; then
    PKG="sudo pacman -S --noconfirm"
else
    warn "Пакетный менеджер не определён. Установите wget, curl, httrack, python3-pip вручную."
    PKG=""
fi

# wget
if ! command -v wget &>/dev/null; then
    info "Устанавливаем wget..."
    $PKG wget
fi

# HTTrack
if ! command -v httrack &>/dev/null; then
    info "Устанавливаем HTTrack..."
    $PKG httrack
else
    ok "HTTrack уже установлен."
fi

# yt-dlp
if ! command -v yt-dlp &>/dev/null; then
    info "Устанавливаем yt-dlp..."
    if command -v pip3 &>/dev/null; then
        pip3 install -q yt-dlp --break-system-packages 2>/dev/null || pip3 install -q yt-dlp
    else
        # Бинарник напрямую
        wget -q "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" \
             -O "$BASE/kiwix/yt-dlp"
        chmod +x "$BASE/kiwix/yt-dlp"
        YT_DLP="$BASE/kiwix/yt-dlp"
    fi
else
    ok "yt-dlp уже установлен."
fi
YT_DLP="${YT_DLP:-yt-dlp}"

# Kiwix Desktop
KIWIX_DEB="$BASE/kiwix/kiwix-desktop.deb"
if ! command -v kiwix-desktop &>/dev/null && [ ! -f "$KIWIX_DEB" ]; then
    info "Скачиваем Kiwix Desktop (.deb)..."
    wget -q --show-progress \
         "https://download.kiwix.org/release/kiwix-desktop/kiwix-desktop_amd64.deb" \
         -O "$KIWIX_DEB"
    ok "Kiwix сохранён. Установите командой:"
    ok "  sudo dpkg -i $KIWIX_DEB"
else
    ok "Kiwix уже скачан или установлен."
fi

# ============================================================
# ШАГ 2 — ZIM файлы
# ============================================================
header "ШАГ 2: ZIM-файлы (открываются в Kiwix)"

download_zim() {
    local name="$1" url="$2" out="$3"
    if [ ! -f "$out" ]; then
        info "Скачиваем: $name"
        warn "Большой файл — оставьте на ночь если нужно."
        wget -q --show-progress -c "$url" -O "$out" && ok "Готово: $out" \
            || warn "Ошибка. Повторите позже: wget -c \"$url\" -O \"$out\""
    else
        ok "Уже есть: $name"
    fi
}

download_zim \
    "DevDocs — ВСЯ документация (JS/TS/React/Vue/Node/Python/PHP/MySQL/MongoDB/Redis/Docker/OpenGL)" \
    "https://download.kiwix.org/zim/devdocs/devdocs_en_all_2024-10.zim" \
    "$BASE/zim/devdocs_all.zim"

download_zim \
    "MDN Web Docs (HTML/CSS/JS Reference)" \
    "https://download.kiwix.org/zim/mdn/mdn_en_all_2024-10.zim" \
    "$BASE/zim/mdn_en_all.zim"

download_zim \
    "Stack Overflow lite (~7GB)" \
    "https://download.kiwix.org/zim/stack_exchange/stackoverflow.com_en_2024-10.zim" \
    "$BASE/zim/stackoverflow.zim"

# ============================================================
# ШАГ 3 — Книги PDF
# ============================================================
header "ШАГ 3: Книги (PDF)"

download_book() {
    local name="$1" url="$2" out="$3"
    if [ ! -f "$out" ]; then
        info "Скачиваем: $name"
        wget -q --show-progress "$url" -O "$out" \
            && ok "Готово." \
            || warn "Не удалось. Скачайте вручную:\n  $url\n  -> $out"
    else
        ok "Уже есть: $name"
    fi
}

# Статистика и ML-математика
download_book \
    "Mathematics for Machine Learning (Deisenroth) — официально бесплатна" \
    "https://mml-book.github.io/book/mml-book.pdf" \
    "$BASE/books/mathematics_for_ml.pdf"

download_book \
    "Elements of Statistical Learning (Hastie et al.)" \
    "https://hastie.su.domains/ElemStatLearn/printings/ESLII_print12_toc.pdf" \
    "$BASE/books/elements_statistical_learning.pdf"

download_book \
    "Think Stats 2e (Allen Downey) — CC лицензия" \
    "https://greenteapress.com/thinkstats2/thinkstats2.pdf" \
    "$BASE/books/think_stats.pdf"

# Рисование — Loomis
download_book \
    "Andrew Loomis — Fun with a Pencil" \
    "https://archive.org/download/loomis_FUN_WITH_A_PENCIL/loomis_FUN_WITH_A_PENCIL.pdf" \
    "$BASE/books/loomis_fun_with_pencil.pdf"

download_book \
    "Andrew Loomis — Figure Drawing For All It's Worth" \
    "https://archive.org/download/loomis_FIGURE_DRAW/loomis_FIGURE_DRAW.pdf" \
    "$BASE/books/loomis_figure_drawing.pdf"

download_book \
    "Andrew Loomis — Drawing the Head and Hands" \
    "https://archive.org/download/andrew-loomis-drawing-the-head-hands/andrew-loomis-drawing-the-head-hands.pdf" \
    "$BASE/books/loomis_head_and_hands.pdf"

# Музыкальная теория
download_book \
    "Johann Fux — Gradus ad Parnassum (контрапункт)" \
    "https://archive.org/download/gradusadparnassu00fuxj/gradusadparnassu00fuxj.pdf" \
    "$BASE/books/fux_gradus_ad_parnassum.pdf"

download_book \
    "Music Theory for Computer Musicians (Hewitt)" \
    "https://archive.org/download/music-theory-for-computer-musicians/music-theory-for-computer-musicians.pdf" \
    "$BASE/books/music_theory_computer_musicians.pdf"

# ============================================================
# ШАГ 4 — Зеркала сайтов (HTTrack)
# ============================================================
header "ШАГ 4: Зеркала сайтов"

if ! command -v httrack &>/dev/null; then
    warn "HTTrack не найден — пропускаем сайты."
else
    mirror_site() {
        local name="$1" url="$2" out="$3"
        # Пропускаем если уже есть index.html
        if [ ! -f "$out/index.html" ]; then
            info "Зеркалируем: $name"
            httrack "$url" -O "$out" \
                --depth=5 --ext-depth=1 \
                --quiet --robots=0 \
                -X "*.mp4,*.avi,*.mov,*.wmv" \
                && ok "Сохранено: $out" \
                || warn "Ошибка при зеркалировании: $name"
        else
            ok "Уже есть: $name"
        fi
    }

    mirror_site "DrawABox (уроки рисования)"        "https://drawabox.com"        "$BASE/sites/drawabox"
    mirror_site "MusicTheory.net (теория музыки)"   "https://www.musictheory.net" "$BASE/sites/musictheory"
    mirror_site "Teoria.com (упражнения по теории)" "https://www.teoria.com"      "$BASE/sites/teoria"
fi

# ============================================================
# ШАГ 5 — Ctrl+Paint видео (yt-dlp по каналу)
# ============================================================
header "ШАГ 5: Ctrl+Paint видеоуроки"

"$YT_DLP" \
    --format "bestvideo[height<=720]+bestaudio/best[height<=720]" \
    --merge-output-format mp4 \
    --output "$BASE/video/ctrlpaint/%(playlist_title)s/%(playlist_index)s - %(title)s.%(ext)s" \
    --sleep-interval 2 \
    --ignore-errors \
    "https://www.youtube.com/@ctrlpainter/videos"

ok "Ctrl+Paint сохранён в $BASE/video/ctrlpaint"

# ============================================================
# ИТОГ
# ============================================================
header "ГОТОВО"
echo -e "${OK}
Библиотека сохранена в: $BASE

  zim/
    devdocs_all.zim         ← ВСЯ твоя документация
    mdn_en_all.zim          ← HTML/CSS/JS reference
    stackoverflow.zim       ← Q&A офлайн
  (открывать через Kiwix Desktop)

  books/
    mathematics_for_ml.pdf
    elements_statistical_learning.pdf
    think_stats.pdf
    loomis_*.pdf            ← 3 книги Loomis по рисованию
    fux_gradus_ad_parnassum.pdf
    music_theory_*.pdf

  sites/
    drawabox/index.html     ← открыть в браузере
    musictheory/index.html
    teoria/index.html

  video/ctrlpaint/          ← видеоуроки по рисованию
${NC}"
