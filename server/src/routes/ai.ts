import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { initRag, rebuildIndex, ragSearch, buildRagContext, getIndexStats } from '../services/rag';
import { runAgent, isBareRepo, cleanupWorkdirsForConversation, abortAgent, isAgentRunning } from '../services/agent';

const router = Router();

// RAG is initialized from index.ts after ChromaDB is ready

const dataPath = process.env.DATA_PATH || path.join(__dirname, '..', '..', '..', 'data');
const metadataDir = path.join(dataPath, 'metadata');
const llmApiUrl = process.env.LLM_API_URL || 'http://localhost:11434';
const llmApiType = process.env.LLM_API_TYPE || 'auto'; // 'ollama', 'openai', or 'auto'
const MAX_HISTORY_MESSAGES = 20;

const DEFAULT_MODEL = 'huihui_ai/qwen3-abliterated:8b-v2';

function getConfiguredModels(): string[] {
  const envModels = process.env.LLM_MODELS;
  if (envModels) {
    const models = envModels.split(',').map(m => m.trim()).filter(Boolean);
    return models.length > 0 ? models : [DEFAULT_MODEL];
  }
  return [DEFAULT_MODEL];
}

const llmModel = getConfiguredModels()[0];

function isModelAllowed(model: string): boolean {
  const allowed = getConfiguredModels();
  return allowed.includes(model);
}

// --- Warez repo resolution for agent ---

import { execSync } from 'child_process';

const warezPaths = (process.env.WAREZ_LIBRARY_PATH || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

interface RepoInfo {
  name: string;
  path: string;
  branch: string;
  isGitRepo: boolean;
}

function findWarezRepos(): RepoInfo[] {
  const repos: RepoInfo[] = [];
  for (const warezPath of warezPaths) {
    if (!fs.existsSync(warezPath)) continue;
    const entries = fs.readdirSync(warezPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(warezPath, entry.name);
      const hasGitDir = fs.existsSync(path.join(fullPath, '.git'));
      const bare = isBareRepo(fullPath);
      const isGitRepo = hasGitDir || bare;
      let branch = '';
      if (isGitRepo) {
        try {
          branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: fullPath, encoding: 'utf-8', timeout: 5000 }).trim();
        } catch { /* ignore */ }
      }
      repos.push({ name: entry.name, path: fullPath, branch, isGitRepo });
    }
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

function findRepoByName(name: string): RepoInfo | null {
  if (!name || name.includes('/') || name.includes('\\') || name === '..' || name === '.') return null;
  return findWarezRepos().find(r => r.name === name) || null;
}

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
      timeout: 600000,
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

async function sendToLlamaCpp(model: string, messages: ChatMessage[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(llmApiUrl);
    const payload = JSON.stringify({
      model,
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
      timeout: 600000,
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

// POST /api/ai/chat - Send message to AI Agent
router.post('/chat', async (req: Request, res: Response) => {
  const { message, history, context, model: requestedModel, repo: repoName, branch: requestedBranch, conversationId } = req.body;

  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  // Determine which model to use
  const trimmedModel = typeof requestedModel === 'string' ? requestedModel.trim() : '';
  const selectedModel = (trimmedModel && isModelAllowed(trimmedModel))
    ? trimmedModel
    : llmModel;

  // Check if LLM is available
  const status = await checkLlmAvailability();
  if (!status.available) {
    res.json({
      role: 'assistant',
      content: `AI assistant is not available. ${status.message}`,
      sources: [],
      actions: [],
    });
    return;
  }

  // If a repo is selected, use the agent with tool-calling
  if (typeof repoName === 'string' && repoName.trim()) {
    const repo = findRepoByName(repoName.trim());
    if (!repo) {
      res.json({
        role: 'assistant',
        content: `Repository "${repoName}" not found in Warez paths.`,
        sources: [],
        actions: [],
      });
      return;
    }

    try {
      const targetBranch = typeof requestedBranch === 'string' ? requestedBranch.trim() : '';
      const historyArr = Array.isArray(history) ? history : [];
      const isFirstMessage = historyArr.filter((m: any) => m.role === 'assistant').length === 0;
      const convId = typeof conversationId === 'string' && conversationId.trim()
        ? conversationId.trim()
        : crypto.randomUUID();
      const result = await runAgent(
        selectedModel,
        message,
        historyArr,
        repo.path,
        repo.name,
        targetBranch || repo.branch,
        repo.isGitRepo,
        isFirstMessage,
        convId,
      );

      res.json({
        role: 'assistant',
        content: result.response,
        actions: result.actions,
        currentBranch: result.currentBranch,
        parentBranch: targetBranch || repo.branch,
        sources: [],
      });
    } catch (err) {
      res.json({
        role: 'assistant',
        content: `Agent error: ${String(err)}`,
        actions: [],
        sources: [],
      });
    }
    return;
  }

  // No repo selected — use standard LLM chat (with RAG)
  const contextLoaded = { musicLibrary: false, fictionLibrary: false };

  if (context?.musicLibrary) {
    const data = readJSON(path.join(metadataDir, 'music_library.json'));
    contextLoaded.musicLibrary = data !== null;
  }
  if (context?.fictionLibrary) {
    const data = readJSON(path.join(metadataDir, 'fiction_library.json'));
    contextLoaded.fictionLibrary = data !== null;
  }

  // RAG: search for relevant context
  let ragSources: string[] = [];
  let ragContextText = '';
  try {
    const ragResults = await ragSearch(message, 5);
    if (ragResults.length > 0) {
      const ragCtx = buildRagContext(ragResults);
      ragContextText = ragCtx.contextText;
      ragSources = ragCtx.sources;
    }
  } catch (err) {
    console.error('[AI] RAG search error:', err);
  }

  // Build messages array for LLM
  const systemPrompt = buildSystemPrompt(context || {}) + ragContextText;
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

  try {
    let response: string;
    if (detectApiType() === 'ollama') {
      response = await sendToOllama(selectedModel, messages);
    } else {
      response = await sendToLlamaCpp(selectedModel, messages);
    }

    res.json({
      role: 'assistant',
      content: response,
      sources: ragSources,
      actions: [],
      contextLoaded,
    });
  } catch (err) {
    res.json({
      role: 'assistant',
      content: `Error communicating with AI: ${String(err)}. Make sure the LLM server is running.`,
      sources: [],
      actions: [],
      contextLoaded,
    });
  }
});

// POST /api/ai/index - Rebuild RAG index
router.post('/index', async (_req: Request, res: Response) => {
  try {
    const result = await rebuildIndex();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Indexing failed: ${String(err)}` });
  }
});

// GET /api/ai/index/status - Get RAG index status
router.get('/index/status', (_req: Request, res: Response) => {
  res.json(getIndexStats());
});

// GET /api/ai/status - Check AI availability
router.get('/status', async (_req: Request, res: Response) => {
  const status = await checkLlmAvailability();
  const ragStats = getIndexStats();
  res.json({ ...status, models: getConfiguredModels(), defaultModel: llmModel, rag: ragStats });
});

// GET /api/ai/models - List configured models
router.get('/models', (_req: Request, res: Response) => {
  res.json({ models: getConfiguredModels(), defaultModel: llmModel });
});

// GET /api/ai/repos - List available Warez repositories for the agent
router.get('/repos', (_req: Request, res: Response) => {
  const repos = findWarezRepos().map(r => ({ name: r.name, branch: r.branch, isGitRepo: r.isGitRepo }));
  res.json({ repos });
});

// GET /api/ai/repos/:name/branches - List branches for a repository
router.get('/repos/:name/branches', (req: Request, res: Response) => {
  try {
    const repo = findRepoByName(req.params.name as string);
    if (!repo) { res.status(404).json({ error: 'Repository not found' }); return; }
    if (!repo.isGitRepo) { res.json({ branches: [], current: '' }); return; }

    const branchesRaw = execSync('git branch --no-color', { cwd: repo.path, encoding: 'utf-8', timeout: 10000 });
    const lines = branchesRaw.split('\n').filter(Boolean);
    let current = '';
    const branches = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('* ')) {
        current = trimmed.slice(2);
        return current;
      }
      return trimmed;
    });
    res.json({ branches, current });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list branches', details: String(err) });
  }
});

// POST /api/ai/abort - Abort a running agent and revert workdir
router.post('/abort', (req: Request, res: Response) => {
  const { conversationId } = req.body;
  if (typeof conversationId !== 'string' || !conversationId.trim()) {
    res.status(400).json({ error: 'conversationId is required' });
    return;
  }
  const result = abortAgent(conversationId.trim());
  res.json(result);
});

// GET /api/ai/running/:id - Check if agent is running for a conversation
router.get('/running/:id', (req: Request, res: Response) => {
  const convId = req.params.id as string;
  res.json({ running: isAgentRunning(convId) });
});

// DELETE /api/ai/conversations/:id/workdir - Clean up agent workdir when conversation is deleted
router.delete('/conversations/:id/workdir', (req: Request, res: Response) => {
  const convId = req.params.id as string;
  if (!convId || !/^[\w\-]+$/.test(convId)) {
    res.status(400).json({ error: 'Invalid conversation ID' });
    return;
  }
  const removed = cleanupWorkdirsForConversation(convId);
  res.json({ removed });
});

export default router;
