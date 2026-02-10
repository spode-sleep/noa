/**
 * ChromaDB auto-launcher
 * Starts chroma server as a child process if not already running.
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import * as http from 'http';

const CHROMA_PORT = parseInt(process.env.CHROMA_PORT || '8000', 10);
const CHROMA_DATA_PATH = process.env.CHROMA_DATA_PATH || './chroma_data';

let chromaProcess: ChildProcess | null = null;

function isChromaRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: 'localhost', port: CHROMA_PORT, path: '/api/v2/heartbeat', method: 'GET', timeout: 3000 },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function findChromaBinary(): string | null {
  try {
    const result = execSync('which chroma 2>/dev/null || where chroma 2>NUL', { encoding: 'utf-8' }).trim();
    return result.split('\n')[0] || null;
  } catch {
    // Try pip-installed chroma
    try {
      execSync('python3 -m chromadb --help 2>/dev/null', { encoding: 'utf-8' });
      return 'python3';
    } catch {
      return null;
    }
  }
}

export async function startChroma(): Promise<void> {
  if (await isChromaRunning()) {
    console.log('[chromadb] ChromaDB is already running on port', CHROMA_PORT);
    return;
  }

  const binary = findChromaBinary();
  if (!binary) {
    console.log('[chromadb] ChromaDB binary not found. Install with: curl -sSL https://raw.githubusercontent.com/chroma-core/chroma/main/rust/cli/install/install.sh | bash');
    console.log('[chromadb] RAG will use fallback in-memory vector store');
    return;
  }

  console.log(`[chromadb] Starting ChromaDB on port ${CHROMA_PORT}...`);

  try {
    const args = binary === 'python3'
      ? ['-m', 'chromadb', 'run', '--port', String(CHROMA_PORT), '--path', CHROMA_DATA_PATH]
      : ['run', '--port', String(CHROMA_PORT), '--path', CHROMA_DATA_PATH];

    chromaProcess = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    chromaProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[chromadb] ${msg}`);
    });

    chromaProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('INFO') && !msg.includes('Uvicorn')) {
        console.error(`[chromadb] ${msg}`);
      }
    });

    chromaProcess.on('exit', (code) => {
      console.log(`[chromadb] Process exited with code ${code}`);
      chromaProcess = null;
    });

    // Wait for ChromaDB to be ready
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await isChromaRunning()) {
        console.log(`[chromadb] ChromaDB is ready on port ${CHROMA_PORT}`);
        return;
      }
    }
    console.warn('[chromadb] ChromaDB did not start within 30 seconds');
  } catch (err) {
    console.error('[chromadb] Failed to start ChromaDB:', err);
  }
}

export function stopChroma(): void {
  if (chromaProcess) {
    console.log('[chromadb] Stopping ChromaDB...');
    chromaProcess.kill('SIGTERM');
    chromaProcess = null;
  }
}

export function getChromaPort(): number {
  return CHROMA_PORT;
}
