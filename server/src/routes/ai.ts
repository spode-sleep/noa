import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

const router = Router();

const dataPath = process.env.DATA_PATH || path.join(__dirname, '..', '..', '..', 'data');
const metadataDir = path.join(dataPath, 'metadata');
const llmApiUrl = process.env.LLM_API_URL || 'http://localhost:11434';
const llmModel = process.env.LLM_MODEL || 'qwen2.5:8b';
const llmApiType = process.env.LLM_API_TYPE || 'auto'; // 'ollama', 'openai', or 'auto'
const MAX_HISTORY_MESSAGES = 20;

function readJSON(filepath: string): unknown {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

function buildSystemPrompt(context: { musicLibrary?: boolean; fictionLibrary?: boolean }): string {
  let systemPrompt = 'You are NOA AI Assistant — a helpful, knowledgeable offline assistant. You can answer questions on any topic, help with analysis, and provide information from connected libraries. Answer in the language the user writes in.';

  if (context?.musicLibrary) {
    const data = readJSON(path.join(metadataDir, 'music_library.json'));
    if (data) {
      systemPrompt += `\n\n<music_library>\n${JSON.stringify(data)}\n</music_library>`;
    }
  }

  if (context?.fictionLibrary) {
    const data = readJSON(path.join(metadataDir, 'fiction_library.json'));
    if (data) {
      systemPrompt += `\n\n<fiction_library>\n${JSON.stringify(data)}\n</fiction_library>`;
    }
  }

  return systemPrompt;
}

function detectApiType(): 'ollama' | 'openai' {
  if (llmApiType === 'ollama') return 'ollama';
  if (llmApiType === 'openai') return 'openai';
  // Auto-detect: default Ollama port is 11434
  return llmApiUrl.includes(':11434') ? 'ollama' : 'openai';
}

async function checkLlmAvailability(): Promise<{ available: boolean; model: string | null; message: string }> {
  return new Promise((resolve) => {
    const urlObj = new URL(llmApiUrl);
    const checkPath = detectApiType() === 'ollama' ? '/api/tags' : '/health';
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80'),
      path: checkPath,
      method: 'GET',
      timeout: 3000,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ available: true, model: llmModel, message: `LLM ready (${llmModel})` });
        } else {
          resolve({ available: false, model: null, message: `LLM server responded with status ${res.statusCode}` });
        }
      });
    });

    req.on('error', () => {
      resolve({ available: false, model: null, message: `LLM server not reachable at ${llmApiUrl}. Start Ollama or llama.cpp server.` });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ available: false, model: null, message: 'LLM server connection timed out' });
    });
    req.end();
  });
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

async function sendToOllama(model: string, messages: ChatMessage[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(llmApiUrl);
    const payload = JSON.stringify({
      model,
      messages,
      stream: false,
    });

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || '80',
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 120000,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.message?.content || data.response || 'No response from model.');
        } catch {
          resolve('Error parsing LLM response.');
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('LLM request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

async function sendToLlamaCpp(messages: ChatMessage[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(llmApiUrl);
    const payload = JSON.stringify({
      messages,
      stream: false,
      temperature: 0.7,
      max_tokens: 2048,
    });

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || '80',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 120000,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.choices?.[0]?.message?.content || 'No response from model.');
        } catch {
          resolve('Error parsing LLM response.');
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('LLM request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

// POST /api/ai/chat - Send message to AI
router.post('/chat', async (req: Request, res: Response) => {
  const { message, history, context } = req.body;

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

  // Build messages array for LLM
  const systemPrompt = buildSystemPrompt(context || {});
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

  // Add conversation history (last messages to save context)
  if (Array.isArray(history)) {
    const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  // Check if LLM is available
  const status = await checkLlmAvailability();
  if (!status.available) {
    res.json({
      role: 'assistant',
      content: `AI assistant is not available. ${status.message}`,
      sources: [],
      contextLoaded,
    });
    return;
  }

  try {
    let response: string;
    if (detectApiType() === 'ollama') {
      response = await sendToOllama(llmModel, messages);
    } else {
      response = await sendToLlamaCpp(messages);
    }

    res.json({
      role: 'assistant',
      content: response,
      sources: [],
      contextLoaded,
    });
  } catch (err) {
    res.json({
      role: 'assistant',
      content: `Error communicating with AI: ${String(err)}. Make sure the LLM server is running.`,
      sources: [],
      contextLoaded,
    });
  }
});

// GET /api/ai/status - Check AI availability
router.get('/status', async (_req: Request, res: Response) => {
  const status = await checkLlmAvailability();
  res.json(status);
});

export default router;
