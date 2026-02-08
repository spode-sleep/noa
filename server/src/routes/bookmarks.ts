import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const router = Router();

const dataPath = process.env.DATA_PATH || path.join(__dirname, '..', '..', '..', 'data');
const bookmarksPath = path.join(dataPath, 'bookmarks', 'fiction_bookmarks.json');

interface ManualBookmark {
  id: string;
  page: number;
  note: string;
  created: string;
}

interface ReadingPosition {
  page: number;
  chapter: string;
  position_percent: number;
  scroll_offset: number;
}

interface BookBookmark {
  book_id: string;
  filepath: string;
  format: string;
  last_position: ReadingPosition;
  last_read: string;
  manual_bookmarks: ManualBookmark[];
}

interface BookmarksData {
  bookmarks: BookBookmark[];
}

function readBookmarks(): BookmarksData {
  try {
    if (fs.existsSync(bookmarksPath)) {
      return JSON.parse(fs.readFileSync(bookmarksPath, 'utf-8'));
    }
  } catch (_e) { /* ignore */ }
  return { bookmarks: [] };
}

function writeBookmarks(data: BookmarksData): void {
  const dir = path.dirname(bookmarksPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(bookmarksPath, JSON.stringify(data, null, 2), 'utf-8');
}

// GET /api/bookmarks - Get all bookmarks
router.get('/', (_req, res) => {
  const data = readBookmarks();
  res.json(data);
});

// GET /api/bookmarks/:bookId - Get bookmarks for a specific book
router.get('/:bookId', (req, res) => {
  const data = readBookmarks();
  const bookmark = data.bookmarks.find(b => b.book_id === req.params.bookId);
  if (!bookmark) {
    return res.status(404).json({ error: 'No bookmarks found for this book' });
  }
  res.json(bookmark);
});

// PUT /api/bookmarks/:bookId/position - Update reading position
router.put('/:bookId/position', (req, res) => {
  const data = readBookmarks();
  const { bookId } = req.params;
  const { page, chapter, position_percent, scroll_offset } = req.body;

  let bookmark = data.bookmarks.find(b => b.book_id === bookId);
  if (!bookmark) {
    bookmark = {
      book_id: bookId,
      filepath: '',
      format: '',
      last_position: { page: 0, chapter: '', position_percent: 0, scroll_offset: 0 },
      last_read: new Date().toISOString(),
      manual_bookmarks: [],
    };
    data.bookmarks.push(bookmark);
  }

  bookmark.last_position = {
    page: page ?? bookmark.last_position.page,
    chapter: chapter ?? bookmark.last_position.chapter,
    position_percent: position_percent ?? bookmark.last_position.position_percent,
    scroll_offset: scroll_offset ?? bookmark.last_position.scroll_offset,
  };
  bookmark.last_read = new Date().toISOString();

  writeBookmarks(data);
  res.json(bookmark);
});

// POST /api/bookmarks/:bookId/manual - Add manual bookmark
router.post('/:bookId/manual', (req, res) => {
  const data = readBookmarks();
  const { bookId } = req.params;
  const { page, note } = req.body;

  let bookmark = data.bookmarks.find(b => b.book_id === bookId);
  if (!bookmark) {
    bookmark = {
      book_id: bookId,
      filepath: '',
      format: '',
      last_position: { page: 0, chapter: '', position_percent: 0, scroll_offset: 0 },
      last_read: new Date().toISOString(),
      manual_bookmarks: [],
    };
    data.bookmarks.push(bookmark);
  }

  const manualBookmark: ManualBookmark = {
    id: crypto.randomUUID(),
    page: page || 0,
    note: note || '',
    created: new Date().toISOString(),
  };

  bookmark.manual_bookmarks.push(manualBookmark);
  writeBookmarks(data);
  res.status(201).json(manualBookmark);
});

// DELETE /api/bookmarks/:bookId/manual/:bookmarkId - Remove manual bookmark
router.delete('/:bookId/manual/:bookmarkId', (req, res) => {
  const data = readBookmarks();
  const { bookId, bookmarkId } = req.params;

  const bookmark = data.bookmarks.find(b => b.book_id === bookId);
  if (!bookmark) {
    return res.status(404).json({ error: 'No bookmarks found for this book' });
  }

  const idx = bookmark.manual_bookmarks.findIndex(m => m.id === bookmarkId);
  if (idx === -1) {
    return res.status(404).json({ error: 'Manual bookmark not found' });
  }

  bookmark.manual_bookmarks.splice(idx, 1);
  writeBookmarks(data);
  res.json({ success: true });
});

export default router;
