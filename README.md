# 🤠 NOA (Non-Online Archive)

Offline Knowledge & Media Hub — a fully offline local application for long-term storage, navigation, and intelligent access to data.

## Features

- **🎮 Games** — Browse game library from SteamDB/RAWG data with ProtonDB compatibility reports
- **🎵 Music** — Local music player with library scanning, metadata extraction, and playlists
- **📖 Fiction** — PDF/EPUB/FB2 reader with bookmarks and reading position tracking
- **📚 Reference** — ZIM archive browser for offline Wikipedia, WikiHow, and other references
- **🤖 AI Assistant** — Local AI chat with RAG support and library context integration

## Tech Stack

- **Frontend**: Vue 3, TypeScript, Composition API, Vue Router, Vite
- **Backend**: Node.js, Express, TypeScript
- **Design**: Dark Frutiger Aurora theme, glassmorphism, desktop-first

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+

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
TTS_MODEL_PATH=/path/to/tts/models
TTS_DEFAULT_VOICE=ru_RU-medium
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
- `POST /api/ai/chat` — Send chat message
- `GET /api/ai/status` — AI availability status

### TTS
- `POST /api/tts/synthesize` — Synthesize speech
- `GET /api/tts/voices` — Available voices
- `GET /api/tts/status` — TTS availability

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
- AI assistant uses local LLM (when configured)
- TTS uses local Piper engine (when configured)
- All metadata cached for fast access

## License

Private project — for personal use.
