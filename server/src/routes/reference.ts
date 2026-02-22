import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const referencePaths = (process.env.REFERENCE_LIBRARY_PATH || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

const KIWIX_PORT = parseInt(process.env.KIWIX_PORT || '9454', 10);

function walkDir(dir: string, visited = new Set<string>()): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const realDir = fs.realpathSync(dir);
  if (visited.has(realDir)) return results;
  visited.add(realDir);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, visited));
    } else if (entry.name.toLowerCase().endsWith('.zim')) {
      results.push(fullPath);
    }
  }
  return results;
}

// GET /api/reference/archives - List ZIM archives
router.get('/archives', (_req: Request, res: Response) => {
  try {
    if (referencePaths.length === 0) {
      res.json({ archives: [] });
      return;
    }

    const archives: { name: string; path: string; size: number }[] = [];
    const unavailablePaths: string[] = [];
    for (const refPath of referencePaths) {
      if (!fs.existsSync(refPath)) {
        unavailablePaths.push(refPath);
        continue;
      }
      const zimFiles = walkDir(refPath);
      for (const fullPath of zimFiles) {
        const stat = fs.statSync(fullPath);
        archives.push({ name: path.basename(fullPath), path: fullPath, size: stat.size });
      }
    }

    res.json({ archives, unavailable_paths: unavailablePaths });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list archives', details: String(err) });
  }
});

// GET /api/reference/status - Return kiwix-serve URL if available
router.get('/status', (_req: Request, res: Response) => {
  let hasZim = false;
  for (const refPath of referencePaths) {
    if (walkDir(refPath).length > 0) {
      hasZim = true;
      break;
    }
  }

  if (hasZim) {
    res.json({ kiwixUrl: `http://localhost:${KIWIX_PORT}/` });
  } else {
    res.json({ kiwixUrl: null });
  }
});

export default router;
