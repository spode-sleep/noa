import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const referencePath = process.env.REFERENCE_LIBRARY_PATH || '';

// GET /api/reference/archives - List ZIM archives
router.get('/archives', (_req: Request, res: Response) => {
  try {
    if (!referencePath || !fs.existsSync(referencePath)) {
      res.json({ archives: [] });
      return;
    }

    const entries = fs.readdirSync(referencePath, { withFileTypes: true });
    const archives = entries
      .filter(e => !e.isDirectory() && e.name.toLowerCase().endsWith('.zim'))
      .map(e => {
        const fullPath = path.join(referencePath, e.name);
        const stat = fs.statSync(fullPath);
        return { name: e.name, path: fullPath, size: stat.size };
      });

    res.json({ archives });
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
