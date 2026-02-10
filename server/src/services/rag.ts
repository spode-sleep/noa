/**
 * RAG (Retrieval-Augmented Generation) Pipeline
 * 
 * - Uses Ollama embedding API for vectorization
 * - Simple in-memory cosine similarity vector store
 * - Indexes reference library metadata and game data
 * - Fiction/music metadata NOT indexed (per spec)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as cheerio from 'cheerio';

// ── Config ──────────────────────────────────────────────────────────────────

const OLLAMA_DEFAULT_PORT = '11434';
const SIMILARITY_THRESHOLD = 0.3;
const CHUNK_SIZE = 500;
const DEFAULT_TOP_K = 5;
const MAX_ZIM_ARTICLES = 5000; // Limit articles per ZIM to keep index manageable

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

// ── Vector Store ────────────────────────────────────────────────────────────

let indexedChunks: IndexedChunk[] = [];
let indexReady = false;
let indexing = false;

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

// ── Ollama Embedding ────────────────────────────────────────────────────────

async function getEmbedding(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(llmApiUrl);
    const payload = JSON.stringify({
      model: embeddingModel,
      prompt: text,
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
      timeout: 30000,
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

    const games = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    if (!Array.isArray(games)) return chunks;

    for (const game of games) {
      const parts: string[] = [];
      if (game.name) parts.push(`Game: ${game.name}`);
      if (game.appId) parts.push(`App ID: ${game.appId}`);
      if (game.type) parts.push(`Platform: ${game.type}`);
      if (game.tags?.length) parts.push(`Tags: ${game.tags.join(', ')}`);
      if (game.description) parts.push(`Description: ${game.description}`);
      if (game.protonStatus) parts.push(`ProtonDB: ${game.protonStatus}`);

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

async function collectReferenceChunks(): Promise<DocumentChunk[]> {
  const chunks: DocumentChunk[] = [];

  const refPaths = (process.env.REFERENCE_LIBRARY_PATH || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  // Extract content from ZIM archives using @openzim/libzim
  for (const refPath of refPaths) {
    try {
      if (!fs.existsSync(refPath)) continue;
      const files = fs.readdirSync(refPath);
      for (const file of files) {
        if (!file.endsWith('.zim')) continue;

        const zimPath = path.join(refPath, file);
        const zimBasename = file.replace('.zim', '');
        console.log(`[RAG] Extracting articles from ZIM: ${file}`);

        try {
          // Use Function() wrapper to prevent ts-node from transpiling dynamic import() to require()
          const libzim = await (new Function('return import("@openzim/libzim")'))();
          const archive = new libzim.Archive(zimPath);
          const entryCount = archive.entryCount;
          const articleLimit = Math.min(entryCount, MAX_ZIM_ARTICLES);

          let articlesProcessed = 0;

          // Iterate over entries by path
          for (let idx = 0; idx < entryCount && articlesProcessed < articleLimit; idx++) {
            try {
              const entry = archive.getEntryByPath(idx);
              // Skip non-article entries (redirects, metadata, images, etc.)
              if (entry.isRedirect) continue;

              const item = entry.item;
              const mimeType = item.mimetype;
              if (!mimeType.startsWith('text/html') && !mimeType.startsWith('text/plain')) continue;

              const blob = item.data;
              const content = Buffer.from(blob.data).toString('utf-8');

              // Strip HTML to get plain text
              let plainText: string;
              if (mimeType.startsWith('text/html')) {
                const $ = cheerio.load(content);
                // Remove scripts, styles, nav elements
                $('script, style, nav, header, footer, .mw-editsection, .reflist, .references').remove();
                plainText = $('body').text().replace(/\s+/g, ' ').trim();
              } else {
                plainText = content.replace(/\s+/g, ' ').trim();
              }

              // Skip very short articles (likely stubs or metadata)
              if (plainText.length < 100) continue;

              const title = entry.title || entry.path;

              // Split long articles into chunks
              const textChunks = splitIntoChunks(plainText, CHUNK_SIZE);
              for (let ci = 0; ci < textChunks.length; ci++) {
                chunks.push({
                  id: `zim-${zimBasename}-${idx}-${ci}`,
                  text: `${title}\n\n${textChunks[ci]}`,
                  source: `${zimBasename}: ${title}`,
                  sourceType: 'reference',
                  metadata: { filename: file, title, path: entry.path, chunkIndex: ci },
                });
              }

              articlesProcessed++;
              if (articlesProcessed % 500 === 0) {
                console.log(`[RAG] Processed ${articlesProcessed}/${articleLimit} articles from ${file}`);
              }
            } catch {
              // Skip entries that can't be read
              continue;
            }
          }

          console.log(`[RAG] Extracted ${articlesProcessed} articles (${chunks.length} chunks) from ${file}`);
        } catch (err) {
          console.error(`[RAG] Error reading ZIM file ${file}:`, err);
          // Fallback: add filename metadata
          chunks.push({
            id: `zim-${zimBasename}`,
            text: `Reference archive: ${zimBasename}. This is a ZIM archive in the reference library. Filename: ${file}.`,
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

  // Also read any .txt or .md files in reference paths
  for (const refPath of refPaths) {
    try {
      if (!fs.existsSync(refPath)) continue;
      const files = fs.readdirSync(refPath);
      for (const file of files) {
        if (file.endsWith('.txt') || file.endsWith('.md')) {
          const filePath = path.join(refPath, file);
          const stat = fs.statSync(filePath);
          if (stat.size > 1024 * 1024) continue; // Skip files > 1MB

          const content = fs.readFileSync(filePath, 'utf-8');
          const textChunks = splitIntoChunks(content, CHUNK_SIZE);
          for (let i = 0; i < textChunks.length; i++) {
            chunks.push({
              id: `ref-${file}-${i}`,
              text: textChunks[i],
              source: `Reference: ${file}`,
              sourceType: 'reference',
              metadata: { filename: file, chunkIndex: i },
            });
          }
        }
      }
    } catch (err) {
      console.error(`[RAG] Error reading reference files in ${refPath}:`, err);
    }
  }

  return chunks;
}

function splitIntoChunks(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxLength && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current ? '\n\n' : '') + para;
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}

// ── Indexing ────────────────────────────────────────────────────────────────

async function buildIndex(): Promise<{ indexed: number; errors: number; message: string }> {
  if (indexing) {
    return { indexed: indexedChunks.length, errors: 0, message: 'Indexing already in progress' };
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
      indexedChunks = [];
      return { indexed: 0, errors: 0, message: 'No documents to index' };
    }

    console.log(`[RAG] Collected ${allChunks.length} chunks. Generating embeddings...`);

    const newIndex: IndexedChunk[] = [];
    let errors = 0;

    // Process in batches to avoid overwhelming Ollama
    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];
      try {
        const embedding = await getEmbedding(chunk.text);
        newIndex.push({ ...chunk, embedding });

        if ((i + 1) % 10 === 0) {
          console.log(`[RAG] Embedded ${i + 1}/${allChunks.length} chunks`);
        }
      } catch (err) {
        errors++;
        console.error(`[RAG] Error embedding chunk ${chunk.id}:`, err);
      }
    }

    indexedChunks = newIndex;
    indexReady = true;

    // Persist index to disk
    try {
      const dir = path.dirname(ragIndexPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(ragIndexPath, JSON.stringify({
        version: 1,
        model: embeddingModel,
        chunks: indexedChunks,
        updatedAt: new Date().toISOString(),
      }));
      console.log(`[RAG] Index saved to ${ragIndexPath}`);
    } catch (err) {
      console.error('[RAG] Error saving index:', err);
    }

    console.log(`[RAG] Index built: ${newIndex.length} chunks indexed, ${errors} errors`);
    return { indexed: newIndex.length, errors, message: `Indexed ${newIndex.length} chunks` };
  } finally {
    indexing = false;
  }
}

function loadIndexFromDisk(): boolean {
  try {
    if (!fs.existsSync(ragIndexPath)) return false;

    const data = JSON.parse(fs.readFileSync(ragIndexPath, 'utf-8'));
    if (data.version !== 1 || data.model !== embeddingModel) {
      console.log('[RAG] Index version/model mismatch, will rebuild');
      return false;
    }

    if (Array.isArray(data.chunks) && data.chunks.length > 0) {
      indexedChunks = data.chunks;
      indexReady = true;
      console.log(`[RAG] Loaded ${indexedChunks.length} chunks from disk (${data.updatedAt})`);
      return true;
    }
  } catch (err) {
    console.error('[RAG] Error loading index from disk:', err);
  }
  return false;
}

// ── Search ──────────────────────────────────────────────────────────────────

async function search(query: string, topK: number = 5): Promise<RagSearchResult[]> {
  if (!indexReady || indexedChunks.length === 0) {
    return [];
  }

  try {
    const queryEmbedding = await getEmbedding(query);

    const scored = indexedChunks.map(chunk => ({
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

    // Return top-K results with score above threshold
    const threshold = SIMILARITY_THRESHOLD;
    return scored.filter(r => r.score >= threshold).slice(0, topK);
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

export function getIndexStats(): { ready: boolean; chunksIndexed: number; indexing: boolean } {
  return {
    ready: indexReady,
    chunksIndexed: indexedChunks.length,
    indexing,
  };
}

export async function initRag(): Promise<void> {
  // Try to load from disk first
  if (loadIndexFromDisk()) {
    console.log('[RAG] Using cached index');
    return;
  }
  console.log('[RAG] No cached index found. Use POST /api/ai/index to build.');
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
