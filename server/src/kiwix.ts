import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

let kiwixProcess: ChildProcess | null = null;

function findKiwixServe(): string | null {
  const envPath = process.env.KIWIX_SERVE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  // Try to find kiwix-serve in PATH
  try {
    const cmd = process.platform === 'win32' ? 'where kiwix-serve' : 'which kiwix-serve';
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

function findZimFiles(): string[] {
  const referencePaths = (process.env.REFERENCE_LIBRARY_PATH || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
  const fictionPaths = (process.env.FICTION_LIBRARY_PATH || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  const allPaths = [...referencePaths, ...fictionPaths];
  const zimFiles: string[] = [];
  const seen = new Set<string>();
  for (const dirPath of allPaths) {
    if (!fs.existsSync(dirPath)) continue;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() && e.name.toLowerCase().endsWith('.zim') && !seen.has(e.name)) {
          seen.add(e.name);
          zimFiles.push(path.join(dirPath, e.name));
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }
  return zimFiles;
}

export function startKiwixServe(): void {
  const kiwixPath = findKiwixServe();
  if (!kiwixPath) {
    console.log('[kiwix] kiwix-serve not found. ZIM viewer will not be available.');
    console.log('[kiwix] Install kiwix-tools or set KIWIX_SERVE_PATH in .env');
    return;
  }

  const zimFiles = findZimFiles();
  if (zimFiles.length === 0) {
    console.log('[kiwix] No ZIM files found. Skipping kiwix-serve start.');
    return;
  }

  const port = process.env.KIWIX_PORT || '9454';

  console.log(`[kiwix] Starting kiwix-serve on port ${port} with ${zimFiles.length} archive(s)...`);

  kiwixProcess = spawn(kiwixPath, ['--port', port, ...zimFiles], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  kiwixProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[kiwix] ${msg}`);
  });

  kiwixProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[kiwix] ${msg}`);
  });

  kiwixProcess.on('error', (err: Error) => {
    console.error(`[kiwix] Failed to start kiwix-serve: ${err.message}`);
    kiwixProcess = null;
  });

  kiwixProcess.on('exit', (code: number | null) => {
    console.log(`[kiwix] kiwix-serve exited with code ${code}`);
    kiwixProcess = null;
  });
}

export function stopKiwixServe(): void {
  if (kiwixProcess) {
    console.log('[kiwix] Stopping kiwix-serve...');
    kiwixProcess.kill();
    kiwixProcess = null;
  }
}
