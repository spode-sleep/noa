import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import http from 'http';

const router = Router();

const referencePaths = (process.env.REFERENCE_LIBRARY_PATH || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

const KIWIX_PORT = parseInt(process.env.KIWIX_PORT || '9454', 10);

/* Custom CSS injected into proxied kiwix-serve HTML to match the app theme */
const KIWIX_DARK_CSS = `
<style id="noa-dark-theme">
  .kiwixHomeBody, body { background: #0a0a1a !important; color: #e0e0e0 !important; }
  .kiwixNav, nav, header { background: rgba(10,10,26,0.95) !important; color: #e0e0e0 !important; }
  .kiwixNav a, nav a { color: #00d4aa !important; }
  a { color: #5ec4e8 !important; }
  .book { background: rgba(255,255,255,0.04) !important; border: 1px solid rgba(255,255,255,0.08) !important; border-radius: 12px !important; }
  .book__title, .book__description, h1, h2, h3, h4, h5, h6, p, li, td, th, span, div { color: #e0e0e0 !important; }
  input, select, textarea { background: #1a1a2e !important; color: #e0e0e0 !important; border-color: rgba(255,255,255,0.1) !important; }
  .kiwixButton, button, .button { background: linear-gradient(135deg, #00d4aa, #7c5ce0) !important; color: #fff !important; border: none !important; border-radius: 8px !important; }
  footer { background: rgba(10,10,26,0.95) !important; color: #999 !important; }
  table, tr, td, th { border-color: rgba(255,255,255,0.1) !important; }
  .searchbar { background: #1a1a2e !important; }
  .search, .searchbox { background: #1a1a2e !important; color: #e0e0e0 !important; }
</style>`;

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

// GET /api/reference/status - Return proxy kiwix URL if available
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
    // Point to our proxy endpoint (same origin so we can inject CSS)
    res.json({ kiwixUrl: '/api/reference/proxy/' });
  } else {
    res.json({ kiwixUrl: null });
  }
});

// Proxy kiwix-serve content, injecting dark theme CSS into HTML responses
router.use('/proxy', (req: Request, res: Response) => {
  // Strip /api/reference/proxy prefix to get the path kiwix-serve expects
  const targetPath = req.url || '/';

  const options: http.RequestOptions = {
    hostname: 'localhost',
    port: KIWIX_PORT,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${KIWIX_PORT}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || '';
    const isHtml = contentType.includes('text/html');

    // Forward status and headers (except content-length for HTML since we modify it)
    const headers = { ...proxyRes.headers };
    if (isHtml) delete headers['content-length'];
    res.writeHead(proxyRes.statusCode || 200, headers);

    if (isHtml) {
      // Collect HTML, inject our dark theme CSS before </head>
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf-8');
        if (html.includes('</head>')) {
          html = html.replace('</head>', KIWIX_DARK_CSS + '</head>');
        } else {
          html = KIWIX_DARK_CSS + html;
        }
        res.end(html);
      });
    } else {
      // Non-HTML (images, CSS, JS, etc.) — pipe through directly
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', (err) => {
    console.error('Kiwix proxy error:', err.message);
    res.status(502).send('Unable to connect to kiwix-serve');
  });

  // Pipe request body through to kiwix-serve
  req.pipe(proxyReq);
});

export default router;
