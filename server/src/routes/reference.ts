import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const referencePaths = (process.env.REFERENCE_LIBRARY_PATH || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

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

// GET /api/reference/archives/:filename/search - Placeholder search
router.get('/archives/:filename/search', (req: Request, res: Response) => {
  const q = req.query.q || '';
  res.json({ message: 'ZIM search requires node-libzim', query: q, results: [] });
});

// GET /api/reference/archives/:filename/article/* - Placeholder article
router.get('/archives/:filename/article/*', (_req: Request, res: Response) => {
  res.json({ message: 'ZIM reading requires node-libzim' });
});

export default router;
