# 📦 BOX

Offline Knowledge & Media Hub — a fully offline local application for long-term storage, navigation, and intelligent access to data.

## Features

- **🎮 Games** — Game library from SteamDB/RAWG with ProtonDB compatibility reports, PCGamingWiki fixes and tips
- **🎵 Music** — Local music player with library scanning, metadata and playlists
- **📖 Fiction** — PDF/EPUB/FB2 reader with bookmarks and reading position saving
- **📚 Reference** — ZIM archive browser for offline Wikipedia, WikiHow, iFixIt and more
- **🔧 Warez** — Local git repository browser with README viewer and file tree
- **🤖 AI Librarian** — Local AI chat with multi-model selection and RAG-powered knowledge base search (Ollama + ChromaDB)
- **🔊 TTS** — Text-to-speech via Piper TTS for reading AI responses and articles aloud

## Tech Stack

- **Frontend**: Vue 3, TypeScript, Composition API, Vue Router, Vite
- **Backend**: Node.js, Express, TypeScript
- **AI/LLM**: Ollama (local LLM, auto-launched)
- **Vector DB**: ChromaDB (for RAG, auto-launched)
- **TTS**: Piper TTS (local, offline)
- **Design**: Dark Frutiger Aurora theme, glassmorphism, desktop-first

---

## Quick Start

```bash
# 1. Install backend
cd server && npm install && cp .env.example .env

# 2. Install frontend
cd ../client && npm install

# 3. Start (from server/)
cd ../server && npm run dev
# In another terminal:
cd client && npm run dev
```

Open http://localhost:5173

---

## Installation Guide

### Prerequisites

- **Node.js 18+** (recommended: 20 LTS)
- **npm 9+**
- **Linux** (tested on Linux Mint 22 / Ubuntu 24.04)

### 1. Clone & Install

```bash
git clone <repo-url>
cd noa

# Backend
cd server
npm install
cp .env.example .env
# Edit .env with your paths (see Configuration section below)

# Frontend
cd ../client
npm install
```

### 2. Install Ollama (AI Assistant)

Ollama is **auto-launched** by BOX server if not already running.

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the default LLM model (first time only)
ollama pull huihui_ai/qwen3-abliterated:8b-v2

# Pull additional models (optional)
ollama pull huihui_ai/qwen2.5-abliterate:14b
ollama pull qwen2.5-coder:14b

# Pull the embedding model for RAG (first time only)
ollama pull nomic-embed-text

# Verify
curl http://localhost:11434/api/tags
```

> BOX auto-starts ollama serve and auto-pulls models on startup if they are missing.

### 3. Install ChromaDB (RAG Vector Database)

ChromaDB stores vector embeddings for RAG search. It is **auto-launched** by BOX server.

```bash
# Install ChromaDB CLI (standalone Rust binary, no Python needed)
curl -sSL https://raw.githubusercontent.com/chroma-core/chroma/main/rust/cli/install/install.sh | bash

# Verify installation
chroma --version
```

> BOX auto-starts `chroma run` on startup. Data is persisted in `chroma_data/` directory.

If you prefer to run ChromaDB manually or on a different host, set in .env:

```env
CHROMA_PORT=8000
CHROMA_DATA_PATH=./chroma_data
```

### 4. Install Piper TTS (Text-to-Speech) — Optional

> ⚠️ **Do NOT use `apt install piper`** — that installs a GTK gaming device tool, not Piper TTS!

```bash
# Download Piper TTS binary from GitHub releases
wget https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz
tar -xzf piper_linux_x86_64.tar.gz
sudo mv piper/piper /usr/local/bin/piper-tts

# Set in your .env:
# PIPER_PATH=/usr/local/bin/piper-tts

# Create models directory
mkdir -p ~/models/piper
cd ~/models/piper

# Download Russian voice (default: irina — female)
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json

# Other Russian voices:
# dmitri — male:  ru_RU-dmitri-medium
# denis — male:   ru_RU-denis-medium
# ruslan — male:  ru_RU-ruslan-medium

# Download English voice (optional)
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json

# Verify (use the same name you set in PIPER_PATH)
piper-tts --help  # Should show --model, --output_file, --output_raw options
```

Voice samples: https://rhasspy.github.io/piper-samples/
All voices: https://huggingface.co/rhasspy/piper-voices/tree/main
Custom community voices: https://github.com/drycen/piper-tts-voices / https://community.home-assistant.io/t/collections-of-pre-trained-piper-voices/915666

### 5. Install kiwix-serve (Reference Library) — Optional

```bash
# Install kiwix-tools
sudo apt install kiwix-tools

# Or download from https://download.kiwix.org/release/kiwix-tools/
```

> BOX auto-starts kiwix-serve with all ZIM files found in REFERENCE_LIBRARY_PATH.

---

## Configuration

Edit server/.env:

```env
# Server
PORT=3001

# Content Libraries (comma-separated for multiple dirs, supports USB/external drives)
MUSIC_LIBRARY_PATH=/home/user/Music,/media/user/USB_DRIVE/Music
FICTION_LIBRARY_PATH=/home/user/Books,/media/user/USB_DRIVE/Books
REFERENCE_LIBRARY_PATH=/home/user/Reference,/media/user/USB_DRIVE/ZIM
WAREZ_LIBRARY_PATH=/home/user/Repos,/media/user/USB_DRIVE/Repos

# Data storage
DATA_PATH=../data

# Kiwix (auto-launched)
KIWIX_PORT=9454
KIWIX_SERVE_PATH=

# TTS (optional)
PIPER_PATH=/usr/local/bin/piper-tts
TTS_MODEL_PATH=/home/user/models/piper
TTS_DEFAULT_VOICE=ru_RU-irina-medium

# AI / LLM (auto-launched)
LLM_API_URL=http://localhost:11434
LLM_MODELS=huihui_ai/qwen3-abliterated:8b-v2,huihui_ai/qwen2.5-abliterate:14b,qwen2.5-coder:14b
LLM_API_TYPE=auto
EMBEDDING_MODEL=nomic-embed-text

# ChromaDB (auto-launched)
CHROMA_PORT=8000
CHROMA_DATA_PATH=./chroma_data

# RAG limits
MAX_RAG_CHUNKS=100000
```

### Multiple Folders and External Drives

All library paths support comma-separated values:

```env
MUSIC_LIBRARY_PATH=/home/user/Music,/media/user/USB_DRIVE/Music,/mnt/nas/Music
```

Unavailable paths (unmounted USB drives) are silently skipped during scans.

---

## RAG (Retrieval-Augmented Generation)

RAG allows the AI Librarian to search your reference library when answering questions.

### How it works

1. **Indexing**: BOX extracts text from ZIM archives (Wikipedia, iFixIt, WikiHow, etc.), chunks it into sections, and generates vector embeddings via Ollama
2. **Storage**: Embeddings are stored in ChromaDB (persistent on disk in chroma_data/)
3. **Retrieval**: When you ask a question, the most relevant chunks are found via cosine similarity and injected into the LLM prompt
4. **Generation**: The LLM generates an answer using the retrieved context, with source attribution

### Building the RAG Index

1. Start the BOX server (Ollama and ChromaDB auto-launch)
2. Open the **AI Librarian** page
3. Click **Build RAG Index**
4. Wait for indexing to complete (progress shown in server logs)

### What gets indexed

- **ZIM archives** — Full article text from all ZIM files (section-aware chunking, all articles extracted)
- **Game data** — Descriptions, tags, ProtonDB compatibility
- Fiction and music are **NOT indexed** (only metadata available via context switches)

### Re-indexing

Click **Build RAG Index** again to rebuild. The old ChromaDB collection is replaced.

---

## Running

```bash
# Terminal 1: Backend (auto-starts Ollama, ChromaDB, kiwix-serve)
cd server
npm run dev

# Terminal 2: Frontend
cd client
npm run dev
```

### Auto-launched Services

| Service | Port | Purpose |
|---------|------|---------|
| Ollama | 11434 | LLM inference + embeddings |
| ChromaDB | 8000 | Vector database for RAG |
| kiwix-serve | 9454 | ZIM archive browser |

All services are stopped gracefully on server shutdown (Ctrl+C).

### Building for Production

```bash
cd server && npm run build
cd ../client && npm run build
```

---

## Adding Content

### Games
Place games.json in data/games/ and header images in data/games/header_images/.

### Music
Set MUSIC_LIBRARY_PATH in .env, then click **Rescan Library** in the Music section. Supports MP3, OGG, FLAC, WAV, AAC, M4A.

### Fiction
Set FICTION_LIBRARY_PATH in .env, then click **Rescan Library**. Supports PDF, EPUB, FB2.

### Reference
Set REFERENCE_LIBRARY_PATH in .env and place .zim files there. Download ZIM archives from https://download.kiwix.org/zim/

### Warez
Set WAREZ_LIBRARY_PATH in .env, pointing to directories containing git repositories or other project folders. BOX will display them with git metadata (branch, commits, last commit message) and render README files.

---

## Troubleshooting

### EADDRINUSE: address already in use :::3001
The server did not shut down cleanly. Find and stop the old process on port 3001.

### Ollama model pull fails
Check model name at https://ollama.com/library. Configured models:
- huihui_ai/qwen3-abliterated:8b-v2 (uncensored, RU/EN, default)
- huihui_ai/qwen2.5-abliterate:14b (uncensored, RU/EN, 14B)
- qwen2.5-coder:14b (code generation, 14B)

### ChromaDB won't start
```bash
# Install standalone CLI (no Python needed):
curl -sSL https://raw.githubusercontent.com/chroma-core/chroma/main/rust/cli/install/install.sh | bash
# Test:
chroma run --port 8000 --path ./chroma_data
```

### ZIM files not showing in Reference
Ensure REFERENCE_LIBRARY_PATH points to the directory containing .zim files and kiwix-serve is installed.

### Music metadata not extracted
After adding files, click **Rescan Library**. If artist/title still show as filename, the files may lack ID3 tags.

### Piper TTS: "Unknown option --model"
You likely have the wrong `piper` package installed. On some Linux distros, `apt install piper` installs a **GTK gaming device tool**, not Piper TTS.

```bash
# Check which piper you have:
which piper
piper --help  # Should show --model, --output_file, --output_raw options

# If wrong, remove it and install Piper TTS:
sudo apt remove piper
# Download the correct Piper TTS from:
# https://github.com/rhasspy/piper/releases
# Install as piper-tts to avoid conflicts:
sudo mv piper/piper /usr/local/bin/piper-tts
# Then set PIPER_PATH=/usr/local/bin/piper-tts in .env
```

---

## License

Private project — for personal use.
