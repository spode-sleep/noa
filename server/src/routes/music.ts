import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as mm from 'music-metadata';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const dataPath = process.env.DATA_PATH || path.join(__dirname, '..', '..', '..', 'data');
const musicPath = process.env.MUSIC_LIBRARY_PATH || '';
const metadataDir = path.join(dataPath, 'metadata');
const libraryFile = path.join(metadataDir, 'music_library.json');
const playlistsFile = path.join(metadataDir, 'playlists.json');

const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.wma'];

const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
};

interface Track {
  id: string;
  filepath: string;
  title: string;
  artist: string;
  album: string;
  year: number | null;
  genre: string;
  duration: number;
}

interface MusicLibrary {
  tracks: Track[];
  last_scan: string | null;
}

interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  created: string;
}

interface PlaylistsData {
  playlists: Playlist[];
}

function readJSON<T>(filepath: string, fallback: T): T {
  try {
    const data = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(filepath: string, data: T): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (AUDIO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

function hashFilepath(filepath: string): string {
  return crypto.createHash('md5').update(filepath).digest('hex');
}

// GET /api/music/tracks
router.get('/tracks', (_req: Request, res: Response) => {
  const library = readJSON<MusicLibrary>(libraryFile, { tracks: [], last_scan: null });
  const search = (_req.query.search as string || '').toLowerCase();

  if (search) {
    const filtered = library.tracks.filter((t) =>
      t.title.toLowerCase().includes(search) ||
      t.artist.toLowerCase().includes(search) ||
      t.album.toLowerCase().includes(search)
    );
    res.json({ tracks: filtered, last_scan: library.last_scan });
  } else {
    res.json(library);
  }
});

// GET /api/music/scan
router.get('/scan', async (_req: Request, res: Response) => {
  try {
    if (!musicPath) {
      res.status(400).json({ error: 'MUSIC_LIBRARY_PATH not configured' });
      return;
    }

    if (!fs.existsSync(musicPath)) {
      res.status(404).json({ error: 'Music library path not found' });
      return;
    }

    const files = walkDir(musicPath);
    const tracks: Track[] = [];

    for (const filepath of files) {
      try {
        const metadata = await mm.parseFile(filepath);
        const common = metadata.common;
        tracks.push({
          id: hashFilepath(filepath),
          filepath,
          title: common.title || path.basename(filepath, path.extname(filepath)),
          artist: common.artist || 'Unknown Artist',
          album: common.album || 'Unknown Album',
          year: common.year || null,
          genre: common.genre?.[0] || '',
          duration: Math.round(metadata.format.duration || 0),
        });
      } catch {
        // Skip files that can't be parsed
        tracks.push({
          id: hashFilepath(filepath),
          filepath,
          title: path.basename(filepath, path.extname(filepath)),
          artist: 'Unknown Artist',
          album: 'Unknown Album',
          year: null,
          genre: '',
          duration: 0,
        });
      }
    }

    const library: MusicLibrary = {
      tracks,
      last_scan: new Date().toISOString(),
    };

    writeJSON(libraryFile, library);
    res.json(library);
  } catch (err) {
    res.status(500).json({ error: 'Scan failed', details: String(err) });
  }
});

// GET /api/music/stream/:id
router.get('/stream/:id', (req: Request, res: Response) => {
  const library = readJSON<MusicLibrary>(libraryFile, { tracks: [], last_scan: null });
  const track = library.tracks.find((t) => t.id === req.params.id);

  if (!track) {
    res.status(404).json({ error: 'Track not found' });
    return;
  }

  if (!fs.existsSync(track.filepath)) {
    res.status(404).json({ error: 'Audio file not found' });
    return;
  }

  const stat = fs.statSync(track.filepath);
  const fileSize = stat.size;
  const ext = path.extname(track.filepath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(track.filepath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(track.filepath).pipe(res);
  }
});

// GET /api/music/playlists
router.get('/playlists', (_req: Request, res: Response) => {
  const data = readJSON<PlaylistsData>(playlistsFile, { playlists: [] });
  res.json(data);
});

// POST /api/music/playlists
router.post('/playlists', (req: Request, res: Response) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }

  const data = readJSON<PlaylistsData>(playlistsFile, { playlists: [] });
  const playlist: Playlist = {
    id: uuidv4(),
    name,
    trackIds: [],
    created: new Date().toISOString(),
  };
  data.playlists.push(playlist);
  writeJSON(playlistsFile, data);
  res.status(201).json(playlist);
});

// PUT /api/music/playlists/:id
router.put('/playlists/:id', (req: Request, res: Response) => {
  const data = readJSON<PlaylistsData>(playlistsFile, { playlists: [] });
  const playlist = data.playlists.find((p) => p.id === req.params.id);

  if (!playlist) {
    res.status(404).json({ error: 'Playlist not found' });
    return;
  }

  if (req.body.name !== undefined) {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Name cannot be empty' });
      return;
    }
    playlist.name = name;
  }
  if (req.body.trackIds !== undefined) {
    if (!Array.isArray(req.body.trackIds) || !req.body.trackIds.every((id: unknown) => typeof id === 'string')) {
      res.status(400).json({ error: 'trackIds must be an array of strings' });
      return;
    }
    playlist.trackIds = req.body.trackIds;
  }

  writeJSON(playlistsFile, data);
  res.json(playlist);
});

// DELETE /api/music/playlists/:id
router.delete('/playlists/:id', (req: Request, res: Response) => {
  const data = readJSON<PlaylistsData>(playlistsFile, { playlists: [] });
  const index = data.playlists.findIndex((p) => p.id === req.params.id);

  if (index === -1) {
    res.status(404).json({ error: 'Playlist not found' });
    return;
  }

  data.playlists.splice(index, 1);
  writeJSON(playlistsFile, data);
  res.status(204).send();
});

// POST /api/music/playlists/:id/tracks
router.post('/playlists/:id/tracks', (req: Request, res: Response) => {
  const { trackId } = req.body;
  if (!trackId) {
    res.status(400).json({ error: 'trackId is required' });
    return;
  }

  const data = readJSON<PlaylistsData>(playlistsFile, { playlists: [] });
  const playlist = data.playlists.find((p) => p.id === req.params.id);

  if (!playlist) {
    res.status(404).json({ error: 'Playlist not found' });
    return;
  }

  if (!playlist.trackIds.includes(trackId)) {
    playlist.trackIds.push(trackId);
  }

  writeJSON(playlistsFile, data);
  res.json(playlist);
});

// DELETE /api/music/playlists/:id/tracks/:trackId
router.delete('/playlists/:id/tracks/:trackId', (req: Request, res: Response) => {
  const data = readJSON<PlaylistsData>(playlistsFile, { playlists: [] });
  const playlist = data.playlists.find((p) => p.id === req.params.id);

  if (!playlist) {
    res.status(404).json({ error: 'Playlist not found' });
    return;
  }

  playlist.trackIds = playlist.trackIds.filter((id) => id !== req.params.trackId);
  writeJSON(playlistsFile, data);
  res.json(playlist);
});

export default router;
