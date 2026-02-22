/**
 * RAG (Retrieval-Augmented Generation) Pipeline
 * 
 * Best practices implemented:
 * - Section-aware chunking: splits on HTML headings (h1-h6) to keep related content together
 * - Chunk metadata: stores title, section heading, content type for better retrieval
 * - Optimal chunk size (800 chars ≈ 200 tokens): balances precision vs context
 * - 15% overlap between chunks for context continuity at boundaries
 * - Aggressive wiki boilerplate removal (nav, TOC, sidebars, citations)
 * - Deduplication: skips near-duplicate chunks
 * - Filters ZIM entries: skips talk pages, user pages, special pages, metadata
 * - Fiction/music NOT indexed (per spec)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as cheerio from 'cheerio';

// ── Config ──────────────────────────────────────────────────────────────────

const OLLAMA_DEFAULT_PORT = '11434';
const SIMILARITY_THRESHOLD = 0.3;
const CHUNK_SIZE = 800;    // ~200 tokens, good balance for wiki Q&A retrieval
const CHUNK_OVERLAP = 120; // ~15% overlap for context continuity
const DEFAULT_TOP_K = 5;
const MAX_CHUNKS = parseInt(process.env.MAX_RAG_CHUNKS || '100000', 10);
const MIN_CHUNK_LENGTH = 50; // Skip very short chunks (noise)

const llmApiUrl = process.env.LLM_API_URL || 'http://localhost:11434';
const embeddingModel = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
const dataPath = process.env.DATA_PATH || path.join(__dirname, '..', '..', '..', 'data');
const ragIndexPath = path.join(dataPath, 'metadata', 'rag_index.json');

// ── Types ───────────────────────────────────────────────────────────────────

interface DocumentChunk {
  id: string;
  text: string;
  source: string;       // human-readable source name
  sourceType: 'reference' | 'games';
  metadata?: Record<string, unknown>;
}

interface IndexedChunk extends DocumentChunk {
  embedding: number[];
}

interface RagSearchResult {
  chunk: DocumentChunk;
  score: number;
}

// ── Vector Store (ChromaDB with fallback) ───────────────────────────────────

let indexReady = false;
let indexing = false;
let chromaCollection: any = null; // ChromaDB collection
let useChromaDb = false;

// Fallback in-memory store (used when ChromaDB is unavailable)
let fallbackChunks: IndexedChunk[] = [];

async function initChromaClient(): Promise<boolean> {
  try {
    const chromaPort = parseInt(process.env.CHROMA_PORT || '8000', 10);
    // Use dynamic import to avoid ESM issues with ts-node
    const { ChromaClient } = await (new Function('return import("chromadb")'))();
    const { OllamaEmbeddingFunction } = await (new Function('return import("@chroma-core/ollama")'))();

    const embedder = new OllamaEmbeddingFunction({
      url: llmApiUrl,
      model: embeddingModel,
    });

    const client = new ChromaClient({ path: `http://localhost:${chromaPort}` });
    // Test connection
    await client.heartbeat();

    chromaCollection = await client.getOrCreateCollection({
      name: 'box_rag',
      embeddingFunction: embedder,
      metadata: { 'hnsw:space': 'cosine' },
    });

    console.log('[RAG] Connected to ChromaDB');
    useChromaDb = true;
    return true;
  } catch (err) {
    console.log('[RAG] ChromaDB not available, using in-memory fallback:', (err as Error).message);
    useChromaDb = false;
    return false;
  }
}

// Fallback: cosine similarity for in-memory store
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

// ── Ollama Embedding (for fallback mode) ────────────────────────────────────

async function getEmbedding(text: string): Promise<number[]> {
  const truncated = text.length > 4000 ? text.substring(0, 4000) : text;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(llmApiUrl);
    const payload = JSON.stringify({
      model: embeddingModel,
      prompt: truncated,
    });

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || OLLAMA_DEFAULT_PORT,
      path: '/api/embeddings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 60000,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.embedding && Array.isArray(data.embedding)) {
            resolve(data.embedding);
          } else {
            reject(new Error(`No embedding in response: ${body.substring(0, 200)}`));
          }
        } catch {
          reject(new Error(`Failed to parse embedding response: ${body.substring(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Embedding request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

// ── Document Collection ─────────────────────────────────────────────────────

function collectGameChunks(): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  try {
    const gamesPath = path.join(dataPath, 'games', 'games.json');
    if (!fs.existsSync(gamesPath)) return chunks;

    const raw = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    const games = Array.isArray(raw) ? raw : Object.values(raw);

    for (const game of games) {
      const parts: string[] = [];
      if (game.name) parts.push(game.name);
      if (game.description) parts.push(game.description);
      if (game.tags?.length) parts.push(`Tags: ${game.tags.join(', ')}`);
      if (game.gameplay_tips?.length) {
        const tips = game.gameplay_tips
          .flatMap((section: any) => (section.tips || []).map((t: any) => t.text))
          .filter(Boolean);
        if (tips.length) parts.push(`Gameplay tips: ${tips.join(' ')}`);
      }

      if (parts.length > 0) {
        chunks.push({
          id: `game-${game.appId || game.name}`,
          text: parts.join('\n'),
          source: `Game: ${game.name || 'Unknown'}`,
          sourceType: 'games',
          metadata: { appId: game.appId, name: game.name },
        });
      }
    }
  } catch (err) {
    console.error('[RAG] Error collecting game chunks:', err);
  }
  return chunks;
}

// Skip non-article ZIM entries: talk pages, user pages, special pages, metadata
function isArticlePath(entryPath: string): boolean {
  const skip = [
    'User:', 'User_talk:', 'Talk:', 'Wikipedia:', 'Wikipedia_talk:',
    'Template:', 'Template_talk:', 'Category:', 'Category_talk:',
    'Help:', 'Help_talk:', 'Portal:', 'Portal_talk:', 'Module:',
    'MediaWiki:', 'Special:', 'File:', 'Draft:', 'TimedText:',
    '-/', 'I/', 'M/',  // ZIM internal namespaces (images, metadata)
  ];
  return !skip.some(prefix => entryPath.startsWith(prefix));
}

// Extract section-aware chunks from HTML content
function extractSectionChunks(
  html: string,
  title: string,
  zimBasename: string,
  entryIdx: number,
  entryPath: string,
  file: string,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const $ = cheerio.load(html);

  // Remove non-content elements aggressively
  $('script, style, nav, header, footer, noscript, svg, img, figure, figcaption, video, audio, iframe').remove();
  $('.mw-editsection, .reflist, .references, .sidebar, .navbox, .infobox, .ambox').remove();
  $('[role="navigation"], .toc, .catlinks, .noprint, .metadata, .mw-jump-link, .hatnote').remove();
  $('table.wikitable, table.infobox, table.navbox, .printfooter, .mw-authority-control').remove();

  // Extract sections by headings (h1–h6)
  const body = $('body');
  let currentSection = title; // First section is the article intro
  let currentText = '';

  // Walk through top-level children of the main content
  const contentEl = body.find('#mw-content-text, .mw-parser-output, article').first();
  const root = contentEl.length > 0 ? contentEl : body;

  root.children().each((_: number, el: cheerio.Element) => {
    const tagName = (el as any).tagName?.toLowerCase();
    if (!tagName) return;

    // If it's a heading, finalize the previous section
    if (/^h[1-6]$/.test(tagName)) {
      if (currentText.trim().length >= MIN_CHUNK_LENGTH) {
        const sectionChunks = splitIntoChunks(currentText.trim(), CHUNK_SIZE, CHUNK_OVERLAP);
        for (let ci = 0; ci < sectionChunks.length; ci++) {
          chunks.push({
            id: `zim-${zimBasename}-${entryIdx}-${chunks.length}`,
            text: `${title} > ${currentSection}\n\n${sectionChunks[ci]}`,
            source: `${zimBasename}: ${title}`,
            sourceType: 'reference',
            metadata: { filename: file, title, section: currentSection, path: entryPath, chunkIndex: ci },
          });
        }
      }
      currentSection = $(el).text()
        .replace(/\[edit\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim() || title;
      currentText = '';
    } else {
      // Accumulate text content
      const text = $(el).text()
        .replace(/\[\d+\]/g, '')     // Remove citation markers
        .replace(/\[edit\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) currentText += text + '\n';
    }
  });

  // Finalize last section
  if (currentText.trim().length >= MIN_CHUNK_LENGTH) {
    const sectionChunks = splitIntoChunks(currentText.trim(), CHUNK_SIZE, CHUNK_OVERLAP);
    for (let ci = 0; ci < sectionChunks.length; ci++) {
      chunks.push({
        id: `zim-${zimBasename}-${entryIdx}-${chunks.length}`,
        text: `${title} > ${currentSection}\n\n${sectionChunks[ci]}`,
        source: `${zimBasename}: ${title}`,
        sourceType: 'reference',
        metadata: { filename: file, title, section: currentSection, path: entryPath, chunkIndex: ci },
      });
    }
  }

  // Fallback: if no sections extracted, chunk the whole body text
  if (chunks.length === 0) {
    const fullText = root.text()
      .replace(/\[edit\]/gi, '')
      .replace(/\[\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (fullText.length >= MIN_CHUNK_LENGTH) {
      const textChunks = splitIntoChunks(fullText, CHUNK_SIZE, CHUNK_OVERLAP);
      for (let ci = 0; ci < textChunks.length; ci++) {
        chunks.push({
          id: `zim-${zimBasename}-${entryIdx}-${ci}`,
          text: `${title}\n\n${textChunks[ci]}`,
          source: `${zimBasename}: ${title}`,
          sourceType: 'reference',
          metadata: { filename: file, title, path: entryPath, chunkIndex: ci },
        });
      }
    }
  }

  return chunks;
}

function walkZimDir(dir: string, visited = new Set<string>()): string[] {
  return walkRefDir(dir, ['.zim'], visited);
}

function walkTextDir(dir: string, extensions: string[], visited = new Set<string>()): string[] {
  return walkRefDir(dir, extensions, visited);
}

function walkRefDir(dir: string, extensions: string[], visited = new Set<string>()): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const realDir = fs.realpathSync(dir);
  if (visited.has(realDir)) return results;
  visited.add(realDir);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkRefDir(fullPath, extensions, visited));
    } else if (extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

async function collectReferenceChunks(): Promise<DocumentChunk[]> {
  const chunks: DocumentChunk[] = [];
  const seenTexts = new Set<string>(); // Deduplication

  const refPaths = (process.env.REFERENCE_LIBRARY_PATH || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  for (const refPath of refPaths) {
    try {
      if (!fs.existsSync(refPath)) continue;
      const zimFiles = walkZimDir(refPath);
      for (const zimPath of zimFiles) {
        const file = path.basename(zimPath);
        if (chunks.length >= MAX_CHUNKS) {
          console.log(`[RAG] Chunk limit (${MAX_CHUNKS}) reached, stopping extraction`);
          break;
        }

        const zimBasename = file.replace('.zim', '');
        console.log(`[RAG] Extracting articles from ZIM: ${file}`);

        try {
          const libzim = await (new Function('return import("@openzim/libzim")'))();
          const archive = new libzim.Archive(zimPath);
          const entryCount = archive.entryCount;
          let articlesProcessed = 0;
          let skippedNonArticle = 0;
          let skippedShort = 0;
          let skippedDuplicate = 0;

          for (let idx = 0; idx < entryCount; idx++) {
            if (chunks.length >= MAX_CHUNKS) break;

            try {
              const entry = archive.getEntryByPath(idx);
              if (entry.isRedirect) continue;

              const item = entry.item;
              const mimeType = item.mimetype;
              if (!mimeType.startsWith('text/html') && !mimeType.startsWith('text/plain')) continue;

              // Filter non-article paths (talk pages, user pages, etc.)
              const entryPath = entry.path || '';
              if (!isArticlePath(entryPath)) {
                skippedNonArticle++;
                continue;
              }

              const blob = item.data;
              const content = Buffer.from(blob.data).toString('utf-8');
              const title = entry.title || entryPath;

              if (mimeType.startsWith('text/html')) {
                // Section-aware chunking for HTML
                const sectionChunks = extractSectionChunks(content, title, zimBasename, idx, entryPath, file);
                for (const chunk of sectionChunks) {
                  // Deduplication: hash first 100 chars
                  const dedupKey = chunk.text.substring(0, 100);
                  if (seenTexts.has(dedupKey)) {
                    skippedDuplicate++;
                    continue;
                  }
                  seenTexts.add(dedupKey);
                  chunks.push(chunk);
                }
              } else {
                // Plain text: simple chunking
                const plainText = content.replace(/\s+/g, ' ').trim();
                if (plainText.length < 100) { skippedShort++; continue; }
                const textChunks = splitIntoChunks(plainText, CHUNK_SIZE, CHUNK_OVERLAP);
                for (let ci = 0; ci < textChunks.length; ci++) {
                  chunks.push({
                    id: `zim-${zimBasename}-${idx}-${ci}`,
                    text: `${title}\n\n${textChunks[ci]}`,
                    source: `${zimBasename}: ${title}`,
                    sourceType: 'reference',
                    metadata: { filename: file, title, path: entryPath, chunkIndex: ci },
                  });
                }
              }

              articlesProcessed++;
              if (articlesProcessed % 1000 === 0) {
                console.log(`[RAG] Processed ${articlesProcessed} articles from ${file} (${chunks.length} chunks)`);
              }
            } catch {
              continue;
            }
          }

          console.log(`[RAG] ${file}: ${articlesProcessed} articles → ${chunks.length} chunks | skipped: ${skippedNonArticle} non-article, ${skippedShort} short, ${skippedDuplicate} duplicate`);
        } catch (err) {
          console.error(`[RAG] Error reading ZIM file ${file}:`, err);
          chunks.push({
            id: `zim-${zimBasename}`,
            text: `Reference archive: ${zimBasename}. ZIM archive in the reference library. Filename: ${file}.`,
            source: `ZIM: ${file}`,
            sourceType: 'reference',
            metadata: { filename: file, path: refPath },
          });
        }
      }
    } catch (err) {
      console.error(`[RAG] Error scanning reference path ${refPath}:`, err);
    }
  }

  // Also read .txt or .md files recursively
  for (const refPath of refPaths) {
    try {
      const textFiles = walkTextDir(refPath, ['.txt', '.md']);
      for (const filePath of textFiles) {
        const file = path.basename(filePath);
        const relPath = path.relative(refPath, filePath).replace(/[/\\]/g, '_');
        const stat = fs.statSync(filePath);
        if (stat.size > 1024 * 1024) continue;
        const content = fs.readFileSync(filePath, 'utf-8');
        const textChunks = splitIntoChunks(content, CHUNK_SIZE, CHUNK_OVERLAP);
        for (let i = 0; i < textChunks.length; i++) {
          chunks.push({
            id: `ref-${relPath}-${i}`,
            text: textChunks[i],
            source: `Reference: ${file}`,
            sourceType: 'reference',
            metadata: { filename: file, chunkIndex: i },
          });
        }
      }
    } catch (err) {
      console.error(`[RAG] Error reading reference files in ${refPath}:`, err);
    }
  }

  return chunks;
}

function splitIntoChunks(text: string, maxLength: number, overlap: number = CHUNK_OVERLAP): string[] {
  if (text.length <= maxLength) return [text];
  
  const chunks: string[] = [];
  
  // Sentence-based splitting for better semantic boundaries
  const sentences = text.split(/(?<=[.!?。])\s+/);
  let current = '';
  
  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 > maxLength && current.length > 0) {
      chunks.push(current.trim());
      // Overlap: keep last N characters of previous chunk
      if (overlap > 0 && current.length > overlap) {
        current = current.substring(current.length - overlap);
      } else {
        current = '';
      }
    }
    current += (current ? ' ' : '') + sentence;
  }
  if (current.trim().length >= MIN_CHUNK_LENGTH) chunks.push(current.trim());
  
  // Hard-split any chunks that are still too long (single long sentences)
  const refined: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxLength * 1.5) {
      refined.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += maxLength - overlap) {
        const piece = chunk.substring(i, i + maxLength);
        if (piece.trim().length >= MIN_CHUNK_LENGTH) refined.push(piece.trim());
      }
    }
  }
  
  return refined;
}

// ── Indexing ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 100; // ChromaDB batch size for upsert

async function buildIndex(): Promise<{ indexed: number; errors: number; message: string }> {
  if (indexing) {
    return { indexed: 0, errors: 0, message: 'Indexing already in progress' };
  }

  indexing = true;
  console.log('[RAG] Starting index build...');

  try {
    // Collect all document chunks
    const refChunks = await collectReferenceChunks();
    const allChunks: DocumentChunk[] = [
      ...collectGameChunks(),
      ...refChunks,
    ];

    if (allChunks.length === 0) {
      indexing = false;
      indexReady = true;
      return { indexed: 0, errors: 0, message: 'No documents to index' };
    }

    console.log(`[RAG] Collected ${allChunks.length} chunks. Indexing...`);

    let indexed = 0;
    let errors = 0;

    if (useChromaDb && chromaCollection) {
      // ── ChromaDB indexing ──
      // Clear existing collection
      try {
        const chromaPort = parseInt(process.env.CHROMA_PORT || '8000', 10);
        const { ChromaClient } = await (new Function('return import("chromadb")'))();
        const { OllamaEmbeddingFunction } = await (new Function('return import("@chroma-core/ollama")'))();
        const embedder = new OllamaEmbeddingFunction({ url: llmApiUrl, model: embeddingModel });
        const client = new ChromaClient({ path: `http://localhost:${chromaPort}` });
        await client.deleteCollection({ name: 'box_rag' });
        chromaCollection = await client.createCollection({
          name: 'box_rag',
          embeddingFunction: embedder,
          metadata: { 'hnsw:space': 'cosine' },
        });
      } catch (err) {
        console.error('[RAG] Error resetting ChromaDB collection:', err);
      }

      // Batch upsert chunks (ChromaDB handles embedding via OllamaEmbeddingFunction)
      for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
        const batch = allChunks.slice(i, i + BATCH_SIZE);
        try {
          // Truncate documents to avoid embedding context length errors
          await chromaCollection.add({
            ids: batch.map((c: DocumentChunk) => c.id),
            documents: batch.map((c: DocumentChunk) => c.text.length > 4000 ? c.text.substring(0, 4000) : c.text),
            metadatas: batch.map((c: DocumentChunk) => ({
              source: c.source,
              sourceType: c.sourceType,
              ...(c.metadata || {}),
            })),
          });
          indexed += batch.length;
        } catch (err) {
          errors += batch.length;
          console.error(`[RAG] Error indexing batch at ${i}:`, (err as Error).message);
        }

        if ((i + BATCH_SIZE) % 500 < BATCH_SIZE) {
          console.log(`[RAG] Indexed ${Math.min(i + BATCH_SIZE, allChunks.length)}/${allChunks.length} chunks`);
        }
      }
    } else {
      // ── Fallback in-memory indexing ──
      const newIndex: IndexedChunk[] = [];
      for (let i = 0; i < allChunks.length; i++) {
        const chunk = allChunks[i];
        try {
          const embedding = await getEmbedding(chunk.text);
          newIndex.push({ ...chunk, embedding });
          indexed++;

          if ((i + 1) % 500 === 0) {
            console.log(`[RAG] Embedded ${i + 1}/${allChunks.length} chunks`);
          }
        } catch (err) {
          errors++;
          if (errors <= 10) console.error(`[RAG] Error embedding chunk ${chunk.id}:`, (err as Error).message);
        }
      }
      fallbackChunks = newIndex;

      // Persist fallback index to disk
      try {
        const dir = path.dirname(ragIndexPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(ragIndexPath, JSON.stringify({
          version: 1,
          model: embeddingModel,
          chunks: fallbackChunks,
          updatedAt: new Date().toISOString(),
        }));
        console.log(`[RAG] Fallback index saved to ${ragIndexPath}`);
      } catch (err) {
        console.error('[RAG] Error saving fallback index:', err);
      }
    }

    indexReady = true;
    const mode = useChromaDb ? 'ChromaDB' : 'in-memory';
    console.log(`[RAG] Index built (${mode}): ${indexed} chunks indexed, ${errors} errors`);
    return { indexed, errors, message: `Indexed ${indexed} chunks via ${mode}` };
  } finally {
    indexing = false;
  }
}

function loadFallbackIndexFromDisk(): boolean {
  try {
    if (!fs.existsSync(ragIndexPath)) return false;

    const data = JSON.parse(fs.readFileSync(ragIndexPath, 'utf-8'));
    if (data.version !== 1 || data.model !== embeddingModel) {
      console.log('[RAG] Index version/model mismatch, will rebuild');
      return false;
    }

    if (Array.isArray(data.chunks) && data.chunks.length > 0) {
      fallbackChunks = data.chunks;
      indexReady = true;
      console.log(`[RAG] Loaded ${fallbackChunks.length} chunks from disk (${data.updatedAt})`);
      return true;
    }
  } catch (err) {
    console.error('[RAG] Error loading index from disk:', err);
  }
  return false;
}

// ── Search ──────────────────────────────────────────────────────────────────

async function search(query: string, topK: number = DEFAULT_TOP_K): Promise<RagSearchResult[]> {
  if (!indexReady) return [];

  try {
    if (useChromaDb && chromaCollection) {
      // ── ChromaDB search ──
      const results = await chromaCollection.query({
        queryTexts: [query],
        nResults: topK,
      });

      if (!results.documents?.[0]) return [];

      return results.documents[0].map((doc: string, i: number) => ({
        chunk: {
          id: results.ids[0][i],
          text: doc,
          source: results.metadatas[0][i]?.source || 'Unknown',
          sourceType: (results.metadatas[0][i]?.sourceType as 'reference' | 'games') || 'reference',
          metadata: results.metadatas[0][i],
        },
        score: results.distances?.[0]?.[i] != null ? 1 - results.distances[0][i] : 0.5,
      })).filter((r: RagSearchResult) => r.score >= SIMILARITY_THRESHOLD);
    } else {
      // ── Fallback in-memory search ──
      if (fallbackChunks.length === 0) return [];

      const queryEmbedding = await getEmbedding(query);
      const scored = fallbackChunks.map(chunk => ({
        chunk: {
          id: chunk.id,
          text: chunk.text,
          source: chunk.source,
          sourceType: chunk.sourceType,
          metadata: chunk.metadata,
        } as DocumentChunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }));

      scored.sort((a, b) => b.score - a.score);
      return scored.filter(r => r.score >= SIMILARITY_THRESHOLD).slice(0, topK);
    }
  } catch (err) {
    console.error('[RAG] Search error:', err);
    return [];
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function isIndexReady(): boolean {
  return indexReady;
}

export function isIndexing(): boolean {
  return indexing;
}

export function getIndexStats(): { ready: boolean; chunksIndexed: number; indexing: boolean; backend: string } {
  return {
    ready: indexReady,
    chunksIndexed: useChromaDb ? -1 : fallbackChunks.length, // ChromaDB manages count internally
    indexing,
    backend: useChromaDb ? 'chromadb' : 'in-memory',
  };
}

export async function initRag(): Promise<void> {
  // Try to connect to ChromaDB first
  const chromaOk = await initChromaClient();

  if (chromaOk) {
    // Check if collection already has data
    try {
      const count = await chromaCollection.count();
      if (count > 0) {
        indexReady = true;
        console.log(`[RAG] ChromaDB collection has ${count} chunks`);
        return;
      }
    } catch { /* proceed */ }
    console.log('[RAG] ChromaDB connected but collection is empty. Use POST /api/ai/index to build.');
    return;
  }

  // Fallback: try to load from disk
  if (loadFallbackIndexFromDisk()) {
    console.log('[RAG] Using cached in-memory index');
    return;
  }
  console.log('[RAG] No index found. Use POST /api/ai/index to build.');
}

export async function rebuildIndex(): Promise<{ indexed: number; errors: number; message: string }> {
  return buildIndex();
}

export async function ragSearch(query: string, topK?: number): Promise<RagSearchResult[]> {
  return search(query, topK);
}

export function buildRagContext(results: RagSearchResult[]): { contextText: string; sources: string[] } {
  if (results.length === 0) {
    return { contextText: '', sources: [] };
  }

  const sources: string[] = [];
  const contextParts: string[] = [];

  for (const result of results) {
    contextParts.push(`[Source: ${result.chunk.source}]\n${result.chunk.text}`);
    if (!sources.includes(result.chunk.source)) {
      sources.push(result.chunk.source);
    }
  }

  const contextText = `\n\n<retrieved_context>\nThe following information was retrieved from the knowledge base and may be relevant to the user's question:\n\n${contextParts.join('\n\n---\n\n')}\n</retrieved_context>\n\nWhen using information from the retrieved context, cite the source. If the context doesn't contain relevant information, answer based on your own knowledge but mention that the information was not found in the local library.`;

  return { contextText, sources };
}
