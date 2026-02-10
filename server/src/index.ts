import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

// Load .env BEFORE importing routes so env vars are available at module init
dotenv.config();

import gamesRouter from './routes/games';
import musicRouter from './routes/music';
import fictionRouter from './routes/fiction';
import referenceRouter from './routes/reference';
import aiRouter from './routes/ai';
import ttsRouter from './routes/tts';
import bookmarksRouter from './routes/bookmarks';
import { startKiwixServe, stopKiwixServe } from './kiwix';
import { startOllama, stopOllama } from './ollama';
import { startChroma, stopChroma } from './chromadb';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve game header images as static files
const dataPath = process.env.DATA_PATH || path.join(__dirname, '..', '..', 'data');
app.use('/data/games/header_images', express.static(path.join(dataPath, 'games', 'header_images')));

// Routes
app.use('/api/games', gamesRouter);
app.use('/api/music', musicRouter);
app.use('/api/fiction', fictionRouter);
app.use('/api/reference', referenceRouter);
app.use('/api/ai', aiRouter);
app.use('/api/tts', ttsRouter);
app.use('/api/bookmarks', bookmarksRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const server = app.listen(PORT, () => {
  console.log(`BOX server running on port ${PORT}`);
  startKiwixServe();
  startOllama();
  startChroma();
});

function shutdown() {
  console.log('Shutting down server...');
  stopKiwixServe();
  stopOllama();
  stopChroma();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
