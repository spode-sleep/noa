# 📦 BOX

Offline Knowledge & Media Hub — a fully offline local application for long-term storage, navigation, and intelligent access to data.

## Features

- **🎮 Games** — Game library from SteamDB/RAWG with ProtonDB compatibility reports
- **🎵 Music** — Local music player with library scanning, metadata and playlists
- **📖 Fiction** — PDF/EPUB/FB2 reader with bookmarks and reading position saving
- **📚 Reference** — ZIM archive browser for offline Wikipedia, WikiHow, iFixIt and more
- **🤖 AI Librarian** — Local AI chat with RAG-powered knowledge base search (Ollama + ChromaDB)
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
- **Python 3.8+** (for ChromaDB)
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

# Pull the LLM model (first time only)
ollama pull qwen2.5:7b

# Pull the embedding model for RAG (first time only)
ollama pull nomic-embed-text

# Verify
curl http://localhost:11434/api/tags
```

> BOX auto-starts ollama serve and auto-pulls models on startup if they are missing.

### 3. Install ChromaDB (RAG Vector Database)

ChromaDB stores vector embeddings for RAG search. It is **auto-launched** by BOX server.

```bash
# Install ChromaDB
pip install chromadb

# Verify installation
chroma --version

# (Optional) Manual start for testing
chroma run --port 8000 --path ./chroma_data
```

> BOX auto-starts chroma run on startup. Data is persisted in chroma_data/ directory.

If you prefer to run ChromaDB manually or on a different host, set in .env:

```env
CHROMA_PORT=8000
CHROMA_DATA_PATH=./chroma_data
```

### 4. Install Piper TTS (Text-to-Speech) — Optional

```bash
# Download Piper binary
wget https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz
tar -xzf piper_linux_x86_64.tar.gz
sudo mv piper /usr/local/bin/

# Create models directory
mkdir -p ~/models/piper
cd ~/models/piper

# Download Russian voice
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/medium/ru_RU-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/medium/ru_RU-medium.onnx.json

# Download English voice (optional)
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json

# Verify
piper --help
```

Full voice list: https://rhasspy.github.io/piper-samples/

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

# Data storage
DATA_PATH=../data

# Kiwix (auto-launched)
KIWIX_PORT=9454
KIWIX_SERVE_PATH=

# TTS (optional)
TTS_MODEL_PATH=/home/user/models/piper
TTS_DEFAULT_VOICE=ru_RU-medium

# AI / LLM (auto-launched)
LLM_API_URL=http://localhost:11434
LLM_MODEL=qwen2.5:7b
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

---

## Troubleshooting

### EADDRINUSE: address already in use :::3001
The server did not shut down cleanly. Find and stop the old process on port 3001.

### Ollama model pull fails
Check model name at https://ollama.com/library. Common models:
- qwen2.5:7b (best for RU/EN)
- mistral:7b (fast, good English)
- llama3.1:8b (strong reasoning)

### ChromaDB won't start
```bash
pip install --upgrade chromadb
chroma run --port 8000 --path ./chroma_data
```

### ZIM files not showing in Reference
Ensure REFERENCE_LIBRARY_PATH points to the directory containing .zim files and kiwix-serve is installed.

### Music metadata not extracted
After adding files, click **Rescan Library**. If artist/title still show as filename, the files may lack ID3 tags.

---

## License

Private project — for personal use.
