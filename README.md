# 🤠 NOA (Non-Online Archive)

Offline Knowledge & Media Hub — a fully offline local application for long-term storage, navigation, and intelligent access to data.

## Features

- **🎮 Игры** — Библиотека игр из SteamDB/RAWG с отчётами совместимости ProtonDB
- **🎵 Музыка** — Локальный музыкальный плеер со сканированием библиотеки, метаданными и плейлистами
- **📖 Художественная литература** — Читалка PDF/EPUB/FB2 с закладками и сохранением позиции чтения
- **📚 Справочная литература** — Браузер ZIM-архивов для офлайн Wikipedia, WikiHow и других справочников
- **🤖 ИИ помощник** — Локальный ИИ-чат с подключением контекста библиотек (Ollama / llama.cpp)
- **🔊 TTS** — Озвучка текста через Piper TTS для чтения ответов ИИ, статей и книг вслух

## Tech Stack

- **Frontend**: Vue 3, TypeScript, Composition API, Vue Router, Vite
- **Backend**: Node.js, Express, TypeScript
- **AI**: Ollama / llama.cpp (local LLM)
- **TTS**: Piper TTS (local, offline)
- **Design**: Dark Frutiger Aurora theme, glassmorphism, desktop-first

## Quick Start

### Prerequisites

- Node.js 18+ (recommended: 20 LTS)
- npm 9+
- Linux Mint 22 / Ubuntu 24.04 (or compatible)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd noa

# Install backend dependencies
cd server
npm install
cp .env.example .env
# Edit .env with your paths

# Install frontend dependencies
cd ../client
npm install
```

### Configuration

Edit `server/.env`:

```env
PORT=3001
MUSIC_LIBRARY_PATH=/home/user/Music,/media/user/USB_DRIVE/Music
FICTION_LIBRARY_PATH=/home/user/Books,/media/user/USB_DRIVE/Books
REFERENCE_LIBRARY_PATH=/home/user/Reference,/media/user/USB_DRIVE/ZIM
TTS_MODEL_PATH=/home/user/models/piper
TTS_DEFAULT_VOICE=ru_RU-medium
LLM_API_URL=http://localhost:11434
LLM_MODEL=qwen2.5:7b
LLM_API_TYPE=auto
DATA_PATH=../data
```

> **Multiple folders & external drives**: Library paths support comma-separated values to scan multiple directories, including paths on USB/external drives (e.g. `/media/user/USB_DRIVE/Music`). Unavailable paths (unmounted drives) are silently skipped.

### Running

```bash
# Terminal 1: Start backend
cd server
npm run dev

# Terminal 2: Start frontend
cd client
npm run dev
```

Open http://localhost:5173 in your browser.

### Building for Production

```bash
# Build backend
cd server
npm run build

# Build frontend
cd client
npm run build
```

---

## 🤖 Настройка ИИ помощника (AI Assistant)

NOA использует **локальную LLM модель** для ИИ помощника. Поддерживаются два варианта: **Ollama** (проще) и **llama.cpp** (больше контроля).

### Вариант A: Ollama (рекомендуется)

```bash
# 1. Установить Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. Скачать модель (Qwen2.5 8B рекомендуется для RU/EN)
ollama pull qwen2.5:7b

# 3. Проверить что Ollama работает
curl http://localhost:11434/api/tags
```

Ollama запускается автоматически как сервис на порту 11434.

**Настройка в `.env`:**
```env
LLM_API_URL=http://localhost:11434
LLM_MODEL=qwen2.5:7b
LLM_API_TYPE=auto
```

> `LLM_API_TYPE` может быть `auto` (определяется по порту), `ollama` или `openai` (для llama.cpp и совместимых серверов).

### Вариант B: llama.cpp

```bash
# 1. Склонировать и собрать
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
cmake -B build
cmake --build build --config Release

# 2. Скачать GGUF модель (например Qwen2.5-8B-Instruct)
# Разместить .gguf файл в папке моделей

# 3. Запустить сервер
./build/bin/llama-server -m /path/to/model.gguf -c 4096 --port 8080
```

**Настройка в `.env`:**
```env
LLM_API_URL=http://localhost:8080
LLM_MODEL=qwen2.5
```

### Рекомендуемые модели

| Модель | Размер | Языки | Примечания |
|--------|--------|-------|------------|
| Qwen2.5-8B-Instruct | ~5 GB | RU, EN | Лучший баланс качества и скорости |
| Mistral-7B-Instruct | ~4 GB | EN, RU | Быстрая, хороший английский |
| Llama-3.1-8B-Instruct | ~5 GB | EN | Сильное рассуждение |

Используйте квантизации **Q4_K_M** или **Q5_K_M** для лучшего соотношения качества/производительности.

### Возможности ИИ помощника

- Ведение диалогов на общие темы (RU/EN)
- **RAG (Retrieval-Augmented Generation)** — ИИ может искать по вашей базе знаний:
  - Индексирует данные игр (описания, теги, ProtonDB совместимость)
  - Индексирует метаданные ZIM-архивов из справочной библиотеки
  - Индексирует текстовые файлы (.txt, .md) из справочной библиотеки
  - При ответе показывает использованные источники
- Подключение метаданных библиотек через свичи перед началом диалога:
  - **Музыкальная библиотека** — ИИ видит все ваши треки, альбомы, артистов
  - **Художественная литература** — ИИ видит все ваши книги, авторов, форматы
- Примеры вопросов:
  - "Какие книги Толстого у меня есть?"
  - "Сколько альбомов группы X в библиотеке?"
  - "Какие игры совместимы с Linux?"
  - "Что у меня есть в справочной библиотеке?"
- TTS озвучка ответов (кнопка "Read Aloud" под каждым ответом)

### Настройка RAG

RAG использует модель эмбеддингов для векторного поиска по вашим данным. Индексируется:
- **Справочная литература** — полный текст статей из ZIM-архивов (Wikipedia, WikiHow и др.) через `@openzim/libzim`
- **Данные игр** — описания, теги, статус ProtonDB
- Текстовые файлы (.txt, .md) из справочной библиотеки

```bash
# 1. Скачать модель эмбеддингов (только Ollama)
ollama pull nomic-embed-text

# 2. Добавить в .env
EMBEDDING_MODEL=nomic-embed-text
```

После запуска сервера, откройте страницу **AI Librarian** и нажмите **Build RAG Index**. Индексирование ZIM-архивов может занять время в зависимости от размера. Индекс сохраняется на диск и загружается автоматически при перезапуске.

> **Примечание**: Художественная литература (включая ZIM Project Gutenberg) **не индексируется** для RAG — только справочные материалы и данные игр.
> По умолчанию из каждого ZIM-архива извлекается до 5000 статей.

---

## 🔊 Настройка TTS (Text-to-Speech)

NOA использует **Piper TTS** для локальной офлайн озвучки текста.

### Установка Piper TTS

```bash
# 1. Скачать бинарник Piper
wget https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz
tar -xzf piper_linux_x86_64.tar.gz
sudo mv piper /usr/local/bin/

# 2. Проверить установку
piper --help
```

### Скачивание голосовых моделей

```bash
# Создать директорию для моделей
mkdir -p ~/models/piper
cd ~/models/piper

# Скачать русский голос
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/medium/ru_RU-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/medium/ru_RU-medium.onnx.json

# Скачать английский голос (опционально)
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json
```

Полный список голосов: https://rhasspy.github.io/piper-samples/

### Настройка в `.env`

```env
TTS_MODEL_PATH=/home/user/models/piper
TTS_DEFAULT_VOICE=ru_RU-medium
```

### Проверка TTS

```bash
# Тест из командной строки
echo "Привет, мир!" | piper --model ~/models/piper/ru_RU-medium.onnx --output_file /tmp/test.wav
aplay /tmp/test.wav

# Тест через API (при запущенном сервере)
curl http://localhost:3001/api/tts/status
```

### Где используется TTS

- **ИИ помощник** — кнопка "Read Aloud 🔊" под каждым ответом ИИ
- **Художественная литература** — кнопка чтения вслух в ридере
- **Справочная литература** — озвучка статей из ZIM архивов

---

## Project Structure

```
noa/
├── client/                 # Vue 3 frontend
│   ├── src/
│   │   ├── assets/         # CSS theme
│   │   ├── components/     # Shared components (HeaderNav)
│   │   ├── pages/          # Page components
│   │   └── router/         # Vue Router config
│   └── vite.config.ts
├── server/                 # Node.js backend
│   ├── src/
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   └── index.ts        # Server entry
│   └── .env.example
├── data/                   # Data storage
│   ├── games/              # Game data (JSON + images)
│   ├── metadata/           # Generated library metadata
│   └── bookmarks/          # Reading bookmarks
└── prompt_noa              # System specification
```

## API Endpoints

### Games
- `GET /api/games` — List games (query: search, tag, source)
- `GET /api/games/tags` — List all tags
- `GET /api/games/:id` — Game details

### Music
- `GET /api/music/tracks` — List tracks (query: search)
- `GET /api/music/scan` — Scan music library
- `GET /api/music/stream/:id` — Stream audio file
- `GET /api/music/playlists` — List playlists
- `POST /api/music/playlists` — Create playlist
- `PUT /api/music/playlists/:id` — Update playlist
- `DELETE /api/music/playlists/:id` — Delete playlist

### Fiction
- `GET /api/fiction/books` — List books (query: search, format, language, author)
- `GET /api/fiction/books/:id` — Book details
- `GET /api/fiction/scan` — Scan fiction library
- `GET /api/fiction/read/:id` — Read/download book

### Bookmarks
- `GET /api/bookmarks` — All bookmarks
- `GET /api/bookmarks/:bookId` — Book bookmarks
- `PUT /api/bookmarks/:bookId/position` — Save reading position
- `POST /api/bookmarks/:bookId/manual` — Add manual bookmark
- `DELETE /api/bookmarks/:bookId/manual/:id` — Remove bookmark

### Reference
- `GET /api/reference/archives` — List ZIM archives
- `GET /api/reference/archives/:filename/search` — Search archive

### AI Assistant
- `POST /api/ai/chat` — Send chat message (body: `{ message, history, context }`)
- `GET /api/ai/status` — AI availability status (checks LLM server)

### TTS
- `POST /api/tts/synthesize` — Synthesize speech (body: `{ text, voice?, speed? }`) → audio/wav stream
- `GET /api/tts/voices` — Available voice models
- `GET /api/tts/status` — TTS availability (checks Piper + models)

## Adding Data

### Games
Place game data JSON in `data/games/games.json` and header images in `data/games/header_images/`.

### Music
Set `MUSIC_LIBRARY_PATH` in .env to your music directory (or multiple directories, comma-separated), then use the "Rescan Library" button in the Music section.

### Fiction
Set `FICTION_LIBRARY_PATH` in .env to your books directory (or multiple directories, comma-separated) with PDF, EPUB, FB2 files, then use the "Rescan Library" button.

### Reference
Set `REFERENCE_LIBRARY_PATH` in .env (comma-separated for multiple directories) and place .zim archive files there.

## Offline-First Design

NOA is designed for permanent offline use:
- All data stored locally in JSON files
- No external API calls required
- AI assistant uses local LLM (Ollama / llama.cpp)
- TTS uses local Piper engine
- All metadata cached for fast access

## License

Private project — for personal use.
