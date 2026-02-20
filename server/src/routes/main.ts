import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const dataPath = process.env.DATA_PATH || path.join(__dirname, '..', '..', '..', 'data');
const contentFile = path.join(dataPath, 'main', 'content.html');

// GET /api/main/content — serve custom HTML content
router.get('/content', (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(contentFile)) {
      res.type('html').send('<p>No content yet. Create <code>data/main/content.html</code>.</p>');
      return;
    }
    const html = fs.readFileSync(contentFile, 'utf-8');
    res.type('html').send(html);
  } catch (err) {
    console.error('[Main] Error reading content:', err);
    res.status(500).json({ error: 'Failed to read content' });
  }
});

export default router;
