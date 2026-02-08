import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const dataPath = process.env.DATA_PATH || path.join(__dirname, '..', '..', '..', 'data');
const metadataDir = path.join(dataPath, 'metadata');

function readJSON(filepath: string): unknown {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

// POST /api/ai/chat - Send message to AI
router.post('/chat', (req: Request, res: Response) => {
  const { message, context } = req.body;

  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  const contextLoaded = { musicLibrary: false, fictionLibrary: false };

  if (context?.musicLibrary) {
    const data = readJSON(path.join(metadataDir, 'music_library.json'));
    contextLoaded.musicLibrary = data !== null;
  }

  if (context?.fictionLibrary) {
    const data = readJSON(path.join(metadataDir, 'fiction_library.json'));
    contextLoaded.fictionLibrary = data !== null;
  }

  res.json({
    role: 'assistant',
    content: `AI assistant is not configured. Please set up a local LLM model to enable AI features. Your message was: ${message}`,
    sources: [],
    contextLoaded,
  });
});

// GET /api/ai/status - Check AI availability
router.get('/status', (_req: Request, res: Response) => {
  res.json({ available: false, model: null, message: 'LLM not configured' });
});

export default router;
