import { spawn, ChildProcess, execSync } from 'child_process';
import * as http from 'http';

let ollamaProcess: ChildProcess | null = null;

function findOllama(): string | null {
  const envPath = process.env.OLLAMA_PATH;
  if (envPath) return envPath;

  try {
    const cmd = process.platform === 'win32' ? 'where ollama' : 'which ollama';
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (result) return result.split('\n')[0];
  } catch {
    // Not found in PATH
  }
  return null;
}

function getOllamaUrl(): string {
  return process.env.LLM_API_URL || 'http://127.0.0.1:11434';
}

function isOllamaRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(getOllamaUrl());
    const req = http.get(
      { hostname: url.hostname, port: url.port, path: '/', timeout: 2000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function waitForOllama(maxAttempts = 15): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      isOllamaRunning().then((running) => {
        if (running) return resolve(true);
        if (attempts >= maxAttempts) return resolve(false);
        setTimeout(check, 1000);
      });
    };
    check();
  });
}

async function pullModel(model: string): Promise<void> {
  const url = getOllamaUrl();
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ name: model });
    const parsed = new URL(`${url}/api/pull`);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        timeout: 600000, // 10 minutes for large models
      },
      (res) => {
        let lastStatus = '';
        res.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.status && obj.status !== lastStatus) {
                console.log(`[ollama] pull ${model}: ${obj.status}`);
                lastStatus = obj.status;
              }
            } catch { /* ignore partial JSON */ }
          }
        });
        res.on('end', () => resolve());
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function isModelAvailable(model: string): Promise<boolean> {
  const url = getOllamaUrl();
  return new Promise((resolve) => {
    const parsed = new URL(`${url}/api/tags`);
    const req = http.get(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, timeout: 5000 },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const models = json.models || [];
            const found = models.some((m: { name: string }) => m.name === model || m.name.startsWith(model + ':'));
            resolve(found);
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

export async function startOllama(): Promise<void> {
  const alreadyRunning = await isOllamaRunning();
  if (alreadyRunning) {
    console.log('[ollama] Ollama is already running.');
  } else {
    const ollamaPath = findOllama();
    if (!ollamaPath) {
      console.log('[ollama] ollama not found. AI features will not be available.');
      console.log('[ollama] Install Ollama: curl -fsSL https://ollama.com/install.sh | sh');
      return;
    }

    console.log('[ollama] Starting ollama serve...');
    ollamaProcess = spawn(ollamaPath, ['serve'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env },
    });

    ollamaProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[ollama] ${msg}`);
    });

    ollamaProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('llama_model_loader')) console.log(`[ollama] ${msg}`);
    });

    ollamaProcess.on('error', (err: Error) => {
      console.error(`[ollama] Failed to start: ${err.message}`);
      ollamaProcess = null;
    });

    ollamaProcess.on('exit', (code: number | null) => {
      console.log(`[ollama] exited with code ${code}`);
      ollamaProcess = null;
    });

    const ready = await waitForOllama();
    if (!ready) {
      console.error('[ollama] Failed to start within timeout.');
      return;
    }
    console.log('[ollama] Ollama is ready.');
  }

  // Auto-pull models
  const llmModel = process.env.LLM_MODEL || 'qwen2.5:7b';
  const embModel = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
  const extraModels = process.env.LLM_MODELS
    ? process.env.LLM_MODELS.split(',').map(m => m.trim()).filter(Boolean)
    : [];

  const allModels = new Set([llmModel, embModel, ...extraModels]);

  for (const model of allModels) {
    const available = await isModelAvailable(model);
    if (!available) {
      console.log(`[ollama] Pulling model ${model}...`);
      try {
        await pullModel(model);
        console.log(`[ollama] Model ${model} pulled successfully.`);
      } catch (err: any) {
        console.error(`[ollama] Failed to pull ${model}: ${err.message}`);
      }
    } else {
      console.log(`[ollama] Model ${model} is available.`);
    }
  }
}

export function stopOllama(): void {
  if (ollamaProcess) {
    console.log('[ollama] Stopping ollama...');
    ollamaProcess.kill();
    ollamaProcess = null;
  }
}
