import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const referencePaths = (process.env.REFERENCE_LIBRARY_PATH || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

const KIWIX_PORT = parseInt(process.env.KIWIX_PORT || '9454', 10);

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
      const entries = fs.readdirSync(refPath, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() && e.name.toLowerCase().endsWith('.zim')) {
          const fullPath = path.join(refPath, e.name);
          const stat = fs.statSync(fullPath);
          archives.push({ name: e.name, path: fullPath, size: stat.size });
        }
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
    if (fs.existsSync(refPath)) {
      const entries = fs.readdirSync(refPath);
      if (entries.some(e => e.toLowerCase().endsWith('.zim'))) {
        hasZim = true;
        break;
      }
    }
  }

  if (hasZim) {
    res.json({ kiwixUrl: `http://localhost:${KIWIX_PORT}/` });
  } else {
    res.json({ kiwixUrl: null });
  }
});

export default router;
