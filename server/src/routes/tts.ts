import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';

const router = Router();

const ttsModelPath = process.env.TTS_MODEL_PATH || '';
const ttsDefaultVoice = process.env.TTS_DEFAULT_VOICE || 'ru_RU-irina-medium';
const piperPath = process.env.PIPER_PATH || 'piper';

function isPiperInstalled(): boolean {
  try {
    const output = execSync(`"${piperPath}" --help`, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
    const helpText = output.toString();
    // Verify it's actually Piper TTS, not the GTK gaming tool
    return helpText.includes('--model') || helpText.includes('piper');
  } catch {
    return false;
  }
}

function getModelPath(voice: string): string | null {
  if (!ttsModelPath) return null;
  const modelFile = path.join(ttsModelPath, `${voice}.onnx`);
  if (fs.existsSync(modelFile)) return modelFile;
  return null;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// POST /api/tts/synthesize - Synthesize text to speech via Piper TTS
router.post('/synthesize', (req: Request, res: Response) => {
  const { text, voice, speed } = req.body;

  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  if (!isPiperInstalled()) {
    res.status(503).json({
      error: 'Piper TTS is not installed. Install it: https://github.com/rhasspy/piper',
    });
    return;
  }

  const selectedVoice = voice || ttsDefaultVoice;
  const modelPath = getModelPath(selectedVoice);
  if (!modelPath) {
    res.status(404).json({
      error: `Voice model not found: ${selectedVoice}. Place .onnx model files in TTS_MODEL_PATH directory.`,
    });
    return;
  }

  const cleanText = stripMarkdown(text);

  const args = ['--model', modelPath, '--output_raw'];
  if (speed && typeof speed === 'number' && speed > 0) {
    args.push('--length_scale', String(1 / speed));
  }

  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Transfer-Encoding', 'chunked');

  const piper = spawn(piperPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

  // Write WAV header first (Piper --output_raw outputs raw PCM, 16-bit mono 22050Hz)
  const sampleRate = 22050;
  const bitsPerSample = 16;
  const numChannels = 1;
  const headerSize = 44;
  // We write a streaming WAV header with max size placeholder
  const header = Buffer.alloc(headerSize);
  header.write('RIFF', 0);
  header.writeUInt32LE(0x7FFFFFFF, 4); // placeholder file size
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(0x7FFFFFFF, 40); // placeholder data size
  res.write(header);

  piper.stdout.pipe(res);

  piper.stderr.on('data', (data: Buffer) => {
    // Piper outputs progress info to stderr, ignore
  });

  piper.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to run Piper TTS', details: String(err) });
    }
  });

  piper.on('close', (code) => {
    if (code !== 0 && !res.headersSent) {
      res.status(500).json({ error: `Piper exited with code ${code}` });
    }
  });

  piper.stdin.write(cleanText);
  piper.stdin.end();
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

    res.json({ voices, default: ttsDefaultVoice });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list voices', details: String(err) });
  }
});

// GET /api/tts/status - Check TTS availability
router.get('/status', (_req: Request, res: Response) => {
  const piperInstalled = isPiperInstalled();
  const hasModels = ttsModelPath && fs.existsSync(ttsModelPath) &&
    fs.readdirSync(ttsModelPath).some(f => f.endsWith('.onnx'));

  if (piperInstalled && hasModels) {
    res.json({ available: true, message: 'Piper TTS ready', defaultVoice: ttsDefaultVoice });
  } else if (piperInstalled && !hasModels) {
    res.json({ available: false, message: 'Piper installed but no voice models found. Set TTS_MODEL_PATH and add .onnx models.' });
  } else {
    res.json({ available: false, message: 'Piper TTS not installed. See README for setup instructions.' });
  }
});

export default router;
