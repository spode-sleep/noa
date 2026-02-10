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
| `TTS_DEFAULT_VOICE`    | Default TTS voice identifier                    | `ru_RU-medium`                   |
| `DATA_PATH`            | Path to data storage directory (relative or absolute) | `../data`                   |

### Example `.env`

```env
PORT=3001
MUSIC_LIBRARY_PATH=/home/user/Music,/media/user/USB_DRIVE/Music
FICTION_LIBRARY_PATH=/home/user/Books/Fiction,/media/user/USB_DRIVE/Books
REFERENCE_LIBRARY_PATH=/home/user/Books/Reference,/media/user/USB_DRIVE/ZIM
TTS_MODEL_PATH=/home/user/models/piper
TTS_DEFAULT_VOICE=ru_RU-medium
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

1. Download ZIM archives from [https://wiki.kiwix.org/wiki/Content](https://wiki.kiwix.org/wiki/Content) (while online).
2. Place `.zim` files in the directory specified by `REFERENCE_LIBRARY_PATH`.
3. Common ZIM archives:
   - `wikipedia_ru_all.zim` — Russian Wikipedia
   - `wikipedia_en_all.zim` — English Wikipedia
   - `wikihow_en_all.zim` — WikiHow
   - `wiktionary_ru_all.zim` — Russian Wiktionary
4. Archives are detected automatically when the Reference section loads.

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
# Download Piper binary
wget https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz
tar -xzf piper_linux_x86_64.tar.gz
sudo mv piper /usr/local/bin/

# Verify
piper --help
```

### Download Voice Models

```bash
# Create models directory
mkdir -p ~/models/piper
cd ~/models/piper

# Download Russian voice
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/medium/ru_RU-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/medium/ru_RU-medium.onnx.json

# Download English voice (optional)
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json
```

### Configure in .env

```env
TTS_MODEL_PATH=/home/user/models/piper
TTS_DEFAULT_VOICE=ru_RU-medium
```

### Test TTS

```bash
echo "Привет, мир!" | piper --model ~/models/piper/ru_RU-medium.onnx --output_file test.wav
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
