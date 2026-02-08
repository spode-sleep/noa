import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const ttsModelPath = process.env.TTS_MODEL_PATH || '';

// POST /api/tts/synthesize - Synthesize text to speech
router.post('/synthesize', (req: Request, res: Response) => {
  const { text } = req.body;

  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  res.json({
    available: false,
    message: 'TTS engine (Piper) not configured. Install piper-tts and set TTS_MODEL_PATH in .env',
  });
});

// GET /api/tts/voices - List available voices
router.get('/voices', (_req: Request, res: Response) => {
  try {
    if (!ttsModelPath || !fs.existsSync(ttsModelPath)) {
      res.json({ voices: [] });
      return;
    }

    const entries = fs.readdirSync(ttsModelPath, { withFileTypes: true });
    const voices = entries
      .filter(e => !e.isDirectory() && e.name.toLowerCase().endsWith('.onnx'))
      .map(e => path.basename(e.name, '.onnx'));

    res.json({ voices });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list voices', details: String(err) });
  }
});

// GET /api/tts/status - Check TTS availability
router.get('/status', (_req: Request, res: Response) => {
  res.json({ available: false, message: 'Piper TTS not configured' });
});

export default router;
