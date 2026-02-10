import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parseString } from 'xml2js';
import StreamZip from 'node-stream-zip';

const router = Router();

const dataPath = process.env.DATA_PATH || path.join(__dirname, '..', '..', '..', 'data');
const metadataPath = path.join(dataPath, 'metadata', 'fiction_library.json');

interface BookMeta {
  id: string;
  filepath: string;
  format: string;
  title: string;
  author: string;
  year: number;
  language: string;
  isbn: string;
  page_count: number;
  file_size: number;
  zimName?: string;
  kiwixPort?: number;
}

interface FictionLibrary {
  books: BookMeta[];
  zim_archives: any[];
  last_scan: string | null;
}

function readLibrary(): FictionLibrary {
  try {
    if (fs.existsSync(metadataPath)) {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    }
  } catch (_e) { /* ignore */ }
  return { books: [], zim_archives: [], last_scan: null };
}

function writeLibrary(data: FictionLibrary): void {
  const dir = path.dirname(metadataPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2), 'utf-8');
}

function generateId(filepath: string): string {
  return crypto.createHash('md5').update(filepath).digest('hex');
}

function parseXmlAsync(xml: string): Promise<any> {
  return new Promise((resolve, reject) => {
    parseString(xml, { explicitArray: false }, (err: Error | null, result: any) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

async function walkDir(dir: string, extensions: string[]): Promise<string[]> {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkDir(fullPath, extensions));
    } else if (extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

async function extractPdfMetadata(filepath: string): Promise<Partial<BookMeta>> {
  try {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filepath);
    const data = await pdfParse(buffer);
    return {
      title: data.info?.Title || path.basename(filepath, '.pdf'),
      author: data.info?.Author || '',
      page_count: data.numpages || 0,
    };
  } catch (_e) {
    return { title: path.basename(filepath, '.pdf'), author: '', page_count: 0 };
  }
}

async function readZipEntry(filepath: string, entryName: string): Promise<string> {
  const zip = new StreamZip.async({ file: filepath });
  try {
    const data = await zip.entryData(entryName);
    return data.toString('utf-8');
  } finally {
    await zip.close();
  }
}

async function extractEpubMetadata(filepath: string): Promise<Partial<BookMeta>> {
  try {
    const containerXml = await readZipEntry(filepath, 'META-INF/container.xml');
    const container = await parseXmlAsync(containerXml);
    const rootfilePath =
      container?.container?.rootfiles?.rootfile?.$?.['full-path'] ||
      container?.container?.rootfiles?.rootfile?.['$']?.['full-path'] ||
      'content.opf';

    const opfXml = await readZipEntry(filepath, rootfilePath);
    const opf = await parseXmlAsync(opfXml);
    const metadata = opf?.package?.metadata || opf?.['opf:package']?.['opf:metadata'] || {};

    const getField = (field: string): string => {
      const val = metadata[`dc:${field}`] || metadata[field] || '';
      if (typeof val === 'string') return val;
      if (val?._) return val._;
      if (typeof val === 'object' && val['#text']) return val['#text'];
      return String(val || '');
    };

    return {
      title: getField('title') || path.basename(filepath, '.epub'),
      author: getField('creator') || '',
      language: getField('language') || '',
    };
  } catch (_e) {
    return { title: path.basename(filepath, '.epub'), author: '' };
  }
}

async function extractFb2Metadata(filepath: string): Promise<Partial<BookMeta>> {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const parsed = await parseXmlAsync(content);
    const titleInfo =
      parsed?.FictionBook?.description?.['title-info'] ||
      parsed?.fictionbook?.description?.['title-info'] ||
      {};

    const bookTitle = titleInfo?.['book-title'] || path.basename(filepath, '.fb2');
    const author = titleInfo?.author;
    let authorStr = '';
    if (author) {
      const firstName = author['first-name'] || '';
      const lastName = author['last-name'] || '';
      authorStr = `${firstName} ${lastName}`.trim();
    }
    const lang = titleInfo?.lang || '';

    return { title: bookTitle, author: authorStr, language: lang };
  } catch (_e) {
    return { title: path.basename(filepath, '.fb2'), author: '' };
  }
}

// GET /api/fiction/books - List all books
router.get('/books', (req, res) => {
  const library = readLibrary();
  let books = library.books;

  const { search, format, language, author } = req.query;

  if (typeof search === 'string' && search) {
    const lower = search.toLowerCase();
    books = books.filter(b =>
      b.title.toLowerCase().includes(lower) ||
      b.author.toLowerCase().includes(lower)
    );
  }
  if (typeof format === 'string' && format) {
    books = books.filter(b => b.format === format.toLowerCase());
  }
  if (typeof language === 'string' && language) {
    books = books.filter(b => b.language === language.toLowerCase());
  }
  if (typeof author === 'string' && author) {
    const lower = author.toLowerCase();
    books = books.filter(b => b.author.toLowerCase().includes(lower));
  }

  res.json({ books, zim_archives: library.zim_archives, last_scan: library.last_scan });
});

// GET /api/fiction/books/:id - Get single book
router.get('/books/:id', (req, res) => {
  const library = readLibrary();
  const book = library.books.find(b => b.id === req.params.id);
  if (!book) {
    return res.status(404).json({ error: 'Book not found' });
  }
  res.json(book);
});

// GET /api/fiction/scan - Scan fiction library
router.get('/scan', async (_req, res) => {
  try {
    const libraryPaths = (process.env.FICTION_LIBRARY_PATH || '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean);
    if (libraryPaths.length === 0) {
      return res.status(400).json({ error: 'FICTION_LIBRARY_PATH not set' });
    }

    const scannedPaths: string[] = [];
    const unavailablePaths: string[] = [];
    const files: string[] = [];
    for (const lp of libraryPaths) {
      if (fs.existsSync(lp)) {
        scannedPaths.push(lp);
        files.push(...await walkDir(lp, ['.pdf', '.epub', '.fb2', '.zim']));
      } else {
        unavailablePaths.push(lp);
      }
    }
    const books: BookMeta[] = [];

    for (const filepath of files) {
      try {
        const ext = path.extname(filepath).toLowerCase().slice(1);
        const stat = fs.statSync(filepath);
        let meta: Partial<BookMeta> = {};

        if (ext === 'pdf') {
          meta = await extractPdfMetadata(filepath);
        } else if (ext === 'epub') {
          meta = await extractEpubMetadata(filepath);
        } else if (ext === 'fb2') {
          meta = await extractFb2Metadata(filepath);
        } else if (ext === 'zim') {
          const zimName = path.basename(filepath, '.zim');
          meta = {
            title: zimName.replace(/_/g, ' '),
            zimName,
            kiwixPort: parseInt(process.env.KIWIX_PORT || '9454', 10),
          };
        }

        books.push({
          id: generateId(filepath),
          filepath,
          format: ext,
          title: meta.title || path.basename(filepath),
          author: meta.author || '',
          year: meta.year || 0,
          language: meta.language || '',
          isbn: meta.isbn || '',
          page_count: meta.page_count || 0,
          file_size: stat.size,
          ...(ext === 'zim' ? { zimName: (meta as any).zimName, kiwixPort: (meta as any).kiwixPort } : {}),
        });
      } catch (_e) {
        // Skip bad files
      }
    }

    const library: FictionLibrary = {
      books,
      zim_archives: [],
      last_scan: new Date().toISOString(),
    };
    writeLibrary(library);
    res.json({ ...library, scanned_paths: scannedPaths, unavailable_paths: unavailablePaths });
  } catch (err: any) {
    res.status(500).json({ error: 'Scan failed', details: err.message });
  }
});

// GET /api/fiction/read/:id - Serve book file
router.get('/read/:id', async (req, res) => {
  const library = readLibrary();
  const book = library.books.find(b => b.id === req.params.id);
  if (!book) {
    return res.status(404).json({ error: 'Book not found' });
  }

  if (!fs.existsSync(book.filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    if (book.format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(book.filepath)}"`);
      fs.createReadStream(book.filepath).pipe(res);
    } else if (book.format === 'epub') {
      res.setHeader('Content-Type', 'application/epub+zip');
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(book.filepath)}"`);
      fs.createReadStream(book.filepath).pipe(res);
    } else if (book.format === 'fb2') {
      const content = fs.readFileSync(book.filepath, 'utf-8');
      const parsed = await parseXmlAsync(content);
      const fictionBook = parsed?.FictionBook || parsed?.fictionbook || {};
      const bodies = Array.isArray(fictionBook.body) ? fictionBook.body : [fictionBook.body].filter(Boolean);

      const chapters: any[] = [];
      for (const body of bodies) {
        const sections = Array.isArray(body?.section) ? body.section : [body?.section].filter(Boolean);
        for (const section of sections) {
          const title = section?.title?.p || section?.title || '';
          const paragraphs = Array.isArray(section?.p) ? section.p : [section?.p].filter(Boolean);
          chapters.push({
            title: typeof title === 'string' ? title : JSON.stringify(title),
            content: paragraphs.map((p: any) => (typeof p === 'string' ? p : p?._ || JSON.stringify(p))),
          });
        }
      }

      res.json({ book: { id: book.id, title: book.title, author: book.author }, chapters });
    } else {
      res.status(400).json({ error: 'Unsupported format' });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read book', details: err.message });
  }
});

export default router;
