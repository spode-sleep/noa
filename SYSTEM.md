# NOA — Installation & Operation Guide

Target system: **Linux Mint 22** (Ubuntu 24.04 base). Applicable to other Debian/Ubuntu-based distributions.

---

## System Requirements

| Component   | Minimum          | Recommended         |
|-------------|------------------|---------------------|
| OS          | Linux Mint 21+   | Linux Mint 22       |
| Node.js     | 18.x             | 20.x LTS            |
| npm         | 9.x              | 10.x                |
| RAM         | 4 GB             | 16 GB (with LLM)    |
| Disk        | 2 GB (app only)  | 50+ GB (with data)  |
| CPU         | Any x86_64       | 8+ cores (for LLM/TTS) |
| GPU         | Not required      | NVIDIA (optional, for LLM) |

---

## Step-by-Step Installation

### 1. Install Node.js

Install Node.js 20 LTS via NodeSource:

```bash
# Install prerequisites
sudo apt update
sudo apt install -y curl ca-certificates gnupg

# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install Node.js
sudo apt install -y nodejs

# Verify installation
node --version   # Should show v20.x.x
npm --version    # Should show 10.x.x
```

Alternative: install via nvm (Node Version Manager):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### 2. Install Build Tools (if needed)

Some native Node.js modules may require build tools:

```bash
sudo apt install -y build-essential python3
```

### 3. Clone the Repository

```bash
cd ~
git clone <repo-url> noa
cd noa
```

### 4. Install Backend Dependencies

```bash
cd server
npm install
```

### 5. Configure Environment

```bash
cp .env.example .env
nano .env
```

Set all paths according to your system (see [Configuration](#configuration) below).

### 6. Install Frontend Dependencies

```bash
cd ../client
npm install
```

### 7. First Run

```bash
# Terminal 1 — Backend
cd ~/noa/server
npm run dev

# Terminal 2 — Frontend
cd ~/noa/client
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Configuration

All configuration is in `server/.env`. Create it from the example:

```bash
cp server/.env.example server/.env
```

### Environment Variables

| Variable               | Description                                      | Example                          |
|------------------------|--------------------------------------------------|----------------------------------|
| `PORT`                 | Backend API port                                 | `3001`                           |
| `MUSIC_LIBRARY_PATH`   | Music directories (comma-separated for multiple) | `/home/user/Music,/media/user/USB/Music`|
| `FICTION_LIBRARY_PATH`  | Book directories (comma-separated for multiple)  | `/home/user/Books,/media/user/USB/Books`|
| `REFERENCE_LIBRARY_PATH`| ZIM archive directories (comma-separated)       | `/home/user/Reference,/media/user/USB/ZIM`|
| `TTS_MODEL_PATH`       | Path to Piper TTS model files                   | `/home/user/models/piper`        |
| `TTS_DEFAULT_VOICE`    | Default TTS voice identifier (Russian)           | `ru_RU-irina-medium`             |
| `TTS_EN_VOICE`         | English TTS voice (auto-selected for English text)| `en_US-lessac-medium`           |
| `PIPER_PATH`           | Path to Piper TTS binary (avoids GTK piper conflict) | `/opt/piper-tts/piper`  |
| `DATA_PATH`            | Path to data storage directory (relative or absolute) | `../data`                   |

### Example `.env`

```env
PORT=3001
MUSIC_LIBRARY_PATH=/home/user/Music,/media/user/USB_DRIVE/Music
FICTION_LIBRARY_PATH=/home/user/Books/Fiction,/media/user/USB_DRIVE/Books
REFERENCE_LIBRARY_PATH=/home/user/Books/Reference,/media/user/USB_DRIVE/ZIM
TTS_MODEL_PATH=/home/user/models/piper
TTS_DEFAULT_VOICE=ru_RU-irina-medium
TTS_EN_VOICE=en_US-lessac-medium
PIPER_PATH=/opt/piper-tts/piper
DATA_PATH=../data
```

**Important**: All library paths must be absolute paths. Use commas to specify multiple directories (e.g. local + USB drive). Unavailable paths (unmounted drives) are silently skipped during scans. The `DATA_PATH` can be relative to the server directory.

---

## Running the Application

### Development Mode

```bash
# Backend (auto-reloads on changes)
cd server
npm run dev

# Frontend (hot module replacement)
cd client
npm run dev
```

### Production Mode

```bash
# Build backend
cd server
npm run build
npm start

# Build frontend
cd client
npm run build
npm run preview   # or serve dist/ with any static server
```

### Running as a Background Service (optional)

Create a systemd service for the backend:

```bash
sudo nano /etc/systemd/system/noa-server.service
```

```ini
[Unit]
Description=NOA Backend Server
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/noa/server
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable noa-server
sudo systemctl start noa-server
```

---

## Adding Data

### Music

1. Place your audio files (MP3, FLAC, OGG, WAV, M4A) in the directory specified by `MUSIC_LIBRARY_PATH`.
2. Subdirectory structure is supported (e.g., `Artist/Album/track.mp3`).
3. Open the Music section in the UI and click **"Rescan Library"**.
4. Metadata is extracted from ID3/Vorbis/APE tags and saved to `data/metadata/music_library.json`.

Supported audio formats: MP3, FLAC, OGG, WAV, M4A, AAC, WMA, AIFF.

### Fiction (Books)

1. Place your book files in the directory specified by `FICTION_LIBRARY_PATH`.
2. Supported formats: **PDF**, **EPUB**, **FB2**.
3. Subdirectory structure is supported.
4. Open the Fiction section and click **"Rescan Library"**.
5. Metadata is saved to `data/metadata/fiction_library.json`.

### Games

Game data is stored as JSON in `data/games/`:

1. Place your game data in `data/games/games.json`.
2. Place header images in `data/games/header_images/` (460×215 px recommended).
3. Image filenames should match the game's `appid` (e.g., `730.jpg` for CS2).

Example `games.json` structure:

```json
[
  {
    "appid": 730,
    "name": "Counter-Strike 2",
    "source": "steam",
    "description": "...",
    "tags": ["FPS", "Multiplayer", "Shooter"],
    "protondb_tier": "gold",
    "protondb_reports": [...]
  }
]
```

### Reference (ZIM Archives)

1. Download ZIM archives from [https://download.kiwix.org/zim/](https://download.kiwix.org/zim/) or browse at [library.kiwix.org](https://library.kiwix.org) (while online).
2. Place `.zim` files in the directory specified by `REFERENCE_LIBRARY_PATH`.
3. Archives are detected automatically when the Reference section loads.
4. Prefer `_maxi_` variants (full articles with images) for the most complete offline experience. Use `_nopic` to save disk space.

#### Recommended ZIM archives for long-term offline use

**📖 Энциклопедии / Encyclopedias:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `wikipedia_ru_all_maxi` | Русская Википедия (полная, с картинками) | ~50 GB |
| `wikipedia_en_all_maxi` | English Wikipedia (full, with images) | ~110 GB |

**📚 Словари / Dictionaries:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `wiktionary_ru_all_maxi` | Русский Викисловарь | ~3 GB |
| `wiktionary_en_all_maxi` | English Wiktionary — definitions, etymology, translations | ~7 GB |

**🏥 Медицина / Medical:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `wikipedia_en_medicine` | WikiMed — 75,000+ медицинских статей из Wikipedia | ~2 GB |
| `medlineplus.gov_en_all` | MedlinePlus — справочник потребительского здоровья (US NLM) | ~1.8 GB |
| `fas-military-medicine_en` | Военно-полевая медицина / Military field medicine | ~78 MB |
| `nhs.uk_en_medicines` | Справочник лекарств NHS UK | ~17 MB |

**💻 Программирование / Programming:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `stackoverflow.com_en_all` | Stack Overflow — вопросы и ответы по программированию | ~60 GB |
| `devdocs_en_all` | DevDocs — агрегированная документация API | ~700 MB |
| `superuser.com_en_all` | Super User — компьютерные вопросы и ответы | ~5 GB |
| `askubuntu.com_en_all` | Ask Ubuntu — вопросы по Linux/Ubuntu | ~2.6 GB |
| `unix.stackexchange.com_en_all` | Unix & Linux Q&A | ~2 GB |
| `serverfault.com_en_all` | Server Fault — системное администрирование | ~3 GB |
| `freecodecamp_en_all` | freeCodeCamp — курсы программирования | ~1 GB |
| `docs.python.org_en` | Документация Python | ~2 GB |

**🔬 Наука и математика / Science & Math:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `mathematics.stackexchange.com_en_all` | Математика Q&A | ~8 GB |
| `physics.stackexchange.com_en_all` | Физика Q&A | ~3 GB |
| `chemistry.stackexchange.com_en_all` | Химия Q&A | ~397 MB |
| `biology.stackexchange.com_en_all` | Биология Q&A | ~403 MB |
| `astronomy.stackexchange.com_en_all` | Астрономия Q&A | ~187 MB |
| `phet_en_all` | PhET — интерактивные научные симуляции | ~1 GB |

**🎓 Образование / Education:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `wikibooks_ru_all` | Русские Викиучебники | <1 GB |
| `wikibooks_en_all_maxi` | English Wikibooks — учебники | ~2 GB |
| `wikiversity_en_all_maxi` | Wikiversity — курсы и учебные материалы | ~500 MB |
| `libretexts_en_all` | LibreTexts — открытые учебники (наука, инженерия) | ~50 GB |
| `crashcourse_en_all` | CrashCourse — образовательные видеосерии | ~21 GB |
| `ted_en_all` | TED Talks | ~5 GB |

**📜 Литература / Literature:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `gutenberg_en_all` | Project Gutenberg — 70,000+ книг в общественном достоянии | ~65 GB |
| `wikisource_ru_all_maxi` | Русская Викитека — литературные первоисточники | ~2 GB |
| `wikisource_en_all_maxi` | English Wikisource — первичные тексты | ~15 GB |
| `wikiquote_ru_all_maxi` | Русские Викицитаты | <1 GB |
| `wikiquote_en_all_maxi` | English Wikiquote | ~500 MB |

**🔧 Ремонт и самоделки / DIY & Repair (уже есть ✓):**

| Archive | Description | Status |
|---------|-------------|--------|
| `wikihow_en_all` | WikiHow — пошаговые инструкции | ✅ есть |
| `ifixit_en_all` | iFixit — ремонт техники | ✅ есть |

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `diy.stackexchange.com_en_all` | Home Improvement — ремонт и обустройство дома Q&A | ~1.5 GB |
| `3dprinting.stackexchange.com_en_all` | 3D-печать Q&A | ~115 MB |
| `arduino.stackexchange.com_en_all` | Arduino и встраиваемая электроника Q&A | ~247 MB |

**🍳 Кулинария / Cooking (уже есть ✓):**

| Archive | Description | Status |
|---------|-------------|--------|
| `cooking.stackexchange.com_en_all` | Cooking Stack Exchange — кулинарные Q&A | ✅ есть |
| `publicdomainrecipes.com_en_all` | Рецепты в общественном достоянии | ✅ есть |
| `foss.cooking_en_all` | FOSS Cooking — открытые рецепты | ✅ есть |

**🌿 Устойчивое развитие / Sustainability & Off-Grid:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `appropedia_en_all_maxi` | Appropedia — устойчивое развитие, appropriate technology | ~555 MB |
| `energypedia_en_all_maxi` | Энергетика, возобновляемые источники, развитие | ~762 MB |
| `cd3wdproject.org_en_all` | CD3WD — ресурсы для развития третьего мира | ~554 MB |
| `100r.co_en_all` | Hundred Rabbits — автономные вычисления и мореплавание | ~160 MB |
| `sustainability.stackexchange.com_en_all` | Sustainability Q&A | ~50 MB |

**🏕️ Природа и практические навыки / Outdoors & Practical Skills:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `gardening.stackexchange.com_en_all` | Садоводство и ландшафтный дизайн Q&A | ~400 MB |
| `outdoors.stackexchange.com_en_all` | The Great Outdoors — туризм, выживание Q&A | ~150 MB |
| `bicycles.stackexchange.com_en_all` | Велосипеды — обслуживание и ремонт Q&A | ~467 MB |
| `pets.stackexchange.com_en_all` | Домашние животные — уход Q&A | ~100 MB |

**⚡ Электроника и инженерия / Electronics & Engineering:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `electronics.stackexchange.com_en_all` | Электроника Q&A | ~3 GB |
| `engineering.stackexchange.com_en_all` | Инженерия Q&A | ~200 MB |

**🌍 Путешествия / Travel & Geography:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `wikivoyage_en_all_maxi` | Wikivoyage — путеводитель по миру | ~800 MB |
| `maps` | OpenStreetMap — оффлайн-карты | varies |

**🔒 Безопасность / Security & Privacy:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `anonymousplanet.org_en_all` | Anonymous Planet — гид по конфиденциальности | ~27 MB |
| `security.stackexchange.com_en_all` | Information Security Q&A | ~700 MB |

**💰 Финансы / Finance:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `money.stackexchange.com_en_all` | Personal Finance — личные финансы Q&A | ~300 MB |

**Дополнительно / Optional:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `vikidia_en_all` | Vikidia — энциклопедия для детей | <1 GB |
| `cheatography.com_en_all` | Cheatography — шпаргалки по всем темам | ~11 GB |

> **Итого все перечисленные архивы (без того, что уже есть): ~450+ GB**
>
> 🔴 Минимальный набор (~240 GB): Wikipedia (RU+EN), Wiktionary (RU+EN), WikiMed, DevDocs, Gutenberg.
>
> 🟡 Оптимальный набор (~340 GB): + Stack Overflow, Wikibooks, Wikiversity, PhET, Wikisource, Appropedia, MedlinePlus, наука (math/physics/chemistry/biology SE).
>
> 🟢 Полный набор (~450+ GB): + всё остальное из списка.
>
> **Совет**: Проверяйте точные размеры на [download.kiwix.org/zim/](https://download.kiwix.org/zim/). Для экономии места используйте варианты `_nopic` (без изображений).

#### Документация по технологиям / Tech Stack Documentation (DevDocs ZIM)

Индивидуальные ZIM-файлы с документацией по конкретным технологиям скачиваются с [download.kiwix.org/zim/devdocs/](https://download.kiwix.org/zim/devdocs/). Формат имён: `devdocs_en_<технология>_<дата>.zim`. Все файлы маленькие (< 60 MB каждый), суммарно ~200 MB.

**🤖 Machine Learning & AI:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `devdocs_en_pytorch` | PyTorch — документация фреймворка | ~3 MB |
| `devdocs_en_tensorflow` | TensorFlow — документация API | ~6 MB |
| `devdocs_en_tensorflow-cpp` | TensorFlow C++ API | ~1.4 MB |
| `devdocs_en_numpy` | NumPy — массивы и математика | ~4.7 MB |
| `devdocs_en_pandas` | pandas — анализ данных | ~4.7 MB |
| `devdocs_en_scikit-learn` | scikit-learn — классический ML | ~54 MB |
| `devdocs_en_matplotlib` | Matplotlib — визуализация данных | ~31 MB |
| `devdocs_en_statsmodels` | statsmodels — статистические модели | ~8 MB |
| `devdocs_en_scikit-image` | scikit-image — обработка изображений | ~11 MB |

**🐍 Языки программирования / Programming Languages:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `devdocs_en_python` | Python — полная документация языка | ~4.1 MB |
| `devdocs_en_c` | C — справочник языка C | ~1.2 MB |
| `devdocs_en_javascript` | JavaScript — документация MDN | ~2.6 MB |
| `devdocs_en_typescript` | TypeScript — типизация для JS | ~1.1 MB |
| `devdocs_en_bash` | Bash — скрипты оболочки | ~546 KB |
| `devdocs_en_latex` | LaTeX — вёрстка документов | ~767 KB |

**⚛️ Frontend:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `devdocs_en_react` | React — UI-фреймворк | ~2.6 MB |
| `devdocs_en_vue` | Vue 3 — прогрессивный фреймворк | ~951 KB |
| `devdocs_en_vue-router` | Vue Router — маршрутизация | ~418 KB |
| `devdocs_en_html` | HTML — разметка | ~1.6 MB |
| `devdocs_en_css` | CSS — стили | ~4.6 MB |
| `devdocs_en_dom` | DOM API — взаимодействие с документом | ~14 MB |
| `devdocs_en_jquery` | jQuery — библиотека DOM | ~1.1 MB |
| `devdocs_en_svg` | SVG — векторная графика | ~867 KB |
| `devdocs_en_webpack` | Webpack — сборка | ~769 KB |
| `devdocs_en_vite` | Vite — сборщик нового поколения | ~483 KB |
| `devdocs_en_sass` | Sass — CSS-препроцессор | ~639 KB |
| `devdocs_en_tailwindcss` | Tailwind CSS — utility-first CSS | ~554 KB |

**🖥️ Backend:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `devdocs_en_node` | Node.js — серверный JavaScript | ~1.3 MB |
| `devdocs_en_express` | Express — минимальный веб-фреймворк | ~433 KB |
| `devdocs_en_php` | PHP — документация языка | ~6.8 MB |
| `devdocs_en_nginx` | Nginx — веб-сервер | ~797 KB |
| `devdocs_en_http` | HTTP — протокол | ~1.9 MB |

**🗄️ Базы данных / Databases:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `devdocs_en_mongoose` | Mongoose — ODM для MongoDB | ~586 KB |
| `devdocs_en_mariadb` | MariaDB/MySQL — реляционная БД | ~9.3 MB |
| `devdocs_en_redis` | Redis — in-memory хранилище | ~853 KB |
| `devdocs_en_postgresql` | PostgreSQL — реляционная БД | ~2.5 MB |
| `devdocs_en_sqlite` | SQLite — встроенная БД | ~3.4 MB |

**🔧 DevOps & Tools:**

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `devdocs_en_docker` | Docker — контейнеризация | ~1.7 MB |
| `devdocs_en_git` | Git — система контроля версий | ~1.5 MB |
| `devdocs_en_man` | Linux man pages — справочник команд | ~28 MB |
| `devdocs_en_npm` | npm — пакетный менеджер | ~649 KB |
| `devdocs_en_cmake` | CMake — система сборки | ~2.5 MB |
| `devdocs_en_gnu-make` | GNU Make — автоматизация сборки | ~600 KB |
| `devdocs_en_markdown` | Markdown — разметка | ~325 KB |

#### 📐 Учебники / Academic Textbooks

| Archive | Description | Size (approx.) |
|---------|-------------|-----------------|
| `libretexts_en_all` | LibreTexts — открытые учебники по математике, статистике, CS, инженерии (включает линейную алгебру, теорию вероятностей, теорию автоматов) | ~50 GB |
| `wikibooks_en_all_maxi` | Wikibooks — учебники (Linear Algebra, Statistics, Automata) | ~2 GB |
| `wikiversity_en_all_maxi` | Wikiversity — курсы | ~500 MB |
| `mathematics.stackexchange.com_en_all` | Mathematics SE — задачи по линейной алгебре и статистике | ~8 GB |
| `stats.stackexchange.com_en_all` | Cross Validated — статистика, ML, data science Q&A | ~2 GB |
| `cs.stackexchange.com_en_all` | Computer Science SE — теория автоматов, формальные языки | ~500 MB |
| `datascience.stackexchange.com_en_all` | Data Science SE — практический ML и анализ данных | ~300 MB |

> **Ключевые темы в LibreTexts**: Statistics and Probability, Linear Algebra (Kuttler, Cherney et al.), Theory of Computation / Automata Theory — доступны как полные открытые учебники.

#### 🎨 Творчество / Creative Learning

**Рисование / Drawing & Art:**

| Resource | Description | Format |
|----------|-------------|--------|
| `gutenberg_en_all` | Project Gutenberg — классические книги по рисованию и искусству (напр. "The Practice and Science of Drawing" — Harold Speed) | ZIM (~65 GB, уже в общем списке) |
| `wikibooks_en_all_maxi` | Wikibooks — "Drawing", "Art", "Painting" разделы | ZIM (~2 GB, уже в списке) |
| Wikipedia + WikiArt | Статьи по техникам рисования, истории искусства | в составе `wikipedia_en_all_maxi` |

> **Совет по рисованию**: Лучшие учебники по рисованию ("Drawing on the Right Side of the Brain", "Figure Drawing for All It's Worth") защищены копирайтом и не доступны в ZIM. Рекомендуется скачать их заранее в PDF/EPUB и положить в `FICTION_LIBRARY_PATH`. В LibreTexts есть открытые курсы по Studio Arts.

**Музыкальная композиция / Music Composition:**

| Resource | Description | Format |
|----------|-------------|--------|
| `music.stackexchange.com_en_all` | Music: Practice & Theory SE — теория музыки Q&A | ZIM (~300 MB) |
| `openmusictheory.com_en_all` | Open Music Theory — открытый учебник по теории музыки | ZIM (~79 MB) |
| `wikibooks_en_all_maxi` | Wikibooks — "Music Theory", "Music Composition" | ZIM (в составе ~2 GB) |
| Wikipedia | Статьи по гармонии, контрапункту, оркестровке | в составе `wikipedia_en_all_maxi` |

> **Совет по музыке**: `openmusictheory.com_en_all` — лучший открытый ZIM для изучения теории музыки с нуля. Скачивается с [download.kiwix.org/zim/zimit/](https://download.kiwix.org/zim/zimit/).

#### ⛏️ Minecraft Fabric Modding

Документация для разработки модов Fabric (Minecraft 1.20.1, Fabric API 0.92.5+1.20.1, Yarn 1.20.1+build.10, Loader 0.16.14).

**Проекты:**
- `endlessrail` (`spodesleep.endlessrail`) — мод на чистом Fabric API
- `zadanie` (`net.spodesleep`) — мод с зависимостями: CC:Tweaked 1.108.3, Create Fabric 0.5.1-f-build.1417+mc1.20.1
- Terra — генерация мира (worldgen)

**Документация Fabric (нет официальных ZIM — скачать вручную):**

| Resource | Как получить оффлайн | Notes |
|----------|---------------------|-------|
| [Fabric Wiki](https://wiki.fabricmc.net/) | `wget --mirror https://wiki.fabricmc.net/` или `zimit` → ZIM | Setup, mixins, events, networking |
| [Fabric Docs](https://docs.fabricmc.net/) | `git clone https://github.com/FabricMC/fabric-docs` | Официальная кураторская документация |
| [Fabric API Javadoc](https://maven.fabricmc.net/docs/) | Скачать JAR с javadoc: `fabric-api:0.92.5+1.20.1` | API reference |
| [Yarn Mappings](https://github.com/FabricMC/yarn) | Включены в Gradle cache | Обфускация → читаемые имена |
| [Minecraft Wiki](https://minecraft.wiki/) | Может быть доступен как ZIM от сообщества | Механики игры, блоки, entities |

**Документация CC:Tweaked (ComputerCraft):**

| Resource | Как получить оффлайн | Notes |
|----------|---------------------|-------|
| [tweaked.cc](https://tweaked.cc/) | `wget --mirror https://tweaked.cc/` | Полная документация API: Lua-среда, Turtle, Peripheral, Redstone, HTTP, Networking |
| [GitHub CC:Tweaked](https://github.com/cc-tweaked/CC-Tweaked) | `git clone` — папка `doc/` содержит Markdown-доки | Исходники + документация |
| `devdocs_en_lua` | ZIM (~418 KB) — Lua-справочник | CC:Tweaked программируется на Lua |
| In-game `help` | Встроено в мод — команда `help` в Lua-консоли | Упрощённая документация прямо в игре |

**Документация Create Fabric:**

| Resource | Как получить оффлайн | Notes |
|----------|---------------------|-------|
| [Create Wiki (GitHub)](https://github.com/Creators-of-Create/Create/wiki) | `wget --mirror` или скачать wiki через git | Механики, рецепты, changelogs |
| [Create Modrinth](https://modrinth.com/mod/create-fabric) | Скачать страницу релизов | Changelog для v0.5.1 |
| Ponder (in-game) | Встроенная интерактивная документация внутри мода | Лучший способ изучить механики Create оффлайн — всё работает без интернета |
| [GitHub Create Source](https://github.com/Creators-of-Create/Create) | `git clone` для JavaDoc и исходников | API reference |

**Документация Terra (worldgen):**

| Resource | Как получить оффлайн | Notes |
|----------|---------------------|-------|
| [Terra Docs](https://terra.polydev.org/) | `wget --mirror https://terra.polydev.org/` | Установка, настройка, конфиг-паки |
| [GitHub Terra](https://github.com/PolyhedralDev/Terra) | `git clone` — README + архитектура + исходники | Addons, платформы, конфигурация |
| [Terra Wiki](https://github.com/PolyhedralDev/TerraWiki/wiki) | `git clone` wiki | Создание миров, настройка биомов и terrain |
| [Community Packs](https://terra.polydev.org/community-packs.html) | Скачать нужные паки заранее | Skylands, Origen, Hydraxia и др. |

**Maven & Gradle (оффлайн-разработка):**

| Resource | Description | Format / Size |
|----------|-------------|---------------|
| `devdocs_en_groovy` | Groovy — язык для `build.gradle` | ZIM (~3.2 MB) |
| `devdocs_en_openjdk` | OpenJDK — Java API (Minecraft и моды на Java) | ZIM (~14 MB) |
| `devdocs_en_lua` | Lua — язык CC:Tweaked | ZIM (~418 KB) |
| Gradle Docs | [docs.gradle.org](https://docs.gradle.org) — скачать через `wget --mirror` | HTML (~50 MB) |
| Maven Docs | [maven.apache.org](https://maven.apache.org) — скачать через `wget --mirror` | HTML (~20 MB) |

**Подготовка Gradle к оффлайн-работе:**

```bash
# Пока есть интернет — скачать все зависимости для ОБОИХ проектов:
cd endlessrail/ && ./gradlew build --refresh-dependencies && cd ..
cd zadanie/ && ./gradlew build --refresh-dependencies && cd ..

# После — работать оффлайн:
./gradlew build --offline
```

**Подготовка Maven-репозитория:**

```bash
# Скачать все зависимости в ~/.m2/repository:
mvn dependency:go-offline

# Или настроить mavenLocal() в build.gradle:
repositories {
    mavenLocal()  // ~/.m2/repository
    // Для оффлайна закомментировать remote:
    // maven { url = "https://maven.fabricmc.net/" }
    // maven { url = "https://api.modrinth.com/maven" }
    // mavenCentral()
}
```

**Скрипт для сохранения всей документации модов:**

```bash
#!/bin/bash
# save-mod-docs.sh — запустить ПОКА ЕСТЬ интернет
DOCS_DIR="$HOME/minecraft-mod-docs"
mkdir -p "$DOCS_DIR"

# Fabric
wget --mirror --convert-links --adjust-extension --wait=1 --random-wait -P "$DOCS_DIR/fabric-wiki" https://wiki.fabricmc.net/
git clone https://github.com/FabricMC/fabric-docs "$DOCS_DIR/fabric-docs"

# CC:Tweaked
wget --mirror --convert-links --adjust-extension --wait=1 --random-wait -P "$DOCS_DIR/cctweaked" https://tweaked.cc/
git clone https://github.com/cc-tweaked/CC-Tweaked "$DOCS_DIR/cctweaked-src"

# Create
git clone https://github.com/Creators-of-Create/Create.wiki.git "$DOCS_DIR/create-wiki"

# Terra
wget --mirror --convert-links --adjust-extension --wait=1 --random-wait -P "$DOCS_DIR/terra" https://terra.polydev.org/
git clone https://github.com/PolyhedralDev/Terra "$DOCS_DIR/terra-src"

echo "Документация сохранена в $DOCS_DIR"
```

> **Совет**: Убедитесь, что весь Gradle cache (`~/.gradle/caches/`) сохранён до потери интернета. Там хранятся Minecraft JAR, Yarn-маппинги, Fabric Loader, Fabric API, CC:Tweaked, Create и все транзитивные зависимости. Без них `./gradlew build --offline` не сработает. Для `zadanie` это особенно важно — Create Fabric тянет за собой много зависимостей.

---

## Using External Drives (USB, HDD)

NOA supports reading content from external/removable drives. On Linux Mint, USB drives are typically mounted at `/media/<username>/<DRIVE_LABEL>`.

### Setup

Add the external drive paths to your `.env` alongside local paths:

```env
MUSIC_LIBRARY_PATH=/home/user/Music,/media/user/MY_USB/Music
FICTION_LIBRARY_PATH=/home/user/Books,/media/user/MY_USB/Books
REFERENCE_LIBRARY_PATH=/home/user/Reference,/media/user/MY_USB/ZIM
```

### How It Works

- During scans, each configured path is checked for availability
- If a drive is **not mounted**, that path is skipped (no errors)
- The scan response includes `scanned_paths` and `unavailable_paths` so you know what was included
- Previously scanned content from the drive remains in the metadata JSON until the next rescan
- To include new content from a freshly plugged-in drive, click **"Rescan Library"**

### Finding Your Drive Path

```bash
# List mounted drives
lsblk
# or
df -h

# USB drives are typically at:
ls /media/$USER/
```

### Tips

- Use consistent drive labels so mount paths stay the same
- You can configure as many paths as needed (comma-separated)
- Paths on unmounted drives are silently skipped — no restart needed

---

## Scanning & Rescanning Libraries

### When to Rescan

- After adding new files to music or fiction directories
- After removing or renaming files
- After changing library paths in `.env`
- After plugging in an external drive with new content

### How to Rescan

**Via UI**: Each section (Music, Fiction) has a **"Rescan Library"** button.

**Via API**:

```bash
# Rescan music library
curl http://localhost:3001/api/music/scan

# Rescan fiction library
curl http://localhost:3001/api/fiction/scan
```

### What Happens During a Scan

1. The server walks the configured directory recursively.
2. For each supported file, metadata is extracted from tags/headers.
3. Each file gets an ID based on its filepath (MD5 hash).
4. Results are written to the corresponding JSON file in `data/metadata/`.
5. Previous metadata is overwritten.

---

## Setting Up Local LLM

The AI Assistant requires a local LLM server. Two options are recommended:

### Option A: Ollama (easier)

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Download a model
ollama pull qwen2.5:7b

# Ollama runs automatically on port 11434
# Verify
curl http://localhost:11434/api/tags
```

### Option B: llama.cpp (more control)

```bash
# Install build dependencies
sudo apt install -y build-essential cmake

# Clone and build
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
cmake -B build
cmake --build build --config Release

# Download a GGUF model (e.g., Qwen2.5-8B-Instruct)
# Place .gguf file in a models directory

# Run the server
./build/bin/llama-server -m /path/to/model.gguf -c 4096 --port 8080
```

### Recommended Models

| Model                    | Size   | Languages | Notes                    |
|--------------------------|--------|-----------|--------------------------|
| Qwen2.5-8B-Instruct     | ~5 GB  | RU, EN    | Best balance of quality/speed |
| Mistral-7B-Instruct      | ~4 GB  | EN, RU    | Fast, good English       |
| Llama-3.1-8B-Instruct   | ~5 GB  | EN        | Strong reasoning         |

Use Q4_K_M or Q5_K_M quantization for best quality/performance trade-off.

---

## Setting Up Piper TTS

Piper TTS enables offline text-to-speech for reading articles and AI responses aloud.

### Installation

```bash
# Download Piper binary (keep the whole directory — it has required libs)
wget https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz
tar -xzf piper_linux_x86_64.tar.gz
sudo mv piper /opt/piper-tts

# Verify (LD_LIBRARY_PATH needed for shared libraries)
LD_LIBRARY_PATH=/opt/piper-tts/lib /opt/piper-tts/piper --help  # Should show --model, --output_file, --output_raw options
```

### Download Voice Models

```bash
# Create models directory
mkdir -p ~/models/piper
cd ~/models/piper

# Download Russian voice (irina — female, default)
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json

# Download English voice (optional)
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json
```

### Configure in .env

```env
PIPER_PATH=/opt/piper-tts/piper
TTS_MODEL_PATH=/home/user/models/piper
TTS_DEFAULT_VOICE=ru_RU-irina-medium
TTS_EN_VOICE=en_US-lessac-medium
```

### Test TTS

```bash
echo "Привет, мир!" | LD_LIBRARY_PATH=/opt/piper-tts/lib /opt/piper-tts/piper --model ~/models/piper/ru_RU-irina-medium.onnx --output_file test.wav
aplay test.wav
```

---

## Rebuilding Indexes

If metadata files become corrupted or you want to start fresh:

```bash
# Remove existing metadata
rm -f data/metadata/music_library.json
rm -f data/metadata/fiction_library.json

# Remove bookmarks (WARNING: this deletes reading positions)
# rm -f data/bookmarks/fiction_bookmarks.json

# Restart the server and trigger rescans via UI or API
cd server
npm run dev

# In another terminal:
curl http://localhost:3001/api/music/scan
curl http://localhost:3001/api/fiction/scan
```

Metadata will be regenerated from the source files. Bookmarks should generally be preserved unless you explicitly delete them.

---

## Troubleshooting

### Application Won't Start

**Problem**: `npm run dev` fails in server directory.

```bash
# Check Node.js version
node --version  # Must be 18+

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Check .env exists and has valid paths
cat .env
```

**Problem**: Port already in use.

```bash
# Find process using port 3001
lsof -i :3001
# Kill it if needed
kill <PID>
```

### Music/Fiction Not Showing

**Problem**: Library scan returns empty results.

1. Verify the path in `.env` is correct and absolute:
   ```bash
   ls -la /your/music/path
   ```
2. Check file permissions — the Node.js process must have read access.
3. Check the scan output for errors in the server terminal.
4. Ensure files have correct extensions (`.mp3`, `.flac`, `.epub`, `.pdf`, `.fb2`).

### ZIM Archives Not Loading

**Problem**: Reference section shows no archives.

1. Verify `REFERENCE_LIBRARY_PATH` points to the directory containing `.zim` files.
2. Check that `node-libzim` native module compiled correctly:
   ```bash
   cd server
   npm rebuild
   ```
3. Check server logs for ZIM-related errors.

### No Audio Playback

**Problem**: Music player doesn't stream audio.

1. Check that the music file exists at the path stored in metadata.
2. Verify the backend is running on the expected port.
3. Check browser console for CORS or network errors.

### TTS Not Working

**Problem**: "Read aloud" button does nothing.

1. Verify `piper` is installed: `piper --help`
2. Check model files exist at `TTS_MODEL_PATH`.
3. Test Piper directly: `echo "test" | piper --model /path/to/model.onnx --output_file /tmp/test.wav`
4. Check server logs for TTS errors.

### AI Assistant Not Responding

**Problem**: Chat returns errors.

1. Verify your LLM server is running (Ollama or llama.cpp).
2. Test the LLM endpoint directly:
   ```bash
   # For Ollama
   curl http://localhost:11434/api/tags

   # For llama.cpp
   curl http://localhost:8080/health
   ```
3. Check server logs for connection errors.

### Build Errors

**Problem**: `npm run build` fails.

```bash
# TypeScript errors — check for type issues
cd server && npx tsc --noEmit
cd client && npx vue-tsc --noEmit

# Clear caches
rm -rf server/dist client/dist
```

---

## Data Format Documentation

### Metadata Storage

All metadata is stored as JSON files in `data/metadata/`:

| File                     | Contents                              |
|--------------------------|---------------------------------------|
| `music_library.json`     | Track metadata from audio file tags   |
| `fiction_library.json`   | Book metadata from file headers       |
| `metadata_schema.json`   | Schema documentation for all formats  |

### Bookmark Storage

Bookmarks are stored in `data/bookmarks/fiction_bookmarks.json`. This file contains:
- Auto-saved reading positions (page, chapter, scroll offset, percentage)
- Manual bookmarks with user notes
- Timestamps for tracking reading history

### Game Data Storage

Game data lives in `data/games/`:
- `games.json` — Array of game objects with metadata, tags, and ProtonDB reports
- `header_images/` — Game header images (named by appid)

### Playlist Storage

Playlists are stored in `data/metadata/playlists.json`:
- Each playlist has a UUID, name, and array of track IDs
- Track IDs reference entries in `music_library.json`

See `data/metadata/metadata_schema.json` for detailed field documentation.

---

## Quick Reference

| Action                     | Command / Location                         |
|----------------------------|--------------------------------------------|
| Start backend (dev)        | `cd server && npm run dev`                 |
| Start frontend (dev)       | `cd client && npm run dev`                 |
| Build for production       | `npm run build` in both directories        |
| Rescan music               | UI button or `GET /api/music/scan`         |
| Rescan books               | UI button or `GET /api/fiction/scan`        |
| Check API health           | `curl http://localhost:3001/api/health`     |
| Check AI status            | `curl http://localhost:3001/api/ai/status`  |
| Check TTS status           | `curl http://localhost:3001/api/tts/status`  |
| View metadata              | `cat data/metadata/music_library.json`      |
| Reset metadata             | Delete JSON files in `data/metadata/`       |
| App URL                    | http://localhost:5173                        |
